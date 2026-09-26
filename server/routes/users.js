import { validate } from '../validate.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { hashPassword, checkNewPassword } from '../auth.js';
import {
  requirePerm,
  requireAny,
  loadPermissions,
  sanitizePermissions,
  assertCanGrant,
  savePermissions,
} from '../permissions.js';
import { audit, diff } from '../audit.js';

const USER_FIELDS = {
  full_name: { type: 'string', required: true, max: 120, label: 'Nome completo' },
  username: { type: 'string', required: true, max: 40, min: 3, label: 'Usuário' },
  email: { type: 'email', label: 'E-mail' },
  job_title: { type: 'string', max: 80, label: 'Cargo' },
  is_active: { type: 'bool', label: 'Status' },
  must_change_password: { type: 'bool', label: 'Trocar senha no primeiro acesso' },
};

function normalizeUsername(u) {
  const s = String(u).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) {
    throw badRequest('Usuário: use de 3 a 40 caracteres (letras sem acento, números, ponto, hífen ou _).', {
      fields: { username: 'Formato inválido' },
    });
  }
  return s;
}

const LIST_SQL = `
  select u.id, u.username, u.full_name, u.email, u.job_title, u.is_active, u.is_master,
         u.must_change_password, u.last_login_at, u.created_at, u.locked_until,
         (select username from users c where c.id = u.created_by) as created_by_name
    from users u`;

async function getUser(db, id) {
  const { rows } = await db.query(`${LIST_SQL} where u.id = $1`, [id]);
  if (!rows[0]) throw notFound('Usuário não encontrado.');
  return rows[0];
}

/**
 * Regras de proteção:
 * - ninguém altera o Administrador Principal, exceto ele mesmo (dados básicos);
 * - um usuário comum só gerencia usuários cujas permissões ele também possui
 *   (assim ninguém consegue bloquear ou rebaixar alguém com mais acesso).
 */
async function assertCanManage(db, actor, target, { selfAllowed = false } = {}) {
  if (actor.is_master) return;
  if (target.is_master) throw forbidden('O Administrador Principal não pode ser alterado por outros usuários.');
  if (target.id === actor.id) {
    if (selfAllowed) return;
    throw forbidden('Você não pode alterar seu próprio acesso.');
  }
  const perms = await loadPermissions(db, target.id);
  for (const [mod, acts] of Object.entries(perms)) {
    for (const a of acts) {
      if (!actor.permissions?.[mod]?.includes(a)) {
        throw forbidden('Este usuário possui permissões que você não tem. Somente o Administrador Principal pode alterá-lo.');
      }
    }
  }
}

