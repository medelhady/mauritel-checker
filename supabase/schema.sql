-- شغّل هذا الملف مرة واحدة في Supabase: SQL Editor -> New query -> Run

create table if not exists public.places (
  id text primary key,
  code text not null,
  area text not null default '',
  landmark text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.zone_areas (
  prefix text primary key,
  name text not null
);

create table if not exists public.locations (
  id text primary key,
  key text not null unique,
  lat double precision not null,
  lng double precision not null,
  code text,
  status text not null default 'unknown',
  area text not null default '',
  landmark text not null default '',
  link text not null default '',
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- أمان: تفعيل RLS بدون أي سياسة = لا وصول من المتصفح إطلاقًا.
-- الخادم وحده (بمفتاح service_role) يقرأ ويكتب.
alter table public.places enable row level security;
alter table public.zone_areas enable row level security;
alter table public.locations enable row level security;

insert into public.zone_areas (prefix, name) values
  ('CA', 'كرفور عرفات'),
  ('TJ', 'توجنين')
on conflict (prefix) do nothing;
