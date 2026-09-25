// Registro de auditoria: quem fez, quando, em qual registro, valor anterior e novo.

function norm(v) {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v;
}

const IGNORED = new Set(['id', 'created_at', 'updated_at', 'created_by', 'password_hash']);

/** Lista de alterações [{campo, anterior, novo}] entre dois objetos. */
export function diff(before = {}, after = {}, fields) {
  const keys = fields || Object.keys(after);
  const out = [];
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = norm(before?.[k]);
    const b = norm(after?.[k]);
    if (String(a) !== String(b)) out.push({ campo: k, anterior: before?.[k] ?? null, novo: after?.[k] ?? null });
  }
  return out;
}

export function snapshot(obj = {}, fields) {
  const keys = fields || Object.keys(obj);
  return keys
    .filter((k) => !IGNORED.has(k) && obj[k] !== null && obj[k] !== undefined && obj[k] !== '')
    .map((k) => ({ campo: k, anterior: null, novo: obj[k] }));
}

/**
 * @param db cliente/pool
 * @param ctx contexto da requisição (user, ip)
 * @param e { module, action, entity, entityId, label, changes, reason }
 */
export async function audit(db, ctx, e) {
  if (e.action === 'editar' && Array.isArray(e.changes) && e.changes.length === 0) return;
  await db.query(
    `insert into audit_log (user_id, username, module, action, entity, entity_id, entity_label, changes, reason, ip)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.user?.id ?? null,
      ctx.user?.username ?? 'sistema',
      e.module,
      e.action,
      e.entity,
      e.entityId != null ? String(e.entityId) : null,
      e.label ?? null,
      e.changes ? JSON.stringify(e.changes) : null,
      e.reason ?? null,
      ctx.ip ?? null,
    ],
  );
}

export async function vehicleEvent(db, ctx, vehicleId, ev) {
  await db.query(
    `insert into vehicle_events (vehicle_id, event_at, type, title, description, ref_table, ref_id, data, user_id)
     values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8, $9)`,
    [
      vehicleId,
      ev.at ?? null,
      ev.type,
      ev.title,
      ev.description ?? null,
      ev.refTable ?? null,
      ev.refId != null ? String(ev.refId) : null,
      ev.data ? JSON.stringify(ev.data) : null,
      ctx.user?.id ?? null,
    ],
  );
}
