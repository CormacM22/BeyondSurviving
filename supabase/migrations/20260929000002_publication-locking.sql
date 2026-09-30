-- Support for sending events to Eventbrite (and later WordPress) safely.

alter table public.event_publications
  -- Set while a save is talking to the destination; stops two saves at once.
  add column in_progress_since timestamptz,
  -- Destination-side ids to remember between saves (venue, ticket, cover).
  add column meta jsonb not null default '{}'::jsonb;

-- Takes the lock on an event's publication row, creating the row if needed.
--   'busy'        another save started less than 5 minutes ago
--   'needs_check' an earlier save stopped part-way before the destination's id
--                 was recorded, so a copy may exist there already: a person
--                 must check before anything is created again
--   'claimed'     the lock is ours; the row's current values are returned
create function public.claim_publication(p_event_id uuid, p_target public.publication_target)
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

  if r.in_progress_since is not null and r.in_progress_since > now() - interval '5 minutes' then
    return query select 'busy'::text, null::text, null::text, null::public.publication_status, null::jsonb;
    return;
  end if;

  if r.in_progress_since is not null and r.external_id is null then
    return query select 'needs_check'::text, null::text, null::text, null::public.publication_status, null::jsonb;
    return;
  end if;

  update public.event_publications p
  set in_progress_since = now()
  where p.event_id = p_event_id and p.target = p_target;

  return query select 'claimed'::text, r.external_id, r.external_url, r.status, r.meta;
end;
$$;

-- Only the server-side functions (service role) may take locks.
revoke execute on function public.claim_publication(uuid, public.publication_target)
  from public, anon, authenticated;
