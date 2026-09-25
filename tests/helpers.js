// Utilitários de teste: banco limpo + cliente HTTP com cookies que chama o handler diretamente.
import pg from 'pg';

process.env.DATABASE_URL ??= 'postgresql://fleet:fleet@localhost:5432/fleet_test';
process.env.ADMIN_INITIAL_PASSWORD ??= '050410';
process.env.STORAGE_LOCAL_DIR ??= '.data/test-uploads';

export async function resetDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(`/${dbName}`, '/postgres') });
  await admin.connect();
  const { rows } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (!rows.length) await admin.query(`create database ${dbName}`);
  await admin.end();
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('drop schema public cascade; create schema public;');
  await c.end();
}

export class Client {
  constructor(handle) {
    this.handle = handle;
    this.cookies = {};
  }

  async call(method, path, body, headers = {}) {
    const h = { 'x-requested-with': 'rdm', ...headers };
    const cookie = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) h.cookie = cookie;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
    const res = await this.handle(new Request(`http://localhost${path}`, { method, headers: h, body: payload }));
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) delete this.cookies[k];
      else this.cookies[k] = v;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  get(p) {
    return this.call('GET', p);
  }
  post(p, b = {}) {
    return this.call('POST', p, b);
  }
  put(p, b = {}) {
    return this.call('PUT', p, b);
  }
  del(p, b = {}) {
    return this.call('DELETE', p, b);
  }
}
