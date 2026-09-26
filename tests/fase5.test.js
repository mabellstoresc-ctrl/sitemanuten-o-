import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, Client } from './helpers.js';

let handle, closePool;
let admin, op; // administrador e operador (sem custos/relatórios de custo)
let cav, cav2, sr1, sr2, sr3;

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const plusDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const year = () => Number(today().slice(0, 4));

before(async () => {
  await resetDatabase();
  ({ handle } = await import('../server/app.js'));
  ({ closePool } = await import('../server/db.js'));
  admin = new Client(handle);
  await admin.post('/api/auth/login', { username: 'bernardo', password: '050410' });
  await admin.post('/api/auth/change-password', { current_password: '050410', new_password: 'Admin@2026' });
  const mk = async (body) => {
    const r = await admin.post('/api/vehicles', body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  cav = await mk({ plate: 'DPC9H83', type: 'cavalo', brand: 'SCANIA', model: 'P94GA4X2NZ 270', axle_config: '4x2', current_km: 400000, pbt: 16.5, cmt: 43.6, color: 'branca' });
  cav2 = await mk({ plate: 'MFI2H68', type: 'cavalo', axle_config: '4x2', current_km: 700000 });
  sr1 = await mk({ plate: 'FJX5H03', type: 'carreta', axle_config: '2 eixos' });
  sr2 = await mk({ plate: 'FJX5H07', type: 'carreta', axle_config: '2 eixos' });
  sr3 = await mk({ plate: 'TQC6D31', type: 'carreta', axle_config: '3 eixos' });
  await admin.post('/api/users', {
    full_name: 'Operador',
    username: 'operador',
    password: 'op12345',
    must_change_password: false,
    permissions: { veiculos: ['ver', 'editar'], documentos: ['ver'], checklists: ['ver', 'cadastrar'], relatorios: ['ver'], manutencoes: ['ver'] },
  });
  op = new Client(handle);
  await op.post('/api/auth/login', { username: 'operador', password: 'op12345' });
});

after(async () => {
  await closePool();
});

let crlvOld, crlvNew;

test('dados do CRLV no cadastro do veículo', async () => {
  const r = await admin.get(`/api/vehicles/${cav}`);
  assert.equal(r.data.vehicle.cmt, 43.6);
  assert.equal(r.data.vehicle.color, 'BRANCA');
});

test('CRLV: o mais novo substitui o anterior; um mais antigo entra como histórico', async () => {
  let r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'crlv', number: '244092661614', issuer: 'DETRAN-SC', exercise_year: year() - 1, issued_on: `${year() - 1}-01-02` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  crlvOld = r.data.id;
  r = await admin.get('/api/alerts');
  assert.ok(r.data.alerts.some((a) => a.kind === 'documento' && a.title.includes(`exercício ${year() - 1}`)), 'CRLV do ano anterior gera alerta');
  assert.ok(r.data.alerts.some((a) => a.title === 'Veículo MFI2H68 sem CRLV cadastrado'), 'veículo sem CRLV');

  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'crlv', number: '244092661614', issuer: 'DETRAN-SC', exercise_year: year(), amount: 250 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  crlvNew = r.data.id;
  assert.equal(r.data.replaced, 1);
  r = await admin.get(`/api/documents/${crlvOld}`);
  assert.equal(r.data.document.status, 'substituido');
  assert.equal(r.data.history.length, 1);

  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'crlv', number: 'X-2020', exercise_year: 2020 });
  assert.equal(r.data.status, 'substituido', 'CRLV antigo não derruba o vigente');
  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'crlv', number: '244092661614', exercise_year: year() });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'DOCUMENTO_DUPLICADO');

  r = await admin.get(`/api/documents?vehicle_id=${cav}`);
  assert.deepEqual(r.data.documents.map((d) => d.id), [crlvNew]);
  r = await admin.get('/api/alerts');
  assert.ok(!r.data.alerts.some((a) => a.title.includes(`exercício ${year() - 1}`)));
});

