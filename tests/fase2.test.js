import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, Client } from './helpers.js';

let handle, closePool;
let admin, op; // administrador e operador comum
let vId, dId;

const day = (n, h = 10) => {
  const d = new Date(Date.now() - n * 864e5);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};

before(async () => {
  await resetDatabase();
  ({ handle } = await import('../server/app.js'));
  ({ closePool } = await import('../server/db.js'));
  admin = new Client(handle);
  await admin.post('/api/auth/login', { username: 'bernardo', password: '050410' });
  await admin.post('/api/auth/change-password', { current_password: '050410', new_password: 'Admin@2026' });
  let r = await admin.post('/api/vehicles', { plate: 'ABC1D23', type: 'cavalo', tank_capacity: 600, fuel_type: 'diesel_s10' });
  vId = r.data.id;
  r = await admin.post('/api/drivers', { full_name: 'João da Silva', cpf: '11144477735' });
  dId = r.data.id;
  await admin.post(`/api/vehicles/${vId}/driver`, { driver_id: dId });
  await admin.post('/api/users', {
    full_name: 'Operador',
    username: 'operador',
    password: 'op1234',
    must_change_password: false,
    permissions: { abastecimentos: ['ver', 'cadastrar', 'editar', 'cancelar', 'exportar'], ordens_abastecimento: ['ver', 'cadastrar'], veiculos: ['ver'] },
  });
  op = new Client(handle);
  await op.post('/api/auth/login', { username: 'operador', password: 'op1234' });
});

after(async () => {
  await closePool();
});

const fuel = (c, body) =>
  c.post('/api/fuelings', { vehicle_id: vId, driver_id: dId, fuel_type: 'diesel_s10', station: 'Posto Rodovia', city: 'Registro', state: 'SP', ...body });

let orderId, f1, f2, f4;

