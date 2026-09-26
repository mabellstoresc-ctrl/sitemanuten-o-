import { validate } from '../validate.js';
import { badRequest, notFound } from '../http.js';
import { requirePerm, requireAny, can } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { alertSettings } from '../maintenance.js';
import { csvResponse } from '../csv.js';
import { DOCUMENT_TYPES, DOCUMENT_OWNERS, TOWED_TYPES, labelOf } from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);
const TODAY = `(now() at time zone 'America/Sao_Paulo')::date`;
const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// Tipos em que só um documento fica vigente por dono (o novo substitui o anterior)
const SINGLE_TYPES = ['crlv', 'tacografo', 'civ_cipp', 'aso', 'toxicologico'];

const FIELDS = {
  owner: { type: 'enum', values: keys(DOCUMENT_OWNERS), required: true, label: 'Documento de' },
  vehicle_id: { type: 'uuid', label: 'Veículo' },
  driver_id: { type: 'uuid', label: 'Motorista' },
  type: { type: 'enum', values: keys(DOCUMENT_TYPES), required: true, label: 'Tipo de documento' },
  number: { type: 'string', max: 60, label: 'Número' },
  issuer: { type: 'string', max: 80, label: 'Órgão / emissor' },
  issued_on: { type: 'date', label: 'Emissão' },
  valid_from: { type: 'date', label: 'Válido a partir de' },
  expires_on: { type: 'date', label: 'Vencimento' },
  exercise_year: { type: 'int', min: 1990, max: 2100, label: 'Exercício' },
  pbtc: { type: 'number', min: 0, max: 200, label: 'PBTC (t)' },
  combination: { type: 'string', max: 80, label: 'Tipo de conjunto', upper: true },
  amount: { type: 'number', min: 0, max: 10_000_000, label: 'Valor pago' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};
const EDITABLE = Object.keys(FIELDS).filter((k) => !['owner', 'vehicle_id', 'driver_id', 'type'].includes(k));

export const DOC_SELECT = `
  select d.*, v.plate, v.fleet_number, v.type as vehicle_type, dr.full_name as driver_name,
         (d.expires_on - ${TODAY}) as days_left,
         u.username as created_by_name, cu.username as cancelled_by_name,
         (select coalesce(json_agg(json_build_object('id', av.id, 'plate', av.plate) order by av.plate), '[]'::json)
            from document_vehicles dv join vehicles av on av.id = dv.vehicle_id where dv.document_id = d.id) as authorized,
         (select count(*)::int from attachments a where a.entity = 'document' and a.entity_id = d.id and a.deleted_at is null) as files
    from documents d
    left join vehicles v on v.id = d.vehicle_id
    left join drivers dr on dr.id = d.driver_id
    left join users u on u.id = d.created_by
    left join users cu on cu.id = d.cancelled_by`;

/** Situação de validade: vencido | vencendo | vigente | sem_validade */
export function docState(d, warnDays) {
  if (d.status !== 'ativo') return d.status;
  if (d.days_left === null || d.days_left === undefined) return 'sem_validade';
  if (d.days_left < 0) return 'vencido';
  if (d.days_left <= warnDays) return 'vencendo';
  return 'vigente';
}

export function docLabel(d) {
  const t = labelOf(DOCUMENT_TYPES, d.type).replace(/ \(.*\)$/, '');
  const who = d.plate || d.driver_name || 'Empresa';
  return `${t}${d.number ? ` nº ${d.number}` : ''} — ${who}`;
}

/** Módulo usado para ver documentos: documentos, ou o módulo do dono (veículos/motoristas) em leitura. */
function requireView(ctx) {
  requireAny(ctx.user, [
    ['documentos', 'ver'],
    ['veiculos', 'ver'],
    ['motoristas', 'ver'],
  ]);
}

function ownerFilter(user) {
  if (can(user, 'documentos', 'ver')) return '';
  const allow = [];
  if (can(user, 'veiculos', 'ver')) allow.push(`d.owner = 'veiculo'`);
  if (can(user, 'motoristas', 'ver')) allow.push(`d.owner = 'motorista'`);
  return allow.length ? `(${allow.join(' or ')})` : 'false';
}

function docFilters(q, user, warnDays) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const own = ownerFilter(user);
  if (own) where.push(own);
  if (q.owner) where.push(`d.owner = ${p(q.owner)}`);
  if (q.type) where.push(`d.type = ${p(q.type)}`);
  if (q.vehicle_id) {
    // Documentos do próprio veículo + AETs em que ele aparece como implemento autorizado
    const vid = p(q.vehicle_id);
    where.push(`(d.vehicle_id = ${vid} or exists (select 1 from document_vehicles dv where dv.document_id = d.id and dv.vehicle_id = ${vid}))`);
  }
  if (q.driver_id) where.push(`d.driver_id = ${p(q.driver_id)}`);
  if (q.q) {
    const like = p(`%${q.q.trim()}%`);
    const plate = p(`%${q.q.trim().toUpperCase().replace(/[-\s]/g, '')}%`);
    where.push(`(d.number ilike ${like} or d.issuer ilike ${like} or v.plate like ${plate} or dr.full_name ilike ${like} or d.notes ilike ${like})`);
  }
  const state = q.state || 'vigentes';
  if (state === 'vencidos') where.push(`d.status = 'ativo' and d.expires_on < ${TODAY}`);
  else if (state === 'vencendo') where.push(`d.status = 'ativo' and d.expires_on between ${TODAY} and ${TODAY} + ${p(warnDays)}::int`);
  else if (state === 'atencao') where.push(`d.status = 'ativo' and d.expires_on <= ${TODAY} + ${p(warnDays)}::int`);
  else if (state === 'vigentes') where.push(`d.status = 'ativo'`);
  else if (state !== 'todos') where.push(`d.status = ${p(state)}`);
  return { where: where.length ? `where ${where.join(' and ')}` : '', params };
}

