import { getPool, tx } from './db.js';
import { bootstrap } from './bootstrap.js';
import { HttpError, json, parseCookies, clientIp } from './http.js';
import { cookieName, hashToken, SESSION, clearCookie } from './auth.js';
import { loadPermissions } from './permissions.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import vehicleRoutes from './routes/vehicles.js';
import driverRoutes from './routes/drivers.js';
import fileRoutes from './routes/files.js';
import miscRoutes from './routes/misc.js';
import fuelRoutes from './routes/fuel.js';
import maintenanceRoutes from './routes/maintenance.js';
import tireRoutes from './routes/tires.js';

// ---------- Roteador ----------
const routes = [];

function add(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ method, re, keys, handler, opts });
}

const r = {
  get: (p, h, o) => add('GET', p, h, o),
  post: (p, h, o) => add('POST', p, h, o),
  put: (p, h, o) => add('PUT', p, h, o),
  del: (p, h, o) => add('DELETE', p, h, o),
};

for (const register of [authRoutes, userRoutes, fuelRoutes, maintenanceRoutes, tireRoutes, vehicleRoutes, driverRoutes, fileRoutes, miscRoutes]) register(r);

function match(method, path) {
  let pathMatched = false;
  for (const rt of routes) {
    const m = rt.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (rt.method !== method) continue;
    const params = {};
    rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { rt, params };
  }
  return { pathMatched };
}