export default function (r) {
  r.get('/users', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'ver');
    const { rows } = await ctx.db.query(`${LIST_SQL} order by u.is_master desc, u.full_name`);
    return { users: rows };
  });

  r.get('/users/permissions-overview', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'ver');
    const { rows } = await ctx.db.query('select user_id, module, actions from user_permissions');
    const permissions = {};
    for (const r of rows) (permissions[r.user_id] ??= {})[r.module] = r.actions;
    return { permissions };
  });

  r.get('/users/:id', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'ver');
    const user = await getUser(ctx.db, ctx.params.id);
    user.permissions = user.is_master ? null : await loadPermissions(ctx.db, user.id);
    const { rows: sessions } = await ctx.db.query(
      `select id, created_at, last_seen_at, expires_at, ip, user_agent, remember from sessions
        where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
      [user.id],
    );
    user.active_sessions = sessions;
    return { user };
  });

  r.post('/users', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'cadastrar');
    const data = validate(ctx.body, USER_FIELDS);
    data.username = normalizeUsername(data.username);
    const password = String(ctx.body?.password ?? '');
    const problem = checkNewPassword(password);
    if (problem) throw badRequest(problem, { fields: { password: problem } });
    if (ctx.body?.is_active === undefined) data.is_active = true;
    if (ctx.body?.must_change_password === undefined) data.must_change_password = true;

    const perms = sanitizePermissions(ctx.body?.permissions);
    assertCanGrant(ctx.user, perms);
    const hash = await hashPassword(password);

    const id = await ctx.tx(async (c) => {
      const { rows } = await c.query(
        `insert into users (username, full_name, email, job_title, is_active, must_change_password, password_hash, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [data.username, data.full_name, data.email, data.job_title, data.is_active, data.must_change_password, hash, ctx.user.id],
      );
      const newId = rows[0].id;
      await savePermissions(c, newId, perms);
      await audit(c, ctx, {
        module: 'usuarios',
        action: 'criar',
        entity: 'usuario',
        entityId: newId,
        label: data.username,
        changes: [
          ...Object.entries(data).map(([campo, novo]) => ({ campo, anterior: null, novo })),
          { campo: 'permissoes', anterior: null, novo: perms },
        ],
      });
      return newId;
    });
    return { id };
  });

  r.put('/users/:id', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'editar');
    const target = await getUser(ctx.db, ctx.params.id);
    const self = target.id === ctx.user.id;
    await assertCanManage(ctx.db, ctx.user, target, { selfAllowed: true });

    const data = validate(ctx.body, USER_FIELDS, { partial: true });
    if (data.username !== undefined) data.username = normalizeUsername(data.username);
    // O próprio usuário e o Administrador Principal não podem se desativar
    if ((self || target.is_master) && data.is_active === false) throw forbidden('Este usuário não pode ser desativado.');
    if (target.is_master) delete data.is_active;
    if (self) delete data.must_change_password;

    let perms;
    if (ctx.body?.permissions !== undefined) {
      if (target.is_master) throw forbidden('O Administrador Principal sempre tem acesso total.');
      if (self) throw forbidden('Você não pode alterar suas próprias permissões.');
      perms = sanitizePermissions(ctx.body.permissions);
      assertCanGrant(ctx.user, perms);
    }

    await ctx.tx(async (c) => {
      const fields = Object.keys(data);
      if (fields.length) {
        const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
        await c.query(`update users set ${sets}, updated_at = now() where id = $1`, [target.id, ...fields.map((f) => data[f])]);
      }
      const changes = diff(target, data, fields);
      if (perms) {
        const before = await loadPermissions(c, target.id);
        if (JSON.stringify(before) !== JSON.stringify(perms)) {
          await savePermissions(c, target.id, perms);
          await audit(c, ctx, {
            module: 'usuarios',
            action: 'alterar_permissoes',
            entity: 'usuario',
            entityId: target.id,
            label: target.username,
            changes: [{ campo: 'permissoes', anterior: before, novo: perms }],
          });
        }
      }
      if (data.is_active === false) {
        await c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [target.id]);
      }
      await audit(c, ctx, { module: 'usuarios', action: 'editar', entity: 'usuario', entityId: target.id, label: target.username, changes });
    });
    return { ok: true };
  });

  r.post('/users/:id/reset-password', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'editar');
    const target = await getUser(ctx.db, ctx.params.id);
    await assertCanManage(ctx.db, ctx.user, target);
    const password = String(ctx.body?.password ?? '');
    const problem = checkNewPassword(password);
    if (problem) throw badRequest(problem);
    const hash = await hashPassword(password);
    await ctx.tx(async (c) => {
      await c.query(
        `update users set password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = null, updated_at = now()
          where id = $1`,
        [target.id, hash],
      );
      await c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [target.id]);
      await audit(c, ctx, {
        module: 'usuarios',
        action: 'redefinir_senha',
        entity: 'usuario',
        entityId: target.id,
        label: target.username,
      });
    });
    return { ok: true };
  });

  r.post('/users/:id/status', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'editar');
    const target = await getUser(ctx.db, ctx.params.id);
    await assertCanManage(ctx.db, ctx.user, target);
    if (target.is_master) throw forbidden('O Administrador Principal não pode ser desativado.');
    if (target.id === ctx.user.id) throw forbidden('Você não pode desativar a si mesmo.');
    const active = Boolean(ctx.body?.is_active);
    await ctx.tx(async (c) => {
      await c.query('update users set is_active = $2, updated_at = now() where id = $1', [target.id, active]);
      if (!active) await c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [target.id]);
      await audit(c, ctx, {
        module: 'usuarios',
        action: active ? 'ativar' : 'desativar',
        entity: 'usuario',
        entityId: target.id,
        label: target.username,
        changes: [{ campo: 'is_active', anterior: target.is_active, novo: active }],
        reason: ctx.body?.reason ? String(ctx.body.reason).slice(0, 500) : null,
      });
    });
    return { ok: true };
  });

  r.post('/users/:id/unlock', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'editar');
    const target = await getUser(ctx.db, ctx.params.id);
    await assertCanManage(ctx.db, ctx.user, target);
    await ctx.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [target.id]);
    await audit(ctx.db, ctx, { module: 'usuarios', action: 'desbloquear', entity: 'usuario', entityId: target.id, label: target.username });
    return { ok: true };
  });

  r.post('/users/:id/revoke-sessions', async (ctx) => {
    requirePerm(ctx.user, 'usuarios', 'editar');
    const target = await getUser(ctx.db, ctx.params.id);
    await assertCanManage(ctx.db, ctx.user, target, { selfAllowed: true });
    await ctx.db.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and id <> $2', [
      target.id,
      ctx.sessionId,
    ]);
    await audit(ctx.db, ctx, {
      module: 'usuarios',
      action: 'encerrar_sessoes',
      entity: 'usuario',
      entityId: target.id,
      label: target.username,
    });
    return { ok: true };
  });

  // Histórico de acessos (login, logout, falhas, bloqueios)
  r.get('/access-log', async (ctx) => {
    requireAny(ctx.user, [
      ['usuarios', 'ver'],
      ['auditoria', 'ver'],
    ]);
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`user_id = $${params.length}`);
    }
    if (q.event) {
      params.push(q.event);
      where.push(`event = $${params.length}`);
    }
    if (q.falhas === '1') where.push(`event in ('login_falha','login_bloqueado','login_suspeito','senha_falha')`);
    if (q.from) {
      params.push(q.from);
      where.push(`created_at >= ($${params.length}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`created_at < ($${params.length}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    const limit = Math.min(Number(q.limit) || 200, 1000);
    const { rows } = await ctx.db.query(
      `select id, user_id, username, event, detail, ip, user_agent, created_at from access_log
        ${where.length ? 'where ' + where.join(' and ') : ''} order by created_at desc limit ${limit}`,
      params,
    );
    return { entries: rows };
  });
}
