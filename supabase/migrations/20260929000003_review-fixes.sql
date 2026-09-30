-- Fixes from the independent review of Eventbrite publishing.

-- 1. An explicit "a person must check Eventbrite" flag, instead of the app
--    guessing it from other columns. Set when a first save stops at a point
--    where Eventbrite may already have created the event. Only cleared by the
--    "I've checked" action or a successful save.
alter table public.event_publications
  add column needs_check boolean not null default false;

create or replace function public.claim_publication(p_event_id uuid, p_target public.publication_target)
returns table (outcome text, external_id text, external_url text,
               status public.publication_status, meta jsonb)
language plpgsql
set search_path = ''
as $$
declare
  r public.event_publications;
begin
  insert into public.event_publications (event_id, target)
  values (p_event_id, p_target)
  on conflict do nothing;

  select * into r
  from public.event_publications p
  where p.event_id = p_event_id and p.target = p_target
  for update;

  if r.needs_check then
    return query select 'needs_check'::text, null::text, null::text, null::public.publication_status, null::jsonb;
    return;
  end if;

  if r.in_progress_since is not null and r.in_progress_since > now() - interval '5 minutes' then
    return query select 'busy'::text, null::text, null::text, null::public.publication_status, null::jsonb;
    return;
  end if;

  -- A save that stopped before recording the destination's id: it may exist there.
  if r.in_progress_since is not null and r.external_id is null then
    update public.event_publications p
    set needs_check = true,
        last_error = 'Eventbrite may have created this event, but the dashboard couldn’t confirm it. '
                  || 'Please check Eventbrite for a duplicate draft before trying again.'
    where p.event_id = p_event_id and p.target = p_target;
    return query select 'needs_check'::text, null::text, null::text, null::public.publication_status, null::jsonb;
    return;
  end if;

  update public.event_publications p
  set in_progress_since = now()
  where p.event_id = p_event_id and p.target = p_target;

  return query select 'claimed'::text, r.external_id, r.external_url, r.status, r.meta;
end;
$$;

revoke execute on function public.claim_publication(uuid, public.publication_target)
  from public, anon, authenticated;

-- 2. The browser may edit an event's details, but not its status or who
--    created it: an event only becomes "published" through the server-side
--    function, after Eventbrite has actually published it.
revoke insert, update on public.events from authenticated;

grant insert (id, title, summary, description, starts_at, ends_at, timezone, is_online,
              public_area, venue_name, venue_address, capacity, category, cover_image_path)
  on public.events to authenticated;

grant update (title, summary, description, starts_at, ends_at, timezone, is_online,
              public_area, venue_name, venue_address, capacity, category, cover_image_path)
  on public.events to authenticated;