// ---------- Sessão ----------
async function loadSession(ctx) {
  const cookies = parseCookies(ctx.req.headers.get('cookie'));
  const token = cookies[cookieName(ctx.secure)] ?? cookies[cookieName(!ctx.secure)];
  if (!token) return;
  const db = getPool();
  const { rows } = await db.query(
    `select s.id as session_id, s.remember, s.last_seen_at, s.expires_at,
            u.id, u.username, u.full_name, u.email, u.job_title, u.is_active, u.is_master,
            u.must_change_password, u.last_login_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) {
    ctx.expiredSession = true;
    return;
  }
  const now = Date.now();
  const idle = row.remember ? SESSION.remember.idleMs : SESSION.normal.idleMs;
  if (new Date(row.expires_at).getTime() < now || new Date(row.last_seen_at).getTime() + idle < now || !row.is_active) {
    await db.query('update sessions set revoked_at = now() where id = $1', [row.session_id]);
    ctx.expiredSession = true;
    return;
  }
  // Evita escrever no banco a cada requisição
  if (now - new Date(row.last_seen_at).getTime() > 60e3) {
    await db.query('update sessions set last_seen_at = now() where id = $1', [row.session_id]);
  }
  const user = {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    job_title: row.job_title,
    is_active: row.is_active,
    is_master: row.is_master,
    must_change_password: row.must_change_password,
    last_login_at: row.last_login_at,
  };
  user.permissions = user.is_master ? {} : await loadPermissions(db, user.id);
  ctx.user = user;
  ctx.sessionId = row.session_id;
}

// ---------- Handler principal ----------
export async function handle(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
  const method = req.method.toUpperCase();
  const secure = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

  const ctx = {
    req,
    url,
    path,
    method,
    secure,
    ip: clientIp(req),
    ua: (req.headers.get('user-agent') || '').slice(0, 300),
    query: Object.fromEntries(url.searchParams),
    db: getPool(),
    tx,
    cookies: [],
  };

  try {
    if (path === '/health') {
      return json({ ok: true });
    }
    // Diagnóstico da instalação (não expõe senhas nem chaves): /api/diagnostico
    if (path === '/diagnostico') {
      return json(await diagnostics());
    }

    await bootstrap();

    const { rt, params, pathMatched } = match(method, path);
    if (!rt) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Método não permitido.' : 'Rota não encontrada.');
    ctx.params = params;

    // Proteção CSRF: toda escrita precisa vir do próprio sistema
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers.get('x-requested-with') !== 'rdm') throw new HttpError(403, 'Requisição bloqueada.');
      const origin = req.headers.get('origin');
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          /* origem inválida */
        }
        const hosts = [url.host, req.headers.get('host'), req.headers.get('x-forwarded-host')].filter(Boolean);
        if (!hosts.includes(originHost)) throw new HttpError(403, 'Origem não permitida.');
      }
    }

    if (!rt.opts.public) {
      await loadSession(ctx);
      if (!ctx.user) {
        const res = json({ error: 'Sessão expirada. Faça login novamente.', code: 'NAO_AUTENTICADO' }, 401);
        if (ctx.expiredSession) res.headers.append('set-cookie', clearCookie(secure));
        return res;
      }
      if (ctx.user.must_change_password && !rt.opts.allowPending) {
        throw new HttpError(403, 'É necessário trocar a senha antes de continuar.', { code: 'TROCAR_SENHA' });
      }
    }

    if (rt.opts.raw) {
      ctx.rawBody = Buffer.from(await req.arrayBuffer());
    } else if (method !== 'GET' && method !== 'HEAD') {
      const text = await req.text();
      try {
        ctx.body = text ? JSON.parse(text) : {};
      } catch {
        throw new HttpError(400, 'JSON inválido.');
      }
    }

    const result = await rt.handler(ctx);
    const res = result instanceof Response ? result : json(result ?? { ok: true });
    for (const c of ctx.cookies) res.headers.append('set-cookie', c);
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message, ...err.extra }, err.status);
    }
    // Violação de unicidade / chave estrangeira do Postgres
    if (err?.code === '23505') {
      return json({ error: duplicateMessage(err), code: 'DUPLICADO' }, 409);
    }
    if (err?.code === '22P02') {
      return json({ error: 'Identificador ou valor inválido.' }, 400);
    }
    if (err?.code === '23503') {
      return json(
        { error: 'Este registro possui outros registros vinculados. Use Inativar/Cancelar em vez de excluir.', code: 'VINCULADO' },
        409,
      );
    }
    console.error('[api] erro', method, path, err);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
}

async function diagnostics() {
  const env = (k) => Boolean(process.env[k] && process.env[k].trim());
  const out = {
    variaveis: {
      DATABASE_URL: env('DATABASE_URL'),
      SUPABASE_URL: env('SUPABASE_URL'),
      SUPABASE_SERVICE_KEY: env('SUPABASE_SERVICE_KEY'),
      ADMIN_INITIAL_PASSWORD: env('ADMIN_INITIAL_PASSWORD'),
    },
  };
  const raw = process.env.DATABASE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      out.banco_endereco = { servidor: u.hostname, porta: u.port, usuario: decodeURIComponent(u.username), tem_senha: Boolean(u.password) };
      if (/[[\]]/.test(raw)) out.aviso = 'A DATABASE_URL contém colchetes [ ]. Remova-os (eles só marcavam onde vai a senha).';
      else if ((raw.match(/@/g) || []).length > 1) out.aviso = 'A DATABASE_URL tem mais de um @. Se a senha tem @, escreva %40 no lugar dele.';
    } catch {
      out.aviso = 'A DATABASE_URL não está num formato válido (postgresql://usuario:senha@servidor:6543/postgres).';
    }
  }
  const t0 = Date.now();
  try {
    // Primeiro só testa a conexão (rápido), depois cria/atualiza as tabelas
    await getPool().query('select 1');
    out.conexao_ms = Date.now() - t0;
    await bootstrap();
    const { rows } = await getPool().query("select (select count(*) from users where is_master)::int as admin, (select count(*) from users)::int as usuarios");
    out.banco = 'conectado';
    out.administrador_criado = rows[0].admin > 0;
    out.usuarios = rows[0].usuarios;
    if (!out.administrador_criado) out.aviso = 'Banco OK, mas o administrador não foi criado: confira a variável ADMIN_INITIAL_PASSWORD e faça um novo deploy.';
  } catch (err) {
    out.banco = 'erro';
    out.tempo_ms = Date.now() - t0;
    if (/timeout|terminated/i.test(String(err.message))) {
      out.aviso = 'O banco não respondeu. Confira na DATABASE_URL o servidor (…pooler.supabase.com), a porta 6543 e se o projeto do Supabase não está pausado.';
    } else if (/password authentication|Tenant or user not found/i.test(String(err.message))) {
      out.aviso = 'O banco recusou o usuário/senha. Confira a senha dentro da DATABASE_URL (Supabase → Project Settings → Database para redefinir).';
    }
    out.erro_banco = String(err.message || err).replace(/postgres(ql)?:\/\/[^\s]+/g, '[endereço oculto]').slice(0, 300);
  }
  out.ok = out.banco === 'conectado' && out.administrador_criado;
  return out;
}

function duplicateMessage(err) {
  const c = err.constraint || '';
  if (c.includes('plate')) return 'Já existe um veículo com esta placa.';
  if (c.includes('fleet')) return 'Já existe um veículo com este número de frota.';
  if (c.includes('cpf')) return 'Já existe um motorista com este CPF.';
  if (c.includes('username')) return 'Já existe um usuário com este nome de usuário.';
  if (c.includes('open_vehicle')) return 'Este veículo já possui um motorista vinculado.';
  if (c.includes('open_driver')) return 'Este motorista já está vinculado a outro veículo.';
  if (c.includes('open_trailer')) return 'Este implemento já está engatado em outro veículo.';
  if (c.includes('tires_code')) return 'Já existe um pneu com este código.';
  if (c.includes('tires_fire')) return 'Já existe um pneu com este número de fogo.';
  if (c.includes('tires_position')) return 'Esta posição já tem um pneu.';
  if (c.includes('tire_retreads_open')) return 'Este pneu já está na recapagem.';
  if (c.includes('fuelings_order')) return 'Esta ordem de abastecimento já foi utilizada em outro abastecimento.';
  return 'Registro duplicado.';
}
