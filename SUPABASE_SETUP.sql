-- Run in Supabase SQL Editor AFTER enabling Data API and automatic RLS.
-- Keep automatic exposure of new tables DISABLED.
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon;
grant select on public.site_admins to authenticated;
create policy "Admins can see own membership" on public.site_admins for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_bright_moments_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.site_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_bright_moments_admin() from public;
grant execute on function public.is_bright_moments_admin() to authenticated;

create table if not exists public.gallery_images (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(title) between 1 and 160),
 section text not null check (section in ('gallery','store')),
 category text not null check (category in ('art','coasters','mirrors','jewelry')),
 file_path text not null unique,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.gallery_images enable row level security;
grant select on public.gallery_images to anon, authenticated;
grant insert, update, delete on public.gallery_images to authenticated;
create policy "Public can read images" on public.gallery_images for select to anon, authenticated using (true);
create policy "Only admins can insert images" on public.gallery_images for insert to authenticated with check ((select public.is_bright_moments_admin()));
create policy "Only admins can update images" on public.gallery_images for update to authenticated using ((select public.is_bright_moments_admin())) with check ((select public.is_bright_moments_admin()));
create policy "Only admins can delete images" on public.gallery_images for delete to authenticated using ((select public.is_bright_moments_admin()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('bright-moments-images','bright-moments-images',true,10485760,array['image/jpeg','image/webp','image/png'])
on conflict (id) do update set public=true, file_size_limit=10485760, allowed_mime_types=array['image/jpeg','image/webp','image/png'];

create policy "Public can view published gallery images" on storage.objects for select to anon, authenticated using (bucket_id = 'bright-moments-images');
create policy "Only admins may upload gallery images" on storage.objects for insert to authenticated with check (bucket_id = 'bright-moments-images' and (select public.is_bright_moments_admin()));
create policy "Only admins may update gallery images" on storage.objects for update to authenticated using (bucket_id = 'bright-moments-images' and (select public.is_bright_moments_admin())) with check (bucket_id = 'bright-moments-images' and (select public.is_bright_moments_admin()));
create policy "Only admins may delete gallery images" on storage.objects for delete to authenticated using (bucket_id = 'bright-moments-images' and (select public.is_bright_moments_admin()));

-- In Authentication -> Users create/invite ONE owner user with an email you control.
-- Look up their UUID in Authentication -> Users, then run:
-- insert into public.site_admins(user_id) values ('OWNER-UUID-HERE');
-- In Authentication -> URL Configuration:
-- Site URL: https://sdot61.github.io/bright-moments/
-- Redirect URL: https://sdot61.github.io/bright-moments/admin.html
-- Disable public signups; enable email confirmation and CAPTCHA for sign-in.
-- Enable MFA for the owner's account and set an appropriate session lifetime.
-- Configure SMTP for reliable production password recovery emails.
-- IMPORTANT: Never put a service_role key, database password, or user password in web files.
