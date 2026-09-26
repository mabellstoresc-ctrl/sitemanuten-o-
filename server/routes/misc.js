import { badRequest } from '../http.js';
import { can, requirePerm } from '../permissions.js';
import { audit, diff } from '../audit.js';
import { validate } from '../validate.js';
import { AVG_SQL } from '../fuel.js';
import { maintenancePlans } from '../maintenance.js';
import { tiresNeedingAttention } from './tires.js';
import { costSummary } from '../costs.js';
import { DEFAULT_SETTINGS, TOWED_TYPES, CONSUMPTION_DEVIATION, DOCUMENT_TYPES, labelOf } from '../../shared/constants.js';

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
      `select id, full_name, cnh_expiry, (cnh_expiry - (now() at time zone 'America/Sao_Paulo')::date) as days from drivers
        where status <> 'inativo' and cnh_expiry is not null and cnh_expiry <= (now() at time zone 'America/Sao_Paulo')::date + $1::int
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
      `select id, plate, fleet_number, km_updated_at, ((now() at time zone 'America/Sao_Paulo')::date - km_updated_at::date) as days from vehicles
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

  if (can(user, 'ordens_abastecimento', 'ver')) {
    const { rows } = await db.query(
      `select o.id, o.number, v.plate, ((now() at time zone 'America/Sao_Paulo')::date - o.order_date) as days from fuel_orders o join vehicles v on v.id = o.vehicle_id
        where o.status = 'pendente' and o.order_date < (now() at time zone 'America/Sao_Paulo')::date - 3 order by o.order_date`,
    );
    for (const o of rows) {
      alerts.push({
        level: 'info',
        kind: 'ordem',
        title: `Ordem de abastecimento nº ${o.number} (${o.plate}) pendente há ${o.days} dias`,
        link: `/abastecimentos/ordens/${o.id}`,
      });
    }
  }

  if (can(user, 'abastecimentos', 'ver')) {
    // Último consumo de cada veículo muito abaixo da média dele (possível vazamento, desvio ou erro de lançamento)
    const { rows } = await db.query(
      `with last as (
         select distinct on (vehicle_id) id, vehicle_id, km_per_liter, fueled_at from fuelings
          where status = 'ativo' and km_per_liter is not null and fueled_at > now() - interval '30 days'
          order by vehicle_id, km desc),
       avg as (
         select vehicle_id, sum(calc_distance) / nullif(sum(calc_liters), 0) as kml from fuelings
          where status = 'ativo' and calc_liters > 0 group by vehicle_id having count(*) >= 3)
       select l.id, l.km_per_liter, a.kml, v.plate from last l join avg a using (vehicle_id) join vehicles v on v.id = l.vehicle_id
        where l.km_per_liter < a.kml * (1 - $1::numeric)`,
      [CONSUMPTION_DEVIATION],
    );
    for (const f of rows) {
      alerts.push({
        level: 'atencao',
        kind: 'consumo',
        title: `Veículo ${f.plate} — último consumo ${Number(f.km_per_liter).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km/L, abaixo da média (${Number(f.kml).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km/L)`,
        link: `/abastecimentos/${f.id}`,
      });
    }
  }

  if (can(user, 'manutencoes', 'ver') || can(user, 'veiculos', 'ver')) {
    const plans = await maintenancePlans(db);
    const nf = (v) => Number(v).toLocaleString('pt-BR');
    for (const p of plans) {
      if (p.state === 'ok') continue;
      const what = p.is_oil ? 'troca de óleo' : `manutenção ${p.type === 'preventiva' ? 'preventiva' : ''} (${p.categories.length} item(ns))`.replace('  ', ' ');
      const parts = [];
      if (p.km_left !== null) parts.push(p.km_left <= 0 ? `KM passou ${nf(-p.km_left)} km` : `faltam ${nf(p.km_left)} km`);
      if (p.days_left !== null) parts.push(p.days_left < 0 ? `data venceu há ${-p.days_left} dia(s)` : p.days_left === 0 ? 'vence hoje' : `em ${p.days_left} dia(s)`);
      alerts.push({
        level: p.state === 'vencida' ? 'urgente' : 'atencao',
        kind: p.is_oil ? 'oleo' : 'manutencao',
        title: `Veículo ${p.plate} — ${what} ${p.state === 'vencida' ? 'VENCIDA' : 'próxima'}: ${parts.join(', ')}`,
        link: `/veiculos/${p.vehicle_id}?aba=manutencoes`,
      });
    }
  }

  if (can(user, 'manutencoes', 'ver')) {
    const { rows } = await db.query(
      `select so.id, so.number, so.due_date, ((now() at time zone 'America/Sao_Paulo')::date - so.due_date) as late, ((now() at time zone 'America/Sao_Paulo')::date - so.opened_on) as age, v.plate
         from service_orders so join vehicles v on v.id = so.vehicle_id
        where so.status in ('aberta','em_analise','aguardando_peca','em_manutencao')
          and (so.due_date < (now() at time zone 'America/Sao_Paulo')::date or (so.due_date is null and so.opened_on < (now() at time zone 'America/Sao_Paulo')::date - 15))`,
    );
    for (const so of rows) {
      alerts.push({
        level: so.due_date ? 'atencao' : 'info',
        kind: 'os',
        title: so.due_date
          ? `OS nº ${so.number} (${so.plate}) atrasada há ${so.late} dia(s)`
          : `OS nº ${so.number} (${so.plate}) aberta há ${so.age} dias sem previsão de conclusão`,
        link: `/manutencao/os/${so.id}`,
      });
    }
  }

  if (can(user, 'pneus', 'ver')) {
    for (const t of await tiresNeedingAttention(db)) {
      const severe = t.attention.some((a) => a.startsWith('sulco'));
      alerts.push({
        level: severe ? 'urgente' : 'atencao',
        kind: 'pneu',
        title: `Pneu ${t.code} (${t.plate} · ${t.position_label}) precisa de atenção: ${t.attention.join(', ')}`,
        link: `/pneus/${t.id}`,
      });
    }
  }

  if (can(user, 'documentos', 'ver')) {
    const { rows } = await db.query(
      `select d.id, d.type, d.number, d.issuer, d.expires_on, (d.expires_on - (now() at time zone 'America/Sao_Paulo')::date) as days,
              v.plate, dr.full_name as driver_name, d.owner
         from documents d left join vehicles v on v.id = d.vehicle_id left join drivers dr on dr.id = d.driver_id
        where d.status = 'ativo' and d.expires_on <= (now() at time zone 'America/Sao_Paulo')::date + $1::int
          and (v.id is null or v.status <> 'inativo')
        order by d.expires_on`,
      [a.documento_dias],
    );
    for (const d of rows) {
      const what = `${labelOf(DOCUMENT_TYPES, d.type).replace(/ \(.*\)$/, '')}${d.issuer ? ` ${d.issuer}` : ''}${d.number ? ` nº ${d.number}` : ''}`;
      const who = d.plate ? `Veículo ${d.plate}` : d.driver_name ? `Motorista ${d.driver_name}` : 'Empresa';
      alerts.push({
        level: d.days < 0 || d.days <= 7 ? 'urgente' : 'atencao',
        kind: 'documento',
        title: `${who} — ${what} ${d.days < 0 ? `VENCIDO há ${-d.days} dia(s)` : d.days === 0 ? 'vence HOJE' : `vence em ${d.days} dia(s)`}`,
        link: `/documentos/${d.id}`,
        date: d.expires_on,
      });
    }
    // CRLV de exercício anterior (licenciamento do ano ainda não registrado)
    const { rows: crlv } = await db.query(
      `select d.id, d.exercise_year, v.plate from documents d join vehicles v on v.id = d.vehicle_id
        where d.type = 'crlv' and d.status = 'ativo' and v.status <> 'inativo'
          and d.exercise_year < extract(year from (now() at time zone 'America/Sao_Paulo'))::int
        order by v.plate`,
    );
    for (const d of crlv) {
      alerts.push({
        level: 'atencao',
        kind: 'documento',
        title: `Veículo ${d.plate} — CRLV do exercício ${d.exercise_year}: confira o licenciamento do ano e cadastre o CRLV novo`,
        link: `/documentos/${d.id}`,
      });
    }
    // Veículos sem CRLV (só depois que a empresa começou a cadastrar CRLVs)
    const { rows: noCrlv } = await db.query(
      `select v.id, v.plate from vehicles v
        where v.status <> 'inativo' and exists (select 1 from documents where type = 'crlv')
          and not exists (select 1 from documents d where d.vehicle_id = v.id and d.type = 'crlv' and d.status = 'ativo')
        order by v.plate`,
    );
    for (const v of noCrlv) {
      alerts.push({ level: 'info', kind: 'documento', title: `Veículo ${v.plate} sem CRLV cadastrado`, link: `/veiculos/${v.id}?aba=documentos` });
    }
    // Implemento engatado que não consta na AET vigente do cavalo
    const { rows: aet } = await db.query(
      `select t.id as tractor_id, t.plate as tractor, r.plate as trailer
         from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id join vehicles r on r.id = vc.trailer_id
        where vc.end_at is null
          and exists (select 1 from documents d where d.type = 'aet' and d.status = 'ativo' and d.vehicle_id = t.id
                         and (d.expires_on is null or d.expires_on >= (now() at time zone 'America/Sao_Paulo')::date))
          and not exists (select 1 from documents d join document_vehicles dv on dv.document_id = d.id
                           where d.type = 'aet' and d.status = 'ativo' and d.vehicle_id = t.id and dv.vehicle_id = r.id
                             and (d.expires_on is null or d.expires_on >= (now() at time zone 'America/Sao_Paulo')::date))`,
    );
    for (const x of aet) {
      alerts.push({
        level: 'atencao',
        kind: 'aet',
        title: `Conjunto ${x.tractor} + ${x.trailer}: o implemento ${x.trailer} não consta na AET vigente do cavalo`,
        link: `/veiculos/${x.tractor_id}?aba=documentos`,
      });
    }
  }

  if (can(user, 'checklists', 'ver')) {
    const { rows } = await db.query(
      `select c.id, c.number, c.result, c.nok_count, v.plate from checklists c join vehicles v on v.id = c.vehicle_id
        where c.status = 'ativo' and c.result <> 'ok' and c.service_order_id is null and c.performed_at > now() - interval '30 days'
          and not exists (select 1 from checklists n where n.vehicle_id = c.vehicle_id and n.status = 'ativo' and n.performed_at > c.performed_at)
        order by c.performed_at desc`,
    );
    for (const c of rows) {
      alerts.push({
        level: c.result === 'reprovado' ? 'urgente' : 'atencao',
        kind: 'checklist',
        title: `Veículo ${c.plate} — checklist nº ${c.number} ${c.result === 'reprovado' ? 'REPROVADO' : 'com problemas'} (${c.nok_count} item(ns)) sem OS aberta`,
        link: `/checklists/${c.id}`,
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

    if (can(ctx.user, 'abastecimentos', 'ver')) {
      const { rows: fm } = await db.query(
        `select ${AVG_SQL} from fuelings where status = 'ativo'
            and fueled_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`,
      );
      out.combustivel_mes = fm[0];
    }
    if (can(ctx.user, 'ordens_abastecimento', 'ver')) {
      const { rows: po } = await db.query(`select count(*)::int as n from fuel_orders where status = 'pendente'`);
      out.ordens_pendentes = po[0].n;
    }

    if (can(ctx.user, 'manutencoes', 'ver')) {
      const plans = await maintenancePlans(db);
      const { rows: mc } = await db.query(
        `select coalesce(sum(total), 0)::float as total, count(*)::int as n from maintenances
          where status = 'ativo' and performed_on >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date`,
      );
      const { rows: so } = await db.query(
        `select count(*)::int as abertas, count(*) filter (where due_date < (now() at time zone 'America/Sao_Paulo')::date)::int as atrasadas from service_orders
          where status in ('aberta','em_analise','aguardando_peca','em_manutencao')`,
      );
      out.manutencao = {
        vencidas: plans.filter((p) => p.state === 'vencida' && !p.is_oil).length,
        proximas: plans.filter((p) => p.state === 'proxima' && !p.is_oil).length,
        oleo_vencidas: plans.filter((p) => p.state === 'vencida' && p.is_oil).length,
        oleo_proximas: plans.filter((p) => p.state === 'proxima' && p.is_oil).length,
        gasto_mes: mc[0].total,
        realizadas_mes: mc[0].n,
        os_abertas: so[0].abertas,
        os_atrasadas: so[0].atrasadas,
      };
    }

    if (can(ctx.user, 'pneus', 'ver')) {
      const { rows: tr } = await db.query(
        `select count(*) filter (where status = 'em_uso')::int as em_uso, count(*) filter (where status in ('novo','estoque','retirado'))::int as estoque,
                count(*) filter (where status = 'recapagem')::int as recapagem from tires`,
      );
      out.pneus = { ...tr[0], atencao: (await tiresNeedingAttention(db)).length };
    }

    if (can(ctx.user, 'custos', 'ver')) {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const m = await costSummary(db, { from: `${today.slice(0, 7)}-01` });
      out.custos_mes = { total: m.total, cost_per_km: m.cost_per_km, by_category: m.by_category.slice(0, 5) };
    }
    if (can(ctx.user, 'checklists', 'ver')) {
      const { rows: ck } = await db.query(
        `select count(*) filter (where performed_at >= (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')::int as hoje,
                count(*) filter (where result <> 'ok' and service_order_id is null and performed_at > now() - interval '30 days')::int as pendentes
           from checklists where status = 'ativo'`,
      );
      out.checklists = ck[0];
    }

    const alerts = await computeAlerts(db, ctx.user);
    out.alerts = alerts;
    if (can(ctx.user, 'documentos', 'ver')) {
      const docAlerts = alerts.filter((x) => x.kind === 'documento' && x.date);
      out.documentos = {
        vencidos: docAlerts.filter((x) => x.title.includes('VENCIDO')).length,
        vencendo: docAlerts.filter((x) => !x.title.includes('VENCIDO')).length,
        aet: alerts.filter((x) => x.kind === 'aet').length,
      };
    }
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
    if (can(ctx.user, 'pneus', 'ver')) {
      const { rows } = await ctx.db.query(
        `select t.id, t.code, t.fire_number, t.status, t.brand, t.size, v.plate from tires t left join vehicles v on v.id = t.vehicle_id
          where t.code ilike $1 or t.fire_number ilike $1 order by t.code limit 6`,
        [like],
      );
      for (const t of rows) {
        results.push({ kind: 'pneu', id: t.id, title: `Pneu ${t.code}${t.fire_number ? ` · fogo ${t.fire_number}` : ''}`, subtitle: [t.brand, t.size, t.plate || t.status].filter(Boolean).join(' · '), link: `/pneus/${t.id}` });
      }
    }
    if (can(ctx.user, 'manutencoes', 'ver')) {
      const num = q.replace(/^(os|n[ºo°]?)\s*/i, '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (num && num.length <= 12) {
        const { rows } = await ctx.db.query(
          `select so.id, so.number, so.status, v.plate from service_orders so join vehicles v on v.id = so.vehicle_id
            where so.number::text like $1 order by so.number desc limit 5`,
          [`${num}%`],
        );
        for (const o of rows) {
          results.push({ kind: 'ordem serviço', id: o.id, title: `OS nº ${o.number}`, subtitle: `${o.plate} · ${o.status}`, link: `/manutencao/os/${o.id}` });
        }
      }
    }
    if (can(ctx.user, 'ordens_abastecimento', 'ver')) {
      const num = q.replace(/^n[ºo°]?\s*/i, '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (num && num.length <= 12) {
        const { rows } = await ctx.db.query(
          `select o.id, o.number, o.status, v.plate from fuel_orders o join vehicles v on v.id = o.vehicle_id
            where o.number::text like $1 order by o.number desc limit 5`,
          [`${num}%`],
        );
        for (const o of rows) {
          results.push({ kind: 'ordem abast.', id: o.id, title: `Ordem nº ${o.number}`, subtitle: `${o.plate} · ${o.status}`, link: `/abastecimentos/ordens/${o.id}` });
        }
      }
    }
    if (can(ctx.user, 'documentos', 'ver') && q.length >= 3) {
      const { rows } = await ctx.db.query(
        `select d.id, d.type, d.number, d.issuer, d.expires_on, v.plate from documents d left join vehicles v on v.id = d.vehicle_id
          where d.status = 'ativo' and d.number ilike $1 order by d.expires_on desc nulls last limit 5`,
        [like],
      );
      for (const d of rows) {
        results.push({ kind: 'documento', id: d.id, title: `${labelOf(DOCUMENT_TYPES, d.type).replace(/ \(.*\)$/, '')} nº ${d.number}`, subtitle: [d.plate, d.issuer].filter(Boolean).join(' · '), link: `/documentos/${d.id}` });
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
      oleo_intervalo_km: { type: 'int', min: 1000, max: 200000, required: true, label: 'Intervalo padrão da troca de óleo (km)' },
      pneu_inspecao_dias: { type: 'int', min: 1, max: 365, required: true, label: 'Inspeção de pneus a cada (dias)' },
      pneu_sulco_minimo: { type: 'number', min: 0, max: 20, required: true, label: 'Sulco mínimo do pneu (mm)' },
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
    if (q.from) where.push(`created_at >= (${p(q.from)}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    if (q.to) where.push(`created_at < (${p(q.to)}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
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
