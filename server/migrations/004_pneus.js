// Fase 4: pneus, movimentações, recapagens e inspeções.
export default /* sql */ `
create table tires (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  fire_number text,
  brand text,
  model text,
  size text,
  purchase_date date,
  purchase_value numeric(12,2) check (purchase_value >= 0),
  initial_km integer not null default 0 check (initial_km >= 0),
  estimated_life_km integer check (estimated_life_km > 0),
  status text not null default 'novo' check (status in ('novo','em_uso','estoque','recapagem','retirado','descartado')),
  vehicle_id uuid references vehicles(id),
  position text,
  installed_at timestamptz,
  installed_vehicle_km integer,
  accumulated_km integer not null default 0 check (accumulated_km >= 0),
  retread_count integer not null default 0 check (retread_count >= 0),
  tread_depth_mm numeric(4,1),
  last_inspection_on date,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'em_uso') = (vehicle_id is not null and position is not null))
);
create unique index tires_code_uq on tires (lower(code));
create unique index tires_fire_uq on tires (lower(fire_number)) where fire_number is not null;
-- Uma posição de um veículo só pode ter um pneu
create unique index tires_position_uq on tires (vehicle_id, position) where vehicle_id is not null;
create index tires_status_idx on tires (status);

create table tire_movements (
  id bigserial primary key,
  tire_id uuid not null references tires(id),
  moved_at timestamptz not null default now(),
  action text not null,
  from_vehicle_id uuid references vehicles(id),
  from_position text,
  to_vehicle_id uuid references vehicles(id),
  to_position text,
  status_before text,
  status_after text,
  vehicle_km integer,
  km_run integer,
  tire_km integer,
  reason text,
  data jsonb,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index tire_movements_tire_idx on tire_movements (tire_id, moved_at);
create index tire_movements_date_idx on tire_movements (moved_at desc);
create index tire_movements_vehicle_idx on tire_movements (to_vehicle_id, moved_at desc);

create table tire_retreads (
  id uuid primary key default gen_random_uuid(),
  tire_id uuid not null references tires(id),
  sent_on date not null,
  company text,
  cost numeric(12,2) check (cost >= 0),
  returned_on date,
  retread_type text,
  warranty text,
  notes text,
  status text not null default 'enviado' check (status in ('enviado','retornado','reprovado')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tire_retreads_tire_idx on tire_retreads (tire_id, sent_on desc);
create unique index tire_retreads_open_uq on tire_retreads (tire_id) where status = 'enviado';
`;
