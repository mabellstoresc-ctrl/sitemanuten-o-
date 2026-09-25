import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, Client } from './helpers.js';

let handle, closePool;
let admin, mec; // administrador e usuário de manutenção
let vId;

const dateAgo = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const today = () => dateAgo(0);

before(async () => {
  await resetDatabase();
  ({ handle } = await import('../server/app.js'));
  ({ closePool } = await import('../server/db.js'));
  admin = new Client(handle);
  await admin.post('/api/auth/login', { username: 'bernardo', password: '050410' });
  await admin.post('/api/auth/change-password', { current_password: '050410', new_password: 'Admin@2026' });
  const r = await admin.post('/api/vehicles', { plate: 'ABC1D23', type: 'cavalo', fleet_number: '101' });
  vId = r.data.id;
  await admin.post('/api/users', {
    full_name: 'Mecânico',
    username: 'mecanico',
    password: 'mec1234',
    must_change_password: false,
    permissions: { manutencoes: ['ver', 'cadastrar', 'editar'], veiculos: ['ver', 'editar'] },
  });
  mec = new Client(handle);
  await mec.post('/api/auth/login', { username: 'mecanico', password: 'mec1234' });
});

after(async () => {
  await closePool();
});

let oilId;

test('troca de óleo: última 350.000, próxima 365.000, atual 360.200 → restam 4.800 km', async () => {
  let r = await mec.post('/api/maintenances', {
    vehicle_id: vId,
    type: 'preventiva',
    categories: ['troca_oleo', 'filtro_oleo'],
    performed_on: dateAgo(30),
    km: 350000,
    workshop: 'Oficina Central',
    oil_brand: 'Shell Rimula',
    oil_type: '15W40',
    oil_quantity: 38,
    oil_filter: true,
    parts: [
      { description: 'Óleo 15W40', quantity: 38, unit_price: 30 },
      { description: 'Filtro de óleo', quantity: 2, unit_price: 90 },
    ],
    labor_cost: 150,
    next_km: 365000,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  oilId = r.data.id;
  r = await mec.get(`/api/maintenances/${oilId}`);
  assert.equal(r.data.maintenance.parts_cost, 1320);
  assert.equal(r.data.maintenance.total, 1470);
  assert.equal(r.data.maintenance.parts.length, 2);

  r = await mec.post(`/api/vehicles/${vId}/km`, { km: 360200, confirm_jump: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await mec.get(`/api/maintenance/oil?vehicle_id=${vId}`);
  const oil = r.data.vehicles[0];
  assert.equal(oil.last_km, 350000);
  assert.equal(oil.next_km, 365000);
  assert.equal(oil.current_km, 360200);
  assert.equal(oil.km_left, 4800);
  assert.equal(oil.state, 'ok');
});

test('alertas de troca de óleo próxima e vencida pelo KM', async () => {
  await mec.post(`/api/vehicles/${vId}/km`, { km: 364500 });
  let r = await admin.get('/api/alerts');
  let a = r.data.alerts.find((x) => x.kind === 'oleo');
  assert.equal(a.level, 'atencao');
  assert.match(a.title, /faltam 500 km/);
  await mec.post(`/api/vehicles/${vId}/km`, { km: 365100 });
  r = await admin.get('/api/alerts');
  a = r.data.alerts.find((x) => x.kind === 'oleo');
  assert.equal(a.level, 'urgente');
  r = await admin.get('/api/dashboard');
  assert.equal(r.data.manutencao.oleo_vencidas, 1);
});

test('próxima manutenção por data vencida aparece no plano e no calendário', async () => {
  let r = await mec.post('/api/maintenances', {
    vehicle_id: vId,
    type: 'preventiva',
    categories: ['revisao', 'freios'],
    performed_on: dateAgo(200),
    km: 300000,
    labor_cost: 800,
    next_date: dateAgo(5),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await mec.get(`/api/maintenance/plans?vehicle_id=${vId}`);
  const rev = r.data.plans.find((p) => p.categories.includes('revisao'));
  assert.equal(rev.state, 'vencida');
  assert.deepEqual(rev.categories, ['freios', 'revisao']);
  r = await mec.get(`/api/maintenance/calendar?from=${dateAgo(10)}&to=${today()}`);
  assert.ok(r.data.items.some((i) => i.kind === 'plano' && i.state === 'vencida'));
});

test('validações da manutenção', async () => {
  let r = await mec.post('/api/maintenances', { vehicle_id: vId, type: 'corretiva', categories: [], performed_on: today() });
  assert.equal(r.status, 400);
  r = await mec.post('/api/maintenances', { vehicle_id: vId, type: 'corretiva', categories: ['motor'], performed_on: today(), km: 365100, next_km: 365000 });
  assert.equal(r.status, 400);
  r = await mec.post('/api/maintenances', { vehicle_id: vId, type: 'corretiva', categories: ['motor'], performed_on: '2099-01-01' });
  assert.equal(r.status, 400);
  r = await mec.post('/api/maintenances', { vehicle_id: vId, type: 'corretiva', categories: ['inexistente'], performed_on: today() });
  assert.equal(r.status, 400);
});

let soId;

test('OS: abre, põe o veículo em manutenção, recebe peças e ao finalizar gera a manutenção', async () => {
  let r = await mec.post('/api/service-orders', {
    vehicle_id: vId,
    type: 'corretiva',
    opened_on: today(),
    reported_problem: 'Barulho no freio dianteiro',
    workshop: 'Oficina Central',
    due_date: today(),
    set_vehicle_status: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  soId = r.data.id;
  assert.equal(r.data.number, 1);
  r = await mec.get(`/api/vehicles/${vId}`);
  assert.equal(r.data.vehicle.status, 'em_manutencao');

  r = await mec.post(`/api/service-orders/${soId}/parts`, { description: 'Pastilha de freio', quantity: 4, unit_price: 120 });
  assert.equal(r.status, 200);
  r = await mec.post(`/api/service-orders/${soId}/status`, { status: 'aguardando_peca', note: 'Pastilha em falta' });
  assert.equal(r.status, 200);
  r = await mec.get(`/api/service-orders/${soId}`);
  assert.equal(r.data.order.parts_total, 480);
  assert.equal(r.data.order.log.length, 2);

  r = await mec.post(`/api/service-orders/${soId}/finalize`, {
    completed_on: today(),
    type: 'corretiva',
    categories: ['freios'],
    labor_cost: 300,
    services_done: 'Troca das pastilhas dianteiras',
    invoice_number: 'NF 1234',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mId = r.data.maintenance_id;
  r = await mec.get(`/api/maintenances/${mId}`);
  assert.equal(r.data.maintenance.total, 780);
  assert.equal(r.data.maintenance.service_order_number, 1);
  assert.equal(r.data.maintenance.parts.length, 1);
  r = await mec.get(`/api/service-orders/${soId}`);
  assert.equal(r.data.order.status, 'finalizada');
  r = await mec.get(`/api/vehicles/${vId}`);
  assert.equal(r.data.vehicle.status, 'disponivel', 'veículo volta a ficar disponível');

  r = await mec.post(`/api/service-orders/${soId}/parts`, { description: 'Mais uma', quantity: 1, unit_price: 1 });
  assert.equal(r.status, 400, 'OS finalizada não recebe peças');
});

test('OS cancelada devolve o status do veículo; cancelar exige permissão', async () => {
  let r = await mec.post('/api/service-orders', { vehicle_id: vId, opened_on: today(), reported_problem: 'Luz do painel acesa', set_vehicle_status: true });
  const id = r.data.id;
  r = await mec.post(`/api/service-orders/${id}/cancel`, { reason: 'Aberta por engano' });
  assert.equal(r.status, 403);
  r = await admin.post(`/api/service-orders/${id}/cancel`, { reason: 'Aberta por engano' });
  assert.equal(r.status, 200);
  r = await mec.get(`/api/vehicles/${vId}`);
  assert.equal(r.data.vehicle.status, 'disponivel');
});

test('edição recalcula total e fica na auditoria; resumo do veículo', async () => {
  let r = await mec.put(`/api/maintenances/${oilId}`, { labor_cost: 200, parts: [{ description: 'Óleo 15W40', quantity: 40, unit_price: 30 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await mec.get(`/api/maintenances/${oilId}`);
  assert.equal(r.data.maintenance.total, 1400);
  r = await admin.get(`/api/audit?entity=manutencao&entity_id=${oilId}&action=editar`);
  assert.ok(r.data.entries[0].changes.some((c) => c.campo === 'labor_cost'));
  r = await mec.get(`/api/vehicles/${vId}/maintenance-summary`);
  assert.equal(r.status, 200);
  assert.equal(r.data.oil.state, 'vencida');
  assert.ok(r.data.cost.all_time > 0);
  r = await mec.get('/api/maintenances?type=preventiva');
  assert.equal(r.data.maintenances.length, 2);
  r = await admin.get(`/api/search?q=${encodeURIComponent('OS 1')}`);
  assert.ok(r.data.results.some((x) => x.kind === 'ordem serviço'));
});

test('usuário sem permissão de manutenção é bloqueado', async () => {
  await admin.post('/api/users', { full_name: 'Sem', username: 'semperm', password: 'sem1234', must_change_password: false, permissions: { veiculos: ['ver'] } });
  const c = new Client(handle);
  await c.post('/api/auth/login', { username: 'semperm', password: 'sem1234' });
  let r = await c.get('/api/maintenances');
  assert.equal(r.status, 403);
  r = await c.post('/api/service-orders', { vehicle_id: vId, opened_on: today(), reported_problem: 'x' });
  assert.equal(r.status, 403);
  r = await c.get('/api/maintenance/oil');
  assert.equal(r.status, 200, 'quem vê veículos vê a situação do óleo');
});

test('manutenção com data de hoje não conflita com leituras de KM do mesmo dia', async () => {
  const v = await admin.post('/api/vehicles', { plate: 'HOJ3E00', type: 'caminhao', current_km: 100000 });
  // leitura mais tarde hoje com KM maior (ex.: abastecimento) e depois manutenção de hoje com esse KM
  await admin.post(`/api/vehicles/${v.data.id}/km`, { km: 100500 });
  const r = await mec.post('/api/maintenances', { vehicle_id: v.data.id, type: 'corretiva', categories: ['motor'], performed_on: today(), km: 100500, labor_cost: 100 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
