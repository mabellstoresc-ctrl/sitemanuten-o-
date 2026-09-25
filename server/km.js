import { conflict, forbidden, badRequest, notFound } from './http.js';
import { audit, vehicleEvent } from './audit.js';

const fmt = (n) => Number(n).toLocaleString('pt-BR');
const fmtDate = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/**
 * Registra uma leitura de quilometragem e atualiza o KM atual do veículo.
 * Usado pelo KM manual, abastecimentos e (próximas fases) checklists e OS.
 *
 * A leitura precisa ser coerente com a linha do tempo de leituras válidas:
 * - não pode ser menor que uma leitura anterior (no tempo) → só o Administrador Principal
 *   corrige, com motivo; as leituras maiores passam a ser inválidas (auditado);
 * - não pode ser maior que uma leitura posterior (no tempo) → bloqueado;
 * - leitura antiga coerente (ex.: abastecimento lançado com atraso) entra no histórico
 *   sem alterar o KM atual;
 * - aumento acima do limite configurado pede confirmação (evita digitar um zero a mais).
 */
export async function registerKm(c, ctx, vehicleId, km, opts = {}) {
  const { source = 'manual', sourceId = null, reason = null, confirmLower = false, confirmJump = false, dateOnly = null } = opts;
  let { readingAt = null } = opts;
  if (!Number.isInteger(km) || km < 0 || km > 9_999_999) throw badRequest('Quilometragem inválida.');

  const { rows } = await c.query('select id, plate, current_km from vehicles where id = $1 for update', [vehicleId]);
  const v = rows[0];
  if (!v) throw notFound('Veículo não encontrado.');
  const previous = v.current_km;
  // Registros só com data (manutenção, OS): comparam com os dias anteriores e posteriores,
  // ignorando leituras do mesmo dia (não se sabe a hora exata).
  let beforeLimit;
  let afterLimit;
  if (dateOnly) {
    const dayStart = new Date(`${dateOnly}T03:00:00.000Z`); // 00:00 em Brasília
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    readingAt = dateOnly === today ? new Date().toISOString() : new Date(dayStart.getTime() + 12 * 3600e3).toISOString();
    beforeLimit = new Date(dayStart.getTime() - 1).toISOString();
    afterLimit = new Date(dayStart.getTime() + 24 * 3600e3 - 1).toISOString();
  }
  const at = readingAt ? new Date(readingAt) : new Date();
  beforeLimit ??= at.toISOString();
  afterLimit ??= at.toISOString();

  const { rows: nb } = await c.query(
    `select
       (select km from km_readings where vehicle_id = $1 and not invalidated and reading_at <= $2 order by km desc limit 1) as before_km,
       (select json_build_object('km', km, 'at', reading_at) from km_readings
         where vehicle_id = $1 and not invalidated and reading_at > $3 order by km asc limit 1) as after`,
    [vehicleId, beforeLimit, afterLimit],
  );
  const beforeKm = nb[0].before_km;
  const after = nb[0].after;

  let isCorrection = false;
  if (beforeKm !== null && km < beforeKm) {
    if (!confirmLower) {
      throw conflict(
        `A quilometragem informada (${fmt(km)} km) é menor que a registrada anteriormente (${fmt(beforeKm)} km).`,
        { code: 'KM_MENOR', current_km: previous },
      );
    }
    if (!ctx.user?.is_master) throw forbidden('Somente o Administrador Principal pode registrar quilometragem menor que a anterior.');
    if (!reason || String(reason).trim().length < 5) throw badRequest('Informe o motivo da correção de quilometragem.');
    isCorrection = true;
  } else if (after && km > after.km) {
    throw conflict(
      `Existe uma leitura posterior (${fmtDate(after.at)}) com ${fmt(after.km)} km, menor que ${fmt(km)} km. Verifique a data e o KM.`,
      { code: 'KM_INCONSISTENTE', current_km: previous },
    );
  }

  if (!isCorrection && km > previous && previous > 0 && !confirmJump) {
    const { rows: s } = await c.query("select value from settings where key = 'alertas'");
    const max = Number(s[0]?.value?.km_salto_maximo) || 5000;
    if (km - previous > max) {
      throw conflict(
        `A quilometragem aumentou ${fmt(km - previous)} km desde o último registro (${fmt(previous)} km). Confirme se está correto.`,
        { code: 'KM_SALTO', current_km: previous },
      );
    }
  }

  if (isCorrection) {
    // As leituras maiores que o valor corrigido eram erradas
    await c.query('update km_readings set invalidated = true where vehicle_id = $1 and not invalidated and km > $2', [vehicleId, km]);
  }
  await c.query(
    `insert into km_readings (vehicle_id, km, previous_km, reading_at, source, source_id, is_correction, reason, user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [vehicleId, km, previous, at.toISOString(), source, sourceId, isCorrection, reason, ctx.user?.id ?? null],
  );

  const updated = km > previous || isCorrection;
  if (updated) {
    await c.query('update vehicles set current_km = $2, km_updated_at = now(), updated_at = now() where id = $1', [vehicleId, km]);
    await audit(c, ctx, {
      module: 'veiculos',
      action: isCorrection ? 'correcao_km' : 'atualizar_km',
      entity: 'veiculo',
      entityId: vehicleId,
      label: v.plate,
      changes: [{ campo: 'current_km', anterior: previous, novo: km }],
      reason: reason || (source !== 'manual' ? `Origem: ${source}` : null),
    });
    if (isCorrection || source === 'manual') {
      await vehicleEvent(c, ctx, vehicleId, {
        type: isCorrection ? 'correcao_km' : 'km',
        title: isCorrection ? 'Correção de quilometragem' : 'Atualização de quilometragem',
        description: `${fmt(previous)} km → ${fmt(km)} km${reason ? ` — ${reason}` : ''}`,
        at: at.toISOString(),
        data: { previous, km },
      });
    }
  }
  return { previous, km, updated, historical: km < previous && !isCorrection };
}

/** Marca como inválida a leitura de KM gerada por um registro (abastecimento, OS...). */
export async function invalidateReading(c, vehicleId, source, sourceId) {
  await c.query(
    'update km_readings set invalidated = true where vehicle_id = $1 and source = $2 and source_id = $3 and not invalidated',
    [vehicleId, source, String(sourceId)],
  );
}

/**
 * Garante que o KM atual não fique acima da maior leitura válida (após cancelar/editar um registro).
 * Voltar o KM é uma redução, então exige o Administrador Principal (regra de KM menor).
 */
export async function syncCurrentKm(c, ctx, vehicleId, { reason } = {}) {
  const { rows } = await c.query('select id, plate, current_km from vehicles where id = $1 for update', [vehicleId]);
  const v = rows[0];
  const { rows: m } = await c.query('select max(km) as km from km_readings where vehicle_id = $1 and not invalidated', [vehicleId]);
  const maxValid = m[0].km ?? 0;
  if (maxValid >= v.current_km) return { reverted: false };
  if (!ctx.user?.is_master) {
    throw forbidden(
      `Este registro definiu o KM atual do veículo (${fmt(v.current_km)} km). Somente o Administrador Principal pode fazer esta alteração, pois o KM do veículo voltaria para ${fmt(maxValid)} km.`,
    );
  }
  await c.query('update vehicles set current_km = $2, km_updated_at = now(), updated_at = now() where id = $1', [vehicleId, maxValid]);
  await audit(c, ctx, {
    module: 'veiculos',
    action: 'correcao_km',
    entity: 'veiculo',
    entityId: vehicleId,
    label: v.plate,
    changes: [{ campo: 'current_km', anterior: v.current_km, novo: maxValid }],
    reason: reason || 'KM revertido por cancelamento/edição de registro',
  });
  await vehicleEvent(c, ctx, vehicleId, {
    type: 'correcao_km',
    title: 'Correção de quilometragem',
    description: `${fmt(v.current_km)} km → ${fmt(maxValid)} km${reason ? ` — ${reason}` : ''}`,
  });
  return { reverted: true, km: maxValid };
}
