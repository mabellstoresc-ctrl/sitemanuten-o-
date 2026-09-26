import { validate } from '../validate.js';
import { badRequest, notFound } from '../http.js';
import { requirePerm } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { csvResponse } from '../csv.js';
import { costEntries, costSummary, kmInPeriod } from '../costs.js';
import { COST_CATEGORIES, COST_SOURCES, labelOf } from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);
const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const FIELDS = {
  vehicle_id: { type: 'uuid', label: 'Veículo' },
  category: { type: 'enum', values: keys(COST_CATEGORIES), required: true, label: 'Categoria' },
  description: { type: 'string', required: true, max: 200, label: 'Descrição' },
  cost_date: { type: 'date', required: true, label: 'Data' },
  amount: { type: 'number', required: true, min: 0.01, max: 10_000_000, label: 'Valor' },
  supplier: { type: 'string', max: 120, label: 'Fornecedor' },
  document_number: { type: 'string', max: 60, label: 'Nº do documento / NF' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};

function periodQuery(q) {
  const out = {};
  for (const k of ['from', 'to']) if (/^\d{4}-\d{2}-\d{2}$/.test(q[k] || '') && !Number.isNaN(Date.parse(q[k]))) out[k] = q[k];
  if (q.vehicle_id === 'geral' || /^[0-9a-f-]{36}$/i.test(q.vehicle_id || '')) out.vehicle_id = q.vehicle_id;
  if (keys(COST_SOURCES).includes(q.source)) out.source = q.source;
  return out;
}

const COST_SELECT = `
  select c.*, v.plate, v.fleet_number, u.username as created_by_name, cu.username as cancelled_by_name
    from costs c left join vehicles v on v.id = c.vehicle_id
    left join users u on u.id = c.created_by left join users cu on cu.id = c.cancelled_by`;

export default function (r) {
  r.get('/costs/summary', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'ver');
    return costSummary(ctx.db, periodQuery(ctx.query));
  });

  r.get('/costs/entries', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'ver');
    const limit = Math.min(Number(ctx.query.limit) || 1000, 20000);
    const entries = await costEntries(ctx.db, periodQuery(ctx.query), limit + 1);
    return { entries: entries.slice(0, limit), truncated: entries.length > limit };
  });

  r.get('/costs/export', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'exportar');
    const entries = await costEntries(ctx.db, periodQuery(ctx.query), 100000);
    await audit(ctx.db, ctx, { module: 'custos', action: 'exportar', entity: 'custo', label: `${entries.length} lançamentos` });
    return csvResponse(
      'custos',
      ['Data', 'Placa', 'Frota', 'Origem', 'Categoria', 'Descrição', 'Valor R$'],
      entries.map((e) => [fmtD(e.date), e.plate || 'Geral', e.fleet_number, labelOf(COST_SOURCES, e.source), e.category_label, e.description, e.amount]),
    );
  });

  // Lançamentos avulsos (IPVA, seguro, multa, pedágio…)
  r.get('/costs', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.vehicle_id === 'geral') where.push('c.vehicle_id is null');
    else if (q.vehicle_id) where.push(`c.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.category) where.push(`c.category = ${p(q.category)}`);
    if (q.from) where.push(`c.cost_date >= ${p(q.from)}::date`);
    if (q.to) where.push(`c.cost_date <= ${p(q.to)}::date`);
    if (q.q) where.push(`(c.description ilike ${p(`%${q.q}%`)} or c.supplier ilike $${params.length} or c.document_number ilike $${params.length})`);
    if (q.status !== 'todos') where.push(`c.status = ${p(q.status || 'ativo')}`);
    const { rows } = await ctx.db.query(`${COST_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by c.cost_date desc, c.created_at desc limit 5000`, params);
    return { costs: rows };
  });

  r.post('/costs', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'cadastrar');
    const d = validate(ctx.body, FIELDS);
    const out = await ctx.tx(async (c) => {
      let v = null;
      if (d.vehicle_id) {
        const { rows } = await c.query('select id, plate from vehicles where id = $1', [d.vehicle_id]);
        v = rows[0];
        if (!v) throw notFound('Veículo não encontrado.');
      }
      const cols = [...Object.keys(FIELDS), 'created_by'];
      const { rows } = await c.query(
        `insert into costs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        [...Object.keys(FIELDS).map((k) => d[k]), ctx.user.id],
      );
      const id = rows[0].id;
      const label = `${labelOf(COST_CATEGORIES, d.category)} · ${d.description} · ${money(d.amount)}`;
      if (v) {
        await vehicleEvent(c, ctx, v.id, { type: 'custo', title: `Custo: ${labelOf(COST_CATEGORIES, d.category)}`, description: `${d.description} · ${money(d.amount)}`, at: `${d.cost_date}T15:00:00.000Z`, refTable: 'costs', refId: id });
      }
      await audit(c, ctx, { module: 'custos', action: 'criar', entity: 'custo', entityId: id, label: `${v ? v.plate : 'Geral'} · ${label}`, changes: snapshot(d) });
      return { id };
    });
    return out;
  });

  r.put('/costs/:id', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'editar');
    const d = validate(ctx.body, FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Lançamento não encontrado.');
      const { rows } = await c.query('select * from costs where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Lançamento não encontrado.');
      if (before.status !== 'ativo') throw badRequest('Lançamento cancelado não pode ser editado.');
      if (d.vehicle_id) {
        const { rows: vr } = await c.query('select 1 from vehicles where id = $1', [d.vehicle_id]);
        if (!vr[0]) throw notFound('Veículo não encontrado.');
      }
      const fields = Object.keys(d);
      if (!fields.length) return;
      await c.query(`update costs set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [before.id, ...fields.map((f) => d[f])]);
      await audit(c, ctx, { module: 'custos', action: 'editar', entity: 'custo', entityId: before.id, label: before.description, changes: diff(before, d, fields) });
    });
    return { ok: true };
  });

  r.post('/costs/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'cancelar');
    const { reason } = validate(ctx.body, { reason: { type: 'string', required: true, min: 5, max: 500, label: 'Motivo' } });
    await ctx.tx(async (c) => {
      if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Lançamento não encontrado.');
      const { rows } = await c.query('select * from costs where id = $1 for update', [ctx.params.id]);
      const cost = rows[0];
      if (!cost) throw notFound('Lançamento não encontrado.');
      if (cost.status !== 'ativo') throw badRequest('Lançamento já cancelado.');
      await c.query(`update costs set status = 'cancelado', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [cost.id, ctx.user.id, reason]);
      await audit(c, ctx, {
        module: 'custos',
        action: 'cancelar',
        entity: 'custo',
        entityId: cost.id,
        label: `${cost.description} · ${money(cost.amount)}`,
        changes: [{ campo: 'status', anterior: 'ativo', novo: 'cancelado' }],
        reason,
      });
    });
    return { ok: true };
  });

  // Aba "Custos" do veículo: mês, ano, total, por categoria e custo por KM
  r.get('/vehicles/:id/costs', async (ctx) => {
    requirePerm(ctx.user, 'custos', 'ver');
    const id = ctx.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Veículo não encontrado.');
    const today = todayBR();
    const month = `${today.slice(0, 7)}-01`;
    const year = `${today.slice(0, 4)}-01-01`;
    const all = await costSummary(ctx.db, { vehicle_id: id });
    const y = await costSummary(ctx.db, { vehicle_id: id, from: year });
    const m = await costSummary(ctx.db, { vehicle_id: id, from: month });
    const km = await kmInPeriod(ctx.db, { vehicleId: id });
    const recent = await costEntries(ctx.db, { vehicle_id: id }, 50);
    const pick = (s) => ({ total: s.total, km: s.by_vehicle.find((v) => v.vehicle_id === id)?.km ?? null, cost_per_km: s.by_vehicle.find((v) => v.vehicle_id === id)?.cost_per_km ?? null, by_category: s.by_category });
    return { month: pick(m), year: pick(y), all: { ...pick(all), km: km[id] ?? null }, by_month: all.by_month.slice(-12), recent };
  });
}