async function getDoc(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Documento não encontrado.');
  const { rows } = await db.query(`${DOC_SELECT} where d.id = $1`, [id]);
  if (!rows[0]) throw notFound('Documento não encontrado.');
  return rows[0];
}

function checkDates(d) {
  if (d.valid_from && d.expires_on && d.expires_on < d.valid_from) {
    throw badRequest('O vencimento deve ser depois do início da validade.', { fields: { expires_on: 'Antes do início' } });
  }
}

/** Valida a lista de implementos autorizados (só AET). */
async function parseAuthorized(c, raw, doc) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw badRequest('Lista de implementos inválida.');
  const ids = [...new Set(raw.map(String))];
  if (!ids.length) return [];
  if (doc.type !== 'aet') throw badRequest('Implementos autorizados só se aplicam à AET.');
  if (ids.length > 100) throw badRequest('Lista de implementos muito grande.');
  if (ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) throw badRequest('Implemento inválido.');
  const { rows } = await c.query('select id, plate, type from vehicles where id = any($1)', [ids]);
  if (rows.length !== ids.length) throw badRequest('Implemento não encontrado.');
  const bad = rows.find((r) => !TOWED_TYPES.includes(r.type));
  if (bad) throw badRequest(`${bad.plate} não é carreta/implemento.`);
  if (ids.includes(doc.vehicle_id)) throw badRequest('O próprio veículo não pode estar na lista de implementos.');
  return rows;
}

async function saveAuthorized(c, docId, list) {
  await c.query('delete from document_vehicles where document_id = $1', [docId]);
  for (const v of list) await c.query('insert into document_vehicles (document_id, vehicle_id) values ($1, $2)', [docId, v.id]);
}

