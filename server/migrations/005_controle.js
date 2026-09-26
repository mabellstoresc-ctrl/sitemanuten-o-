// Fase 5: documentos (com AET e reboques autorizados), checklists, custos avulsos e agenda.
export default /* sql */ `
-- Dados do CRLV que ajudam a conferir AET e capacidade
alter table vehicles
  add column color text,
  add column body_type text,
  add column pbt numeric(6,2) check (pbt >= 0),
  add column cmt numeric(6,2) check (cmt >= 0),
  add column capacity numeric(6,2) check (capacity >= 0);

create table documents (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner in ('veiculo','motorista','empresa')),
  vehicle_id uuid references vehicles(id),
  driver_id uuid references drivers(id),
  type text not null,
  number text,
  issuer text,
  issued_on date,
  valid_from date,
  expires_on date,
  exercise_year int check (exercise_year between 1990 and 2100),
  pbtc numeric(6,2) check (pbtc >= 0),
  combination text,
  amount numeric(12,2) check (amount >= 0),
  notes text,
  status text not null default 'ativo' check (status in ('ativo','substituido','cancelado')),
  replaced_by uuid references documents(id),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner = 'veiculo') = (vehicle_id is not null)),
  check ((owner = 'motorista') = (driver_id is not null)),
  check (valid_from is null or expires_on is null or expires_on >= valid_from)
);
create index documents_vehicle_idx on documents (vehicle_id, type) where vehicle_id is not null;
create index documents_driver_idx on documents (driver_id, type) where driver_id is not null;
create index documents_expiry_idx on documents (expires_on) where status = 'ativo';

-- AET: implementos (reboques/semirreboques) autorizados a rodar com o cavalo do documento
create table document_vehicles (
  document_id uuid not null references documents(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id),
  primary key (document_id, vehicle_id)
);
create index document_vehicles_vehicle_idx on document_vehicles (vehicle_id);

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'saida',
  vehicle_types text[] not null default '{}',
  items jsonb not null,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence checklist_number_seq start 1;

create table checklists (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('checklist_number_seq'),
  template_id uuid references checklist_templates(id),
  template_name text not null,
  kind text not null,
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  performed_at timestamptz not null,
  km integer check (km >= 0),
  inspector text,
  notes text,
  result text not null check (result in ('ok','problemas','reprovado')),
  nok_count int not null default 0,
  critical_count int not null default 0,
  service_order_id uuid references service_orders(id),
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index checklists_vehicle_idx on checklists (vehicle_id, performed_at desc);
create index checklists_date_idx on checklists (performed_at desc);

create table checklist_answers (
  checklist_id uuid not null references checklists(id) on delete cascade,
  position int not null,
  item_key text not null,
  item_group text,
  label text not null,
  critical boolean not null default false,
  answer text not null check (answer in ('ok','nok','na')),
  note text,
  primary key (checklist_id, item_key)
);

create table costs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  category text not null,
  description text not null,
  cost_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  supplier text,
  document_number text,
  notes text,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index costs_vehicle_idx on costs (vehicle_id, cost_date desc);
create index costs_date_idx on costs (cost_date desc);

-- Compromissos marcados direto no calendário (vistoria, revisão agendada, renovação…)
create table appointments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  title text not null,
  scheduled_on date not null,
  notes text,
  done_at timestamptz,
  done_by uuid references users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_date_idx on appointments (scheduled_on) where cancelled_at is null;

-- Modelos iniciais de checklist (podem ser editados ou desativados)
insert into checklist_templates (name, kind, vehicle_types, items) values
('Saída — cavalo / caminhão', 'saida', '{cavalo,caminhao}', '[
  {"key":"doc","group":"Documentos","label":"CRLV, AET e documentos do motorista a bordo","critical":true},
  {"key":"tacografo","group":"Documentos","label":"Tacógrafo funcionando / disco ou registro","critical":false},
  {"key":"oleo","group":"Motor","label":"Nível do óleo do motor","critical":true},
  {"key":"agua","group":"Motor","label":"Nível da água do radiador","critical":true},
  {"key":"vazamentos","group":"Motor","label":"Sem vazamentos (óleo, água, combustível, ar)","critical":true},
  {"key":"arla","group":"Motor","label":"Nível do ARLA 32","critical":false},
  {"key":"freio","group":"Freios","label":"Freio de serviço e de estacionamento","critical":true},
  {"key":"ar","group":"Freios","label":"Pressão de ar / sem vazamento no sistema de freio","critical":true},
  {"key":"pneus","group":"Pneus","label":"Pneus calibrados e sem cortes/bolhas","critical":true},
  {"key":"estepe","group":"Pneus","label":"Estepe em condições","critical":false},
  {"key":"porcas","group":"Pneus","label":"Porcas de roda (sem falta / sem folga)","critical":true},
  {"key":"farois","group":"Elétrica","label":"Faróis, lanternas, setas e luz de freio","critical":true},
  {"key":"painel","group":"Elétrica","label":"Painel sem luzes de alerta","critical":false},
  {"key":"parabrisa","group":"Cabine","label":"Para-brisa, limpadores e retrovisores","critical":false},
  {"key":"cinto","group":"Cabine","label":"Cinto de segurança","critical":true},
  {"key":"extintor","group":"Segurança","label":"Extintor na validade","critical":true},
  {"key":"triangulo","group":"Segurança","label":"Triângulo, macaco e chave de roda","critical":false},
  {"key":"quinta_roda","group":"Engate","label":"Quinta roda / pino rei travado e engraxado","critical":true},
  {"key":"mangueiras","group":"Engate","label":"Mangueiras de ar e cabo elétrico do engate","critical":true},
  {"key":"limpeza","group":"Geral","label":"Limpeza e conservação","critical":false}
]'::jsonb),
('Saída — carreta / semirreboque', 'saida', '{carreta,implemento}', '[
  {"key":"pneus","group":"Pneus","label":"Pneus calibrados e sem cortes/bolhas","critical":true},
  {"key":"estepe","group":"Pneus","label":"Estepe(s) em condições","critical":false},
  {"key":"porcas","group":"Pneus","label":"Porcas de roda (sem falta / sem folga)","critical":true},
  {"key":"freio","group":"Freios","label":"Freios e lonas / sem vazamento de ar","critical":true},
  {"key":"suspensao","group":"Estrutura","label":"Suspensão, molas e bolsas de ar","critical":true},
  {"key":"pino_rei","group":"Estrutura","label":"Pino rei e mesa","critical":true},
  {"key":"carroceria","group":"Estrutura","label":"Carroceria, portas, lonas e travas","critical":false},
  {"key":"lanternas","group":"Elétrica","label":"Lanternas, setas, luz de freio e placa","critical":true},
  {"key":"faixas","group":"Segurança","label":"Faixas refletivas e para-choque","critical":true},
  {"key":"pes","group":"Estrutura","label":"Pés de apoio (sapatas)","critical":false},
  {"key":"placa","group":"Documentos","label":"Placa legível e lacrada","critical":true}
]'::jsonb);
`;
