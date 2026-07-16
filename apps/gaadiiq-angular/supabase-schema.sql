-- GAADIIQ Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/gnhixykdvnuoxeccntjo/sql

-- 1. Main cars table
create table if not exists cars (
  id            bigint primary key,
  make          text not null,
  model         text not null,
  variant       text,
  year          int not null,
  price         bigint not null,
  km            int not null default 0,
  fuel          text not null,
  transmission  text not null,
  badge         text,
  badge_type    text,
  image         text,
  rating        numeric(3,1),
  reviews       int default 0,
  verified      boolean default true,
  city          text,
  body_type     text,
  color         text,
  owners        text,
  created_at    timestamptz default now()
);

-- 2. Car specs (Engine, Power, Torque, Mileage, etc.)
create table if not exists car_specs (
  id      bigserial primary key,
  car_id  bigint references cars(id) on delete cascade,
  label   text not null,
  value   text not null
);

-- 3. Car features (Sunroof, ADAS, etc.)
create table if not exists car_features (
  id       bigserial primary key,
  car_id   bigint references cars(id) on delete cascade,
  feature  text not null
);

-- 4. Car images (multiple photos per car)
create table if not exists car_images (
  id         bigserial primary key,
  car_id     bigint references cars(id) on delete cascade,
  url        text not null,
  sort_order int default 0
);

-- 5. AI valuation per car
create table if not exists ai_valuation (
  id           bigserial primary key,
  car_id       bigint references cars(id) on delete cascade,
  fair_price   bigint,
  market_min   bigint,
  market_max   bigint,
  verdict      text,
  confidence   int
);

-- Enable Row Level Security (read-only for anon users)
alter table cars          enable row level security;
alter table car_specs     enable row level security;
alter table car_features  enable row level security;
alter table car_images    enable row level security;
alter table ai_valuation  enable row level security;

-- Allow public read access
create policy "Public read cars"         on cars          for select using (true);
create policy "Public read car_specs"    on car_specs     for select using (true);
create policy "Public read car_features" on car_features  for select using (true);
create policy "Public read car_images"   on car_images    for select using (true);
create policy "Public read ai_valuation" on ai_valuation  for select using (true);
