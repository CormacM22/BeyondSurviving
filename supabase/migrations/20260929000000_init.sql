-- Initial schema for the Beyond Surviving dashboard.
--
-- Users come from Supabase Auth (auth.users). Access is controlled by roles and
-- permissions rather than "is this the one admin", so a second board member can later
-- be given a narrower role without restructuring anything.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

create table public.roles (
  id   text primary key,
  name text not null
);

create table public.permissions (
  id          text primary key,
  description text not null
);

create table public.role_permissions (
  role_id       text not null references public.roles (id) on delete cascade,
  permission_id text not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id text not null references public.roles (id) on delete cascade,
  primary key (user_id, role_id)
);

insert into public.roles (id, name) values
  ('admin', 'Administrator');

insert into public.permissions (id, description) values
  ('events.manage', 'Create, edit, publish and cancel events');

insert into public.role_permissions (role_id, permission_id) values
  ('admin', 'events.manage');

-- True if the signed-in user holds a role that grants the given permission.
create function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid()
      and rp.permission_id = permission
  );
$$;

-- ---------------------------------------------------------------------------
-- Events
--
-- This table is the single source of truth for an event. Eventbrite and WordPress
-- are copies of it, tracked in event_publications.
-- ---------------------------------------------------------------------------

create type public.event_status as enum ('draft', 'published', 'cancelled');

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(trim(title)) > 0),
  summary          text check (char_length(summary) <= 140),
  description      text not null check (char_length(trim(description)) > 0),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  timezone         text not null default 'Europe/Dublin',
  is_online        boolean not null default false,
  -- Area shown on listings, e.g. "Mayo".
  public_area      text,
  -- Full venue details, for the organiser's own records.
  venue_name       text,
  venue_address    text,
  capacity         integer not null check (capacity > 0),
  category         text not null
                   check (category in ('support_group', 'community_event', 'fundraiser')),
  cover_image_path text,
  status           public.event_status not null default 'draft',
  created_by       uuid references auth.users (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (ends_at > starts_at),
  check (is_online or (public_area is not null and venue_address is not null))
);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Publications: one row per event per destination.
--
-- The primary key guarantees at most one Eventbrite copy and one WordPress copy
-- per event. Once external_id is set, retries update that copy instead of
-- creating a duplicate.
-- ---------------------------------------------------------------------------

create type public.publication_target as enum ('eventbrite', 'wordpress');

create type public.publication_status as enum ('not_started', 'draft', 'live', 'cancelled');

create table public.event_publications (
  event_id     uuid not null references public.events (id) on delete cascade,
  target       public.publication_target not null,
  external_id  text,
  external_url text,
  status       public.publication_status not null default 'not_started',
  -- Last failure message, cleared on the next success.
  last_error   text,
  updated_at   timestamptz not null default now(),
  primary key (event_id, target)
);

create trigger event_publications_set_updated_at
  before update on public.event_publications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Nothing is readable or writable without an explicit policy. Events are never
-- hard-deleted from the app (there is no delete policy); they are cancelled.
-- Publication rows are written only by the server-side functions, which use the
-- service role and bypass these policies.
-- ---------------------------------------------------------------------------

alter table public.roles              enable row level security;
alter table public.permissions        enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.user_roles         enable row level security;
alter table public.events             enable row level security;
alter table public.event_publications enable row level security;

create policy "signed-in users can read roles"
  on public.roles for select to authenticated using (true);

create policy "signed-in users can read permissions"
  on public.permissions for select to authenticated using (true);

create policy "signed-in users can read role permissions"
  on public.role_permissions for select to authenticated using (true);

create policy "users can read their own roles"
  on public.user_roles for select to authenticated using (user_id = auth.uid());

create policy "event managers can read events"
  on public.events for select to authenticated
  using (public.has_permission('events.manage'));

create policy "event managers can create events"
  on public.events for insert to authenticated
  with check (public.has_permission('events.manage'));

create policy "event managers can update events"
  on public.events for update to authenticated
  using (public.has_permission('events.manage'))
  with check (public.has_permission('events.manage'));

create policy "event managers can read publications"
  on public.event_publications for select to authenticated
  using (public.has_permission('events.manage'));

-- ---------------------------------------------------------------------------
-- Cover images: a private bucket. The server-side functions read from it to
-- upload images to Eventbrite and WordPress.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('event-covers', 'event-covers', false);

create policy "event managers can read cover images"
  on storage.objects for select to authenticated
  using (bucket_id = 'event-covers' and public.has_permission('events.manage'));

create policy "event managers can upload cover images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-covers' and public.has_permission('events.manage'));

create policy "event managers can replace cover images"
  on storage.objects for update to authenticated
  using (bucket_id = 'event-covers' and public.has_permission('events.manage'));
