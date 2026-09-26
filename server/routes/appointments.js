// Agenda: compromissos marcados direto no calendário (vistoria, revisão agendada, renovação de documento…).
import { validate } from '../validate.js';
import { badRequest, notFound } from '../http.js';
import { requirePerm } from '../permissions.js';
import { audit, diff, vehicleEvent } from '../audit.js';

const FIELDS = {
  vehicle_id: { type: 'uuid', label: 'Veículo' },
  title: { type: 'string', required: true, max: 150, label: 'Compromisso' },
  scheduled_on: { type: 'date', required: true, label: 'Data' },
  notes: { type: 'text', max: 2000, label: 'Observações' },
};

const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

async function load(c, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Compromisso não encontrado.');
  const { rows } = await c.query('select a.*, v.plate from appointments a left join vehicles v on v.id = a.vehicle_id where a.id = $1 for update of a', [id]);
  if (!rows[0]) throw notFound('Compromisso não encontrado.');
  return rows[0];
}

export default function (r) {
  r.post('/appointments', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cadastrar');
    const d = validate(ctx.body, FIELDS);
    return ctx.tx(async (c) => {
      let plate = null;
      if (d.vehicle_id) {
        const { rows } = await c.query('select plate from vehicles where id = $1', [d.vehicle_id]);
        if (!rows[0]) throw notFound('Veículo não encontrado.');
        plate = rows[0].plate;
      }
      const { rows } = await c.query(
        'insert into appointments (vehicle_id, title, scheduled_on, notes, created_by) values ($1, $2, $3, $4, $5) returning id',
        [d.vehicle_id, d.title, d.scheduled_on, d.notes, ctx.user.id],
      );
      if (d.vehicle_id) {
        await vehicleEvent(c, ctx, d.vehicle_id, { type: 'agenda', title: 'Compromisso agendado', description: `${d.title} — ${fmtD(d.scheduled_on)}`, refTable: 'appointments', refId: rows[0].id });
      }
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'criar',
        entity: 'agendamento',
        entityId: rows[0].id,
        label: `${fmtD(d.scheduled_on)} · ${d.title}${plate ? ` · ${plate}` : ''}`,
        changes: Object.entries(d)
          .filter(([, v]) => v)
          .map(([k, v]) => ({ campo: k, anterior: null, novo: v })),
      });
      return { id: rows[0].id };
    });
  });

  r.put('/appointments/:id', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const d = validate(ctx.body, FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      const a = await load(c, ctx.params.id);
      if (a.cancelled_at) throw badRequest('Compromisso cancelado.');
      const fields = Object.keys(d);
      if (!fields.length) return;
      await c.query(`update appointments set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [a.id, ...fields.map((f) => d[f])]);
      await audit(c, ctx, { module: 'manutencoes', action: 'editar', entity: 'agendamento', entityId: a.id, label: a.title, changes: diff(a, d, fields) });
    });
    return { ok: true };
  });

  // Marcar como feito / desfazer
  r.post('/appointments/:id/done', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const done = ctx.body?.done !== false;
    await ctx.tx(async (c) => {
      const a = await load(c, ctx.params.id);
      if (a.cancelled_at) throw badRequest('Compromisso cancelado.');
      await c.query('update appointments set done_at = $2, done_by = $3, updated_at = now() where id = $1', [a.id, done ? new Date().toISOString() : null, done ? ctx.user.id : null]);
      if (done && a.vehicle_id) await vehicleEvent(c, ctx, a.vehicle_id, { type: 'agenda', title: 'Compromisso realizado', description: a.title, refTable: 'appointments', refId: a.id });
      await audit(c, ctx, { module: 'manutencoes', action: done ? 'concluir' : 'reabrir', entity: 'agendamento', entityId: a.id, label: a.title });
    });
    return { ok: true };
  });

  r.post('/appointments/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim() || null;
    await ctx.tx(async (c) => {
      const a = await load(c, ctx.params.id);
      if (a.cancelled_at) return;
      await c.query('update appointments set cancelled_at = now(), cancelled_by = $2, updated_at = now() where id = $1', [a.id, ctx.user.id]);
      await audit(c, ctx, { module: 'manutencoes', action: 'cancelar', entity: 'agendamento', entityId: a.id, label: a.title, reason });
    });
    return { ok: true };
  });
}
