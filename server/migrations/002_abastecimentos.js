// Fase 2: ordens de abastecimento, abastecimentos e médias de consumo.
export default /* sql */ `
-- Leituras de KM invalidadas por correção ou cancelamento deixam de valer nas verificações
alter table km_readings add column invalidated boolean not null default false;
create index km_readings_valid_idx on km_readings (vehicle_id, reading_at) where not invalidated;

create sequence fuel_order_number_seq start 1;

create table fuel_orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('fuel_order_number_seq'),
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  order_date date not null,
  station text,
  fuel_type text,
  max_liters numeric(10,2) check (max_liters > 0),
  max_amount numeric(12,2) check (max_amount > 0),
  notes text,
  status text not null default 'pendente' check (status in ('pendente','utilizada','cancelada')),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fuel_orders_vehicle_idx on fuel_orders (vehicle_id, order_date desc);
create index fuel_orders_status_idx on fuel_orders (status, order_date desc);

create table fuelings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  fueled_at timestamptz not null,
  km integer not null check (km >= 0),
  station text,
  city text,
  state text,
  fuel_type text not null,
  liters numeric(10,3) not null check (liters > 0),
  price_per_liter numeric(10,4) not null check (price_per_liter >= 0),
  total numeric(12,2) not null check (total >= 0),
  full_tank boolean not null default true,
  order_id uuid references fuel_orders(id),
  order_ref text,
  notes text,
  -- Calculados automaticamente (recalculados a cada inclusão/edição/cancelamento)
  previous_km integer,
  distance integer,
  km_per_liter numeric(8,3),
  cost_per_km numeric(10,4),
  calc_distance integer,
  calc_liters numeric(10,3),
  calc_cost numeric(12,2),
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fuelings_vehicle_idx on fuelings (vehicle_id, km);
create index fuelings_date_idx on fuelings (fueled_at desc);
create index fuelings_driver_idx on fuelings (driver_id, fueled_at desc);
-- Uma ordem só pode ser usada por um abastecimento ativo
create unique index fuelings_order_uq on fuelings (order_id) where order_id is not null and status = 'ativo';
`;