test('exemplo da especificação: 350.000 → 350.800 km com 250 L = 3,2 km/L', async () => {
  let r = await fuel(op, { fueled_at: day(20), km: 350000, liters: 300, price_per_liter: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  f1 = r.data.id;
  assert.equal(r.data.fueling.km_per_liter, null, 'primeiro abastecimento não tem média');
  assert.equal(r.data.fueling.total, 1800);

  r = await op.post('/api/fuel-orders', { vehicle_id: vId, driver_id: dId, order_date: day(18).slice(0, 10), station: 'Posto Rodovia', max_liters: 260, max_amount: 1600 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  orderId = r.data.id;
  assert.equal(r.data.number, 1);

  r = await fuel(op, { fueled_at: day(18), km: 350800, liters: 250, total: 1500, order_id: orderId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  f2 = r.data.id;
  const f = r.data.fueling;
  assert.equal(f.distance, 800);
  assert.equal(f.km_per_liter, 3.2);
  assert.equal(f.price_per_liter, 6);
  assert.equal(f.cost_per_km, 1.875);
  assert.equal(f.order_number, 1);

  r = await op.get(`/api/fuel-orders/${orderId}`);
  assert.equal(r.data.order.status, 'utilizada');
  r = await op.get(`/api/vehicles/${vId}`);
  assert.equal(r.data.vehicle.current_km, 350800);
});

test('ordem já utilizada, limite da ordem e valor que não confere', async () => {
  let r = await fuel(op, { fueled_at: day(17), km: 351000, liters: 50, price_per_liter: 6, order_id: orderId });
  assert.equal(r.status, 400);
  r = await op.post('/api/fuel-orders', { vehicle_id: vId, order_date: day(17).slice(0, 10), max_liters: 100 });
  const o2 = r.data.id;
  r = await fuel(op, { fueled_at: day(16), km: 351100, liters: 150, price_per_liter: 6, order_id: o2 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'ORDEM_LIMITE');
  r = await fuel(op, { fueled_at: day(16), km: 351100, liters: 100, price_per_liter: 6, total: 900 });
  assert.equal(r.status, 400, 'total não confere');
  r = await op.post(`/api/fuel-orders/${o2}/cancel`, { reason: 'Não será usada' });
  assert.equal(r.status, 403, 'operador não tem permissão de cancelar ordem');
  r = await admin.post(`/api/fuel-orders/${o2}/cancel`, { reason: 'Não será usada' });
  assert.equal(r.status, 200);
});

test('tanque parcial acumula litros até o próximo tanque cheio', async () => {
  let r = await fuel(op, { fueled_at: day(14), km: 351400, liters: 100, price_per_liter: 6, full_tank: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.fueling.km_per_liter, null);
  r = await fuel(op, { fueled_at: day(12), km: 352000, liters: 200, price_per_liter: 6 });
  assert.equal(r.status, 200);
  f4 = r.data.id;
  // (352.000 − 350.800) ÷ (100 + 200) = 4,0
  assert.equal(r.data.fueling.km_per_liter, 4);
  assert.equal(r.data.fueling.calc_liters, 300);
});

test('ARLA 32 entra no custo mas não na média', async () => {
  const r = await fuel(op, { fueled_at: day(11), km: 352100, liters: 40, price_per_liter: 3.5, fuel_type: 'arla32' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.fueling.km_per_liter, null);
  const a = await op.get(`/api/fuel/averages?vehicle_id=${vId}`);
  assert.equal(a.data.fleet.liters, 850, 'litros de diesel');
  assert.equal(a.data.fleet.total, 1800 + 1500 + 600 + 1200 + 140);
});

test('lançamento atrasado: entra no histórico, recalcula médias e não reduz o KM atual', async () => {
  const r = await fuel(op, { fueled_at: day(19), km: 350400, liters: 120, price_per_liter: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.historical, true);
  assert.equal(Math.round(r.data.fueling.km_per_liter * 1000) / 1000, 3.333);
  const f = await op.get(`/api/fuelings/${f2}`);
  assert.equal(f.data.fueling.km_per_liter, 1.6, '(350.800 − 350.400) ÷ 250');
  const v = await op.get(`/api/vehicles/${vId}`);
  assert.equal(v.data.vehicle.current_km, 352100);
});

test('KM incoerente com a linha do tempo é bloqueado', async () => {
  // Depois do abastecimento de 352.000 km, mas com KM menor
  let r = await fuel(op, { fueled_at: day(10), km: 351500, liters: 100, price_per_liter: 6 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'KM_MENOR');
  // Antes do abastecimento de 350.800 km, mas com KM maior
  r = await fuel(op, { fueled_at: day(19, 12), km: 351000, liters: 100, price_per_liter: 6 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'KM_INCONSISTENTE');
});

test('tanque, duplicidade e salto de KM pedem confirmação', async () => {
  let r = await fuel(op, { fueled_at: day(9), km: 352900, liters: 700, price_per_liter: 6 });
  assert.equal(r.data.code, 'LITROS_TANQUE');
  r = await fuel(op, { fueled_at: day(9), km: 352000, liters: 200, price_per_liter: 6 });
  assert.equal(r.data.code, 'DUPLICADO_PROVAVEL');
  r = await fuel(op, { fueled_at: day(9), km: 362900, liters: 200, price_per_liter: 6 });
  assert.equal(r.data.code, 'KM_SALTO');
});

test('edição recalcula a média e fica na auditoria', async () => {
  let r = await op.put(`/api/fuelings/${f4}`, { liters: 150 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // (352.000 − 350.800) ÷ (100 + 150) = 4,8
  assert.equal(r.data.fueling.km_per_liter, 4.8);
  assert.equal(r.data.fueling.total, 900);
  r = await admin.get(`/api/audit?entity=abastecimento&entity_id=${f4}&action=editar`);
  const ch = r.data.entries[0].changes;
  assert.ok(ch.some((c) => c.campo === 'liters' && c.anterior === 200 && c.novo === 150));
});

test('cancelar o abastecimento que definiu o KM atual exige o administrador', async () => {
  const arla = (await op.get(`/api/fuelings?vehicle_id=${vId}&fuel_type=arla32`)).data.fuelings[0];
  let r = await op.post(`/api/fuelings/${arla.id}/cancel`, { reason: 'Lançado errado' });
  assert.equal(r.status, 403);
  r = await admin.post(`/api/fuelings/${arla.id}/cancel`, { reason: 'Lançado errado' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = await op.get(`/api/vehicles/${vId}`);
  assert.equal(v.data.vehicle.current_km, 352000);
  // Cancelar um abastecimento com ordem devolve a ordem para pendente
  r = await op.post(`/api/fuelings/${f2}/cancel`, { reason: 'Teste de cancelamento' });
  assert.equal(r.status, 200);
  r = await op.get(`/api/fuel-orders/${orderId}`);
  assert.equal(r.data.order.status, 'pendente');
  const list = await op.get(`/api/fuelings?vehicle_id=${vId}&status=todos`);
  assert.equal(list.data.fuelings.filter((x) => x.status === 'cancelado').length, 2);
});

test('médias por mês, painel, alertas e exportação', async () => {
  let r = await op.get(`/api/fuel/series?vehicle_id=${vId}&group=month`);
  assert.equal(r.status, 200);
  assert.ok(r.data.series.length >= 1);
  assert.ok(r.data.series.every((s) => /^\d{4}-\d{2}$/.test(s.period)));
  r = await op.get(`/api/vehicles/${vId}/fuel-summary`);
  assert.equal(r.status, 200);
  assert.ok(r.data.last_average.km_per_liter > 0);
  r = await admin.get('/api/dashboard');
  assert.ok(r.data.combustivel_mes);
  r = await op.get('/api/fuelings/export');
  assert.equal(r.status, 200);
  assert.ok(r.data.toString('utf8').includes('ABC1D23'));
  r = await op.get(`/api/search?q=${encodeURIComponent('nº 1')}`);
  assert.ok(r.data.results.some((x) => x.kind === 'ordem abast.'));
  f1; // usado no início
});

test('média improvável (KM ou litros digitados errado) pede confirmação', async () => {
  // Tanque cheio anterior em 352.000 km; 40 L para 3.000 km = 75 km/L
  let r = await fuel(op, { fueled_at: day(1), km: 355000, liters: 40, price_per_liter: 6 });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'MEDIA_IMPROVAVEL');
  const list = await op.get(`/api/fuelings?vehicle_id=${vId}`);
  assert.ok(!list.data.fuelings.some((f) => f.km === 355000), 'nada foi salvo');
  r = await fuel(op, { fueled_at: day(1), km: 355000, liters: 40, price_per_liter: 6, confirm_avg: true });
  assert.equal(r.status, 200);
});
