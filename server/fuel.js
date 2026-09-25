import { NON_CONSUMPTION_FUELS, FUELING_TYPES, labelOf } from '../shared/constants.js';

const n2 = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function fuelingDescription(f) {
  const parts = [`${n2(f.liters, f.liters % 1 ? 2 : 0)} L de ${labelOf(FUELING_TYPES, f.fuel_type)}`, money(f.total)];
  if (f.km_per_liter) parts.push(`Média ${n2(f.km_per_liter)} km/L`);
  if (f.station) parts.push(f.station);
  parts.push(`KM ${Number(f.km).toLocaleString('pt-BR')}`);
  return parts.join(' · ');
}

/**
 * Recalcula os campos derivados de todos os abastecimentos válidos do veículo.
 *
 * Método "tanque cheio": a média de um abastecimento com tanque cheio é
 *   (KM atual − KM do tanque cheio anterior) ÷ (litros abastecidos desde então, incluindo este).
 * Abastecimentos parciais acumulam litros para o próximo tanque cheio.
 * Exemplo: 350.000 → 350.800 km com 250 L = 800 ÷ 250 = 3,2 km/L.
 * ARLA 32 não entra na média.
 */
export async function recalcVehicleFuel(c, vehicleId) {
  const { rows } = await c.query(
    `select id, km, liters, total, full_tank, fuel_type, station, previous_km, distance, km_per_liter, cost_per_km,
            calc_distance, calc_liters, calc_cost
       from fuelings where vehicle_id = $1 and status = 'ativo' order by km, fueled_at, created_at`,
    [vehicleId],
  );
  let prevKm = null;
  let refKm = null; // KM do último tanque cheio
  let accLiters = 0;
  let accCost = 0;
  for (const f of rows) {
    const next = { previous_km: null, distance: null, km_per_liter: null, cost_per_km: null, calc_distance: null, calc_liters: null, calc_cost: null };
    if (!NON_CONSUMPTION_FUELS.includes(f.fuel_type)) {
      next.previous_km = prevKm;
      next.distance = prevKm !== null ? f.km - prevKm : null;
      prevKm = f.km;
      accLiters += Number(f.liters);
      accCost += Number(f.total);
      if (f.full_tank) {
        if (refKm !== null && f.km > refKm && accLiters > 0) {
          const dist = f.km - refKm;
          next.calc_distance = dist;
          next.calc_liters = Math.round(accLiters * 1000) / 1000;
          next.calc_cost = Math.round(accCost * 100) / 100;
          next.km_per_liter = Math.round((dist / accLiters) * 1000) / 1000;
          next.cost_per_km = Math.round((accCost / dist) * 10000) / 10000;
        }
        refKm = f.km;
        accLiters = 0;
        accCost = 0;
      }
    }
    const changed = Object.keys(next).some((k) => (f[k] === null ? null : Number(f[k])) !== next[k]);
    if (changed) {
      await c.query(
        `update fuelings set previous_km = $2, distance = $3, km_per_liter = $4, cost_per_km = $5,
                calc_distance = $6, calc_liters = $7, calc_cost = $8 where id = $1`,
        [f.id, next.previous_km, next.distance, next.km_per_liter, next.cost_per_km, next.calc_distance, next.calc_liters, next.calc_cost],
      );
    }
    await c.query(`update vehicle_events set description = $3 where vehicle_id = $1 and ref_table = 'fuelings' and ref_id = $2 and type = 'abastecimento'`, [
      vehicleId,
      f.id,
      fuelingDescription({ ...f, ...next }),
    ]);
  }
}

/** Agregado de consumo: soma das distâncias ÷ soma dos litros dos ciclos de tanque cheio. */
export const AVG_SQL = `
  count(*)::int as fuelings,
  coalesce(sum(liters) filter (where fuel_type <> 'arla32'), 0)::float as liters,
  coalesce(sum(total), 0)::float as total,
  coalesce(sum(calc_distance), 0)::int as distance,
  case when sum(calc_liters) > 0 then round((sum(calc_distance) / sum(calc_liters))::numeric, 3)::float end as km_per_liter,
  case when sum(calc_distance) > 0 then round((sum(calc_cost) / sum(calc_distance))::numeric, 4)::float end as cost_per_km`;