test('regras de dono/tipo e permissão', async () => {
  let r = await admin.post('/api/documents', { owner: 'empresa', type: 'crlv' });
  assert.equal(r.status, 400, 'CRLV não é da empresa');
  r = await admin.post('/api/documents', { owner: 'veiculo', type: 'crlv' });
  assert.equal(r.status, 400, 'veículo obrigatório');
  r = await admin.post('/api/documents', { owner: 'empresa', type: 'antt', number: '057079355', issuer: 'ANTT', notes: 'ETC desde 05/07/2024' });
  assert.equal(r.status, 200);
  r = await op.post('/api/documents', { owner: 'empresa', type: 'alvara' });
  assert.equal(r.status, 403, 'operador só visualiza documentos');
  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'seguro', valid_from: plusDays(10), expires_on: plusDays(5) });
  assert.equal(r.status, 400, 'vencimento antes do início');
});

let aetDnit, aetSp;

test('AET: implementos autorizados, duas AETs de órgãos diferentes e aviso ao engatar', async () => {
  let r = await admin.post('/api/documents', {
    owner: 'veiculo',
    vehicle_id: cav,
    type: 'aet',
    number: '339224/2026E',
    issuer: 'DNIT',
    valid_from: today(),
    expires_on: plusDays(365),
    pbtc: '43,6',
    combination: 'Bitrem 6 eixos CTSS7+',
    authorized_vehicle_ids: [sr1, sr2],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  aetDnit = r.data.id;
  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'aet', number: 'AET-12473326', issuer: 'DER-SP', expires_on: plusDays(366), authorized_vehicle_ids: [sr1] });
  aetSp = r.data.id;
  r = await admin.get(`/api/documents/${aetDnit}`);
  assert.equal(r.data.document.status, 'ativo', 'AET de outro órgão não substitui');
  assert.equal(r.data.document.combination, 'BITREM 6 EIXOS CTSS7+');
  assert.deepEqual(r.data.document.authorized.map((x) => x.plate), ['FJX5H03', 'FJX5H07']);

  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'aet', authorized_vehicle_ids: [cav2] });
  assert.equal(r.status, 400, 'cavalo não pode ser implemento autorizado');
  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'seguro', authorized_vehicle_ids: [sr1] });
  assert.equal(r.status, 400, 'lista só vale para AET');

  // A AET aparece também nos documentos do implemento
  r = await admin.get(`/api/documents?vehicle_id=${sr2}`);
  assert.deepEqual(r.data.documents.map((d) => d.id), [aetDnit]);

  r = await op.post(`/api/vehicles/${cav}/couple`, { trailer_id: sr1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.aet_warning, null);
  r = await op.post(`/api/vehicles/${cav}/couple`, { trailer_id: sr3 });
  assert.equal(r.status, 200, 'engate não é bloqueado');
  assert.match(r.data.aet_warning, /TQC6D31 não consta na AET/);
  r = await admin.get('/api/alerts');
  assert.ok(r.data.alerts.some((a) => a.kind === 'aet' && a.title.includes('DPC9H83 + TQC6D31')));

  // Nova AET do DNIT substitui a anterior do DNIT
  r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav, type: 'aet', number: '400000/2027E', issuer: 'dnit', expires_on: plusDays(700), authorized_vehicle_ids: [sr1, sr2, sr3] });
  assert.equal(r.data.replaced, 1);
  r = await admin.get(`/api/documents/${aetSp}`);
  assert.equal(r.data.document.status, 'ativo');
  r = await admin.get('/api/alerts');
  assert.ok(!r.data.alerts.some((a) => a.kind === 'aet'), 'implemento passou a constar na AET');

  // Editar a lista e cancelar: a AET anterior volta a valer
  const newId = (await admin.get(`/api/documents?vehicle_id=${cav}&type=aet`)).data.documents.find((d) => d.number === '400000/2027E').id;
  r = await admin.put(`/api/documents/${newId}`, { authorized_vehicle_ids: [sr1] });
  assert.equal(r.status, 200);
  r = await admin.post(`/api/documents/${newId}/cancel`, { reason: 'lançada por engano' });
  assert.equal(r.status, 200);
  r = await admin.get(`/api/documents/${aetDnit}`);
  assert.equal(r.data.document.status, 'ativo');
});

