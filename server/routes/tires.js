import { validate } from '../validate.js';
import { badRequest, notFound, conflict } from '../http.js';
import { requirePerm, requireAny } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { csvResponse } from '../csv.js';
import { alertSettings } from '../maintenance.js';
import { TIRE_STATUS, TIRE_AVAILABLE, TIRE_ACTIONS, TOWED_TYPES, positionsFor, positionLabel, layoutFor, labelOf } from '../../shared/constants.js';

const fmtN = (v) => Number(v).toLocaleString('pt-BR');

/**
 * "Hodômetro" usado para medir o KM dos pneus.
 * Veículo com motor: KM atual. Carreta/implemento: KM acumulado pelos cavalos enquanto engatado.
 */
export async function vehicleOdometer(db, vehicleId) {
  const { rows } = await db.query(
    `select v.id, v.type, v.current_km,
            (select coalesce(sum(greatest(coalesce(vc.end_km, t.current_km) - coalesce(vc.start_km, 0), 0)), 0)::int
               from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id where vc.trailer_id = v.id) as towed_km
       from vehicles v where v.id = $1`,
    [vehicleId],
  );
  const v = rows[0];
  if (!v) return 0;
  return TOWED_TYPES.includes(v.type) ? v.towed_km : v.current_km;
}

/** KM total rodado pelo pneu (inclui o período atual de instalação). */
function tireKm(t, odometer) {
  const current = t.status === 'em_uso' && t.installed_vehicle_km !== null && odometer !== null ? Math.max(0, odometer - t.installed_vehicle_km) : 0;
  return t.initial_km + t.accumulated_km + current;
}

