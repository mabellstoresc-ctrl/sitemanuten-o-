import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, Client } from './helpers.js';

let handle, closePool;
let admin, bor; // administrador e borracheiro
let abc, xyz, car;

before(async () => {
  await resetDatabase();
  ({ handle } = await import('../server/app.js'));
  ({ closePool } = await import('../server/db.js'));
  admin = new Client(handle);
  await admin.post('/api/auth/login', { username: 'bernardo', password: '050410' });
  await admin.post('/api/auth/change-password', { current_password: '050410', new_password: 'Admin@2026' });
  abc = (await admin.post('/api/vehicles', { plate: 'ABC1D23', type: 'cavalo', axle_config: '6x2', current_km: 100000 })).data.id;
  xyz = (await admin.post('/api/vehicles', { plate: 'XYZ9A87', type: 'cavalo', axle_config: '4x2', current_km: 500000 })).data.id;
  car = (await admin.post('/api/vehicles', { plate: 'CAR2E34', type: 'carreta', axle_config: '3 eixos' })).data.id;
  await admin.post('/api/users', {
    full_name: 'Borracheiro',
    username: 'borracheiro',
    password: 'bor1234',
    must_change_password: false,
    permissions: { pneus: ['ver', 'cadastrar', 'editar'], veiculos: ['ver'] },
  });
  bor = new Client(handle);
  await bor.post('/api/auth/login', { username: 'borracheiro', password: 'bor1234' });
});

after(async () => {
  await closePool();
});

let t1, t2;

