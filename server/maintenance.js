import { DEFAULT_SETTINGS, OIL_CATEGORY } from '../shared/constants.js';

export async function alertSettings(db) {
  const { rows } = await db.query("select value from settings where key = 'alertas'");
  return { ...DEFAULT_SETTINGS.alertas, ...(rows[0]?.value || {}) };
}

/** KM médio por dia de cada veículo (leituras válidas dos últimos 90 dias). */
export async function dailyKm(db, vehicleId = null) {
  const { rows } = await db.query(
    `select vehicle_id,
            (max(km) - min(km))::float / greatest(extract(epoch from max(reading_at) - min(reading_at)) / 86400, 1) as per_day,
            extract(epoch from max(reading_at) - min(reading_at)) / 86400 as span
       from km_readings
      where not invalidated and reading_at > now() - interval '90 days' and ($1::uuid is null or vehicle_id = $1)
      group by vehicle_id`,
    [vehicleId],
  );
  const out = {};
  for (const r of rows) if (r.span >= 7 && r.per_day > 0) out[r.vehicle_id] = r.per_day;
  return out;
}

/**
 * Próximas manutenções ("plano"): para cada veículo e categoria, vale a manutenção válida mais recente.
 * Se ela tem próxima data e/ou próximo KM, gera um item. Uma manutenção com várias categorias
 * (ex.: revisão + troca de óleo + filtros) gera um único item com todas elas.
 *
 * Situação: vencida (data passou ou KM atingido), proxima (dentro do aviso configurado), ok.
 */
export async function maintenancePlans(db, { vehicleId = null } = {}) {
  const cfg = await alertSettings(db);
  const perDay = await dailyKm(db, vehicleId);
  const { rows } = await db.query(
    `with cats as (
       select m.id, m.vehicle_id, m.performed_on, m.km, m.next_date, m.next_km, m.type, m.description, c.cat,
              row_number() over (partition by m.vehicle_id, c.cat order by m.performed_on desc, m.km desc nulls last, m.created_at desc) as rn
         from maintenances m cross join unnest(m.categories) as c(cat)
        where m.status = 'ativo' and ($1::uuid is null or m.vehicle_id = $1))
     select c.id as maintenance_id, c.vehicle_id, c.performed_on, c.km, c.next_date, c.next_km, c.type, c.description,
            array_agg(c.cat order by c.cat) as categories,
            v.plate, v.fleet_number, v.model, v.current_km, v.status as vehicle_status,
            (c.next_date - (now() at time zone 'America/Sao_Paulo')::date) as days_left, (c.next_km - v.current_km) as km_left
       from cats c join vehicles v on v.id = c.vehicle_id
      where c.rn = 1 and (c.next_date is not null or c.next_km is not null) and v.status <> 'inativo'
      group by c.id, c.vehicle_id, c.performed_on, c.km, c.next_date, c.next_km, c.type, c.description,
               v.plate, v.fleet_number, v.model, v.current_km, v.status`,
    [vehicleId],
  );
  const today = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z');
  return rows
    .map((p) => {
      const isOil = p.categories.includes(OIL_CATEGORY);
      const kmWarn = isOil ? cfg.oleo_km : cfg.manutencao_km;
      const overdue = (p.days_left !== null && p.days_left < 0) || (p.km_left !== null && p.km_left <= 0);
      const soon = (p.days_left !== null && p.days_left <= cfg.manutencao_dias) || (p.km_left !== null && p.km_left <= kmWarn);
      // Data estimada para o KM, pelo ritmo de rodagem dos últimos 90 dias
      let estimated = null;
      if (p.km_left !== null && perDay[p.vehicle_id]) {
        const days = Math.max(0, Math.round(p.km_left / perDay[p.vehicle_id]));
        estimated = new Date(today.getTime() + days * 864e5).toISOString().slice(0, 10);
      }
      const dueCandidates = [p.next_date, estimated].filter(Boolean).sort();
      return {
        ...p,
        is_oil: isOil,
        km_per_day: perDay[p.vehicle_id] ? Math.round(perDay[p.vehicle_id]) : null,
        estimated_date: estimated,
        due_date: dueCandidates[0] || null,
        state: overdue ? 'vencida' : soon ? 'proxima' : 'ok',
      };
    })
    .sort((a, b) => {
      const o = { vencida: 0, proxima: 1, ok: 2 };
      return o[a.state] - o[b.state] || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
    });
}

/** Situação da troca de óleo de cada veículo com motor (inclui os que nunca registraram troca). */
export async function oilStatus(db, { vehicleId = null } = {}) {
  const cfg = await alertSettings(db);
  const { rows } = await db.query(
    `select v.id as vehicle_id, v.plate, v.fleet_number, v.model, v.current_km, v.status as vehicle_status,
            m.id as maintenance_id, m.performed_on, m.km as last_km, m.next_km, m.next_date, m.oil_brand, m.oil_type, m.oil_spec,
            m.oil_quantity, m.oil_filter, m.fuel_filter, m.air_filter, m.workshop, m.total,
            (m.next_km - v.current_km) as km_left, (m.next_date - (now() at time zone 'America/Sao_Paulo')::date) as days_left,
            (v.current_km - m.km) as km_since
       from vehicles v
       left join lateral (
         select * from maintenances x where x.vehicle_id = v.id and x.status = 'ativo' and $2 = any(x.categories)
          order by x.performed_on desc, x.km desc nulls last, x.created_at desc limit 1) m on true
      where v.status <> 'inativo' and v.type not in ('carreta', 'implemento') and ($1::uuid is null or v.id = $1)
      order by v.fleet_number nulls last, v.plate`,
    [vehicleId, OIL_CATEGORY],
  );
  return rows.map((r) => {
    let state = 'sem_registro';
    if (r.maintenance_id) {
      if ((r.km_left !== null && r.km_left <= 0) || (r.days_left !== null && r.days_left < 0)) state = 'vencida';
      else if ((r.km_left !== null && r.km_left <= cfg.oleo_km) || (r.days_left !== null && r.days_left <= cfg.manutencao_dias)) state = 'proxima';
      else if (r.next_km === null && r.next_date === null) state = 'sem_proxima';
      else state = 'ok';
    }
    return { ...r, state };
  });
}
