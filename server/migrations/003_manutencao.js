// Fase 3: ordens de serviço, manutenções (preventivas/corretivas), troca de óleo e próximas manutenções.
export default /* sql */ `
create sequence service_order_number_seq start 1;

create table service_orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('service_order_number_seq'),
  vehicle_id uuid not null references vehicles(id),
  type text not null default 'corretiva' check (type in ('preventiva','corretiva')),
  opened_on date not null,
  km integer check (km >= 0),
  reported_problem text not null,
  responsible text,
  workshop text,
  services_done text,
  due_date date,
  status text not null default 'aberta'
    check (status in ('aberta','em_analise','aguardando_peca','em_manutencao','finalizada','cancelada')),
  completed_on date,
  maintenance_id uuid,
  vehicle_status_before text,
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_orders_vehicle_idx on service_orders (vehicle_id, opened_on desc);
create index service_orders_status_idx on service_orders (status);

create table service_order_status_log (
  id bigserial primary key,
  service_order_id uuid not null references service_orders(id),
  from_status text,
  to_status text not null,
  note text,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index so_status_log_idx on service_order_status_log (service_order_id, created_at);

create table maintenances (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  service_order_id uuid references service_orders(id),
  type text not null check (type in ('preventiva','corretiva')),
  categories text[] not null check (cardinality(categories) > 0),
  performed_on date not null,
  km integer check (km >= 0),
  workshop text,
  responsible text,
  description text,
  parts_cost numeric(12,2) not null default 0 check (parts_cost >= 0),
  labor_cost numeric(12,2) not null default 0 check (labor_cost >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  invoice_number text,
  notes text,
  next_date date,
  next_km integer check (next_km >= 0),
  -- Troca de óleo
  oil_brand text,
  oil_type text,
  oil_spec text,
  oil_quantity numeric(8,2),
  oil_filter boolean not null default false,
  fuel_filter boolean not null default false,
  air_filter boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maintenances_vehicle_idx on maintenances (vehicle_id, performed_on desc);
create index maintenances_categories_idx on maintenances using gin (categories);
create index maintenances_next_idx on maintenances (next_date) where status = 'ativo';
alter table service_orders add constraint service_orders_maintenance_fk foreign key (maintenance_id) references maintenances(id);

-- Peças: lançadas na OS e/ou na manutenção
create table maintenance_parts (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid references service_orders(id),
  maintenance_id uuid references maintenances(id),
  description text not null,
  part_number text,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  total numeric(12,2) not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (service_order_id is not null or maintenance_id is not null)
);
create index maintenance_parts_so_idx on maintenance_parts (service_order_id);
create index maintenance_parts_m_idx on maintenance_parts (maintenance_id);
`;