test('cadastro de pneu e validações', async () => {
  let r = await bor.post('/api/tires', { code: '00125', fire_number: 'F-777', brand: 'Michelin', model: 'X Multi Z', size: '295/80R22.5', purchase_date: '2026-01-10', purchase_value: 2800, estimated_life_km: 150000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  t1 = r.data.id;
  r = await bor.post('/api/tires', { code: '00125' });
  assert.equal(r.status, 409, 'código duplicado');
  r = await bor.post('/api/tires', { code: '00126', brand: 'Pirelli', size: '295/80R22.5', initial_km: 20000 });
  t2 = r.data.id;
  r = await bor.get(`/api/tires/${t2}`);
  assert.equal(r.data.tire.total_km, 20000);
});

test('mapa do veículo e instalação em posição válida', async () => {
  let r = await bor.get(`/api/vehicles/${abc}/tires`);
  assert.equal(r.data.positions.length, 11, '6x2: 2 + 4 + 4 + estepe');
  r = await bor.post(`/api/tires/${t1}/move`, { action: 'instalar', vehicle_id: abc, position: 'E9-X' });
  assert.equal(r.status, 400);
  r = await bor.post(`/api/tires/${t1}/move`, { action: 'instalar', vehicle_id: abc, position: 'E1-E' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await bor.post(`/api/tires/${t2}/move`, { action: 'instalar', vehicle_id: abc, position: 'E1-E' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'POSICAO_OCUPADA');
  r = await bor.post(`/api/tires/${t2}/move`, { action: 'instalar', vehicle_id: abc, position: 'E1-D' });
  assert.equal(r.status, 200);
  r = await bor.get(`/api/vehicles/${abc}/tires`);
  assert.equal(r.data.positions.find((p) => p.code === 'E1-E').tire.code, '00125');
});

test('KM do pneu acompanha o KM do veículo; rodízio troca os dois pneus de lugar', async () => {
  await admin.post(`/api/vehicles/${abc}/km`, { km: 104000 });
  let r = await bor.get(`/api/tires/${t1}`);
  assert.equal(r.data.tire.total_km, 4000);
  assert.equal(r.data.tire.current_install_km, 4000);
  r = await bor.post(`/api/tires/${t1}/move`, { action: 'trocar_posicao', position: 'E1-D', reason: 'Rodízio' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.swapped, '00126');
  r = await bor.get(`/api/vehicles/${abc}/tires`);
  assert.equal(r.data.positions.find((p) => p.code === 'E1-D').tire.code, '00125');
  assert.equal(r.data.positions.find((p) => p.code === 'E1-E').tire.code, '00126');
  r = await bor.get(`/api/tires/${t1}`);
  assert.equal(r.data.tire.total_km, 4000, 'rodízio no mesmo veículo não zera o KM');
});

test('histórico do exemplo: removido → recapagem → instalado em outro veículo', async () => {
  await admin.post(`/api/vehicles/${abc}/km`, { km: 110000, confirm_jump: true });
  let r = await bor.post(`/api/tires/${t1}/move`, { action: 'recapagem', company: 'Recapadora Vale', cost: 650, retread_type: 'Pré-moldada', reason: 'Desgaste' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await bor.get(`/api/tires/${t1}`);
  assert.equal(r.data.tire.status, 'recapagem');
  assert.equal(r.data.tire.accumulated_km, 10000);
  assert.equal(r.data.tire.total_km, 10000);
  r = await bor.post(`/api/tires/${t1}/move`, { action: 'instalar', vehicle_id: xyz, position: 'E1-E' });
  assert.equal(r.status, 400, 'na recapagem não pode instalar');
  r = await bor.post(`/api/tires/${t1}/retread-return`, { returned_on: new Date().toISOString().slice(0, 10), warranty: '6 meses' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await bor.post(`/api/tires/${t1}/move`, { action: 'instalar', vehicle_id: xyz, position: 'E1-E' });
  assert.equal(r.status, 200);
  await admin.post(`/api/vehicles/${xyz}/km`, { km: 502000 });
  r = await bor.get(`/api/tires/${t1}`);
  const t = r.data.tire;
  assert.equal(t.retread_count, 1);
  assert.equal(t.plate, 'XYZ9A87');
  assert.equal(t.total_km, 12000, '10.000 no ABC + 2.000 no XYZ');
  const actions = r.data.movements.map((m) => m.action);
  assert.deepEqual(actions, ['cadastro', 'instalar', 'trocar_posicao', 'recapagem', 'retorno_recapagem', 'instalar']);
  assert.equal(r.data.movements[1].to_plate, 'ABC1D23');
  assert.equal(r.data.movements[1].to_position_label, 'Dianteiro — esquerdo');
  assert.equal(r.data.retreads[0].status, 'retornado');
});

test('carreta: KM do pneu vem do cavalo enquanto engatada', async () => {
  const r0 = await bor.post('/api/tires', { code: 'C-001', size: '275/80R22.5' });
  const id = r0.data.id;
  let r = await bor.post(`/api/tires/${id}/move`, { action: 'instalar', vehicle_id: car, position: 'E1-EE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await admin.post(`/api/vehicles/${abc}/couple`, { trailer_id: car });
  await admin.post(`/api/vehicles/${abc}/km`, { km: 111500 });
  r = await bor.get(`/api/tires/${id}`);
  assert.equal(r.data.tire.total_km, 1500);
});

test('inspeção, alerta de sulco baixo, descarte exige permissão e motivo', async () => {
  let r = await bor.post(`/api/tires/${t2}/inspect`, { inspected_on: new Date().toISOString().slice(0, 10), tread_depth_mm: 2.5, pressure_psi: 110 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get('/api/alerts');
  const a = r.data.alerts.find((x) => x.kind === 'pneu' && x.title.includes('00126'));
  assert.equal(a.level, 'urgente');
  r = await admin.get('/api/dashboard');
  assert.ok(r.data.pneus.atencao >= 1);
  r = await bor.post(`/api/tires/${t2}/move`, { action: 'descartar', reason: 'Sulco no limite' });
  assert.equal(r.status, 403, 'descartar exige permissão de cancelar');
  r = await admin.post(`/api/tires/${t2}/move`, { action: 'descartar' });
  assert.equal(r.status, 400, 'motivo obrigatório');
  r = await admin.post(`/api/tires/${t2}/move`, { action: 'descartar', reason: 'Sulco no limite' });
  assert.equal(r.status, 200);
  r = await bor.post(`/api/tires/${t2}/move`, { action: 'instalar', vehicle_id: xyz, position: 'E1-D' });
  assert.equal(r.status, 400, 'descartado não volta');
  r = await admin.del(`/api/tires/${t2}`, { reason: 'Tentativa de apagar' });
  assert.equal(r.status, 409, 'pneu com histórico não é excluído');
});

test('listas de movimentações, recapagens, pesquisa e exportação', async () => {
  let r = await bor.get(`/api/tire-movements?vehicle_id=${abc}`);
  assert.ok(r.data.movements.length >= 4);
  r = await bor.get('/api/tire-retreads');
  assert.equal(r.data.totals.aprovadas, 1);
  assert.equal(r.data.totals.custo_total, 650);
  r = await bor.get('/api/tires?status=em_uso');
  assert.ok(r.data.tires.every((t) => t.status === 'em_uso'));
  r = await admin.get('/api/search?q=00125');
  assert.ok(r.data.results.some((x) => x.kind === 'pneu'));
  r = await admin.get('/api/tires/export');
  assert.equal(r.status, 200);
  r = await admin.get(`/api/audit?entity=pneu&entity_id=${t1}`);
  assert.ok(r.data.entries.length >= 5);
});

test('datas gravadas no dia de Brasília (não no dia UTC do servidor)', async () => {
  const r0 = await bor.post('/api/tires', { code: 'TZ-001' });
  await bor.post(`/api/tires/${r0.data.id}/move`, { action: 'recapagem', company: 'X' });
  const r = await bor.get(`/api/tires/${r0.data.id}`);
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  assert.equal(r.data.retreads[0].sent_on, hoje);
  const ret = await bor.post(`/api/tires/${r0.data.id}/retread-return`, { returned_on: hoje });
  assert.equal(ret.status, 200, JSON.stringify(ret.data));
});
