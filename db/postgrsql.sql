
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists postgis    with schema extensions;

-- 1. Types --------------------------------------------------------------
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.appointment_status  as enum ('booked', 'cancelled', 'completed', 'no_show');

-- 2. Helpers ------------------------------------------------------------
-- Role from the JWT. Uses app_metadata (NOT user_metadata: users can edit that).
create or replace function public.app_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'patient')
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Verhoeff check digit (same algorithm Aadhaar uses)
create or replace function public.verhoeff_check_digit(payload text)
returns int language plpgsql immutable as $$
declare
  d   int[] := array[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  p   int[] := array[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  inv int[] := array[0,4,3,2,1,5,6,7,8,9];
  c   int := 0;
  n   int := length(payload);
  i   int;
begin
  for i in 0..n-1 loop
    c := d[c+1][ p[((i+1) % 8)+1][ substr(payload, n-i, 1)::int + 1 ] + 1 ];
  end loop;
  return inv[c+1];
end $$;

create or replace function public.verhoeff_valid(num text)
returns boolean language plpgsql immutable as $$
declare
  d int[] := array[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  p int[] := array[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  c int := 0;
  n int := length(num);
  i int;
begin
  if num is null or num !~ '^[0-9]+$' then
    return false;
  end if;
  for i in 0..n-1 loop
    c := d[c+1][ p[(i % 8)+1][ substr(num, n-i, 1)::int + 1 ] + 1 ];
  end loop;
  return c = 0;
end $$;

-- PREFIX + 13 random digits (first digit 1-9) + Verhoeff check digit
create or replace function public.generate_code(p_prefix text)
returns text language plpgsql volatile
set search_path = public, extensions as $$
declare
  r    bigint;
  body text;
begin
  if p_prefix not in ('PAT','DOC','ADM','REC') then
    raise exception 'invalid code prefix: %', p_prefix;
  end if;
  -- 63 random bits from a cryptographic source -> uniform-enough 13-digit number
  r    := ('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint & 9223372036854775807;
  body := (1000000000000 + (r % 9000000000000))::text;
  return p_prefix || body || public.verhoeff_check_digit(body)::text;
end $$;

revoke execute on function public.generate_code(text) from public, anon, authenticated;

-- 3. profiles (one row per auth user) ----------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  user_code   text not null unique,
  handle      text unique,
  full_name   text,
  phone_e164  text,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_user_code_format check (
    user_code ~ '^PAT[1-9][0-9]{12}[0-9]$' and public.verhoeff_valid(substr(user_code, 4))
  ),
  constraint profiles_handle_format check (
    handle ~ '^[a-z0-9][a-z0-9._]{2,29}$' and handle !~ '\.\.' and handle !~ '\.$'
  ),
  constraint profiles_phone_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- auto-generate user_code (retry on the rare collision; UNIQUE is the final guard)
create or replace function public.profiles_set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; n int := 0;
begin
  if new.user_code is null then
    loop
      c := public.generate_code('PAT');
      exit when not exists (select 1 from public.profiles where user_code = c);
      n := n + 1;
      if n >= 5 then raise exception 'could not generate a unique user_code'; end if;
    end loop;
    new.user_code := c;
  end if;
  return new;
end $$;

create trigger profiles_set_code before insert on public.profiles
  for each row execute function public.profiles_set_code();

-- handles: reserved names + 90-day cool-down after someone releases one
create table public.reserved_handles (handle text primary key);
insert into public.reserved_handles (handle) values
  ('admin'),('administrator'),('support'),('help'),('doctor'),('medionary'),
  ('emergency'),('sos'),('ambulance'),('official'),('staff'),('root'),
  ('system'),('api'),('www'),('null'),('undefined');

create table public.handle_history (
  handle      text primary key,
  user_id     uuid not null,
  released_at timestamptz not null default now()
);

create or replace function public.profiles_handle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.handle is not null then
    new.handle := lower(new.handle);
  end if;

  if new.handle is not null and (tg_op = 'INSERT' or new.handle is distinct from old.handle) then
    if exists (select 1 from public.reserved_handles r where r.handle = new.handle) then
      raise exception 'handle is reserved';
    end if;
    if exists (select 1 from public.handle_history h
               where h.handle = new.handle and h.user_id <> new.id
                 and h.released_at > now() - interval '90 days') then
      raise exception 'handle was used recently, choose another';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.handle is not null and new.handle is distinct from old.handle then
    insert into public.handle_history (handle, user_id) values (old.handle, old.id)
    on conflict (handle) do update set user_id = excluded.user_id, released_at = now();
  end if;
  return new;
end $$;

create trigger profiles_handle_guard before insert or update of handle on public.profiles
  for each row execute function public.profiles_handle_guard();

-- create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. doctors ------------------------------------------------------------
create table public.doctors (
  id                  uuid primary key references public.profiles(id) on delete cascade,
  doctor_code         text not null unique,
  specialty           text not null,
  experience_years    smallint check (experience_years between 0 and 70),
  fee_minor           integer not null default 0 check (fee_minor >= 0),  -- paise/cents
  fee_currency        text not null default 'INR' check (fee_currency ~ '^[A-Z]{3}$'),
  timezone            text not null default 'Asia/Kolkata',
  nmc_number          text,
  bio                 text,
  verification_status public.verification_status not null default 'pending',
  verified_at         timestamptz,
  verified_by         uuid references public.profiles(id),
  location            extensions.geography(Point, 4326),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint doctors_code_format check (
    doctor_code ~ '^DOC[1-9][0-9]{12}[0-9]$' and public.verhoeff_valid(substr(doctor_code, 4))
  )
);

create index doctors_location_idx  on public.doctors using gist (location);
create index doctors_specialty_idx on public.doctors (specialty)
  where verification_status = 'verified';

create trigger doctors_updated_at before update on public.doctors
  for each row execute function public.set_updated_at();

create or replace function public.doctors_set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; n int := 0;
begin
  if new.doctor_code is null then
    loop
      c := public.generate_code('DOC');
      exit when not exists (select 1 from public.doctors where doctor_code = c);
      n := n + 1;
      if n >= 5 then raise exception 'could not generate a unique doctor_code'; end if;
    end loop;
    new.doctor_code := c;
  end if;
  return new;
end $$;

create trigger doctors_set_code before insert on public.doctors
  for each row execute function public.doctors_set_code();

create or replace function public.is_verified_doctor(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.doctors
                 where id = p_id and verification_status = 'verified')
$$;

create table public.doctor_availability (
  id           bigint generated always as identity primary key,
  doctor_id    uuid not null references public.doctors(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time   time not null,
  end_time     time not null,
  slot_minutes smallint not null default 15 check (slot_minutes between 5 and 240),
  check (end_time > start_time)
);
create index doctor_availability_doctor_idx on public.doctor_availability (doctor_id, weekday);

-- 5. appointments ---------------------------------------------------------
create table public.appointments (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id),
  doctor_id  uuid not null references public.doctors(id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     public.appointment_status not null default 'booked',
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- the DATABASE prevents double booking, even if two requests race
  constraint appointments_no_doctor_overlap exclude using gist (
    doctor_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status = 'booked'),
  constraint appointments_no_patient_overlap exclude using gist (
    patient_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status = 'booked')
);
create index appointments_patient_idx on public.appointments (patient_id, starts_at);
create index appointments_doctor_idx  on public.appointments (doctor_id, starts_at);

create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- The ONLY way a patient creates an appointment. Server validates the slot.
create or replace function public.book_appointment(
  p_doctor uuid, p_starts timestamptz, p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tz    text;
  v_local timestamp;
  v_slot  smallint;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select timezone into v_tz from public.doctors
   where id = p_doctor and verification_status = 'verified';
  if v_tz is null then
    raise exception 'doctor not available';
  end if;
  if p_starts <= now() then
    raise exception 'appointment must be in the future';
  end if;

  v_local := p_starts at time zone v_tz;

  select a.slot_minutes into v_slot
    from public.doctor_availability a
   where a.doctor_id = p_doctor
     and a.weekday   = extract(dow from v_local)::smallint
     and v_local::time >= a.start_time
     and (v_local::time - a.start_time) + make_interval(mins => a.slot_minutes)
           <= (a.end_time - a.start_time)
     and extract(epoch from (v_local::time - a.start_time)) % (a.slot_minutes * 60) = 0
   limit 1;

  if v_slot is null then
    raise exception 'slot not available';
  end if;

  insert into public.appointments (patient_id, doctor_id, starts_at, ends_at, reason)
  values (auth.uid(), p_doctor, p_starts, p_starts + make_interval(mins => v_slot), p_reason)
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'slot already booked';
end $$;

revoke execute on function public.book_appointment(uuid, timestamptz, text) from public, anon;
grant  execute on function public.book_appointment(uuid, timestamptz, text) to authenticated;

-- 6. audit_logs (append-only) -------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  target_type text,
  target_id   text,
  ip          inet,
  meta        jsonb not null default '{}'
);
create index audit_logs_actor_idx  on public.audit_logs (actor_id, at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id, at desc);

create or replace function public.audit_logs_block_change()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.audit_logs_block_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_logs_block_change();

-- 7. Public views (safe columns only) -----------------------------------
-- These views run with the owner's rights on purpose (they expose ONLY safe columns).
create view public.doctor_directory as
  select d.id, d.doctor_code, p.handle, p.full_name, d.specialty, d.experience_years,
         d.fee_minor, d.fee_currency, d.timezone, d.bio, d.location
    from public.doctors d
    join public.profiles p on p.id = d.id
   where d.verification_status = 'verified';

create view public.public_profiles as
  select handle, full_name
    from public.profiles
   where is_public and handle is not null;

-- 8. Security: RLS ON everywhere, then grant the minimum -----------------
alter table public.profiles            enable row level security;
alter table public.doctors             enable row level security;
alter table public.doctor_availability enable row level security;
alter table public.appointments        enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.reserved_handles    enable row level security;
alter table public.handle_history      enable row level security;

-- Supabase grants new tables to anon/authenticated by default -> take it all back
revoke all on public.profiles, public.doctors, public.doctor_availability,
              public.appointments, public.audit_logs,
              public.reserved_handles, public.handle_history,
              public.doctor_directory, public.public_profiles
  from anon, authenticated;

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name, phone_e164, handle, is_public) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.app_role() in ('admin', 'receptionist')
    or exists (select 1 from public.appointments a
               where a.doctor_id = auth.uid() and a.patient_id = profiles.id)
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- doctors  (verification_status/doctor_code/nmc_number: server-only writes)
grant select on public.doctors to authenticated;
grant update (bio, fee_minor, location, timezone) on public.doctors to authenticated;

create policy doctors_select on public.doctors for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');
create policy doctors_update_own on public.doctors for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- doctor_availability
grant select, insert, update, delete on public.doctor_availability to authenticated;

create policy availability_select on public.doctor_availability for select to authenticated
  using (doctor_id = auth.uid() or public.is_verified_doctor(doctor_id)
         or public.app_role() = 'admin');
create policy availability_write_own on public.doctor_availability for all to authenticated
  using (doctor_id = auth.uid() and public.is_verified_doctor(auth.uid()))
  with check (doctor_id = auth.uid() and public.is_verified_doctor(auth.uid()));

-- appointments: no INSERT grant at all (use book_appointment); update status only
grant select on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;

create policy appointments_select on public.appointments for select to authenticated
  using (patient_id = auth.uid() or doctor_id = auth.uid()
         or public.app_role() in ('admin', 'receptionist'));

create policy appointments_patient_cancel on public.appointments for update to authenticated
  using (patient_id = auth.uid() and status = 'booked')
  with check (patient_id = auth.uid() and status = 'cancelled');

create policy appointments_doctor_update on public.appointments for update to authenticated
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid() and status in ('completed', 'no_show', 'cancelled'));

-- audit_logs: only admins read; writes only via the server (service_role)
grant select on public.audit_logs to authenticated;
create policy audit_admin_read on public.audit_logs for select to authenticated
  using (public.app_role() = 'admin');

-- public views
grant select on public.doctor_directory to anon, authenticated;
grant select on public.public_profiles  to anon, authenticated;

-- reserved_handles / handle_history: no policies, no grants = server-only


-- ######################## PART 2 ########################
-- =====================================================================
-- Medionary — Phase 1b: hospitals, reception staff, reviews
-- Run ONCE, AFTER medionary_phase1.sql.
--
--  * hospitals are their own entity (separate from doctors)
--  * receptionist / hospital admin are per-HOSPITAL staff (hospital_staff),
--    no longer a global role -> a receptionist only sees ONE hospital's data
--  * a doctor can work at many hospitals (doctor_hospitals), each with its own schedule
--  * patient can book by themselves, or reception can book for a walk-in patient
--  * ratings: one review per COMPLETED appointment, written only via submit_review()
--  * emergency (ambulance/SOS) is NOT here: it gets its own tables in phase 2
-- =====================================================================

-- 0. allow HOS prefix for hospital codes --------------------------------
create or replace function public.generate_code(p_prefix text)
returns text language plpgsql volatile
set search_path = public, extensions as $$
declare
  r    bigint;
  body text;
begin
  if p_prefix not in ('PAT','DOC','ADM','REC','HOS') then
    raise exception 'invalid code prefix: %', p_prefix;
  end if;
  r    := ('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint & 9223372036854775807;
  body := (1000000000000 + (r % 9000000000000))::text;
  return p_prefix || body || public.verhoeff_check_digit(body)::text;
end $$;
revoke execute on function public.generate_code(text) from public, anon, authenticated;

-- 1. hospitals ------------------------------------------------------------
create type public.hospital_staff_role as enum ('hospital_admin', 'receptionist');

create table public.hospitals (
  id                  uuid primary key default gen_random_uuid(),
  hospital_code       text not null unique,
  slug                text not null unique,
  name                text not null,
  registration_number text,
  phone_e164          text,
  address             jsonb not null default '{}',
  city                text,
  state               text,
  country_code        text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  timezone            text not null default 'Asia/Kolkata',
  location            extensions.geography(Point, 4326),
  has_emergency       boolean not null default false,
  verification_status public.verification_status not null default 'pending',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint hospitals_code_format check (
    hospital_code ~ '^HOS[1-9][0-9]{12}[0-9]$' and public.verhoeff_valid(substr(hospital_code, 4))
  ),
  constraint hospitals_slug_format  check (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  constraint hospitals_phone_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create index hospitals_location_idx on public.hospitals using gist (location);
create index hospitals_city_idx     on public.hospitals (city) where verification_status = 'verified';

create trigger hospitals_updated_at before update on public.hospitals
  for each row execute function public.set_updated_at();

create or replace function public.hospitals_set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; n int := 0;
begin
  if new.hospital_code is null then
    loop
      c := public.generate_code('HOS');
      exit when not exists (select 1 from public.hospitals where hospital_code = c);
      n := n + 1;
      if n >= 5 then raise exception 'could not generate a unique hospital_code'; end if;
    end loop;
    new.hospital_code := c;
  end if;
  return new;
end $$;
create trigger hospitals_set_code before insert on public.hospitals
  for each row execute function public.hospitals_set_code();

-- 2. staff of a hospital (receptionist / hospital admin) ----------------
create table public.hospital_staff (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  user_id     uuid not null references public.profiles(id)  on delete cascade,
  staff_role  public.hospital_staff_role not null,
  staff_code  text not null unique,           -- ADM... or REC...
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (hospital_id, user_id),
  constraint staff_code_format check (
    staff_code ~ '^(ADM|REC)[1-9][0-9]{12}[0-9]$' and public.verhoeff_valid(substr(staff_code, 4))
  )
);
create index hospital_staff_user_idx on public.hospital_staff (user_id) where is_active;

create or replace function public.hospital_staff_set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; n int := 0; p text;
begin
  if new.staff_code is null then
    p := case new.staff_role when 'hospital_admin' then 'ADM' else 'REC' end;
    loop
      c := public.generate_code(p);
      exit when not exists (select 1 from public.hospital_staff where staff_code = c);
      n := n + 1;
      if n >= 5 then raise exception 'could not generate a unique staff_code'; end if;
    end loop;
    new.staff_code := c;
  end if;
  return new;
end $$;
create trigger hospital_staff_set_code before insert on public.hospital_staff
  for each row execute function public.hospital_staff_set_code();

-- 3. which doctor works at which hospital --------------------------------
create table public.doctor_hospitals (
  doctor_id   uuid not null references public.doctors(id)   on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  is_active   boolean not null default true,
  joined_at   timestamptz not null default now(),
  primary key (doctor_id, hospital_id)
);
create index doctor_hospitals_hospital_idx on public.doctor_hospitals (hospital_id) where is_active;

-- 4. helpers --------------------------------------------------------------
create or replace function public.my_staff_hospitals()
returns setof uuid language sql stable security definer set search_path = public as $$
  select hospital_id from public.hospital_staff
   where user_id = auth.uid() and is_active
$$;

create or replace function public.is_hospital_staff(p_hospital uuid, p_roles public.hospital_staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hospital_staff
     where hospital_id = p_hospital and user_id = auth.uid()
       and is_active and staff_role = any(p_roles))
$$;

-- 5. schedule + appointments become hospital-aware ------------------------
alter table public.doctor_availability
  add column hospital_id uuid references public.hospitals(id) on delete cascade;  -- null = independent/online
create index doctor_availability_hospital_idx on public.doctor_availability (hospital_id);

alter table public.appointments
  add column hospital_id uuid references public.hospitals(id),
  add column booked_by   uuid references public.profiles(id),
  add column source      text not null default 'app' check (source in ('app', 'reception'));
create index appointments_hospital_idx on public.appointments (hospital_id, starts_at);

-- INTERNAL: validates doctor/hospital/slot and returns slot length (minutes)
create or replace function public._slot_minutes(p_doctor uuid, p_hospital uuid, p_starts timestamptz)
returns smallint language plpgsql stable security definer set search_path = public as $$
declare
  v_tz    text;
  v_local timestamp;
  v_slot  smallint;
begin
  select timezone into v_tz from public.doctors
   where id = p_doctor and verification_status = 'verified';
  if v_tz is null then
    raise exception 'doctor not available';
  end if;

  if p_hospital is not null then
    select h.timezone into v_tz
      from public.hospitals h
      join public.doctor_hospitals dh on dh.hospital_id = h.id
     where h.id = p_hospital and h.is_active and h.verification_status = 'verified'
       and dh.doctor_id = p_doctor and dh.is_active;
    if v_tz is null then
      raise exception 'doctor does not work at this hospital';
    end if;
  end if;

  v_local := p_starts at time zone v_tz;

  select a.slot_minutes into v_slot
    from public.doctor_availability a
   where a.doctor_id = p_doctor
     and a.hospital_id is not distinct from p_hospital
     and a.weekday = extract(dow from v_local)::smallint
     and v_local::time >= a.start_time
     and (v_local::time - a.start_time) + make_interval(mins => a.slot_minutes)
           <= (a.end_time - a.start_time)
     and extract(epoch from (v_local::time - a.start_time)) % (a.slot_minutes * 60) = 0
   limit 1;

  if v_slot is null then
    raise exception 'slot not available';
  end if;
  return v_slot;
end $$;
revoke execute on function public._slot_minutes(uuid, uuid, timestamptz) from public, anon, authenticated;

-- patient books for THEMSELVES (optionally at a hospital)
drop function public.book_appointment(uuid, timestamptz, text);
create or replace function public.book_appointment(
  p_doctor uuid, p_starts timestamptz, p_reason text default null, p_hospital uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_slot smallint; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_starts <= now()   then raise exception 'appointment must be in the future'; end if;

  v_slot := public._slot_minutes(p_doctor, p_hospital, p_starts);

  insert into public.appointments
    (patient_id, doctor_id, hospital_id, starts_at, ends_at, reason, booked_by, source)
  values
    (auth.uid(), p_doctor, p_hospital, p_starts, p_starts + make_interval(mins => v_slot),
     p_reason, auth.uid(), 'app')
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then raise exception 'slot already booked';
end $$;
revoke execute on function public.book_appointment(uuid, timestamptz, text, uuid) from public, anon;
grant  execute on function public.book_appointment(uuid, timestamptz, text, uuid) to authenticated;

-- reception books FOR a patient (walk-in / phone call)
create or replace function public.reception_book_appointment(
  p_hospital uuid, p_patient uuid, p_doctor uuid, p_starts timestamptz, p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_slot smallint; v_id uuid;
begin
  if not public.is_hospital_staff(p_hospital, array['receptionist','hospital_admin']::public.hospital_staff_role[]) then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from public.profiles where id = p_patient) then
    raise exception 'patient not found';
  end if;
  if p_starts <= now() then raise exception 'appointment must be in the future'; end if;

  v_slot := public._slot_minutes(p_doctor, p_hospital, p_starts);

  insert into public.appointments
    (patient_id, doctor_id, hospital_id, starts_at, ends_at, reason, booked_by, source)
  values
    (p_patient, p_doctor, p_hospital, p_starts, p_starts + make_interval(mins => v_slot),
     p_reason, auth.uid(), 'reception')
  returning id into v_id;

  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, meta)
  values (auth.uid(), 'receptionist', 'RECEPTION_BOOK', 'appointment', v_id::text,
          jsonb_build_object('hospital_id', p_hospital, 'patient_id', p_patient, 'doctor_id', p_doctor));
  return v_id;
exception
  when exclusion_violation then raise exception 'slot already booked';
end $$;
revoke execute on function public.reception_book_appointment(uuid, uuid, uuid, timestamptz, text) from public, anon;
grant  execute on function public.reception_book_appointment(uuid, uuid, uuid, timestamptz, text) to authenticated;

-- reception finds a patient by EXACT user_code only (no browsing / no phone search); audited
create or replace function public.reception_find_patient(p_hospital uuid, p_user_code text)
returns table (id uuid, user_code text, full_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hospital_staff(p_hospital, array['receptionist','hospital_admin']::public.hospital_staff_role[]) then
    raise exception 'not allowed';
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, meta)
  values (auth.uid(), 'receptionist', 'RECEPTION_FIND_PATIENT', 'patient',
          upper(regexp_replace(coalesce(p_user_code, ''), '[-\s]', '', 'g')),
          jsonb_build_object('hospital_id', p_hospital));
  return query
    select p.id, p.user_code, p.full_name from public.profiles p
     where p.user_code = upper(regexp_replace(coalesce(p_user_code, ''), '[-\s]', '', 'g'));
end $$;
revoke execute on function public.reception_find_patient(uuid, text) from public, anon;
grant  execute on function public.reception_find_patient(uuid, text) to authenticated;

-- 6. reviews / ratings -----------------------------------------------------
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),  -- one review per visit
  patient_id     uuid not null references public.profiles(id),
  doctor_id      uuid not null references public.doctors(id),
  hospital_id    uuid references public.hospitals(id),
  rating         smallint not null check (rating between 1 and 5),
  comment        text check (char_length(comment) <= 1000),
  is_hidden      boolean not null default false,   -- moderation (server-only)
  created_at     timestamptz not null default now()
);
create index reviews_doctor_idx   on public.reviews (doctor_id)   where not is_hidden;
create index reviews_hospital_idx on public.reviews (hospital_id) where not is_hidden;

create or replace function public.submit_review(
  p_appointment uuid, p_rating smallint, p_comment text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into a from public.appointments
   where id = p_appointment and patient_id = auth.uid() and status = 'completed';
  if not found then
    raise exception 'only a completed appointment of yours can be reviewed';
  end if;
  insert into public.reviews (appointment_id, patient_id, doctor_id, hospital_id, rating, comment)
  values (a.id, a.patient_id, a.doctor_id, a.hospital_id, p_rating, nullif(btrim(p_comment), ''))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then raise exception 'you already reviewed this appointment';
end $$;
revoke execute on function public.submit_review(uuid, smallint, text) from public, anon;
grant  execute on function public.submit_review(uuid, smallint, text) to authenticated;

-- 7. public views (safe columns only; rebuilt to include ratings) -------------
drop view public.doctor_directory;
create view public.doctor_directory as
  select d.id, d.doctor_code, p.handle, p.full_name, d.specialty, d.experience_years,
         d.fee_minor, d.fee_currency, d.timezone, d.bio, d.location,
         coalesce(r.avg_rating, 0)   as avg_rating,
         coalesce(r.review_count, 0) as review_count
    from public.doctors d
    join public.profiles p on p.id = d.id
    left join (select doctor_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count
                 from public.reviews where not is_hidden group by doctor_id) r on r.doctor_id = d.id
   where d.verification_status = 'verified';

create view public.hospital_directory as
  select h.id, h.hospital_code, h.slug, h.name, h.city, h.state, h.country_code,
         h.phone_e164, h.has_emergency, h.location,
         coalesce(r.avg_rating, 0)   as avg_rating,
         coalesce(r.review_count, 0) as review_count
    from public.hospitals h
    left join (select hospital_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count
                 from public.reviews where not is_hidden and hospital_id is not null
                group by hospital_id) r on r.hospital_id = h.id
   where h.verification_status = 'verified' and h.is_active;

create view public.hospital_doctors as
  select dh.hospital_id, dh.doctor_id
    from public.doctor_hospitals dh
    join public.hospitals h on h.id = dh.hospital_id
    join public.doctors   d on d.id = dh.doctor_id
   where dh.is_active and h.is_active and h.verification_status = 'verified'
     and d.verification_status = 'verified';

create view public.public_reviews as      -- no patient identity on purpose
  select doctor_id, hospital_id, rating, comment, created_at
    from public.reviews where not is_hidden;

-- 8. security --------------------------------------------------------------
alter table public.hospitals        enable row level security;
alter table public.hospital_staff   enable row level security;
alter table public.doctor_hospitals enable row level security;
alter table public.reviews          enable row level security;

revoke all on public.hospitals, public.hospital_staff, public.doctor_hospitals, public.reviews,
              public.doctor_directory, public.hospital_directory,
              public.hospital_doctors, public.public_reviews
  from anon, authenticated;

-- hospitals: staff read their own hospital; hospital_admin edits contact info only
grant select on public.hospitals to authenticated;
grant update (phone_e164, address, city, state, location, has_emergency) on public.hospitals to authenticated;
create policy hospitals_select on public.hospitals for select to authenticated
  using (id in (select public.my_staff_hospitals()) or public.app_role() = 'admin');
create policy hospitals_update_admin on public.hospitals for update to authenticated
  using (public.is_hospital_staff(id, array['hospital_admin']::public.hospital_staff_role[]))
  with check (public.is_hospital_staff(id, array['hospital_admin']::public.hospital_staff_role[]));

-- hospital_staff / doctor_hospitals: reads only; all writes by the server (service_role)
grant select on public.hospital_staff to authenticated;
create policy hospital_staff_select on public.hospital_staff for select to authenticated
  using (user_id = auth.uid()
         or public.is_hospital_staff(hospital_id, array['hospital_admin']::public.hospital_staff_role[])
         or public.app_role() = 'admin');

grant select on public.doctor_hospitals to authenticated;
create policy doctor_hospitals_select on public.doctor_hospitals for select to authenticated
  using (doctor_id = auth.uid()
         or hospital_id in (select public.my_staff_hospitals())
         or public.app_role() = 'admin');

-- reviews: no insert/update/delete grants (submit_review + server moderation only)
grant select on public.reviews to authenticated;
create policy reviews_select on public.reviews for select to authenticated
  using (patient_id = auth.uid() or doctor_id = auth.uid()
         or hospital_id in (select public.my_staff_hospitals())
         or public.app_role() = 'admin');

-- replace the phase-1 policies that treated 'receptionist' as a GLOBAL role
drop policy profiles_select           on public.profiles;
drop policy appointments_select       on public.appointments;
drop policy availability_select       on public.doctor_availability;
drop policy availability_write_own    on public.doctor_availability;
drop policy appointments_doctor_update on public.appointments;

-- a doctor can mark "completed"/"no_show" only AFTER the appointment started
-- (stops fake "completed" visits that would unlock fake reviews)
create policy appointments_doctor_update on public.appointments for update to authenticated
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid()
              and (status = 'cancelled'
                   or (status in ('completed', 'no_show') and starts_at <= now())));

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.app_role() = 'admin'
    or exists (select 1 from public.appointments a
               where a.patient_id = profiles.id
                 and (a.doctor_id = auth.uid()
                      or a.hospital_id in (select public.my_staff_hospitals())))
  );

create policy appointments_select on public.appointments for select to authenticated
  using (patient_id = auth.uid() or doctor_id = auth.uid()
         or public.app_role() = 'admin'
         or hospital_id in (select public.my_staff_hospitals()));

-- reception may only cancel / mark no-show for their own hospital
create policy appointments_staff_update on public.appointments for update to authenticated
  using (hospital_id in (select public.my_staff_hospitals()))
  with check (hospital_id in (select public.my_staff_hospitals())
              and status in ('cancelled', 'no_show'));

create policy availability_select on public.doctor_availability for select to authenticated
  using (doctor_id = auth.uid() or public.is_verified_doctor(doctor_id)
         or public.app_role() = 'admin');

create policy availability_write_own on public.doctor_availability for all to authenticated
  using (doctor_id = auth.uid() and public.is_verified_doctor(auth.uid()))
  with check (
    doctor_id = auth.uid() and public.is_verified_doctor(auth.uid())
    and (hospital_id is null
         or exists (select 1 from public.doctor_hospitals dh
                    where dh.doctor_id = auth.uid()
                      and dh.hospital_id = doctor_availability.hospital_id and dh.is_active))
  );

-- public views
grant select on public.doctor_directory, public.hospital_directory,
                public.hospital_doctors, public.public_reviews
  to anon, authenticated;


-- ######################## PART 3 ########################
-- =====================================================================
-- Medionary — Phase 1c: family members (dependents), doctor leave, free-slot list
-- Run ONCE, AFTER medionary_phase1.sql and medionary_phase1b_hospitals.sql.
--
--  * one account can book for family (parent/child/spouse...) -> family_members
--    The appointment still belongs to the ACCOUNT HOLDER (patient_id = guardian),
--    so every existing security rule keeps working; family_member_id says "for whom".
--  * doctor_time_off: leave/absence. Booking is refused during leave, and a doctor
--    cannot add leave on top of already-booked appointments.
--  * available_slots(): what the booking screen needs to list free times.
-- =====================================================================

-- 1. family_members ---------------------------------------------------------
create table public.family_members (
  id           uuid primary key default gen_random_uuid(),
  guardian_id  uuid not null references public.profiles(id) on delete cascade,
  member_code  text not null unique,              -- PAT... (own code, like a patient)
  full_name    text not null check (char_length(btrim(full_name)) between 1 and 100),
  relationship text not null
               check (relationship in ('spouse','child','parent','sibling','other')),
  birth_year   smallint check (birth_year between 1900 and 2100),  -- year only (less sensitive than full DOB)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint family_member_code_format check (
    member_code ~ '^PAT[1-9][0-9]{12}[0-9]$' and public.verhoeff_valid(substr(member_code, 4))
  )
);
create index family_members_guardian_idx on public.family_members (guardian_id) where is_active;

create trigger family_members_updated_at before update on public.family_members
  for each row execute function public.set_updated_at();

-- code must be unique across BOTH profiles.user_code and family_members.member_code
create or replace function public.family_members_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; n int := 0; v_count int;
begin
  if tg_op = 'INSERT' then
    select count(*) into v_count from public.family_members
     where guardian_id = new.guardian_id and is_active;
    if v_count >= 10 then
      raise exception 'maximum 10 active family members per account';
    end if;
    if new.member_code is null then
      loop
        c := public.generate_code('PAT');
        exit when not exists (select 1 from public.profiles       where user_code   = c)
              and not exists (select 1 from public.family_members where member_code = c);
        n := n + 1;
        if n >= 5 then raise exception 'could not generate a unique member_code'; end if;
      end loop;
      new.member_code := c;
    end if;
  end if;
  return new;
end $$;
create trigger family_members_before_write before insert on public.family_members
  for each row execute function public.family_members_before_write();

-- appointments: "for whom"
alter table public.appointments
  add column family_member_id uuid references public.family_members(id);
create index appointments_family_idx on public.appointments (family_member_id);

-- a parent may book two children at the same time with different doctors:
-- the overlap rule now applies per PERSON (dependent if any, else the account holder)
alter table public.appointments drop constraint appointments_no_patient_overlap;
alter table public.appointments add constraint appointments_no_patient_overlap exclude using gist (
  (coalesce(family_member_id, patient_id)) with =, tstzrange(starts_at, ends_at) with &&
) where (status = 'booked');

-- 2. doctor_time_off --------------------------------------------------------
create table public.doctor_time_off (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references public.doctors(id) on delete cascade,
  hospital_id uuid references public.hospitals(id) on delete cascade,  -- null = everywhere
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text check (char_length(reason) <= 200),                 -- private note
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index doctor_time_off_doctor_idx on public.doctor_time_off (doctor_id, starts_at);

-- refuse leave that sits on top of already-booked appointments
create or replace function public.doctor_time_off_no_conflict()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  select count(*) into v_count
    from public.appointments ap
   where ap.doctor_id = new.doctor_id
     and ap.status = 'booked'
     and tstzrange(ap.starts_at, ap.ends_at) && tstzrange(new.starts_at, new.ends_at)
     and (new.hospital_id is null or ap.hospital_id = new.hospital_id);
  if v_count > 0 then
    raise exception '% booked appointment(s) overlap this leave; cancel or reschedule them first', v_count;
  end if;
  return new;
end $$;
create trigger doctor_time_off_no_conflict before insert or update on public.doctor_time_off
  for each row execute function public.doctor_time_off_no_conflict();

-- 3. slot validation now also respects leave ---------------------------------
create or replace function public._slot_minutes(p_doctor uuid, p_hospital uuid, p_starts timestamptz)
returns smallint language plpgsql stable security definer set search_path = public as $$
declare
  v_tz    text;
  v_local timestamp;
  v_slot  smallint;
begin
  select timezone into v_tz from public.doctors
   where id = p_doctor and verification_status = 'verified';
  if v_tz is null then
    raise exception 'doctor not available';
  end if;

  if p_hospital is not null then
    select h.timezone into v_tz
      from public.hospitals h
      join public.doctor_hospitals dh on dh.hospital_id = h.id
     where h.id = p_hospital and h.is_active and h.verification_status = 'verified'
       and dh.doctor_id = p_doctor and dh.is_active;
    if v_tz is null then
      raise exception 'doctor does not work at this hospital';
    end if;
  end if;

  v_local := p_starts at time zone v_tz;

  select a.slot_minutes into v_slot
    from public.doctor_availability a
   where a.doctor_id = p_doctor
     and a.hospital_id is not distinct from p_hospital
     and a.weekday = extract(dow from v_local)::smallint
     and v_local::time >= a.start_time
     and (v_local::time - a.start_time) + make_interval(mins => a.slot_minutes)
           <= (a.end_time - a.start_time)
     and extract(epoch from (v_local::time - a.start_time)) % (a.slot_minutes * 60) = 0
   limit 1;

  if v_slot is null then
    raise exception 'slot not available';
  end if;

  if exists (select 1 from public.doctor_time_off t
              where t.doctor_id = p_doctor
                and (t.hospital_id is null or t.hospital_id = p_hospital)
                and tstzrange(t.starts_at, t.ends_at)
                    && tstzrange(p_starts, p_starts + make_interval(mins => v_slot))) then
    raise exception 'doctor is on leave';
  end if;

  return v_slot;
end $$;

-- 4. booking functions now accept an optional family member -------------------
drop function public.book_appointment(uuid, timestamptz, text, uuid);
create or replace function public.book_appointment(
  p_doctor uuid, p_starts timestamptz, p_reason text default null,
  p_hospital uuid default null, p_family_member uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_slot smallint; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_starts <= now()   then raise exception 'appointment must be in the future'; end if;

  if p_family_member is not null and not exists (
       select 1 from public.family_members
        where id = p_family_member and guardian_id = auth.uid() and is_active) then
    raise exception 'family member not found';
  end if;

  v_slot := public._slot_minutes(p_doctor, p_hospital, p_starts);

  insert into public.appointments
    (patient_id, family_member_id, doctor_id, hospital_id, starts_at, ends_at,
     reason, booked_by, source)
  values
    (auth.uid(), p_family_member, p_doctor, p_hospital, p_starts,
     p_starts + make_interval(mins => v_slot), p_reason, auth.uid(), 'app')
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then raise exception 'slot already booked';
end $$;
revoke execute on function public.book_appointment(uuid, timestamptz, text, uuid, uuid) from public, anon;
grant  execute on function public.book_appointment(uuid, timestamptz, text, uuid, uuid) to authenticated;

drop function public.reception_book_appointment(uuid, uuid, uuid, timestamptz, text);
create or replace function public.reception_book_appointment(
  p_hospital uuid, p_patient uuid, p_doctor uuid, p_starts timestamptz,
  p_reason text default null, p_family_member uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_slot smallint; v_id uuid;
begin
  if not public.is_hospital_staff(p_hospital, array['receptionist','hospital_admin']::public.hospital_staff_role[]) then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from public.profiles where id = p_patient) then
    raise exception 'patient not found';
  end if;
  if p_family_member is not null and not exists (
       select 1 from public.family_members
        where id = p_family_member and guardian_id = p_patient and is_active) then
    raise exception 'family member not found';
  end if;
  if p_starts <= now() then raise exception 'appointment must be in the future'; end if;

  v_slot := public._slot_minutes(p_doctor, p_hospital, p_starts);

  insert into public.appointments
    (patient_id, family_member_id, doctor_id, hospital_id, starts_at, ends_at,
     reason, booked_by, source)
  values
    (p_patient, p_family_member, p_doctor, p_hospital, p_starts,
     p_starts + make_interval(mins => v_slot), p_reason, auth.uid(), 'reception')
  returning id into v_id;

  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, meta)
  values (auth.uid(), 'receptionist', 'RECEPTION_BOOK', 'appointment', v_id::text,
          jsonb_build_object('hospital_id', p_hospital, 'patient_id', p_patient,
                             'family_member_id', p_family_member, 'doctor_id', p_doctor));
  return v_id;
exception
  when exclusion_violation then raise exception 'slot already booked';
end $$;
revoke execute on function public.reception_book_appointment(uuid, uuid, uuid, timestamptz, text, uuid) from public, anon;
grant  execute on function public.reception_book_appointment(uuid, uuid, uuid, timestamptz, text, uuid) to authenticated;

-- reception search now also understands a family member's own code
drop function public.reception_find_patient(uuid, text);
create or replace function public.reception_find_patient(p_hospital uuid, p_user_code text)
returns table (id uuid, user_code text, full_name text, family_member_id uuid, family_member_name text)
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_user_code, ''), '[-\s]', '', 'g'));
begin
  if not public.is_hospital_staff(p_hospital, array['receptionist','hospital_admin']::public.hospital_staff_role[]) then
    raise exception 'not allowed';
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, meta)
  values (auth.uid(), 'receptionist', 'RECEPTION_FIND_PATIENT', 'patient', v_code,
          jsonb_build_object('hospital_id', p_hospital));

  return query
    select p.id, p.user_code, p.full_name, null::uuid, null::text
      from public.profiles p where p.user_code = v_code
    union all
    select p.id, p.user_code, p.full_name, f.id, f.full_name
      from public.family_members f
      join public.profiles p on p.id = f.guardian_id
     where f.member_code = v_code and f.is_active;
end $$;
revoke execute on function public.reception_find_patient(uuid, text) from public, anon;
grant  execute on function public.reception_find_patient(uuid, text) to authenticated;

-- 5. free slots for the booking screen -----------------------------------------
create or replace function public.available_slots(p_doctor uuid, p_hospital uuid, p_date date)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  select d.timezone into v_tz from public.doctors d
   where d.id = p_doctor and d.verification_status = 'verified';
  if v_tz is null then return; end if;

  if p_hospital is not null then
    select h.timezone into v_tz
      from public.hospitals h
      join public.doctor_hospitals dh on dh.hospital_id = h.id
     where h.id = p_hospital and h.is_active and h.verification_status = 'verified'
       and dh.doctor_id = p_doctor and dh.is_active;
    if v_tz is null then return; end if;
  end if;

  return query
    select s.st, s.st + make_interval(mins => a.slot_minutes)
      from public.doctor_availability a
     cross join lateral generate_series(
            (p_date + a.start_time) at time zone v_tz,
            ((p_date + a.end_time)  at time zone v_tz) - make_interval(mins => a.slot_minutes),
            make_interval(mins => a.slot_minutes)) as s(st)
     where a.doctor_id = p_doctor
       and a.hospital_id is not distinct from p_hospital
       and a.weekday = extract(dow from p_date)::smallint
       and s.st > now()
       and not exists (select 1 from public.appointments ap
                        where ap.doctor_id = p_doctor and ap.status = 'booked'
                          and tstzrange(ap.starts_at, ap.ends_at)
                              && tstzrange(s.st, s.st + make_interval(mins => a.slot_minutes)))
       and not exists (select 1 from public.doctor_time_off t
                        where t.doctor_id = p_doctor
                          and (t.hospital_id is null or t.hospital_id = p_hospital)
                          and tstzrange(t.starts_at, t.ends_at)
                              && tstzrange(s.st, s.st + make_interval(mins => a.slot_minutes)))
     order by 1;
end $$;
revoke execute on function public.available_slots(uuid, uuid, date) from public, anon;
grant  execute on function public.available_slots(uuid, uuid, date) to authenticated;

-- 6. security -------------------------------------------------------------------
alter table public.family_members enable row level security;
alter table public.doctor_time_off enable row level security;
revoke all on public.family_members, public.doctor_time_off from anon, authenticated;

-- family_members: account holder manages their own; doctor / hospital staff can read
-- only the members that appear in THEIR appointments. No DELETE: set is_active=false
-- (keeps appointment history intact).
grant select on public.family_members to authenticated;
grant insert (guardian_id, full_name, relationship, birth_year) on public.family_members to authenticated;
grant update (full_name, relationship, birth_year, is_active)   on public.family_members to authenticated;

create policy family_select on public.family_members for select to authenticated
  using (
    guardian_id = auth.uid()
    or public.app_role() = 'admin'
    or exists (select 1 from public.appointments a
               where a.family_member_id = family_members.id
                 and (a.doctor_id = auth.uid()
                      or a.hospital_id in (select public.my_staff_hospitals())))
  );
create policy family_insert on public.family_members for insert to authenticated
  with check (guardian_id = auth.uid());
create policy family_update on public.family_members for update to authenticated
  using (guardian_id = auth.uid()) with check (guardian_id = auth.uid());

-- doctor_time_off: the doctor manages their own; hospital admin may read hospital-specific leave
grant select, insert, update, delete on public.doctor_time_off to authenticated;
create policy time_off_select on public.doctor_time_off for select to authenticated
  using (doctor_id = auth.uid()
         or public.app_role() = 'admin'
         or (hospital_id is not null
             and public.is_hospital_staff(hospital_id, array['hospital_admin']::public.hospital_staff_role[])));
create policy time_off_write_own on public.doctor_time_off for all to authenticated
  using (doctor_id = auth.uid() and public.is_verified_doctor(auth.uid()))
  with check (
    doctor_id = auth.uid() and public.is_verified_doctor(auth.uid())
    and (hospital_id is null
         or exists (select 1 from public.doctor_hospitals dh
                    where dh.doctor_id = auth.uid()
                      and dh.hospital_id = doctor_time_off.hospital_id and dh.is_active))
  );