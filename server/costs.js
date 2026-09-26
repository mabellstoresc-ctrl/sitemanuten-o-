// Custos consolidados: cada módulo contribui com suas linhas (sem digitar duas vezes).
import {
  COST_SOURCES,
  COST_CATEGORIES,
  FUELING_TYPES,
  MAINTENANCE_CATEGORIES,
  DOCUMENT_TYPES,
  TOWED_TYPES,
  labelOf,
} from '../shared/constants.js';

const n = (v, d = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Linhas de custo de todos os módulos. Datas no fuso de Brasília.
const ENTRIES_SQL = `
  select 'combustivel' as source, null::text as category, f.vehicle_id, (f.fueled_at at time zone 'America/Sao_Paulo')::date as date, f.total::float as amount,
         json_build_object('fuel_type', f.fuel_type, 'liters', f.liters, 'station', f.station) as info, 'abastecimento' as ref, f.id as ref_id
    from fuelings f where f.status = 'ativo' and f.fuel_type <> 'arla32' and f.total > 0
  union all
  select 'arla', null, f.vehicle_id, (f.fueled_at at time zone 'America/Sao_Paulo')::date, f.total::float,
         json_build_object('fuel_type', f.fuel_type, 'liters', f.liters, 'station', f.station), 'abastecimento', f.id
    from fuelings f where f.status = 'ativo' and f.fuel_type = 'arla32' and f.total > 0
  union all
  select 'manutencao', m.type, m.vehicle_id, m.performed_on, m.total::float,
         json_build_object('categories', m.categories, 'workshop', m.workshop), 'manutencao', m.id
    from maintenances m where m.status = 'ativo' and m.total > 0
  union all
  select 'pneus', null,
         (select tm.to_vehicle_id from tire_movements tm where tm.tire_id = t.id and tm.action = 'instalar' order by tm.moved_at limit 1),
         coalesce(t.purchase_date, (t.created_at at time zone 'America/Sao_Paulo')::date), t.purchase_value::float,
         json_build_object('code', t.code, 'brand', t.brand, 'size', t.size), 'pneu', t.id
    from tires t where t.purchase_value > 0
  union all
  select 'recapagem', null,
         (select tm.from_vehicle_id from tire_movements tm where tm.tire_id = r.tire_id and tm.action = 'recapagem'
             and tm.moved_at <= r.created_at + interval '1 minute' order by tm.moved_at desc limit 1),
         coalesce(r.returned_on, r.sent_on), r.cost::float,
         json_build_object('code', t.code, 'company', r.company), 'pneu', t.id
    from tire_retreads r join tires t on t.id = r.tire_id where r.cost > 0
  union all
  select 'documentos', d.type, d.vehicle_id, coalesce(d.issued_on, d.valid_from, (d.created_at at time zone 'America/Sao_Paulo')::date), d.amount::float,
         json_build_object('type', d.type, 'number', d.number, 'issuer', d.issuer), 'documento', d.id
    from documents d where d.status <> 'cancelado' and d.amount > 0
  union all
  select 'avulso', c.category, c.vehicle_id, c.cost_date, c.amount::float,
         json_build_object('description', c.description, 'supplier', c.supplier), 'custo', c.id
    from costs c where c.status = 'ativo'`;

function describe(e) {
  const i = e.info || {};
  switch (e.source) {
    case 'combustivel':
    case 'arla':
      return [`${n(i.liters, i.liters % 1 ? 2 : 0)} L de ${labelOf(FUELING_TYPES, i.fuel_type)}`, i.station].filter(Boolean).join(' · ');
    case 'manutencao':
      return [(i.categories || []).map((c) => labelOf(MAINTENANCE_CATEGORIES, c)).join(', '), i.workshop].filter(Boolean).join(' · ');
    case 'pneus':
      return [`Pneu ${i.code}`, i.brand, i.size].filter(Boolean).join(' · ');
    case 'recapagem':
      return [`Recapagem do pneu ${i.code}`, i.company].filter(Boolean).join(' · ');
    case 'documentos':
      return [labelOf(DOCUMENT_TYPES, i.type), i.number && `nº ${i.number}`, i.issuer].filter(Boolean).join(' · ');
    default:
      return [i.description, i.supplier].filter(Boolean).join(' · ');
  }
}

/** Categoria exibida: origem automática ou, no lançamento avulso, a categoria escolhida. */
export function categoryKey(e) {
  return e.source === 'avulso' ? `avulso:${e.category}` : e.source;
}

export function categoryLabel(key) {
  if (key.startsWith('avulso:')) return labelOf(COST_CATEGORIES, key.slice(7));
  return labelOf(COST_SOURCES, key);
}

function where(q) {
  const cond = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (q.from) cond.push(`e.date >= ${p(q.from)}::date`);
  if (q.to) cond.push(`e.date <= ${p(q.to)}::date`);
  if (q.vehicle_id === 'geral') cond.push('e.vehicle_id is null');
  else if (q.vehicle_id) cond.push(`e.vehicle_id = ${p(q.vehicle_id)}`);
  if (q.source) cond.push(`e.source = ${p(q.source)}`);
  return { sql: cond.length ? `where ${cond.join(' and ')}` : '', params };
}

/** Linhas de custo (mais recentes primeiro). */
export async function costEntries(db, q = {}, limit = 5000) {
  const w = where(q);
  const { rows } = await db.query(
    `select e.*, v.plate, v.fleet_number, v.type as vehicle_type
       from (${ENTRIES_SQL}) e left join vehicles v on v.id = e.vehicle_id
       ${w.sql} order by e.date desc, e.source limit ${Number(limit) || 5000}`,
    w.params,
  );
  for (const e of rows) {
    e.description = describe(e);
    e.category_key = categoryKey(e);
    e.category_label = categoryLabel(e.category_key);
  }
  return rows;
}

/**
 * KM rodado por veículo no período (leituras válidas): maior leitura até o fim menos
 * maior leitura antes do início (ou a primeira leitura dentro do período).
 */
export async function kmInPeriod(db, { from = null, to = null, vehicleId = null } = {}) {
  const { rows } = await db.query(
    `select v.id,
            (select max(km) from km_readings k where k.vehicle_id = v.id and not k.invalidated
                and ($2::date is null or k.reading_at < ($2::date + 1)::timestamp at time zone 'America/Sao_Paulo')) as end_km,
            (select max(km) from km_readings k where k.vehicle_id = v.id and not k.invalidated and $1::date is not null
                and k.reading_at < ($1::date)::timestamp at time zone 'America/Sao_Paulo') as start_km,
            (select min(km) from km_readings k where k.vehicle_id = v.id and not k.invalidated
                and ($1::date is null or k.reading_at >= ($1::date)::timestamp at time zone 'America/Sao_Paulo')
                and ($2::date is null or k.reading_at < ($2::date + 1)::timestamp at time zone 'America/Sao_Paulo')) as first_km
       from vehicles v where not (v.type = any($3)) and ($4::uuid is null or v.id = $4)`,
    [from, to, TOWED_TYPES, vehicleId],
  );
  const out = {};
  for (const r of rows) {
    const start = r.start_km ?? r.first_km;
    if (r.end_km !== null && start !== null && r.end_km > start) out[r.id] = r.end_km - start;
  }
  return out;
}

/** Resumo: total, por categoria, por veículo (com custo/km) e por mês. */
export async function costSummary(db, q = {}) {
  const entries = await costEntries(db, q, 1_000_000);
  const km = await kmInPeriod(db, { from: q.from || null, to: q.to || null, vehicleId: q.vehicle_id && q.vehicle_id !== 'geral' ? q.vehicle_id : null });
  const round = (v) => Math.round(v * 100) / 100;
  const total = round(entries.reduce((s, e) => s + e.amount, 0));

  const byCat = new Map();
  const byVeh = new Map();
  const byMonth = new Map();
  for (const e of entries) {
    const c = byCat.get(e.category_key) || { key: e.category_key, label: e.category_label, total: 0, count: 0 };
    c.total += e.amount;
    c.count++;
    byCat.set(e.category_key, c);

    const vk = e.vehicle_id || 'geral';
    const v = byVeh.get(vk) || { vehicle_id: e.vehicle_id, plate: e.plate || null, fleet_number: e.fleet_number, vehicle_type: e.vehicle_type, total: 0, by_source: {} };
    v.total += e.amount;
    v.by_source[e.source] = (v.by_source[e.source] || 0) + e.amount;
    byVeh.set(vk, v);

    const m = String(e.date).slice(0, 7);
    const mm = byMonth.get(m) || { month: m, total: 0, by_source: {} };
    mm.total += e.amount;
    mm.by_source[e.source] = (mm.by_source[e.source] || 0) + e.amount;
    byMonth.set(m, mm);
  }
  const by_vehicle = [...byVeh.values()].map((v) => {
    const k = v.vehicle_id ? km[v.vehicle_id] ?? null : null;
    return { ...v, total: round(v.total), km: k, cost_per_km: k ? Math.round((v.total / k) * 10000) / 10000 : null };
  });
  // Veículos com KM rodado mas sem custo no período também aparecem (custo zero)
  if (!q.source) {
    const missing = Object.keys(km).filter((id) => !byVeh.has(id));
    if (missing.length) {
      const { rows } = await db.query('select id, plate, fleet_number, type from vehicles where id = any($1)', [missing]);
      for (const v of rows) by_vehicle.push({ vehicle_id: v.id, plate: v.plate, fleet_number: v.fleet_number, vehicle_type: v.type, total: 0, by_source: {}, km: km[v.id], cost_per_km: 0 });
    }
  }
  by_vehicle.sort((a, b) => b.total - a.total);
  const kmTotal = Object.values(km).reduce((s, v) => s + v, 0);
  const vehicleCost = by_vehicle.filter((v) => v.km).reduce((s, v) => s + v.total, 0);
  return {
    total,
    count: entries.length,
    km: kmTotal,
    cost_per_km: kmTotal ? Math.round((vehicleCost / kmTotal) * 10000) / 10000 : null,
    by_category: [...byCat.values()].map((c) => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total),
    by_vehicle,
    by_month: [...byMonth.values()].map((m) => ({ ...m, total: round(m.total) })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