const TIRE_FIELDS = {
  code: { type: 'string', required: true, max: 40, label: 'Código interno', upper: true },
  fire_number: { type: 'string', max: 40, label: 'Número de fogo', upper: true },
  brand: { type: 'string', max: 60, label: 'Marca' },
  model: { type: 'string', max: 80, label: 'Modelo' },
  size: { type: 'string', max: 40, label: 'Medida' },
  purchase_date: { type: 'date', label: 'Data da compra' },
  purchase_value: { type: 'number', min: 0, max: 100000, label: 'Valor da compra' },
  initial_km: { type: 'int', min: 0, max: 5_000_000, label: 'Quilometragem inicial' },
  estimated_life_km: { type: 'int', min: 1, max: 5_000_000, label: 'Vida útil estimada (km)' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};
const TIRE_COLS = Object.keys(TIRE_FIELDS);

const TIRE_SELECT = `
  select t.*, v.plate, v.fleet_number, v.type as vehicle_type, v.axle_config, v.current_km as vehicle_current_km,
         (select coalesce(sum(greatest(coalesce(vc.end_km, tr.current_km) - coalesce(vc.start_km, 0), 0)), 0)::int
            from vehicle_couplings vc join vehicles tr on tr.id = vc.tractor_id where vc.trailer_id = v.id) as vehicle_towed_km,
         (select company from tire_retreads r where r.tire_id = t.id and r.status = 'enviado') as retread_company,
         (select sent_on from tire_retreads r where r.tire_id = t.id and r.status = 'enviado') as retread_sent_on
    from tires t left join vehicles v on v.id = t.vehicle_id`;

function enrich(t, cfg) {
  const odo = t.vehicle_id ? (TOWED_TYPES.includes(t.vehicle_type) ? t.vehicle_towed_km : t.vehicle_current_km) : null;
  t.total_km = tireKm(t, odo);
  t.current_install_km = t.status === 'em_uso' && odo !== null ? Math.max(0, odo - t.installed_vehicle_km) : null;
  t.life_pct = t.estimated_life_km ? Math.round((t.total_km / t.estimated_life_km) * 1000) / 10 : null;
  t.position_label = t.vehicle_id ? positionLabel({ type: t.vehicle_type, axle_config: t.axle_config }, t.position) : null;
  const reasons = [];
  if (t.status === 'em_uso' && cfg) {
    if (t.tread_depth_mm !== null && Number(t.tread_depth_mm) <= cfg.pneu_sulco_minimo) reasons.push(`sulco ${t.tread_depth_mm} mm`);
    if (t.life_pct !== null && t.life_pct >= 90) reasons.push(`${fmtN(t.life_pct)}% da vida útil`);
    const days = t.last_inspection_on ? Math.floor((Date.now() - new Date(`${t.last_inspection_on}T12:00:00Z`)) / 864e5) : null;
    if (days === null ? t.installed_at && Date.now() - new Date(t.installed_at) > cfg.pneu_inspecao_dias * 864e5 : days > cfg.pneu_inspecao_dias) {
      reasons.push(days === null ? 'nunca inspecionado' : `sem inspeção há ${days} dias`);
    }
  }
  t.attention = reasons;
  delete t.vehicle_towed_km;
  return t;
}

/** Lista de pneus com KM calculado (usada em relatórios). */
export async function listTires(db, where = '', params = []) {
  const cfg = await alertSettings(db);
  const { rows } = await db.query(`${TIRE_SELECT} ${where} order by v.plate nulls last, t.position, t.code`, params);
  return rows.map((t) => enrich(t, cfg));
}

export async function tiresNeedingAttention(db) {
  const cfg = await alertSettings(db);
  const { rows } = await db.query(`${TIRE_SELECT} where t.status = 'em_uso'`);
  return rows.map((t) => enrich(t, cfg)).filter((t) => t.attention.length);
}

async function lockTire(c, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Pneu não encontrado.');
  const { rows } = await c.query('select * from tires where id = $1 for update', [id]);
  if (!rows[0]) throw notFound('Pneu não encontrado.');
  return rows[0];
}

async function loadVehicle(c, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw badRequest('Selecione o veículo.');
  const { rows } = await c.query('select id, plate, type, status, axle_config, current_km from vehicles where id = $1 for update', [id]);
  if (!rows[0]) throw notFound('Veículo não encontrado.');
  if (rows[0].status === 'inativo') throw badRequest('Veículo inativo.');
  return rows[0];
}

function checkPosition(vehicle, position) {
  if (!positionsFor(vehicle).some((p) => p.code === position)) {
    throw badRequest(`Posição inválida para a configuração de eixos do veículo ${vehicle.plate} (${layoutFor(vehicle).label}).`);
  }
}

async function logMovement(c, ctx, m) {
  await c.query(
    `insert into tire_movements (tire_id, moved_at, action, from_vehicle_id, from_position, to_vehicle_id, to_position, status_before, status_after,
                                 vehicle_km, km_run, tire_km, reason, data, user_id)
     values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      m.tireId,
      m.at ?? null,
      m.action,
      m.fromVehicle ?? null,
      m.fromPosition ?? null,
      m.toVehicle ?? null,
      m.toPosition ?? null,
      m.before ?? null,
      m.after ?? null,
      m.vehicleKm ?? null,
      m.kmRun ?? null,
      m.tireKm ?? null,
      m.reason ?? null,
      m.data ? JSON.stringify(m.data) : null,
      ctx.user.id,
    ],
  );
}

/** Tira o pneu do veículo (se estiver instalado), somando o KM rodado. Retorna dados da saída. */
async function detach(c, t, nextStatus) {
  if (t.status !== 'em_uso') return { kmRun: 0, odo: null, fromVehicle: null, fromPosition: null };
  const odo = await vehicleOdometer(c, t.vehicle_id);
  const kmRun = Math.max(0, odo - (t.installed_vehicle_km ?? odo));
  const fromVehicle = t.vehicle_id;
  const fromPosition = t.position;
  t.accumulated_km += kmRun;
  await c.query(
    `update tires set status = $3, vehicle_id = null, position = null, installed_at = null, installed_vehicle_km = null, accumulated_km = $2, updated_at = now() where id = $1`,
    [t.id, t.accumulated_km, nextStatus],
  );
  t.vehicle_id = null;
  t.position = null;
  return { kmRun, odo, fromVehicle, fromPosition };
}

async function attach(c, t, vehicle, position, status = 'em_uso') {
  const { rows } = await c.query('select code from tires where vehicle_id = $1 and position = $2', [vehicle.id, position]);
  if (rows[0]) {
    throw conflict(`A posição ${positionLabel(vehicle, position)} de ${vehicle.plate} já tem o pneu ${rows[0].code}. Retire-o primeiro ou use "Trocar de posição".`, {
      code: 'POSICAO_OCUPADA',
    });
  }
  const odo = await vehicleOdometer(c, vehicle.id);
  await c.query(
    `update tires set status = $2, vehicle_id = $3, position = $4, installed_at = now(), installed_vehicle_km = $5, updated_at = now() where id = $1`,
    [t.id, status, vehicle.id, position, odo],
  );
  return odo;
}

export default function (r) {
  r.get('/tires', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.status === 'disponiveis') where.push(`t.status = any(${p(TIRE_AVAILABLE)})`);
    else if (q.status === 'ativos') where.push(`t.status <> 'descartado'`);
    else if (q.status) where.push(`t.status = ${p(q.status)}`);
    if (q.vehicle_id) where.push(`t.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.brand) where.push(`t.brand ilike ${p(`%${q.brand}%`)}`);
    if (q.size) where.push(`t.size ilike ${p(`%${q.size}%`)}`);
    if (q.q) where.push(`(t.code ilike ${p(`%${q.q}%`)} or t.fire_number ilike $${params.length} or v.plate ilike ${p(`%${q.q.toUpperCase().replace(/[-\s]/g, '')}%`)})`);
    const cfg = await alertSettings(ctx.db);
    const { rows } = await ctx.db.query(`${TIRE_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by v.plate nulls last, t.position, t.code limit 3000`, params);
    let tires = rows.map((t) => enrich(t, cfg));
    if (q.atencao === '1') tires = tires.filter((t) => t.attention.length);
    return { tires };
  });

  r.get('/tires/export', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'exportar');
    const cfg = await alertSettings(ctx.db);
    const { rows } = await ctx.db.query(`${TIRE_SELECT} order by t.code`);
    await audit(ctx.db, ctx, { module: 'pneus', action: 'exportar', entity: 'pneu', label: `${rows.length} registros` });
    return csvResponse(
      'pneus',
      ['Código', 'Nº de fogo', 'Marca', 'Modelo', 'Medida', 'Situação', 'Veículo', 'Posição', 'KM total', 'Vida útil (km)', '% vida', 'Recapagens', 'Sulco (mm)', 'Última inspeção', 'Compra', 'Valor'],
      rows.map((x) => {
        const t = enrich(x, cfg);
        return [t.code, t.fire_number, t.brand, t.model, t.size, labelOf(TIRE_STATUS, t.status), t.plate, t.position_label, t.total_km, t.estimated_life_km, t.life_pct, t.retread_count, t.tread_depth_mm, t.last_inspection_on, t.purchase_date, t.purchase_value];
      }),
    );
  });

  r.get('/tires/:id', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'ver');
    if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Pneu não encontrado.');
    const cfg = await alertSettings(ctx.db);
    const { rows } = await ctx.db.query(`${TIRE_SELECT} where t.id = $1`, [ctx.params.id]);
    if (!rows[0]) throw notFound('Pneu não encontrado.');
    const tire = enrich(rows[0], cfg);
    const { rows: movements } = await ctx.db.query(
      `select m.*, fv.plate as from_plate, fv.type as from_type, fv.axle_config as from_axle, tv.plate as to_plate, tv.type as to_type, tv.axle_config as to_axle, u.username
         from tire_movements m
         left join vehicles fv on fv.id = m.from_vehicle_id
         left join vehicles tv on tv.id = m.to_vehicle_id
         left join users u on u.id = m.user_id
        where m.tire_id = $1 order by m.moved_at, m.id`,
      [tire.id],
    );
    for (const m of movements) {
      m.from_position_label = m.from_position ? positionLabel({ type: m.from_type, axle_config: m.from_axle }, m.from_position) : null;
      m.to_position_label = m.to_position ? positionLabel({ type: m.to_type, axle_config: m.to_axle }, m.to_position) : null;
    }
    const { rows: retreads } = await ctx.db.query(
      `select r.*, u.username as created_by_name from tire_retreads r left join users u on u.id = r.created_by where r.tire_id = $1 order by r.sent_on desc`,
      [tire.id],
    );
    return { tire, movements, retreads };
  });

  r.post('/tires', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'cadastrar');
    const d = validate(ctx.body, TIRE_FIELDS);
    d.initial_km = d.initial_km ?? 0;
    const { status } = validate(ctx.body, { status: { type: 'enum', values: ['novo', 'estoque'], label: 'Situação' } });
    const out = await ctx.tx(async (c) => {
      const cols = [...TIRE_COLS, 'status', 'created_by'];
      const { rows } = await c.query(
        `insert into tires (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        [...TIRE_COLS.map((k) => d[k]), status || 'novo', ctx.user.id],
      );
      const id = rows[0].id;
      await logMovement(c, ctx, { tireId: id, action: 'cadastro', after: status || 'novo', tireKm: d.initial_km, data: { purchase_value: d.purchase_value } });
      await audit(c, ctx, { module: 'pneus', action: 'criar', entity: 'pneu', entityId: id, label: d.code, changes: snapshot(d) });
      return { id };
    });
    return out;
  });

  r.put('/tires/:id', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'editar');
    const d = validate(ctx.body, TIRE_FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      const before = await lockTire(c, ctx.params.id);
      const fields = Object.keys(d);
      if (!fields.length) return;
      if (d.initial_km === null) d.initial_km = 0;
      await c.query(`update tires set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [before.id, ...fields.map((f) => d[f])]);
      await audit(c, ctx, {
        module: 'pneus',
        action: 'editar',
        entity: 'pneu',
        entityId: before.id,
        label: before.code,
        changes: diff({ ...before, purchase_value: before.purchase_value === null ? null : Number(before.purchase_value) }, d, fields),
      });
    });
    return { ok: true };
  });

  /**
   * Movimentar pneu. Ações:
   * - instalar: pneu disponível → veículo/posição
   * - trocar_posicao: mesmo veículo, outra posição (se ocupada, os dois trocam de lugar — rodízio)
   * - trocar_veiculo: vai para outro veículo/posição
   * - estoque | retirar: sai do veículo
   * - recapagem: sai do veículo e abre registro de recapagem
   * - descartar: definitivo
   */
  r.post('/tires/:id/move', async (ctx) => {
    const d = validate(ctx.body, {
      action: { type: 'enum', values: ['instalar', 'trocar_posicao', 'trocar_veiculo', 'estoque', 'recapagem', 'retirar', 'descartar'], required: true, label: 'Ação' },
      vehicle_id: { type: 'uuid', label: 'Veículo' },
      position: { type: 'string', max: 20, label: 'Posição' },
      reason: { type: 'string', max: 500, label: 'Motivo' },
      company: { type: 'string', max: 120, label: 'Empresa de recapagem' },
      cost: { type: 'number', min: 0, max: 100000, label: 'Valor' },
      retread_type: { type: 'string', max: 60, label: 'Tipo de recapagem' },
    });
    requirePerm(ctx.user, 'pneus', d.action === 'descartar' ? 'cancelar' : 'editar');
    const result = await ctx.tx(async (c) => {
      const t = await lockTire(c, ctx.params.id);
      const before = t.status;
      if (t.status === 'descartado') throw badRequest('Pneu descartado não pode ser movimentado.');
      if (t.status === 'recapagem') throw badRequest('O pneu está na recapagem. Registre o retorno antes de movimentá-lo.');

      if (d.action === 'instalar') {
        if (!TIRE_AVAILABLE.includes(t.status)) throw badRequest('Só pneus novos, em estoque ou retirados podem ser instalados. Para mover um pneu em uso, use trocar posição/veículo.');
        const v = await loadVehicle(c, d.vehicle_id);
        checkPosition(v, d.position);
        const odo = await attach(c, t, v, d.position);
        await logMovement(c, ctx, { tireId: t.id, action: 'instalar', toVehicle: v.id, toPosition: d.position, before, after: 'em_uso', vehicleKm: odo, tireKm: t.initial_km + t.accumulated_km, reason: d.reason });
        await vehicleEvent(c, ctx, v.id, { type: 'pneu', title: 'Pneu instalado', description: `${t.code} em ${positionLabel(v, d.position)}${d.reason ? ` — ${d.reason}` : ''}`, refTable: 'tires', refId: t.id });
        await audit(c, ctx, { module: 'pneus', action: 'instalar', entity: 'pneu', entityId: t.id, label: t.code, changes: [{ campo: 'posicao', anterior: null, novo: `${v.plate} · ${positionLabel(v, d.position)}` }], reason: d.reason });
        return { ok: true };
      }

      if (d.action === 'trocar_posicao') {
        if (t.status !== 'em_uso') throw badRequest('O pneu não está instalado.');
        const { rows: vr } = await c.query('select id, plate, type, status, axle_config from vehicles where id = $1 for update', [t.vehicle_id]);
        const v = vr[0];
        checkPosition(v, d.position);
        if (d.position === t.position) throw badRequest('Escolha uma posição diferente.');
        const odo = await vehicleOdometer(c, v.id);
        const { rows: occ } = await c.query('select * from tires where vehicle_id = $1 and position = $2 for update', [v.id, d.position]);
        const other = occ[0];
        const from = t.position;
        // Troca de posição mantém o pneu no veículo: o KM continua contando normalmente
        // posição temporária para não violar a regra "uma posição, um pneu" durante o rodízio
        await c.query(`update tires set position = 'TMP-' || id where id = $1`, [t.id]);
        if (other) await c.query('update tires set position = $2, updated_at = now() where id = $1', [other.id, from]);
        await c.query('update tires set position = $2, updated_at = now() where id = $1', [t.id, d.position]);
        const tkm = tireKm(t, odo);
        await logMovement(c, ctx, { tireId: t.id, action: 'trocar_posicao', fromVehicle: v.id, fromPosition: from, toVehicle: v.id, toPosition: d.position, before, after: 'em_uso', vehicleKm: odo, tireKm: tkm, reason: d.reason });
        if (other) {
          await logMovement(c, ctx, { tireId: other.id, action: 'trocar_posicao', fromVehicle: v.id, fromPosition: d.position, toVehicle: v.id, toPosition: from, before: 'em_uso', after: 'em_uso', vehicleKm: odo, tireKm: tireKm(other, odo), reason: d.reason || `Rodízio com ${t.code}` });
        }
        await vehicleEvent(c, ctx, v.id, {
          type: 'pneu',
          title: other ? 'Rodízio de pneus' : 'Pneu trocado de posição',
          description: `${t.code}: ${positionLabel(v, from)} → ${positionLabel(v, d.position)}${other ? ` · ${other.code}: ${positionLabel(v, d.position)} → ${positionLabel(v, from)}` : ''}`,
          refTable: 'tires',
          refId: t.id,
        });
        await audit(c, ctx, { module: 'pneus', action: 'trocar_posicao', entity: 'pneu', entityId: t.id, label: t.code, changes: [{ campo: 'posicao', anterior: positionLabel(v, from), novo: positionLabel(v, d.position) }], reason: d.reason });
        return { ok: true, swapped: other?.code || null };
      }

      if (d.action === 'trocar_veiculo') {
        if (t.status !== 'em_uso') throw badRequest('O pneu não está instalado. Use "Instalar".');
        const v = await loadVehicle(c, d.vehicle_id);
        if (v.id === t.vehicle_id) throw badRequest('Para o mesmo veículo, use "Trocar de posição".');
        checkPosition(v, d.position);
        const { rows: fr } = await c.query('select id, plate, type, axle_config from vehicles where id = $1', [t.vehicle_id]);
        const from = fr[0];
        const out = await detach(c, t, 'estoque');
        const odo = await attach(c, t, v, d.position);
        await logMovement(c, ctx, {
          tireId: t.id,
          action: 'trocar_veiculo',
          fromVehicle: out.fromVehicle,
          fromPosition: out.fromPosition,
          toVehicle: v.id,
          toPosition: d.position,
          before,
          after: 'em_uso',
          vehicleKm: odo,
          kmRun: out.kmRun,
          tireKm: t.initial_km + t.accumulated_km,
          reason: d.reason,
        });
        await vehicleEvent(c, ctx, from.id, { type: 'pneu', title: 'Pneu removido', description: `${t.code} de ${positionLabel(from, out.fromPosition)} → ${v.plate}`, refTable: 'tires', refId: t.id });
        await vehicleEvent(c, ctx, v.id, { type: 'pneu', title: 'Pneu instalado', description: `${t.code} em ${positionLabel(v, d.position)} (veio de ${from.plate})`, refTable: 'tires', refId: t.id });
        await audit(c, ctx, {
          module: 'pneus',
          action: 'trocar_veiculo',
          entity: 'pneu',
          entityId: t.id,
          label: t.code,
          changes: [{ campo: 'posicao', anterior: `${from.plate} · ${positionLabel(from, out.fromPosition)}`, novo: `${v.plate} · ${positionLabel(v, d.position)}` }],
          reason: d.reason,
        });
        return { ok: true };
      }

      // Saída do veículo: estoque, retirar, recapagem, descartar
      const statusMap = { estoque: 'estoque', retirar: 'retirado', recapagem: 'recapagem', descartar: 'descartado' };
      const after = statusMap[d.action];
      if (before === after) throw badRequest(`O pneu já está com a situação "${labelOf(TIRE_STATUS, after)}".`);
      if ((d.action === 'descartar' || d.action === 'retirar') && !d.reason) throw badRequest('Informe o motivo.');
      let fromV = null;
      if (t.vehicle_id) {
        const { rows: fr } = await c.query('select id, plate, type, axle_config from vehicles where id = $1', [t.vehicle_id]);
        fromV = fr[0];
      }
      const out = await detach(c, t, after);
      await c.query('update tires set status = $2, updated_at = now() where id = $1', [t.id, after]);
      if (d.action === 'recapagem') {
        await c.query(
          `insert into tire_retreads (tire_id, sent_on, company, cost, retread_type, notes, created_by) values ($1, (now() at time zone 'America/Sao_Paulo')::date, $2, $3, $4, $5, $6)`,
          [t.id, d.company, d.cost, d.retread_type, d.reason, ctx.user.id],
        );
      }
      await logMovement(c, ctx, {
        tireId: t.id,
        action: d.action,
        fromVehicle: out.fromVehicle,
        fromPosition: out.fromPosition,
        before,
        after,
        vehicleKm: out.odo,
        kmRun: out.fromVehicle ? out.kmRun : null,
        tireKm: t.initial_km + t.accumulated_km,
        reason: d.reason,
        data: d.action === 'recapagem' ? { company: d.company, cost: d.cost, retread_type: d.retread_type } : null,
      });
      if (fromV) {
        await vehicleEvent(c, ctx, fromV.id, {
          type: 'pneu',
          title: 'Pneu removido',
          description: `${t.code} de ${positionLabel(fromV, out.fromPosition)} → ${labelOf(TIRE_ACTIONS, d.action).toLowerCase()}${d.reason ? ` — ${d.reason}` : ''}`,
          refTable: 'tires',
          refId: t.id,
        });
      }
      await audit(c, ctx, {
        module: 'pneus',
        action: d.action,
        entity: 'pneu',
        entityId: t.id,
        label: t.code,
        changes: [{ campo: 'status', anterior: before, novo: after }],
        reason: d.reason,
      });
      return { ok: true };
    });
    return result;
  });

  r.post('/tires/:id/retread-return', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'editar');
    const d = validate(ctx.body, {
      returned_on: { type: 'date', required: true, label: 'Data de retorno' },
      approved: { type: 'bool', label: 'Aprovado' },
      cost: { type: 'number', min: 0, max: 100000, label: 'Valor' },
      retread_type: { type: 'string', max: 60, label: 'Tipo de recapagem' },
      warranty: { type: 'string', max: 120, label: 'Garantia' },
      notes: { type: 'text', max: 2000, label: 'Observações' },
      company: { type: 'string', max: 120, label: 'Empresa' },
    });
    if (ctx.body?.approved === undefined) d.approved = true;
    await ctx.tx(async (c) => {
      const t = await lockTire(c, ctx.params.id);
      if (t.status !== 'recapagem') throw badRequest('O pneu não está na recapagem.');
      const { rows } = await c.query(`select * from tire_retreads where tire_id = $1 and status = 'enviado' for update`, [t.id]);
      const rt = rows[0];
      if (!rt) throw badRequest('Nenhuma recapagem em aberto para este pneu.');
      if (d.returned_on < String(rt.sent_on)) throw badRequest('O retorno não pode ser antes do envio.');
      await c.query(
        `update tire_retreads set status = $2, returned_on = $3, cost = coalesce($4, cost), retread_type = coalesce($5, retread_type), warranty = $6,
                notes = coalesce($7, notes), company = coalesce($8, company), updated_at = now() where id = $1`,
        [rt.id, d.approved ? 'retornado' : 'reprovado', d.returned_on, d.cost, d.retread_type, d.warranty, d.notes, d.company],
      );
      const after = d.approved ? 'estoque' : 'descartado';
      await c.query(`update tires set status = $2, retread_count = retread_count + $3, tread_depth_mm = null, updated_at = now() where id = $1`, [t.id, after, d.approved ? 1 : 0]);
      await logMovement(c, ctx, {
        tireId: t.id,
        action: 'retorno_recapagem',
        before: 'recapagem',
        after,
        tireKm: t.initial_km + t.accumulated_km,
        reason: d.approved ? `Recapagem nº ${t.retread_count + 1} aprovada` : `Reprovado na recapagem${d.notes ? `: ${d.notes}` : ''}`,
        data: { cost: d.cost ?? rt.cost, company: d.company ?? rt.company, warranty: d.warranty },
      });
      await audit(c, ctx, {
        module: 'pneus',
        action: 'retorno_recapagem',
        entity: 'pneu',
        entityId: t.id,
        label: t.code,
        changes: [
          { campo: 'status', anterior: 'recapagem', novo: after },
          ...(d.approved ? [{ campo: 'retread_count', anterior: t.retread_count, novo: t.retread_count + 1 }] : []),
        ],
      });
    });
    return { ok: true };
  });

  r.post('/tires/:id/inspect', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'editar');
    const d = validate(ctx.body, {
      inspected_on: { type: 'date', required: true, label: 'Data' },
      tread_depth_mm: { type: 'number', min: 0, max: 40, label: 'Sulco (mm)' },
      pressure_psi: { type: 'number', min: 0, max: 200, label: 'Pressão (psi)' },
      condition: { type: 'enum', values: ['bom', 'regular', 'ruim'], label: 'Estado' },
      notes: { type: 'text', max: 2000, label: 'Observações' },
    });
    await ctx.tx(async (c) => {
      const t = await lockTire(c, ctx.params.id);
      if (t.status === 'descartado') throw badRequest('Pneu descartado.');
      const odo = t.vehicle_id ? await vehicleOdometer(c, t.vehicle_id) : null;
      await c.query(`update tires set last_inspection_on = $2, tread_depth_mm = coalesce($3, tread_depth_mm), updated_at = now() where id = $1`, [
        t.id,
        d.inspected_on,
        d.tread_depth_mm,
      ]);
      await logMovement(c, ctx, {
        tireId: t.id,
        at: `${d.inspected_on}T15:00:00.000Z`,
        action: 'inspecao',
        fromVehicle: t.vehicle_id,
        fromPosition: t.position,
        before: t.status,
        after: t.status,
        vehicleKm: odo,
        tireKm: tireKm(t, odo),
        reason: d.notes,
        data: { tread_depth_mm: d.tread_depth_mm, pressure_psi: d.pressure_psi, condition: d.condition },
      });
      await audit(c, ctx, {
        module: 'pneus',
        action: 'inspecao',
        entity: 'pneu',
        entityId: t.id,
        label: t.code,
        changes: [{ campo: 'tread_depth_mm', anterior: t.tread_depth_mm === null ? null : Number(t.tread_depth_mm), novo: d.tread_depth_mm }],
      });
    });
    return { ok: true };
  });

  r.del('/tires/:id', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'excluir');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo da exclusão.');
    await ctx.tx(async (c) => {
      const t = await lockTire(c, ctx.params.id);
      const { rows } = await c.query(`select count(*)::int as n from tire_movements where tire_id = $1 and action <> 'cadastro'`, [t.id]);
      if (rows[0].n > 0 || t.status === 'em_uso') throw conflict('Este pneu já tem histórico de uso. Use "Descartar" em vez de excluir.', { code: 'VINCULADO' });
      await c.query('delete from tire_movements where tire_id = $1', [t.id]);
      await c.query('delete from tire_retreads where tire_id = $1', [t.id]);
      await c.query('delete from tires where id = $1', [t.id]);
      await audit(c, ctx, { module: 'pneus', action: 'excluir', entity: 'pneu', entityId: t.id, label: t.code, changes: snapshot(t, TIRE_COLS).map((x) => ({ ...x, anterior: x.novo, novo: null })), reason });
    });
    return { ok: true };
  });

  // Mapa de pneus de um veículo
  r.get('/vehicles/:id/tires', async (ctx) => {
    requireAny(ctx.user, [
      ['pneus', 'ver'],
      ['veiculos', 'ver'],
    ]);
    const { rows: vr } = await ctx.db.query('select id, plate, type, axle_config, status from vehicles where id = $1', [ctx.params.id]);
    const v = vr[0];
    if (!v) throw notFound('Veículo não encontrado.');
    const cfg = await alertSettings(ctx.db);
    const { rows } = await ctx.db.query(`${TIRE_SELECT} where t.vehicle_id = $1`, [v.id]);
    const tires = rows.map((t) => enrich(t, cfg));
    const layout = layoutFor(v);
    const positions = positionsFor(v).map((p) => ({ ...p, tire: tires.find((t) => t.position === p.code) || null }));
    // Pneus em posições que não existem mais (configuração de eixos alterada)
    const orphans = tires.filter((t) => !positions.some((p) => p.code === t.position));
    return { vehicle: v, layout, positions, orphans, odometer: await vehicleOdometer(ctx.db, v.id) };
  });

  r.get('/tire-movements', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.vehicle_id) where.push(`(m.from_vehicle_id = ${p(q.vehicle_id)} or m.to_vehicle_id = $${params.length})`);
    if (q.action) where.push(`m.action = ${p(q.action)}`);
    else if (q.inspecoes !== '1') where.push(`m.action <> 'inspecao'`);
    if (q.from) where.push(`m.moved_at >= (${p(q.from)}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    if (q.to) where.push(`m.moved_at < (${p(q.to)}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
    const { rows } = await ctx.db.query(
      `select m.*, t.code, t.fire_number, fv.plate as from_plate, fv.type as from_type, fv.axle_config as from_axle,
              tv.plate as to_plate, tv.type as to_type, tv.axle_config as to_axle, u.username
         from tire_movements m join tires t on t.id = m.tire_id
         left join vehicles fv on fv.id = m.from_vehicle_id
         left join vehicles tv on tv.id = m.to_vehicle_id
         left join users u on u.id = m.user_id
        ${where.length ? 'where ' + where.join(' and ') : ''} order by m.moved_at desc, m.id desc limit 1000`,
      params,
    );
    for (const m of rows) {
      m.from_position_label = m.from_position ? positionLabel({ type: m.from_type, axle_config: m.from_axle }, m.from_position) : null;
      m.to_position_label = m.to_position ? positionLabel({ type: m.to_type, axle_config: m.to_axle }, m.to_position) : null;
    }
    return { movements: rows };
  });

  r.get('/tire-retreads', async (ctx) => {
    requirePerm(ctx.user, 'pneus', 'ver');
    const params = [];
    let where = '';
    if (ctx.query.status) {
      params.push(ctx.query.status);
      where = 'where r.status = $1';
    }
    const { rows } = await ctx.db.query(
      `select r.*, t.code, t.fire_number, t.brand, t.size, t.retread_count, u.username as created_by_name
         from tire_retreads r join tires t on t.id = r.tire_id left join users u on u.id = r.created_by
        ${where} order by (r.status = 'enviado') desc, r.sent_on desc limit 1000`,
      params,
    );
    const { rows: tot } = await ctx.db.query(
      `select count(*) filter (where status = 'enviado')::int as abertas, coalesce(sum(cost) filter (where status <> 'enviado'), 0)::float as custo_total,
              count(*) filter (where status = 'retornado')::int as aprovadas, count(*) filter (where status = 'reprovado')::int as reprovadas
         from tire_retreads`,
    );
    return { retreads: rows, totals: tot[0] };
  });
}
