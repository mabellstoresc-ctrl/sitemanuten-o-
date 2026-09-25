import { conflict, forbidden, badRequest, notFound } from './http.js';
import { audit, vehicleEvent } from './audit.js';

/**
 * Registra uma leitura de quilometragem e atualiza o KM atual do veículo.
 * Usado pelo cadastro manual e, nas próximas fases, por abastecimentos, checklists e OS.
 *
 * Regras:
 * - KM menor que o atual só com confirmação do Administrador Principal + motivo (correção, auditada).
 * - Salto muito grande (acima do limite em Configurações) exige confirmação (evita digitar um zero a mais).
 *
 * @returns {{ previous: number, km: number, updated: boolean }}
 */
export async function registerKm(c, ctx, vehicleId, km, opts = {}) {
  const { source = 'manual', sourceId = null, readingAt = null, reason = null, confirmLower = false, confirmJump = false } = opts;
  if (!Number.isInteger(km) || km < 0 || km > 9_999_999) throw badRequest('Quilometragem inválida.');

  const { rows } = await c.query('select id, plate, current_km, type from vehicles where id = $1 for update', [vehicleId]);
  const v = rows[0];
  if (!v) throw notFound('Veículo não encontrado.');
  const previous = v.current_km;

  if (km < previous) {
    if (!confirmLower) {
      throw conflict(
        `A quilometragem informada (${km.toLocaleString('pt-BR')} km) é menor que a última registrada (${previous.toLocaleString('pt-BR')} km).`,
        { code: 'KM_MENOR', current_km: previous },
      );
    }
    if (!ctx.user?.is_master) throw forbidden('Somente o Administrador Principal pode registrar quilometragem menor que a atual.');
    if (!reason || String(reason).trim().length < 5) throw badRequest('Informe o motivo da correção de quilometragem.');
  }

  if (km > previous && previous > 0 && !confirmJump) {
    const { rows: s } = await c.query("select value from settings where key = 'alertas'");
    const max = Number(s[0]?.value?.km_salto_maximo) || 5000;
    if (km - previous > max) {
      throw conflict(
        `A quilometragem aumentou ${(km - previous).toLocaleString('pt-BR')} km desde o último registro (${previous.toLocaleString('pt-BR')} km). Confirme se está correto.`,
        { code: 'KM_SALTO', current_km: previous },
      );
    }
  }

  const isCorrection = km < previous;
  await c.query(
    `insert into km_readings (vehicle_id, km, previous_km, reading_at, source, source_id, is_correction, reason, user_id)
     values ($1, $2, $3, coalesce($4, now()), $5, $6, $7, $8, $9)`,
    [vehicleId, km, previous, readingAt, isCorrection ? 'correcao' : source, sourceId, isCorrection, reason, ctx.user?.id ?? null],
  );

  // Leituras antigas (ex.: abastecimento lançado com atraso) não reduzem o KM atual
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
        description: `${previous.toLocaleString('pt-BR')} km → ${km.toLocaleString('pt-BR')} km${reason ? ` — ${reason}` : ''}`,
        at: readingAt,
        data: { previous, km },
      });
    }
  }
  return { previous, km, updated };
}
