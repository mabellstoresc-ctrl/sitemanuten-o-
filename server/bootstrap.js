import { tx } from './db.js';
import migrations from './migrations/index.js';
import { hashPassword, hashToken } from './auth.js';
import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { ensureBucket } from './storage.js';

// Executado na primeira requisição de cada instância da função.
// Aplica migrações pendentes e garante que o Administrador Principal exista.

let ready;
export const MASTER_USERNAME = 'bernardo';

export function bootstrap() {
  if (!ready) {
    ready = run().catch((err) => {
      ready = undefined; // tenta de novo na próxima requisição
      throw err;
    });
  }
  return ready;
}

async function run() {
  await tx(async (c) => {
    // Lock de transação: evita duas instâncias migrando ao mesmo tempo (funciona com pooler)
    await c.query('select pg_advisory_xact_lock(727274)');
    await c.query(`create table if not exists schema_migrations (
      version text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await c.query('select version from schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await c.query(m.sql);
      await c.query('insert into schema_migrations (version) values ($1)', [m.version]);
      console.log(`[bootstrap] migração aplicada: ${m.version}`);
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query('insert into settings (key, value) values ($1, $2) on conflict (key) do nothing', [
        key,
        JSON.stringify(value),
      ]);
    }

    await ensureMaster(c);
  });
  await ensureBucket().catch((err) => console.error('[bootstrap] storage:', err.message));
}

async function ensureMaster(c) {
  const { rows } = await c.query('select id from users where is_master');
  if (!rows.length) {
    const initial = process.env.ADMIN_INITIAL_PASSWORD;
    if (!initial) {
      console.error('[bootstrap] ADMIN_INITIAL_PASSWORD não configurada: Administrador Principal não criado.');
      return;
    }
    const hash = await hashPassword(initial);
    const { rows: created } = await c.query(
      `insert into users (username, full_name, job_title, is_master, must_change_password, password_hash)
       values ($1, 'Bernardo', 'Administrador Principal', true, true, $2) returning id`,
      [MASTER_USERNAME, hash],
    );
    await c.query(
      `insert into audit_log (username, module, action, entity, entity_id, entity_label)
       values ('sistema', 'usuarios', 'criar', 'usuario', $1, $2)`,
      [created[0].id, MASTER_USERNAME],
    );
    console.log('[bootstrap] Administrador Principal criado.');
    return;
  }

  // Recuperação de senha do Administrador Principal via variável de ambiente.
  // Aplicada uma única vez para cada valor diferente de ADMIN_RESET_PASSWORD.
  const reset = process.env.ADMIN_RESET_PASSWORD;
  if (reset) {
    const marker = hashToken(`reset:${reset}`);
    const { rows: done } = await c.query("select 1 from settings where key = 'admin_reset_aplicado' and value = $1", [
      JSON.stringify(marker),
    ]);
    if (!done.length) {
      const hash = await hashPassword(reset);
      await c.query(
        `update users set password_hash = $1, must_change_password = true, failed_attempts = 0,
           locked_until = null, is_active = true, updated_at = now() where is_master`,
        [hash],
      );
      await c.query(
        `update sessions set revoked_at = now() where revoked_at is null and user_id = (select id from users where is_master)`,
      );
      await c.query(
        `insert into settings (key, value) values ('admin_reset_aplicado', $1)
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(marker)],
      );
      await c.query(
        `insert into audit_log (username, module, action, entity, entity_label, reason)
         values ('sistema', 'usuarios', 'redefinir_senha', 'usuario', $1, 'ADMIN_RESET_PASSWORD')`,
        [MASTER_USERNAME],
      );
      console.log('[bootstrap] Senha do Administrador Principal redefinida via ADMIN_RESET_PASSWORD.');
    }
  }
}
