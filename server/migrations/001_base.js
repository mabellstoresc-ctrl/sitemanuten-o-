// Fase 1: usuários, permissões, sessões, auditoria, veículos, motoristas.
export default /* sql */ `
create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  full_name text not null,
  email text,
  job_title text,
  is_active boolean not null default true,
  is_master boolean not null default false,
  must_change_password boolean not null default true,
  password_hash text not null,
  password_changed_at timestamptz,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  last_login_ip text,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create unique index users_username_uq on users (lower(username));
-- Só pode existir um Administrador Principal
create unique index users_single_master on users (is_master) where is_master;

create table user_permissions (
  user_id uuid not null references users(id) on delete cascade,
  module text not null,
  actions text[] not null default '{}',
  primary key (user_id, module)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  remember boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

create table access_log (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  username text,
  event text not null,
  detail text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index access_log_created_idx on access_log (created_at desc);
create index access_log_user_idx on access_log (user_id, created_at desc);
create index access_log_ip_idx on access_log (ip, created_at desc);

create table audit_log (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  username text,
  module text not null,
  action text not null,
  entity text not null,
  entity_id text,
  entity_label text,
  changes jsonb,
  reason text,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_log (created_at desc);
create index audit_entity_idx on audit_log (entity, entity_id);
create index audit_user_idx on audit_log (user_id, created_at desc);
create index audit_module_idx on audit_log (module, created_at desc);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  category text,
  filename text not null,
  mime text not null,
  size int not null,
  storage_key text not null unique,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references users(id)
);
create index attachments_entity_idx on attachments (entity, entity_id);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  fleet_number text,
  brand text,
  model text,
  year_manufacture int,
  year_model int,
  chassis text,
  renavam text,
  type text not null check (type in ('cavalo','caminhao','carreta','implemento','utilitario','outros')),
  fuel_type text check (fuel_type in ('diesel_s10','diesel_s500','gasolina','etanol','flex','gnv','eletrico','nenhum')),
  tank_capacity numeric(10,2),
  current_km integer not null default 0 check (current_km >= 0),
  km_updated_at timestamptz,
  acquisition_date date,
  status text not null default 'disponivel' check (status in ('disponivel','em_viagem','em_manutencao','parado','inativo')),
  axle_config text,
  photo_id uuid references attachments(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create unique index vehicles_plate_uq on vehicles (plate);
create unique index vehicles_fleet_uq on vehicles (lower(fleet_number)) where fleet_number is not null;
create index vehicles_status_idx on vehicles (status);

create table km_readings (
  id bigserial primary key,
  vehicle_id uuid not null references vehicles(id),
  km integer not null check (km >= 0),
  previous_km integer,
  reading_at timestamptz not null default now(),
  source text not null,
  source_id text,
  is_correction boolean not null default false,
  reason text,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index km_readings_vehicle_idx on km_readings (vehicle_id, reading_at desc);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  cpf text not null,
  cnh_number text,
  cnh_category text,
  cnh_expiry date,
  phone text,
  admission_date date,
  status text not null default 'ativo' check (status in ('ativo','ferias','afastado','inativo')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create unique index drivers_cpf_uq on drivers (cpf);
create index drivers_cnh_expiry_idx on drivers (cnh_expiry);

create table driver_assignments (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id),
  vehicle_id uuid not null references vehicles(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  start_km integer,
  end_km integer,
  notes text,
  created_by uuid references users(id),
  ended_by uuid references users(id)
);
create unique index driver_assignments_open_vehicle on driver_assignments (vehicle_id) where end_at is null;
create unique index driver_assignments_open_driver on driver_assignments (driver_id) where end_at is null;
create index driver_assignments_driver_idx on driver_assignments (driver_id, start_at desc);
create index driver_assignments_vehicle_idx on driver_assignments (vehicle_id, start_at desc);

-- Conjunto: qual carreta/implemento está engatado em qual cavalo
create table vehicle_couplings (
  id uuid primary key default gen_random_uuid(),
  tractor_id uuid not null references vehicles(id),
  trailer_id uuid not null references vehicles(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  start_km integer,
  end_km integer,
  created_by uuid references users(id),
  ended_by uuid references users(id),
  check (tractor_id <> trailer_id)
);
create unique index vehicle_couplings_open_trailer on vehicle_couplings (trailer_id) where end_at is null;
create index vehicle_couplings_tractor_idx on vehicle_couplings (tractor_id, start_at desc);

-- Linha do tempo do veículo
create table vehicle_events (
  id bigserial primary key,
  vehicle_id uuid not null references vehicles(id),
  event_at timestamptz not null default now(),
  type text not null,
  title text not null,
  description text,
  ref_table text,
  ref_id text,
  data jsonb,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index vehicle_events_vehicle_idx on vehicle_events (vehicle_id, event_at desc);

create table driver_occurrences (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id),
  vehicle_id uuid references vehicles(id),
  occurred_on date not null,
  type text not null,
  description text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text
);
create index driver_occurrences_driver_idx on driver_occurrences (driver_id, occurred_on desc);
`;
