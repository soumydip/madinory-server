
create type public.hospital_application_status as enum ('pending', 'approved', 'rejected');

create table public.hospital_registration_applications (
  id                  uuid primary key default gen_random_uuid(),
  applicant_user_id   uuid not null references public.profiles(id) on delete cascade,
  hospital_name       text not null check (char_length(hospital_name) between 2 and 160),
  registration_number text,
  phone_e164          text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  address             text not null check (char_length(address) between 5 and 500),
  city                text not null check (char_length(city) between 2 and 100),
  state               text not null check (char_length(state) between 2 and 100),
  country_code        text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  status              public.hospital_application_status not null default 'pending',
  reviewed_by         uuid references public.profiles(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index hospital_registration_applications_applicant_idx
  on public.hospital_registration_applications (applicant_user_id, created_at desc);

create unique index hospital_registration_applications_one_pending_idx
  on public.hospital_registration_applications (applicant_user_id)
  where status = 'pending';

create trigger hospital_registration_applications_updated_at
before update on public.hospital_registration_applications
for each row execute function public.set_updated_at();

alter table public.hospital_registration_applications enable row level security;

grant select, insert on public.hospital_registration_applications to authenticated;

create policy hospital_application_insert_own
on public.hospital_registration_applications
for insert to authenticated
with check (applicant_user_id = auth.uid());

create policy hospital_application_select_own_or_admin
on public.hospital_registration_applications
for select to authenticated
using (applicant_user_id = auth.uid() or public.app_role() = 'admin');
