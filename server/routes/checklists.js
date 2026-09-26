import { validate } from '../validate.js';
import { badRequest, notFound } from '../http.js';
import { requirePerm, requireAny } from '../permissions.js';
import { audit, diff, vehicleEvent } from '../audit.js';
import { registerKm, invalidateReading, syncCurrentKm } from '../km.js';
import { csvResponse } from '../csv.js';
import { CHECKLIST_KINDS, CHECKLIST_RESULTS, VEHICLE_TYPES, TOWED_TYPES, labelOf } from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);
const fmtDT = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');

const TEMPLATE_FIELDS = {
  name: { type: 'string', required: true, max: 100, label: 'Nome do modelo' },
  kind: { type: 'enum', values: keys(CHECKLIST_KINDS), required: true, label: 'Tipo' },
  is_active: { type: 'bool', label: 'Ativo' },
};

const CHECK_FIELDS = {
  template_id: { type: 'uuid', required: true, label: 'Modelo de checklist' },
  vehicle_id: { type: 'uuid', required: true, label: 'Veículo' },
  driver_id: { type: 'uuid', label: 'Motorista' },
  performed_at: { type: 'datetime', required: true, label: 'Data/hora' },
  km: { type: 'int', min: 0, max: 9_999_999, label: 'Quilometragem' },
  inspector: { type: 'string', max: 120, label: 'Responsável pela vistoria' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};

function slug(s) {
  return (
    String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'item'
  );
}

/** Normaliza os itens do modelo, mantendo as chaves existentes e criando chaves únicas para os novos. */
function parseItems(raw) {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('Inclua pelo menos um item no checklist.');
  if (raw.length > 150) throw badRequest('Máximo de 150 itens por checklist.');
  const used = new Set();
  return raw.map((it, i) => {
    const label = String(it?.label ?? '').trim();
    if (!label) throw badRequest(`Item ${i + 1}: informe a descrição.`);
    if (label.length > 200) throw badRequest(`Item ${i + 1}: máximo de 200 caracteres.`);
    const group = String(it?.group ?? '').trim().slice(0, 60) || null;
    let key = /^[a-z0-9_]{1,50}$/.test(it?.key || '') ? it.key : slug(label);
    let n = 2;
    const base = key;
    while (used.has(key)) key = `${base}_${n++}`;
    used.add(key);
    return { key, group, label, critical: Boolean(it?.critical) };
  });
}

function parseVehicleTypes(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest('Tipos de veículo inválidos.');
  const list = [...new Set(raw.map(String))];
  if (list.some((t) => !keys(VEHICLE_TYPES).includes(t))) throw badRequest('Tipo de veículo inválido.');
  return list;
}

const CHECK_SELECT = `
  select c.*, v.plate, v.fleet_number, v.type as vehicle_type, d.full_name as driver_name,
         so.number as service_order_number, so.status as service_order_status,
         u.username as created_by_name, cu.username as cancelled_by_name
    from checklists c
    join vehicles v on v.id = c.vehicle_id
    left join drivers d on d.id = c.driver_id
    left join service_orders so on so.id = c.service_order_id
    left join users u on u.id = c.created_by
    left join users cu on cu.id = c.cancelled_by`;

function checkFilters(q) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (q.vehicle_id) where.push(`c.vehicle_id = ${p(q.vehicle_id)}`);
  if (q.driver_id) where.push(`c.driver_id = ${p(q.driver_id)}`);
  if (q.template_id) where.push(`c.template_id = ${p(q.template_id)}`);
  if (q.kind) where.push(`c.kind = ${p(q.kind)}`);
  if (q.result === 'pendentes') where.push(`c.result <> 'ok' and c.service_order_id is null`);
  else if (q.result) where.push(`c.result = ${p(q.result)}`);
  if (q.from) where.push(`c.performed_at >= (${p(q.from)}::date)::timestamp at time zone 'America/Sao_Paulo'`);
  if (q.to) where.push(`c.performed_at < (${p(q.to)}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
  if (q.status !== 'todos') where.push(`c.status = ${p(q.status || 'ativo')}`);
  return { where: where.length ? `where ${where.join(' and ')}` : '', params };
}

export default function (r) {
  // ---------------- Modelos ----------------
  r.get('/checklist-templates', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'ver');
    const { rows } = await ctx.db.query(
      `select t.*, jsonb_array_length(t.items) as item_count,
              (select count(*)::int from checklists c where c.template_id = t.id) as uses
         from checklist_templates t where t.is_active or $1 order by t.is_active desc, t.name`,
      [ctx.query.all === '1'],
    );
    return { templates: rows };
  });

  r.get('/checklist-templates/:id', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'ver');
    if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Modelo não encontrado.');
    const { rows } = await ctx.db.query('select * from checklist_templates where id = $1', [ctx.params.id]);
    if (!rows[0]) throw notFound('Modelo não encontrado.');
    return { template: rows[0] };
  });

  r.post('/checklist-templates', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'cadastrar');
    const d = validate(ctx.body, TEMPLATE_FIELDS);
    const items = parseItems(ctx.body?.items);
    const types = parseVehicleTypes(ctx.body?.vehicle_types);
    const { rows } = await ctx.db.query(
      `insert into checklist_templates (name, kind, vehicle_types, items, is_active, created_by) values ($1, $2, $3, $4, true, $5) returning id`,
      [d.name, d.kind, types, JSON.stringify(items), ctx.user.id],
    );
    await audit(ctx.db, ctx, {
      module: 'checklists',
      action: 'criar',
      entity: 'modelo_checklist',
      entityId: rows[0].id,
      label: d.name,
      changes: [
        { campo: 'name', anterior: null, novo: d.name },
        { campo: 'itens', anterior: null, novo: items.length },
      ],
    });
    return { id: rows[0].id };
  });

  r.put('/checklist-templates/:id', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'editar');
    const d = validate(ctx.body, TEMPLATE_FIELDS, { partial: true });
    const items = ctx.body?.items !== undefined ? parseItems(ctx.body.items) : null;
    const types = ctx.body?.vehicle_types !== undefined ? parseVehicleTypes(ctx.body.vehicle_types) : null;
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from checklist_templates where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Modelo não encontrado.');
      const next = { ...before, ...d };
      if (items) next.items = items;
      if (types) next.vehicle_types = types;
      await c.query(
        `update checklist_templates set name = $2, kind = $3, is_active = $4, items = $5, vehicle_types = $6, updated_at = now() where id = $1`,
        [before.id, next.name, next.kind, next.is_active, JSON.stringify(next.items), next.vehicle_types],
      );
      const changes = diff(before, d, Object.keys(d));
      if (items && JSON.stringify(items) !== JSON.stringify(before.items)) {
        changes.push({ campo: 'itens', anterior: before.items.map((i) => i.label).join(' | '), novo: items.map((i) => i.label).join(' | ') });
      }
      if (types && JSON.stringify(types) !== JSON.stringify(before.vehicle_types)) {
        changes.push({ campo: 'tipos_veiculo', anterior: before.vehicle_types, novo: types });
      }
      await audit(c, ctx, { module: 'checklists', action: 'editar', entity: 'modelo_checklist', entityId: before.id, label: next.name, changes });
    });
    return { ok: true };
  });

  // ---------------- Checklists realizados ----------------
  r.get('/checklists', async (ctx) => {
    requireAny(ctx.user, [
      ['checklists', 'ver'],
      ['veiculos', 'ver'],
    ]);
    const { where, params } = checkFilters(ctx.query);
    const limit = Math.min(Number(ctx.query.limit) || 500, 5000);
    const { rows } = await ctx.db.query(`${CHECK_SELECT} ${where} order by c.performed_at desc limit ${limit}`, params);
    return { checklists: rows, truncated: rows.length === limit };
  });

  r.get('/checklists/export', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'exportar');
    const { where, params } = checkFilters(ctx.query);
    const { rows } = await ctx.db.query(
      `${CHECK_SELECT} ${where} order by c.performed_at desc limit 20000`,
      params,
    );
    const ids = rows.map((x) => x.id);
    const { rows: nok } = await ctx.db.query(
      `select checklist_id, string_agg(label || coalesce(' (' || note || ')', ''), '; ' order by position) as items
         from checklist_answers where answer = 'nok' and checklist_id = any($1) group by checklist_id`,
      [ids],
    );
    const nokMap = Object.fromEntries(nok.map((n) => [n.checklist_id, n.items]));
    await audit(ctx.db, ctx, { module: 'checklists', action: 'exportar', entity: 'checklist', label: `${rows.length} registros` });
    return csvResponse(
      'checklists',
      ['Nº', 'Data/hora', 'Placa', 'Modelo', 'Tipo', 'Motorista', 'KM', 'Vistoriador', 'Resultado', 'Itens com problema', 'OS', 'Observações', 'Situação'],
      rows.map((c) => [
        c.number,
        fmtDT(c.performed_at),
        c.plate,
        c.template_name,
        labelOf(CHECKLIST_KINDS, c.kind),
        c.driver_name,
        c.km,
        c.inspector,
        labelOf(CHECKLIST_RESULTS, c.result),
        nokMap[c.id],
        c.service_order_number,
        c.notes,
        c.status,
      ]),
    );
  });

  r.get('/checklists/:id', async (ctx) => {
    requireAny(ctx.user, [
      ['checklists', 'ver'],
      ['veiculos', 'ver'],
    ]);
    if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Checklist não encontrado.');
    const { rows } = await ctx.db.query(`${CHECK_SELECT} where c.id = $1`, [ctx.params.id]);
    if (!rows[0]) throw notFound('Checklist não encontrado.');
    const { rows: answers } = await ctx.db.query('select * from checklist_answers where checklist_id = $1 order by position', [ctx.params.id]);
    return { checklist: { ...rows[0], answers } };
  });

  r.post('/checklists', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'cadastrar');
    const d = validate(ctx.body, CHECK_FIELDS);
    const flags = validate(ctx.body, {
      confirm_jump: { type: 'bool' },
      confirm_lower: { type: 'bool' },
      km_reason: { type: 'string', max: 500 },
    });
    if (new Date(d.performed_at) > new Date(Date.now() + 5 * 60e3)) throw badRequest('A data do checklist não pode ser no futuro.');
    const rawAnswers = Array.isArray(ctx.body?.answers) ? ctx.body.answers : [];

    const out = await ctx.tx(async (c) => {
      const { rows: tr } = await c.query('select * from checklist_templates where id = $1', [d.template_id]);
      const tpl = tr[0];
      if (!tpl) throw notFound('Modelo de checklist não encontrado.');
      if (!tpl.is_active) throw badRequest('Este modelo de checklist está desativado.');
      const { rows: vr } = await c.query('select id, plate, type, status from vehicles where id = $1', [d.vehicle_id]);
      const v = vr[0];
      if (!v) throw notFound('Veículo não encontrado.');
      if (v.status === 'inativo') throw badRequest('Veículo inativo.');
      if (tpl.vehicle_types.length && !tpl.vehicle_types.includes(v.type)) {
        throw badRequest(`O modelo "${tpl.name}" não se aplica a ${labelOf(VEHICLE_TYPES, v.type).toLowerCase()}.`);
      }
      if (d.driver_id) {
        const { rows: dr } = await c.query('select 1 from drivers where id = $1', [d.driver_id]);
        if (!dr[0]) throw notFound('Motorista não encontrado.');
      }
      if (TOWED_TYPES.includes(v.type)) d.km = null;

      const byKey = new Map(rawAnswers.map((a) => [String(a?.key), a]));
      const missing = [];
      const answers = tpl.items.map((it, i) => {
        const a = byKey.get(it.key);
        const answer = ['ok', 'nok', 'na'].includes(a?.answer) ? a.answer : null;
        if (!answer) missing.push(it.label);
        const note = String(a?.note ?? '').trim().slice(0, 500) || null;
        return { position: i, key: it.key, group: it.group || null, label: it.label, critical: Boolean(it.critical), answer, note };
      });
      if (missing.length) {
        throw badRequest(`Responda todos os itens. Faltam ${missing.length}: ${missing.slice(0, 3).join('; ')}${missing.length > 3 ? '…' : ''}`, { code: 'ITENS_SEM_RESPOSTA' });
      }
      const nok = answers.filter((a) => a.answer === 'nok');
      const critical = nok.filter((a) => a.critical);
      const result = critical.length ? 'reprovado' : nok.length ? 'problemas' : 'ok';

      const { rows } = await c.query(
        `insert into checklists (template_id, template_name, kind, vehicle_id, driver_id, performed_at, km, inspector, notes, result, nok_count, critical_count, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, number`,
        [tpl.id, tpl.name, tpl.kind, v.id, d.driver_id, d.performed_at, d.km, d.inspector, d.notes, result, nok.length, critical.length, ctx.user.id],
      );
      const ck = rows[0];
      for (const a of answers) {
        await c.query(
          `insert into checklist_answers (checklist_id, position, item_key, item_group, label, critical, answer, note) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ck.id, a.position, a.key, a.group, a.label, a.critical, a.answer, a.note],
        );
      }
      if (d.km !== null && d.km !== undefined) {
        await registerKm(c, ctx, v.id, d.km, {
          source: 'checklist',
          sourceId: ck.id,
          readingAt: d.performed_at,
          confirmJump: flags.confirm_jump,
          confirmLower: flags.confirm_lower,
          reason: flags.km_reason,
        });
      }
      await vehicleEvent(c, ctx, v.id, {
        type: 'checklist',
        title: `Checklist nº ${ck.number} — ${labelOf(CHECKLIST_RESULTS, result)}`,
        description: [tpl.name, d.km && `KM ${d.km.toLocaleString('pt-BR')}`, nok.length && `${nok.length} item(ns) com problema: ${nok.map((a) => a.label).slice(0, 5).join('; ')}`]
          .filter(Boolean)
          .join(' · '),
        at: d.performed_at,
        refTable: 'checklists',
        refId: ck.id,
      });
      await audit(c, ctx, {
        module: 'checklists',
        action: 'criar',
        entity: 'checklist',
        entityId: ck.id,
        label: `Checklist nº ${ck.number} · ${v.plate}`,
        changes: [
          { campo: 'modelo', anterior: null, novo: tpl.name },
          { campo: 'resultado', anterior: null, novo: result },
          ...(nok.length ? [{ campo: 'itens_com_problema', anterior: null, novo: nok.map((a) => a.label).join('; ') }] : []),
          ...(d.km ? [{ campo: 'km', anterior: null, novo: d.km }] : []),
        ],
      });
      return { id: ck.id, number: ck.number, result, nok: nok.length };
    });
    return out;
  });

  r.post('/checklists/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'checklists', 'cancelar');
    const { reason } = validate(ctx.body, { reason: { type: 'string', required: true, min: 5, max: 500, label: 'Motivo' } });
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select c.*, v.plate from checklists c join vehicles v on v.id = c.vehicle_id where c.id = $1 for update of c', [ctx.params.id]);
      const ck = rows[0];
      if (!ck) throw notFound('Checklist não encontrado.');
      if (ck.status === 'cancelado') throw badRequest('Checklist já cancelado.');
      await c.query(`update checklists set status = 'cancelado', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 where id = $1`, [ck.id, ctx.user.id, reason]);
      if (ck.km !== null) {
        await invalidateReading(c, ck.vehicle_id, 'checklist', ck.id);
        await syncCurrentKm(c, ctx, ck.vehicle_id, { reason: `Cancelamento do checklist nº ${ck.number}: ${reason}` });
      }
      await vehicleEvent(c, ctx, ck.vehicle_id, { type: 'checklist', title: `Checklist nº ${ck.number} cancelado`, description: reason, refTable: 'checklists', refId: ck.id });
      await audit(c, ctx, {
        module: 'checklists',
        action: 'cancelar',
        entity: 'checklist',
        entityId: ck.id,
        label: `Checklist nº ${ck.number} · ${ck.plate}`,
        changes: [{ campo: 'status', anterior: 'ativo', novo: 'cancelado' }],
        reason,
      });
    });
    return { ok: true };
  });
}
