import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, Client } from './helpers.js';

let handle, closePool;
let admin; // Client do bernardo

before(async () => {
  await resetDatabase();
  ({ handle } = await import('../server/app.js'));
  ({ closePool } = await import('../server/db.js'));
  admin = new Client(handle);
});

after(async () => {
  await closePool();
});

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

test('login do administrador principal e troca obrigatória de senha', async () => {
  let r = await admin.get('/api/auth/me');
  assert.equal(r.status, 401);

  r = await admin.post('/api/auth/login', { username: 'bernardo', password: 'errada' });
  assert.equal(r.status, 401);

  r = await admin.post('/api/auth/login', { username: 'Bernardo', password: '050410' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.is_master, true);
  assert.equal(r.data.user.must_change_password, true);

  // Antes de trocar a senha, outras rotas são bloqueadas
  r = await admin.get('/api/vehicles');
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'TROCAR_SENHA');

  r = await admin.post('/api/auth/change-password', { current_password: '050410', new_password: '050410' });
  assert.equal(r.status, 400);
  r = await admin.post('/api/auth/change-password', { current_password: '050410', new_password: 'NovaSenha@2026' });
  assert.equal(r.status, 200);

  r = await admin.get('/api/vehicles');
  assert.equal(r.status, 200);
});

test('proteção CSRF: escrita sem cabeçalho é bloqueada', async () => {
  const cookie = Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await handle(
    new Request('http://localhost/api/vehicles', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plate: 'AAA1A11', type: 'cavalo' }),
    }),
  );
  assert.equal(res.status, 403);
});

test('bloqueio após 5 tentativas erradas', async () => {
  const r0 = await admin.post('/api/users', {
    full_name: 'Teste Bloqueio',
    username: 'bloq',
    password: 'senha123',
    must_change_password: false,
  });
  assert.equal(r0.status, 200, JSON.stringify(r0.data));
  const c = new Client(handle);
  let r;
  for (let i = 0; i < 5; i++) r = await c.post('/api/auth/login', { username: 'bloq', password: 'x' + i });
  assert.equal(r.status, 423);
  r = await c.post('/api/auth/login', { username: 'bloq', password: 'senha123' });
  assert.equal(r.status, 423, 'continua bloqueado mesmo com a senha certa');
  r = await admin.post(`/api/users/${r0.data.id}/unlock`);
  assert.equal(r.status, 200);
  r = await c.post('/api/auth/login', { username: 'bloq', password: 'senha123' });
  assert.equal(r.status, 200);
  const log = await admin.get(`/api/access-log?user_id=${r0.data.id}`);
  assert.ok(log.data.entries.some((e) => e.event === 'login_falha'));
});

let joana; // usuária com permissão de cadastrar usuários
let joanaId;

