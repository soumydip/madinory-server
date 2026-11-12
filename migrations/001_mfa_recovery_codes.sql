create table public.mfa_recovery_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code_hash     text not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index mfa_recovery_codes_active_idx
  on public.mfa_recovery_codes (user_id, code_hash)
  where consumed_at is null;

alter table public.mfa_recovery_codes enable row level security;

revoke all on public.mfa_recovery_codes from anon, authenticated;
grant select, insert, update on public.mfa_recovery_codes to authenticated;

create policy mfa_recovery_codes_own on public.mfa_recovery_codes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