test('vencimento de documentos: alerta, painel e calendário', async () => {
  let r = await admin.post('/api/documents', { owner: 'veiculo', vehicle_id: cav2, type: 'tacografo', number: 'T-1', expires_on: plusDays(3) });
  assert.equal(r.status, 200);
  r = await admin.post('/api/drivers', { full_name: 'João da Silva', cpf: '11144477735' });
  const driver = r.data.id;
  r = await admin.post('/api/documents', { owner: 'motorista', driver_id: driver, type: 'toxicologico', expires_on: plusDays(-2) });
  assert.equal(r.status, 200);
  r = await admin.get('/api/alerts');
  const docs = r.data.alerts.filter((a) => a.kind === 'documento' && a.date);
  assert.ok(docs.some((a) => a.level === 'urgente' && a.title.includes('VENCIDO há 2')));
  assert.ok(docs.some((a) => a.title.includes('Aferição do tacógrafo nº T-1 vence em 3')));
  r = await admin.get('/api/dashboard');
  assert.equal(r.data.documentos.vencidos, 1);
  assert.equal(r.data.documentos.vencendo, 1);
  r = await admin.get(`/api/documents?state=atencao`);
  assert.equal(r.data.documents.length, 2);
  r = await admin.get(`/api/maintenance/calendar?from=${today()}&to=${plusDays(10)}`);
  assert.ok(r.data.items.some((i) => i.kind === 'documento' && i.plate === 'MFI2H68'));
  r = await admin.get('/api/search?q=T-1');
  assert.ok(r.data.results.some((x) => x.kind === 'documento' && x.subtitle === 'MFI2H68'));
  r = await admin.get('/api/search?q=339224');
  assert.ok(r.data.results.some((x) => x.kind === 'documento'));
});

let ckId;

test('checklist: itens obrigatórios, resultado, KM e OS a partir do checklist', async () => {
  let r = await op.get('/api/checklist-templates');
  assert.equal(r.data.templates.length, 2, 'modelos iniciais');
  const tpl = r.data.templates.find((t) => t.vehicle_types.includes('cavalo'));
  const carTpl = r.data.templates.find((t) => t.vehicle_types.includes('carreta'));
  r = await op.get(`/api/checklist-templates/${tpl.id}`);
  const items = r.data.template.items;

  r = await op.post('/api/checklists', { template_id: carTpl.id, vehicle_id: cav, performed_at: new Date().toISOString(), answers: [] });
  assert.equal(r.status, 400, 'modelo de carreta não se aplica a cavalo');
  r = await op.post('/api/checklists', { template_id: tpl.id, vehicle_id: cav, performed_at: new Date().toISOString(), answers: [{ key: items[0].key, answer: 'ok' }] });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'ITENS_SEM_RESPOSTA');

  const answers = items.map((it) => ({ key: it.key, answer: 'ok' }));
  answers.find((a) => a.key === 'freio').answer = 'nok';
  answers.find((a) => a.key === 'freio').note = 'freio de estacionamento fraco';
  answers.find((a) => a.key === 'limpeza').answer = 'na';
  r = await op.post('/api/checklists', { template_id: tpl.id, vehicle_id: cav, performed_at: new Date().toISOString(), km: 400500, inspector: 'Carlos', answers });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.result, 'reprovado', 'item crítico com problema reprova');
  ckId = r.data.id;
  r = await op.get(`/api/vehicles/${cav}`);
  assert.equal(r.data.vehicle.current_km, 400500, 'KM do checklist atualiza o veículo');
  r = await op.get(`/api/checklists/${ckId}`);
  assert.equal(r.data.checklist.answers.find((a) => a.item_key === 'freio').note, 'freio de estacionamento fraco');
  r = await admin.get('/api/alerts');
  assert.ok(r.data.alerts.some((a) => a.kind === 'checklist' && a.level === 'urgente'));

  r = await admin.post('/api/service-orders', { vehicle_id: cav, opened_on: today(), reported_problem: 'Checklist nº 1: freio', checklist_id: ckId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/service-orders', { vehicle_id: cav, opened_on: today(), reported_problem: 'de novo', checklist_id: ckId });
  assert.equal(r.status, 400, 'checklist já vinculado');
  r = await op.get(`/api/checklists/${ckId}`);
  assert.equal(r.data.checklist.service_order_number, 1);
  r = await admin.get('/api/alerts');
  assert.ok(!r.data.alerts.some((a) => a.kind === 'checklist'));

  r = await op.post(`/api/checklists/${ckId}/cancel`, { reason: 'lançado errado' });
  assert.equal(r.status, 403, 'operador não cancela');
});