test('permissões: usuário comum não escala privilégios nem mexe no administrador', async () => {
  let r = await admin.post('/api/users', {
    full_name: 'Joana Operacional',
    username: 'joana',
    password: 'joana123',
    must_change_password: false,
    permissions: {
      veiculos: ['ver', 'cadastrar', 'editar'],
      motoristas: ['ver'],
      usuarios: ['ver', 'cadastrar', 'editar'],
      modulo_inexistente: ['ver'],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  joanaId = r.data.id;
  r = await admin.get(`/api/users/${joanaId}`);
  assert.deepEqual(r.data.user.permissions.veiculos, ['ver', 'cadastrar', 'editar']);
  assert.equal(r.data.user.permissions.modulo_inexistente, undefined);

  joana = new Client(handle);
  r = await joana.post('/api/auth/login', { username: 'joana', password: 'joana123' });
  assert.equal(r.status, 200);

  // Não pode conceder o que não tem
  r = await joana.post('/api/users', {
    full_name: 'Carlos',
    username: 'carlos',
    password: 'carlos123',
    permissions: { veiculos: ['ver', 'excluir'] },
  });
  assert.equal(r.status, 403);

  // Pode conceder subconjunto
  r = await joana.post('/api/users', {
    full_name: 'Carlos',
    username: 'carlos',
    password: 'carlos123',
    permissions: { veiculos: ['ver'] },
  });
  assert.equal(r.status, 200);

  // Não mexe no administrador principal
  const users = (await admin.get('/api/users')).data.users;
  const master = users.find((u) => u.is_master);
  r = await joana.post(`/api/users/${master.id}/status`, { is_active: false });
  assert.equal(r.status, 403);
  r = await joana.post(`/api/users/${master.id}/reset-password`, { password: 'hackeado' });
  assert.equal(r.status, 403);
  r = await joana.put(`/api/users/${master.id}`, { full_name: 'Outro' });
  assert.equal(r.status, 403);

  // Nem nas próprias permissões
  r = await joana.put(`/api/users/${joanaId}`, { permissions: { veiculos: ['ver', 'excluir'] } });
  assert.equal(r.status, 403);

  // O administrador não pode se desativar
  r = await admin.post(`/api/users/${master.id}/status`, { is_active: false });
  assert.equal(r.status, 403);

  // Sem permissão de auditoria
  r = await joana.get('/api/audit');
  assert.equal(r.status, 403);
});

test('usuário desativado perde a sessão na hora', async () => {
  const c = new Client(handle);
  let r = await c.post('/api/auth/login', { username: 'carlos', password: 'carlos123' });
  assert.equal(r.status, 200);
  const carlos = (await admin.get('/api/users')).data.users.find((u) => u.username === 'carlos');
  r = await admin.post(`/api/users/${carlos.id}/status`, { is_active: false });
  assert.equal(r.status, 200);
  r = await c.get('/api/auth/me');
  assert.equal(r.status, 401);
  r = await c.post('/api/auth/login', { username: 'carlos', password: 'carlos123' });
  assert.equal(r.status, 403);
});

let cavaloId, carretaId, motoristaId;

test('veículos: cadastro, validação e KM', async () => {
  let r = await joana.post('/api/vehicles', { plate: 'abc-1d23', type: 'cavalo', current_km: 350000, brand: 'Scania', model: 'R450', fleet_number: '101' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cavaloId = r.data.id;

  r = await joana.post('/api/vehicles', { plate: 'ABC1D23', type: 'cavalo' });
  assert.equal(r.status, 409, 'placa duplicada');

  r = await joana.post('/api/vehicles', { plate: 'XX12', type: 'cavalo' });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.plate);

  r = await joana.post('/api/vehicles', { plate: 'CAR2E34', type: 'carreta', renavam: '12345678901' });
  assert.equal(r.status, 400, 'RENAVAM com dígito errado');
  r = await joana.post('/api/vehicles', { plate: 'CAR2E34', type: 'carreta', fleet_number: 'C-01' });
  assert.equal(r.status, 200);
  carretaId = r.data.id;

  r = await joana.get(`/api/vehicles/${cavaloId}`);
  assert.equal(r.data.vehicle.plate, 'ABC1D23');
  assert.equal(r.data.vehicle.current_km, 350000);

  // KM maior: ok
  r = await joana.post(`/api/vehicles/${cavaloId}/km`, { km: 350800 });
  assert.equal(r.status, 200);
  // KM menor: bloqueado
  r = await joana.post(`/api/vehicles/${cavaloId}/km`, { km: 350700 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'KM_MENOR');
  // Usuário comum não pode confirmar KM menor
  r = await joana.post(`/api/vehicles/${cavaloId}/km`, { km: 350700, confirm_lower: true, reason: 'erro de digitação' });
  assert.equal(r.status, 403);
  // Salto grande exige confirmação
  r = await joana.post(`/api/vehicles/${cavaloId}/km`, { km: 450800 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'KM_SALTO');
  // Administrador corrige com motivo
  r = await admin.post(`/api/vehicles/${cavaloId}/km`, { km: 350700, confirm_lower: true });
  assert.equal(r.status, 400, 'motivo obrigatório');
  r = await admin.post(`/api/vehicles/${cavaloId}/km`, { km: 350700, confirm_lower: true, reason: 'Erro de digitação no hodômetro' });
  assert.equal(r.status, 200);

  r = await admin.get(`/api/audit?entity=veiculo&entity_id=${cavaloId}`);
  const correction = r.data.entries.find((e) => e.action === 'correcao_km');
  assert.ok(correction);
  assert.deepEqual(correction.changes[0], { campo: 'current_km', anterior: 350800, novo: 350700 });

  // Edição gera auditoria com anterior/novo
  r = await joana.put(`/api/vehicles/${cavaloId}`, { model: 'R 450 A6x2', current_km: 1 });
  assert.equal(r.status, 200);
  r = await joana.get(`/api/vehicles/${cavaloId}`);
  assert.equal(r.data.vehicle.current_km, 350700, 'KM não muda pela edição comum');
  r = await admin.get(`/api/audit?entity=veiculo&entity_id=${cavaloId}&action=editar`);
  assert.equal(r.data.entries[0].changes[0].anterior, 'R450');
});

test('motoristas, vínculo com veículo e engate de carreta', async () => {
  let r = await admin.post('/api/drivers', { full_name: 'João da Silva', cpf: '111.444.777-35', cnh_expiry: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  motoristaId = r.data.id;
  r = await admin.post('/api/drivers', { full_name: 'CPF Ruim', cpf: '111.111.111-11' });
  assert.equal(r.status, 400);

  // Joana só tem "ver" em motoristas, mas "editar" em veículos: pode vincular
  r = await joana.post(`/api/vehicles/${cavaloId}/driver`, { driver_id: motoristaId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await joana.get(`/api/vehicles/${cavaloId}`);
  assert.equal(r.data.vehicle.driver_name, 'João da Silva');

  r = await joana.post(`/api/vehicles/${carretaId}/driver`, { driver_id: motoristaId });
  assert.equal(r.status, 400, 'carreta não recebe motorista');

  r = await joana.post(`/api/vehicles/${cavaloId}/couple`, { trailer_id: carretaId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await joana.post(`/api/vehicles/${carretaId}/couple`, { trailer_id: cavaloId });
  assert.equal(r.status, 400);

  await joana.post(`/api/vehicles/${cavaloId}/km`, { km: 351700 });
  r = await joana.get(`/api/vehicles/${carretaId}`);
  assert.equal(r.data.vehicle.tractor.plate, 'ABC1D23');
  assert.equal(r.data.vehicle.towed_km, 1000);

  r = await admin.get(`/api/drivers/${motoristaId}/assignments`);
  assert.equal(r.data.assignments.length, 1);

  r = await admin.get('/api/alerts');
  assert.ok(r.data.alerts.some((a) => a.kind === 'cnh' && a.title.includes('João da Silva')));

  r = await admin.get(`/api/vehicles/${cavaloId}/events`);
  const types = r.data.events.map((e) => e.type);
  assert.ok(types.includes('cadastro') && types.includes('motorista') && types.includes('engate') && types.includes('correcao_km'));

  // Exclusão bloqueada quando há histórico
  r = await admin.del(`/api/vehicles/${cavaloId}`, { reason: 'Cadastro errado' });
  assert.equal(r.status, 409);

  // Inativar encerra vínculos
  r = await joana.post(`/api/vehicles/${cavaloId}/status`, { status: 'inativo', reason: 'Vendido' });
  assert.equal(r.status, 403, 'inativar exige permissão cancelar');
  r = await admin.post(`/api/vehicles/${cavaloId}/status`, { status: 'inativo', reason: 'Vendido' });
  assert.equal(r.status, 200);
  r = await admin.get(`/api/vehicles/${cavaloId}`);
  assert.equal(r.data.vehicle.driver_id, null);
  assert.equal(r.data.vehicle.trailers.length, 0);
});

test('anexos: valida tipo real do arquivo e permissão', async () => {
  let r = await joana.call('POST', `/api/files?entity=vehicle&entity_id=${carretaId}&category=foto`, PNG, {
    'content-type': 'image/png',
    'x-filename': 'foto.png',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const fileId = r.data.id;
  r = await joana.get(`/api/vehicles/${carretaId}`);
  assert.equal(r.data.vehicle.photo_id, fileId);
  r = await joana.get(`/api/files/${fileId}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');

  // Arquivo disfarçado (texto com extensão .png) é recusado
  r = await joana.call('POST', `/api/files?entity=vehicle&entity_id=${carretaId}`, new TextEncoder().encode('<script>alert(1)</script> nada'), {
    'content-type': 'image/png',
    'x-filename': 'x.png',
  });
  assert.equal(r.status, 400);

  // Sem permissão em motoristas.editar
  r = await joana.call('POST', `/api/files?entity=driver&entity_id=${motoristaId}`, PNG, { 'x-filename': 'cnh.png' });
  assert.equal(r.status, 403);
});

test('exclusão de cadastro feito por engano fica registrada', async () => {
  let r = await admin.post('/api/vehicles', { plate: 'ERR0R00', type: 'utilitario' });
  const id = r.data.id;
  r = await admin.del(`/api/vehicles/${id}`, {});
  assert.equal(r.status, 400);
  r = await admin.del(`/api/vehicles/${id}`, { reason: 'Cadastrado por engano' });
  assert.equal(r.status, 200);
  r = await admin.get(`/api/audit?entity=veiculo&entity_id=${id}&action=excluir`);
  assert.equal(r.data.entries[0].reason, 'Cadastrado por engano');
});

test('dashboard, pesquisa e configurações', async () => {
  let r = await admin.get('/api/dashboard');
  assert.equal(r.status, 200);
  assert.equal(r.data.implementos.total, 1);
  assert.ok(r.data.login_falhas_24h >= 1);

  r = await admin.get('/api/search?q=abc1');
  assert.ok(r.data.results.some((x) => x.kind === 'veiculo'));
  r = await admin.get('/api/search?q=joão');
  assert.ok(r.data.results.some((x) => x.kind === 'motorista'));

  r = await joana.put('/api/settings/alertas', { cnh_dias: 60 });
  assert.equal(r.status, 403);
  r = await admin.put('/api/settings/alertas', { cnh_dias: 60, documento_dias: 15, manutencao_dias: 7, manutencao_km: 1000, oleo_km: 1000, km_salto_maximo: 8000 });
  assert.equal(r.status, 200);
  r = await admin.get('/api/settings');
  assert.equal(r.data.settings.alertas.cnh_dias, 60);

  r = await admin.get('/api/audit/export');
  assert.equal(r.status, 200);
  assert.ok(r.data.toString('utf8').includes('correcao_km'));
});

test('logout encerra a sessão', async () => {
  let r = await joana.post('/api/auth/logout');
  assert.equal(r.status, 200);
  r = await joana.get('/api/auth/me');
  assert.equal(r.status, 401);
});
