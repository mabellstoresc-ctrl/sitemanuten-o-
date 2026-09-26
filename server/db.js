import pg from 'pg';

const { Pool, types } = pg;

// numeric -> number, bigint -> number, date -> 'YYYY-MM-DD' (sem conversão de fuso)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

let pool;

function connectionConfig() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error('DATABASE_URL não configurada');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'DATABASE_URL em formato inválido. O formato é postgresql://usuario:senha@servidor:6543/postgres — sem colchetes, sem espaços, e se a senha tiver @ # / ? % use uma senha só com letras e números.',
    );
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('DATABASE_URL deve começar com postgresql://');
  // O SSL é configurado abaixo; sslmode na URL faria o driver exigir certificado público.
  url.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}

export function getPool() {
  if (!pool) pool = new Pool(connectionConfig());
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/** Executa fn(client) dentro de uma transação. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