test('modelo de checklist editável', async () => {
  let r = await admin.post('/api/checklist-templates', { name: 'Retorno', kind: 'retorno', items: [{ label: 'Avarias' }, { label: 'Avarias' }, { label: 'Tanque', critical: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get(`/api/checklist-templates/${r.data.id}`);
  assert.deepEqual(r.data.template.items.map((i) => i.key), ['avarias', 'avarias_2', 'tanque']);
  r = await admin.put(`/api/checklist-templates/${r.data.template.id}`, { is_active: false });
  assert.equal(r.status, 200);
  r = await admin.get('/api/checklist-templates');
  assert.equal(r.data.templates.length, 2);
});

test('custos consolidados: combustível, manutenção, documentos e avulsos', async () => {
  let r = await admin.post('/api/fuelings', { vehicle_id: cav, fuel_type: 'diesel_s10', fueled_at: new Date().toISOString(), km: 401000, liters: 100, price_per_liter: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/maintenances', { vehicle_id: cav, type: 'corretiva', categories: ['freios'], performed_on: today(), labor_cost: 400, parts: [{ description: 'Lona', quantity: 4, unit_price: 50 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/costs', { vehicle_id: cav, category: 'pedagio', description: 'Pedágios da viagem', cost_date: today(), amount: '150,50' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/costs', { category: 'seguro', description: 'Seguro da frota (parcela)', cost_date: today(), amount: 1000 });
  const general = r.data.id;
  r = await op.get('/api/costs/summary');
  assert.equal(r.status, 403, 'operador sem permissão de custos');

  r = await admin.get(`/api/costs/summary?from=${today().slice(0, 7)}-01`);
  assert.equal(r.status, 200);
  // 600 combustível + 600 manutenção + 250 CRLV + 150,50 pedágio + 1000 seguro geral
  assert.equal(r.data.total, 2600.5);
  const v = r.data.by_vehicle.find((x) => x.plate === 'DPC9H83');
  assert.equal(v.total, 1600.5);
  assert.equal(v.by_source.combustivel, 600);
  assert.equal(v.by_source.documentos, 250);
  assert.ok(v.km >= 1000, 'KM rodado no período');
  assert.ok(r.data.by_vehicle.some((x) => x.vehicle_id === null && x.total === 1000));
  assert.ok(r.data.by_category.some((c) => c.key === 'avulso:pedagio' && c.label === 'Pedágio'));

  r = await admin.get(`/api/vehicles/${cav}/costs`);
  assert.equal(r.data.month.total, 1600.5);
  assert.ok(r.data.recent.length >= 4);

  r = await admin.post(`/api/costs/${general}/cancel`, { reason: 'duplicado' });
  assert.equal(r.status, 200);
  r = await admin.get('/api/costs/summary');
  assert.equal(r.data.total, 1600.5);
  r = await admin.get('/api/costs/export');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  r = await admin.get('/api/dashboard');
  assert.equal(r.data.custos_mes.total, 1600.5);
});

test('relatórios: permissões, execução e exportação', async () => {
  let r = await op.get('/api/reports');
  const keys = r.data.reports.map((x) => x.key);
  assert.ok(keys.includes('frota') && keys.includes('documentos') && keys.includes('checklists'));
  assert.ok(!keys.includes('custos_veiculo') && !keys.includes('abastecimentos'), 'só relatórios dos módulos que o usuário vê');
  r = await op.get('/api/reports/custos_veiculo');
  assert.equal(r.status, 403);
  r = await op.get('/api/reports/frota?format=csv');
  assert.equal(r.status, 403, 'exportar exige permissão');

  r = await admin.get('/api/reports');
  for (const rep of r.data.reports) {
    const res = await admin.get(`/api/reports/${rep.key}?from=${today().slice(0, 7)}-01&to=${today()}`);
    assert.equal(res.status, 200, `${rep.key}: ${JSON.stringify(res.data)}`);
    assert.ok(Array.isArray(res.data.rows) && res.data.columns.length > 0, rep.key);
  }
  r = await admin.get('/api/reports/custos_veiculo');
  assert.equal(r.data.totals.total, 1600.5);
  r = await admin.get('/api/reports/documentos?state=todos');
  assert.ok(r.data.rows.some((x) => x.authorized === 'FJX5H03, FJX5H07'));
  r = await admin.get('/api/reports/abastecimentos?format=csv');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const text = r.data.toString('utf8');
  assert.ok(text.startsWith('﻿'), 'BOM para o Excel');
  assert.match(text, /TOTAL/);
  r = await admin.get('/api/reports/abastecimentos?from=2026-13-01');
  assert.equal(r.status, 400);
});

test('agenda no calendário', async () => {
  let r = await op.post('/api/appointments', { title: 'Vistoria', scheduled_on: plusDays(2) });
  assert.equal(r.status, 403);
  r = await admin.post('/api/appointments', { vehicle_id: cav2, title: 'Vistoria do cronotacógrafo', scheduled_on: plusDays(2) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  r = await admin.get(`/api/maintenance/calendar?from=${today()}&to=${plusDays(5)}`);
  const item = r.data.items.find((i) => i.appointment_id === id);
  assert.equal(item.state, 'proxima');
  r = await admin.post(`/api/appointments/${id}/done`, {});
  r = await admin.get(`/api/maintenance/calendar?from=${today()}&to=${plusDays(5)}`);
  assert.equal(r.data.items.find((i) => i.appointment_id === id).state, 'realizada');
});

test('backup completo só para o Administrador Principal, sem senhas', async () => {
  let r = await op.get('/api/admin/backup');
  assert.equal(r.status, 403);
  r = await admin.get('/api/admin/backup');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /backup-rododimi-/);
  const b = r.data;
  assert.ok(b.dados.vehicles.length >= 5);
  assert.ok(b.dados.documents.length > 0);
  assert.ok(!('password_hash' in b.dados.users[0]));
  assert.ok(!('sessions' in b.dados));
});

test('leitura de CRLV e AET a partir do texto do PDF (dados fictícios)', async () => {
  const { parseDocument } = await import('../shared/docParse.js');
  // Rótulo (fonte pequena) com o valor logo abaixo, como no CRLV digital
  const L = (str, x, y) => ({ str, x, y, w: str.length * 3, h: 5.9, page: 1 });
  const V = (str, x, y) => ({ str, x, y, w: str.length * 6, h: 10, page: 1 });
  const items = [
    L('CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEÍCULO - DIGITAL', 31, 773),
    L('DETRAN-', 31, 784),
    L('SC', 51, 784),
    L('CÓDIGO RENAVAM', 31, 747),
    V('12345678900', 31, 733),
    L('PLACA', 31, 720),
    L('EXERCÍCIO', 103, 720),
    V('ABC1D23', 31, 707),
    V('2026', 103, 707),
    L('ANO FABRICAÇÃO', 31, 694),
    L('ANO MODELO', 103, 694),
    V('2018', 31, 681),
    V('2019', 103, 681),
    L('PESO BRUTO TOTAL', 510, 734),
    V('2.8', 510, 721),
    L('CMT', 453, 708),
    V('60.0', 454, 694),
    L('EIXOS', 504, 708),
    V('3', 504, 694),
    L('MARCA / MODELO / VERSÃO', 31, 564),
    V('M.BENZ/AXOR 2544', 31, 541),
    V('S', 133, 541),
    L('ESPÉCIE / TIPO', 31, 529),
    V('TRACAO CAMINHAO TRATOR', 31, 506),
    L('CHASSI', 130, 494),
    V('9BM958207AB123456', 131, 471),
    L('COMBUSTÍVEL', 102, 458),
    V('DIESEL', 103, 436),
  ];
  const c = parseDocument(items);
  assert.equal(c.kind, 'crlv');
  assert.equal(c.plate, 'ABC1D23');
  assert.equal(c.exercise_year, 2026);
  assert.equal(c.type, 'cavalo');
  assert.equal(c.axle_config, '6x2');
  assert.equal(c.brand, 'M.BENZ');
  assert.equal(c.model, 'AXOR 2544 S', 'valor quebrado na mesma linha');
  assert.equal(c.pbt, null, 'PBT implausível é descartado');
  assert.equal(c.cmt, 60);
  assert.equal(c.fuel_type, 'diesel_s10');
  assert.equal(c.issuer, 'DETRAN-SC');

  const t = (arr) => arr.map((str, i) => ({ str, x: 0, y: 800 - i * 10, h: 8, page: 1 }));
  const dnit = parseDocument(t(['DEPARTAMENTO NACIONAL DE INFRA-ESTRUTURA DE TRANSPORTES - DNIT', 'AUTORIZAÇÃO ESPECIAL DE TRÂNSITO', 'A.E.T. Nº 111111/2026E', 'BITREM 6 EIXOS CTSS7+', 'PROPRIETÁRIO DO VEÍCULO', 'no período de:', '21/08/2026 a 20/08/2027', 'ABC1D23', 'XYZ1234', 'CONJUNTO TIPO: BITREM 6 EIXOS CTSS7+', 'PBTC INFORMADO (t): 43,6', 'Número da ART: 14392945/RS - RIV']));
  assert.deepEqual(
    { issuer: dnit.issuer, number: dnit.number, from: dnit.valid_from, to: dnit.expires_on, pbtc: dnit.pbtc, comb: dnit.combination, art: dnit.art, plates: dnit.plates },
    { issuer: 'DNIT', number: '111111/2026E', from: '2026-08-21', to: '2027-08-20', pbtc: 43.6, comb: 'BITREM 6 EIXOS CTSS7+', art: '14392945/RS', plates: ['ABC1D23', 'XYZ1234'] },
  );
  const der = parseDocument(t(['SECRETARIA DE MEIO AMBIENTE, INFRAESTRUTURA E LOGÍSTICA', 'DEPARTAMENTO DE ESTRADAS DE RODAGEM', 'Nº', 'AET-12345678', 'Autorização Especial de Trânsito para circulação', 'PLACA:', 'ABC1D23', 'CONJUNTO:', 'SEMIREBOQUE /', 'SEMIREBOQUE', 'PESO', 'TOTAL BRUTO:', '47,00t', 'VALIDADE', '21/08/2026 a 21/08/2027']), 'X_DERSP_AET.pdf');
  assert.equal(der.issuer, 'DER-SP');
  assert.equal(der.number, 'AET-12345678');
  assert.equal(der.pbtc, 47);
  assert.equal(der.expires_on, '2027-08-21');
  assert.equal(parseDocument(t(['Dados bancários'])), null);
});
