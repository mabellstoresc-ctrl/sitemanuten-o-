import { badRequest } from '../http.js';
import { can, requirePerm } from '../permissions.js';
import { audit, diff } from '../audit.js';
import { validate } from '../validate.js';
import { DEFAULT_SETTINGS, TOWED_TYPES } from '../../shared/constants.js';

async function getSettings(db) {
  const { rows } = await db.query('select key, value from settings');
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) if (r.key in out) out[r.key] = { ...out[r.key], ...r.value };
  return out;
}

/**
 * Alertas calculados em tempo real a partir dos dados (sempre atualizados).
 * Nível: urgente | atencao | info
 */
export async function computeAlerts(db, user) {
  const settings = await getSettings(db);
  const a = settings.alertas;
  const alerts = [];

  if (can(user, 'motoristas', 'ver')) {
    const { rows } = await db.query(
      `select id, full_name, cnh_expiry, (cnh_expiry - current_date) as days from drivers
        where status <> 'inativo' and cnh_expiry is not null and cnh_expiry <= current_date + $1::int
        order by cnh_expiry`,
      [a.cnh_dias],
    );
    for (const d of rows) {
      const level = d.days < 0 || d.days <= 7 ? 'urgente' : 'atencao';
      alerts.push({
        level,
        kind: 'cnh',
        title:
          d.days < 0
            ? `CNH do motorista ${d.full_name} está VENCIDA há ${-d.days} dia(s)`
            : d.days === 0
              ? `CNH do motorista ${d.full_name} vence HOJE`
              : `CNH do motorista ${d.full_name} vence em ${d.days} dia(s)`,
        link: `/motoristas/${d.id}`,
        date: d.cnh_expiry,
      });
    }
    const { rows: noCnh } = await db.query(
      `select id, full_name from drivers where status = 'ativo' and cnh_expiry is null order by full_name`,
    );
    for (const d of noCnh) {
      alerts.push({ level: 'info', kind: 'cnh', title: `Motorista ${d.full_name} sem validade da CNH cadastrada`, link: `/motoristas/${d.id}` });
    }
  }

  if (can(user, 'veiculos', 'ver')) {
    // O KM alimenta os alertas de óleo e manutenção: avisa quando está desatualizado
    const { rows } = await db.query(
      `select id, plate, fleet_number, km_updated_at, (current_date - km_updated_at::date) as days from vehicles
        where status in ('disponivel', 'em_viagem') and not (type = any($1))
          and (km_updated_at is null or km_updated_at < now() - interval '15 days')
        order by km_updated_at nulls first`,
      [TOWED_TYPES],
    );
    for (const v of rows) {
      alerts.push({
        level: 'info',
        kind: 'km',
        title: v.km_updated_at
          ? `Veículo ${v.plate} — quilometragem sem atualização há ${v.days} dias`
          : `Veículo ${v.plate} — quilometragem nunca informada`,
        link: `/veiculos/${v.id}`,
      });
    }
  }

  const order = { urgente: 0, atencao: 1, info: 2 };
  alerts.sort((x, y) => order[x.level] - order[y.level]);
  return alerts;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function (r) {
  r.get('/dashboard', async (ctx) => {
    requirePerm(ctx.user, 'dashboard', 'ver');
    const db = ctx.db;
    const out = {};

    const { rows: vs } = await db.query(
      `select (type = any($1)) as towed, status, count(*)::int as n from vehicles group by 1, 2`,
      [TOWED_TYPES],
    );
    const group = (towed) => {
      const g = { total: 0, disponivel: 0, em_viagem: 0, em_manutencao: 0, parado: 0, inativo: 0 };
      for (const r of vs.filter((x) => x.towed === towed)) {
        g[r.status] = r.n;
        if (r.status !== 'inativo') g.total += r.n;
      }
      return g;
    };
    out.frota = group(false);
    out.implementos = group(true);

    const { rows: ds } = await db.query(
      `select count(*) filter (where d.status = 'ativo')::int as ativos,
              count(*) filter (where d.status = 'ativo' and a.id is null)::int as sem_veiculo,
              count(*) filter (where d.status in ('ferias','afastado'))::int as ausentes
         from drivers d left join driver_assignments a on a.driver_id = d.id and a.end_at is null`,
    );
    out.motoristas = ds[0];

    const alerts = await computeAlerts(db, ctx.user);
    out.alerts = alerts;
    out.cnh_alertas = alerts.filter((a) => a.kind === 'cnh' && a.level !== 'info').length;

    if (can(ctx.user, 'veiculos', 'ver')) {
      const { rows: ev } = await db.query(
        `select e.id, e.event_at, e.type, e.title, e.description, v.id as vehicle_id, v.plate, u.username
           from vehicle_events e join vehicles v on v.id = e.vehicle_id left join users u on u.id = e.user_id
          order by e.event_at desc, e.id desc limit 12`,
      );
      out.recent = ev;
    }
    if (ctx.user.is_master || can(ctx.user, 'auditoria', 'ver')) {
      const { rows: f } = await db.query(
        `select count(*)::int as n from access_log
          where event in ('login_falha','login_bloqueado','login_suspeito') and created_at > now() - interval '24 hours'`,
      );
      out.login_falhas_24h = f[0].n;
    }
    return out;
  });

  r.get('/alerts', async (ctx) => ({ alerts: await computeAlerts(ctx.db, ctx.user) }));

  // Pesquisa global (barra do topo)
  r.get('/search', async (ctx) => {
    const q = String(ctx.query.q ?? '').trim();
    if (q.length < 2) return { results: [] };
    const results = [];
    const like = `%${q}%`;
    const plate = `%${q.toUpperCase().replace(/[-\s]/g, '')}%`;
    if (can(ctx.user, 'veiculos', 'ver')) {
      const { rows } = await ctx.db.query(
        `select id, plate, fleet_number, brand, model, type, status from vehicles
          where plate like $1 or upper(coalesce(fleet_number, '')) like upper($2) or model ilike $2 or chassis ilike $2 or renavam like $2
          order by plate limit 8`,
        [plate, like],
      );
      for (const v of rows) {
        results.push({
          kind: 'veiculo',
          id: v.id,
          title: v.plate + (v.fleet_number ? ` · Frota ${v.fleet_number}` : ''),
          subtitle: [v.brand, v.model].filter(Boolean).join(' '),
          link: `/veiculos/${v.id}`,
        });
      }
    }
    if (can(ctx.user, 'motoristas', 'ver')) {
      const digits = q.replace(/\D/g, '');
      const { rows } = await ctx.db.query(
        `select id, full_name, cpf, status from drivers
          where full_name ilike $1 ${digits.length >= 3 ? 'or cpf like $2 or cnh_number like $2' : ''}
          order by full_name limit 8`,
        digits.length >= 3 ? [like, `%${digits}%`] : [like],
      );
      for (const d of rows) {
        results.push({ kind: 'motorista', id: d.id, title: d.full_name, subtitle: `CPF ${d.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`, link: `/motoristas/${d.id}` });
      }
    }
    return { results };
  });

  // ----- Configurações -----
  r.get('/settings', async (ctx) => {
    requirePerm(ctx.user, 'configuracoes', 'ver');
    return { settings: await getSettings(ctx.db) };
  });

  // Limites de alerta são lidos por todos (usados em telas de vários módulos)
  r.get('/settings/public', async (ctx) => {
    const s = await getSettings(ctx.db);
    return { settings: { alertas: s.alertas, empresa: { nome: s.empresa.nome } } };
  });

  const SETTINGS_SCHEMA = {
    alertas: {
      cnh_dias: { type: 'int', min: 1, max: 365, required: true, label: 'Aviso de CNH (dias)' },
      documento_dias: { type: 'int', min: 1, max: 365, required: true, label: 'Aviso de documentos (dias)' },
      manutencao_dias: { type: 'int', min: 1, max: 365, required: true, label: 'Aviso de manutenção (dias)' },
      manutencao_km: { type: 'int', min: 0, max: 100000, required: true, label: 'Aviso de manutenção (km)' },
      oleo_km: { type: 'int', min: 0, max: 100000, required: true, label: 'Aviso de troca de óleo (km)' },
      km_salto_maximo: { type: 'int', min: 100, max: 100000, required: true, label: 'Salto máximo de KM sem confirmação' },
    },
    empresa: {
      nome: { type: 'string', max: 120, required: true, label: 'Nome da empresa' },
      cnpj: { type: 'digits', max: 14, label: 'CNPJ' },
    },
  };

  r.put('/settings/:key', async (ctx) => {
    requirePerm(ctx.user, 'configuracoes', 'editar');
    const schema = SETTINGS_SCHEMA[ctx.params.key];
    if (!schema) throw badRequest('Configuração inválida.');
    const value = validate(ctx.body, schema);
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select value from settings where key = $1', [ctx.params.key]);
      await c.query(
        `insert into settings (key, value, updated_by) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [ctx.params.key, JSON.stringify(value), ctx.user.id],
      );
      await audit(c, ctx, {
        module: 'configuracoes',
        action: 'editar',
        entity: 'configuracao',
        entityId: ctx.params.key,
        label: ctx.params.key,
        changes: diff(rows[0]?.value || {}, value),
      });
    });
    return { ok: true };
  });

  // ----- Auditoria -----
  function auditQuery(q) {
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.module) where.push(`module = ${p(q.module)}`);
    if (q.user_id) where.push(`user_id = ${p(q.user_id)}`);
    if (q.action) where.push(`action = ${p(q.action)}`);
    if (q.entity) where.push(`entity = ${p(q.entity)}`);
    if (q.entity_id) where.push(`entity_id = ${p(q.entity_id)}`);
    if (q.from) where.push(`created_at >= ${p(q.from)}::date`);
    if (q.to) where.push(`created_at < ${p(q.to)}::date + 1`);
    if (q.q) where.push(`(entity_label ilike ${p(`%${q.q}%`)} or reason ilike $${params.length} or username ilike $${params.length})`);
    return { where: where.length ? `where ${where.join(' and ')}` : '', params };
  }

  r.get('/audit', async (ctx) => {
    requirePerm(ctx.user, 'auditoria', 'ver');
    const { where, params } = auditQuery(ctx.query);
    const page = Math.max(1, Number(ctx.query.page) || 1);
    const size = 50;
    const { rows } = await ctx.db.query(
      `select id, user_id, username, module, action, entity, entity_id, entity_label, changes, reason, ip, created_at
         from audit_log ${where} order by created_at desc, id desc limit ${size + 1} offset ${(page - 1) * size}`,
      params,
    );
    return { entries: rows.slice(0, size), page, has_more: rows.length > size };
  });

  r.get('/audit/export', async (ctx) => {
    requirePerm(ctx.user, 'auditoria', 'exportar');
    const { where, params } = auditQuery(ctx.query);
    const { rows } = await ctx.db.query(
      `select created_at, username, module, action, entity, entity_label, changes, reason, ip
         from audit_log ${where} order by created_at desc limit 20000`,
      params,
    );
    const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const lines = [['Data/hora', 'Usuário', 'Módulo', 'Ação', 'Registro', 'Identificação', 'Alterações', 'Motivo', 'IP'].join(';')];
    for (const r of rows) {
      const changes = (r.changes || []).map((c) => `${c.campo}: ${c.anterior ?? '—'} → ${c.novo ?? '—'}`).join(' | ');
      lines.push([fmt(r.created_at), r.username, r.module, r.action, r.entity, r.entity_label, changes, r.reason, r.ip].map(csvCell).join(';'));
    }
    await audit(ctx.db, ctx, { module: 'auditoria', action: 'exportar', entity: 'auditoria', label: `${rows.length} registros` });
    // BOM para o Excel abrir com acentuação correta
    return new Response('﻿' + lines.join('\r\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
