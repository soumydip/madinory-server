-- Remove the deprecated profile handle feature.

drop view if exists public.public_profiles;
drop view if exists public.doctor_directory;

drop trigger if exists profiles_handle_guard on public.profiles;
drop function if exists public.profiles_handle_guard();

alter table public.profiles
  drop constraint if exists profiles_handle_format,
  drop column if exists handle;

drop table if exists public.handle_history;
drop table if exists public.reserved_handles;

create view public.doctor_directory as
  select d.id, d.doctor_code, p.full_name, d.specialty, d.experience_years,
         d.fee_minor, d.fee_currency, d.timezone, d.bio, d.location,
         coalesce(r.avg_rating, 0) as avg_rating,
         coalesce(r.review_count, 0) as review_count
    from public.doctors d
    join public.profiles p on p.id = d.id
    left join (
      select doctor_id, round(avg(rating)::numeric, 2) as avg_rating,
             count(*) as review_count
        from public.reviews
       where not is_hidden
       group by doctor_id
    ) r on r.doctor_id = d.id
   where d.verification_status = 'verified';

revoke all on public.doctor_directory from anon, authenticated;
grant select on public.doctor_directory to anon, authenticated;

grant update (full_name, phone_e164, is_public) on public.profiles to authenticated;
