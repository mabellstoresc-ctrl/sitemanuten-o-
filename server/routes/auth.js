import {
  verifyPassword,
  hashPassword,
  newToken,
  hashToken,
  sessionCookie,
  clearCookie,
  checkNewPassword,
  SESSION,
  LOCKOUT,
} from '../auth.js';
import { HttpError, badRequest } from '../http.js';
import { loadPermissions } from '../permissions.js';
import { audit } from '../audit.js';

async function logAccess(db, ctx, { userId = null, username, event, detail = null }) {
  await db.query(
    `insert into access_log (user_id, username, event, detail, ip, user_agent) values ($1, $2, $3, $4, $5, $6)`,
    [userId, username, event, detail, ctx.ip, ctx.ua],
  );
}

export function publicUser(u, permissions) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    email: u.email,
    job_title: u.job_title,
    is_master: u.is_master,
    must_change_password: u.must_change_password,
    last_login_at: u.last_login_at,
    permissions: permissions ?? u.permissions ?? {},
  };
}

export default function (r) {
  r.post(
    '/auth/login',
    async (ctx) => {
      const db = ctx.db;
      const username = String(ctx.body?.username ?? '').trim().toLowerCase().slice(0, 100);
      const password = String(ctx.body?.password ?? '');
      const remember = Boolean(ctx.body?.remember);
      if (!username || !password) throw badRequest('Informe usuário e senha.');

      // Muitas falhas vindas do mesmo IP: bloqueia temporariamente (tentativa suspeita)
      if (ctx.ip) {
        const { rows } = await db.query(
          `select count(*)::int as n from access_log
            where ip = $1 and event in ('login_falha', 'login_bloqueado') and created_at > now() - ($2 || ' milliseconds')::interval`,
          [ctx.ip, String(LOCKOUT.ipWindowMs)],
        );
        if (rows[0].n >= LOCKOUT.ipMaxFailures) {
          await logAccess(db, ctx, { username, event: 'login_suspeito', detail: 'Excesso de tentativas deste IP' });
          throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
        }
      }

      const { rows } = await db.query('select * from users where lower(username) = $1', [username]);
      const user = rows[0];

      if (!user) {
        await verifyPassword(password, null);
        await logAccess(db, ctx, { username, event: 'login_falha', detail: 'Usuário inexistente' });
        throw new HttpError(401, 'Usuário ou senha inválidos.');
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const min = Math.ceil((new Date(user.locked_until) - Date.now()) / 60e3);
        await logAccess(db, ctx, { userId: user.id, username, event: 'login_bloqueado', detail: 'Tentativa durante bloqueio' });
        throw new HttpError(423, `Usuário bloqueado por excesso de tentativas. Tente novamente em ${min} minuto(s).`);
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        const attempts = user.failed_attempts + 1;
        if (attempts >= LOCKOUT.maxAttempts) {
          await db.query(
            `update users set failed_attempts = 0, locked_until = now() + ($2 || ' milliseconds')::interval where id = $1`,
            [user.id, String(LOCKOUT.lockMs)],
          );
          await logAccess(db, ctx, {
            userId: user.id,
            username,
            event: 'login_falha',
            detail: `Senha incorreta — usuário bloqueado por ${LOCKOUT.lockMs / 60e3} min`,
          });
          throw new HttpError(
            423,
            `Senha incorreta. Usuário bloqueado por ${LOCKOUT.lockMs / 60e3} minutos por excesso de tentativas.`,
          );
        }
        await db.query('update users set failed_attempts = $2 where id = $1', [user.id, attempts]);
        await logAccess(db, ctx, { userId: user.id, username, event: 'login_falha', detail: 'Senha incorreta' });
        throw new HttpError(401, 'Usuário ou senha inválidos.');
      }

      if (!user.is_active) {
        await logAccess(db, ctx, { userId: user.id, username, event: 'login_falha', detail: 'Usuário inativo' });
        throw new HttpError(403, 'Usuário inativo. Procure o administrador.');
      }

      const token = newToken();
      const cfg = remember ? SESSION.remember : SESSION.normal;
      await db.query(
        `insert into sessions (user_id, token_hash, remember, expires_at, ip, user_agent)
         values ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6)`,
        [user.id, hashToken(token), remember, String(cfg.absoluteMs), ctx.ip, ctx.ua],
      );
      const previousLogin = user.last_login_at;
      await db.query(
        `update users set failed_attempts = 0, locked_until = null, last_login_at = now(), last_login_ip = $2 where id = $1`,
        [user.id, ctx.ip],
      );
      await logAccess(db, ctx, { userId: user.id, username: user.username, event: 'login_ok' });
      ctx.cookies.push(sessionCookie(token, { secure: ctx.secure, remember }));

      const permissions = user.is_master ? {} : await loadPermissions(db, user.id);
      return { user: { ...publicUser(user, permissions), last_login_at: previousLogin } };
    },
    { public: true },
  );

  r.post(
    '/auth/logout',
    async (ctx) => {
      await ctx.db.query('update sessions set revoked_at = now() where id = $1', [ctx.sessionId]);
      await logAccess(ctx.db, ctx, { userId: ctx.user.id, username: ctx.user.username, event: 'logout' });
      ctx.cookies.push(clearCookie(ctx.secure));
      return { ok: true };
    },
    { allowPending: true },
  );

  r.get('/auth/me', async (ctx) => ({ user: publicUser(ctx.user) }), { allowPending: true });

  r.post(
    '/auth/change-password',
    async (ctx) => {
      const current = String(ctx.body?.current_password ?? '');
      const next = String(ctx.body?.new_password ?? '');
      const problem = checkNewPassword(next);
      if (problem) throw badRequest(problem);
      if (current === next) throw badRequest('A nova senha deve ser diferente da atual.');

      const { rows } = await ctx.db.query('select password_hash from users where id = $1', [ctx.user.id]);
      if (!(await verifyPassword(current, rows[0].password_hash))) {
        await logAccess(ctx.db, ctx, {
          userId: ctx.user.id,
          username: ctx.user.username,
          event: 'senha_falha',
          detail: 'Senha atual incorreta ao trocar senha',
        });
        throw badRequest('Senha atual incorreta.');
      }
      const hash = await hashPassword(next);
      await ctx.tx(async (c) => {
        await c.query(
          `update users set password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now()
            where id = $1`,
          [ctx.user.id, hash],
        );
        // Encerra as outras sessões deste usuário
        await c.query('update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [
          ctx.user.id,
          ctx.sessionId,
        ]);
        await audit(c, ctx, {
          module: 'usuarios',
          action: 'trocar_senha',
          entity: 'usuario',
          entityId: ctx.user.id,
          label: ctx.user.username,
        });
      });
      await logAccess(ctx.db, ctx, { userId: ctx.user.id, username: ctx.user.username, event: 'senha_alterada' });
      return { user: publicUser({ ...ctx.user, must_change_password: false }) };
    },
    { allowPending: true },
  );
}