export default function (r) {
  // AETs vigentes de um cavalo e se o implemento está autorizado (usado ao engatar)
  r.get('/documents/aet-check', async (ctx) => {
    requireView(ctx);
    const { tractor_id: tractorId, trailer_id: trailerId } = ctx.query;
    if (!/^[0-9a-f-]{36}$/i.test(tractorId || '') || !/^[0-9a-f-]{36}$/i.test(trailerId || '')) throw badRequest('Informe os veículos.');
    return aetCheck(ctx.db, tractorId, trailerId);
  });

  r.get('/documents', async (ctx) => {
    requireView(ctx);
    const a = await alertSettings(ctx.db);
    const { where, params } = docFilters(ctx.query, ctx.user, a.documento_dias);
    const { rows } = await ctx.db.query(
      `${DOC_SELECT} ${where} order by d.status = 'ativo' desc, d.expires_on nulls last, d.created_at desc limit 2000`,
      params,
    );
    for (const d of rows) d.state = docState(d, a.documento_dias);
    return { documents: rows, warn_days: a.documento_dias };
  });

  r.get('/documents/export', async (ctx) => {
    requirePerm(ctx.user, 'documentos', 'exportar');
    const a = await alertSettings(ctx.db);
    const { where, params } = docFilters(ctx.query, ctx.user, a.documento_dias);
    const { rows } = await ctx.db.query(`${DOC_SELECT} ${where} order by d.expires_on nulls last limit 20000`, params);
    await audit(ctx.db, ctx, { module: 'documentos', action: 'exportar', entity: 'documento', label: `${rows.length} registros` });
    const states = { vencido: 'Vencido', vencendo: 'Vencendo', vigente: 'Vigente', sem_validade: 'Sem vencimento', substituido: 'Substituído', cancelado: 'Cancelado' };
    return csvResponse(
      'documentos',
      ['Documento', 'Dono', 'Placa / motorista', 'Número', 'Órgão', 'Emissão', 'Válido de', 'Vencimento', 'Dias', 'Exercício', 'Implementos autorizados', 'Valor R$', 'Situação', 'Observações'],
      rows.map((d) => [
        labelOf(DOCUMENT_TYPES, d.type),
        labelOf(DOCUMENT_OWNERS, d.owner),
        d.plate || d.driver_name || 'Empresa',
        d.number,
        d.issuer,
        fmtD(d.issued_on),
        fmtD(d.valid_from),
        fmtD(d.expires_on),
        d.days_left,
        d.exercise_year,
        (d.authorized || []).map((x) => x.plate).join(', '),
        d.amount,
        states[docState(d, a.documento_dias)],
        d.notes,
      ]),
    );
  });

  r.get('/documents/:id', async (ctx) => {
    requireView(ctx);
    const d = await getDoc(ctx.db, ctx.params.id);
    const own = ownerFilter(ctx.user);
    if (own && !((d.owner === 'veiculo' && can(ctx.user, 'veiculos', 'ver')) || (d.owner === 'motorista' && can(ctx.user, 'motoristas', 'ver')))) {
      throw notFound('Documento não encontrado.');
    }
    const a = await alertSettings(ctx.db);
    d.state = docState(d, a.documento_dias);
    // Histórico do mesmo tipo para o mesmo dono
    const { rows: history } = await ctx.db.query(
      `select id, number, issuer, issued_on, expires_on, exercise_year, status, created_at from documents
        where id <> $1 and type = $2 and owner = $3 and vehicle_id is not distinct from $4 and driver_id is not distinct from $5
        order by coalesce(expires_on, issued_on, created_at::date) desc`,
      [d.id, d.type, d.owner, d.vehicle_id, d.driver_id],
    );
    return { document: d, history, warn_days: a.documento_dias };
  });

  r.post('/documents', async (ctx) => {
    requirePerm(ctx.user, 'documentos', 'cadastrar');
    const d = validate(ctx.body, FIELDS);
    const typeDef = DOCUMENT_TYPES.find((t) => t.key === d.type);
    if (!typeDef.owners.includes(d.owner)) throw badRequest(`${typeDef.label} não se aplica a ${labelOf(DOCUMENT_OWNERS, d.owner).toLowerCase()}.`);
    if (d.owner === 'veiculo' && !d.vehicle_id) throw badRequest('Selecione o veículo.', { fields: { vehicle_id: 'Obrigatório' } });
    if (d.owner === 'motorista' && !d.driver_id) throw badRequest('Selecione o motorista.', { fields: { driver_id: 'Obrigatório' } });
    if (d.owner !== 'veiculo') d.vehicle_id = null;
    if (d.owner !== 'motorista') d.driver_id = null;
    if (d.type !== 'crlv') d.exercise_year = null;
    if (d.type !== 'aet') {
      d.pbtc = null;
      d.combination = null;
    }
    checkDates(d);

    const out = await ctx.tx(async (c) => {
      let vehicle = null;
      let driver = null;
      if (d.vehicle_id) {
        const { rows } = await c.query('select id, plate, type, status from vehicles where id = $1 for update', [d.vehicle_id]);
        vehicle = rows[0];
        if (!vehicle) throw notFound('Veículo não encontrado.');
      }
      if (d.driver_id) {
        const { rows } = await c.query('select id, full_name from drivers where id = $1', [d.driver_id]);
        driver = rows[0];
        if (!driver) throw notFound('Motorista não encontrado.');
      }
      const authorized = (await parseAuthorized(c, ctx.body?.authorized_vehicle_ids, d)) || [];

      if (d.number) {
        const { rows: dup } = await c.query(
          `select id from documents where status <> 'cancelado' and type = $1 and lower(number) = lower($2)
              and vehicle_id is not distinct from $3 and driver_id is not distinct from $4
              and coalesce(exercise_year, 0) = coalesce($5, 0)`,
          [d.type, d.number, d.vehicle_id, d.driver_id, d.exercise_year],
        );
        if (dup[0]) throw badRequest('Este documento já está cadastrado.', { code: 'DOCUMENTO_DUPLICADO', id: dup[0].id });
      }

      // Documento anterior vigente do mesmo tipo (e do mesmo órgão, no caso da AET)
      let previous = [];
      if (d.owner !== 'empresa' && (SINGLE_TYPES.includes(d.type) || (d.type === 'aet' && d.issuer))) {
        const { rows } = await c.query(
          `select id, number, exercise_year, expires_on from documents
            where status = 'ativo' and type = $1 and vehicle_id is not distinct from $2 and driver_id is not distinct from $3
              and ($4::text is null or lower(coalesce(issuer, '')) = lower($4)) for update`,
          [d.type, d.vehicle_id, d.driver_id, d.type === 'aet' ? d.issuer : null],
        );
        previous = rows;
      }
      // Um CRLV/documento mais antigo que o vigente entra já como substituído (histórico)
      const newer = previous.find(
        (p) => (d.exercise_year && p.exercise_year && p.exercise_year > d.exercise_year) || (d.expires_on && p.expires_on && p.expires_on > d.expires_on),
      );
      const status = newer ? 'substituido' : 'ativo';

      const cols = [...Object.keys(FIELDS), 'status', 'replaced_by', 'created_by'];
      const vals = [...Object.keys(FIELDS).map((k) => d[k]), status, newer?.id ?? null, ctx.user.id];
      const { rows } = await c.query(
        `insert into documents (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        vals,
      );
      const id = rows[0].id;
      await saveAuthorized(c, id, authorized);
      if (!newer && previous.length) {
        await c.query(`update documents set status = 'substituido', replaced_by = $2, updated_at = now() where id = any($1)`, [previous.map((p) => p.id), id]);
      }

      const label = docLabel({ ...d, plate: vehicle?.plate, driver_name: driver?.full_name });
      if (vehicle) {
        await vehicleEvent(c, ctx, vehicle.id, {
          type: 'documento',
          title: `Documento: ${labelOf(DOCUMENT_TYPES, d.type)}`,
          description: [d.number && `nº ${d.number}`, d.issuer, d.exercise_year && `exercício ${d.exercise_year}`, d.expires_on && `vence em ${fmtD(d.expires_on)}`, authorized.length && `${authorized.length} implemento(s) autorizado(s)`]
            .filter(Boolean)
            .join(' · '),
          refTable: 'documents',
          refId: id,
        });
      }
      await audit(c, ctx, {
        module: 'documentos',
        action: 'criar',
        entity: 'documento',
        entityId: id,
        label,
        changes: [
          ...snapshot(d),
          ...(authorized.length ? [{ campo: 'implementos_autorizados', anterior: null, novo: authorized.map((x) => x.plate).join(', ') }] : []),
          ...(previous.length && !newer ? [{ campo: 'substitui', anterior: null, novo: previous.map((p) => p.number || p.id).join(', ') }] : []),
        ],
      });
      return { id, status, replaced: newer ? 0 : previous.length };
    });
    return out;
  });

  r.put('/documents/:id', async (ctx) => {
    requirePerm(ctx.user, 'documentos', 'editar');
    const schema = Object.fromEntries(EDITABLE.map((k) => [k, FIELDS[k]]));
    const data = validate(ctx.body, schema, { partial: true });
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from documents where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Documento não encontrado.');
      if (before.status === 'cancelado') throw badRequest('Documento cancelado não pode ser editado.');
      if (before.type !== 'crlv') delete data.exercise_year;
      if (before.type !== 'aet') {
        delete data.pbtc;
        delete data.combination;
      }
      checkDates({ ...before, ...data });
      const fields = Object.keys(data);
      if (fields.length) {
        await c.query(`update documents set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [
          before.id,
          ...fields.map((f) => data[f]),
        ]);
      }
      const changes = diff(before, data, fields);
      const authorized = await parseAuthorized(c, ctx.body?.authorized_vehicle_ids, before);
      if (authorized) {
        const { rows: cur } = await c.query(
          'select v.plate from document_vehicles dv join vehicles v on v.id = dv.vehicle_id where dv.document_id = $1 order by v.plate',
          [before.id],
        );
        const a = cur.map((x) => x.plate).join(', ');
        const b = authorized.map((x) => x.plate).sort().join(', ');
        if (a !== b) {
          await saveAuthorized(c, before.id, authorized);
          changes.push({ campo: 'implementos_autorizados', anterior: a || null, novo: b || null });
        }
      }
      const { rows: lbl } = await c.query(`${DOC_SELECT} where d.id = $1`, [before.id]);
      await audit(c, ctx, { module: 'documentos', action: 'editar', entity: 'documento', entityId: before.id, label: docLabel(lbl[0]), changes });
    });
    return { ok: true };
  });

  r.post('/documents/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'documentos', 'cancelar');
    const { reason } = validate(ctx.body, { reason: { type: 'string', required: true, min: 5, max: 500, label: 'Motivo' } });
    await ctx.tx(async (c) => {
      const { rows } = await c.query(`${DOC_SELECT} where d.id = $1`, [ctx.params.id]);
      const d = rows[0];
      if (!d) throw notFound('Documento não encontrado.');
      if (d.status === 'cancelado') throw badRequest('Documento já cancelado.');
      await c.query(`update documents set status = 'cancelado', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [
        d.id,
        ctx.user.id,
        reason,
      ]);
      // Se ele tinha substituído outro, o anterior volta a valer
      if (d.status === 'ativo') {
        await c.query(`update documents set status = 'ativo', replaced_by = null, updated_at = now() where replaced_by = $1 and status = 'substituido'`, [d.id]);
      }
      await audit(c, ctx, {
        module: 'documentos',
        action: 'cancelar',
        entity: 'documento',
        entityId: d.id,
        label: docLabel(d),
        changes: [{ campo: 'status', anterior: d.status, novo: 'cancelado' }],
        reason,
      });
    });
    return { ok: true };
  });

}

/** AETs vigentes do cavalo e quais cobrem o implemento. Sem AET cadastrada = não se aplica. */
export async function aetCheck(db, tractorId, trailerId) {
  const { rows } = await db.query(
    `select d.id, d.number, d.issuer, d.expires_on,
            exists (select 1 from document_vehicles dv where dv.document_id = d.id and dv.vehicle_id = $2) as covers
       from documents d
      where d.type = 'aet' and d.status = 'ativo' and d.vehicle_id = $1 and (d.expires_on is null or d.expires_on >= ${TODAY})`,
    [tractorId, trailerId],
  );
  const covering = rows.filter((r) => r.covers);
  return {
    has_aet: rows.length > 0,
    covered: rows.length === 0 || covering.length > 0,
    aets: rows,
    missing: rows.filter((r) => !r.covers).map((r) => [r.issuer, r.number].filter(Boolean).join(' ')),
  };
}

