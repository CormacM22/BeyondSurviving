-- Fixes from the independent review of reusing website posts.

-- A website post id goes into a WordPress address, so it must be a plain number.
alter table public.events
  add constraint events_website_post_id_is_a_number check (website_post_id ~ '^[0-9]+$');

-- take_over_post, now also:
--  - refuses ('upcoming') to take a post from an event whose session hasn't
--    happened yet (and isn't cancelled): that session would vanish from the site;
--  - records the earlier event's own post choice ('' = "create a new post"), so
--    if Ciara changes that event's choice later it can start afresh;
--  - clears the earlier event's lock, "needs check" flag and stale status flags.
create or replace function public.take_over_post(p_event_id uuid, p_post_id text, p_url text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  other record;
begin
  for other in
    select p.in_progress_since, p.status as pub_status, e.ends_at, e.status as event_status
    from public.event_publications p
    join public.events e on e.id = p.event_id
    where p.target = 'wordpress' and p.external_id = p_post_id and p.event_id <> p_event_id
    for update of p
  loop
    if other.in_progress_since is not null and other.in_progress_since > now() - interval '5 minutes' then
      return 'busy';
    end if;
    if other.ends_at > now() and other.event_status <> 'cancelled' and other.pub_status <> 'cancelled' then
      return 'upcoming';
    end if;
  end loop;

  update public.event_publications p
  set external_id = null,
      external_url = null,
      needs_check = false,
      in_progress_since = null,
      last_error = null,
      status = case when p.status = 'cancelled' then 'cancelled'::public.publication_status
                    else 'not_started'::public.publication_status end,
      meta = (p.meta - 'lastSetStatus' - 'statusOwnedByCiara' - 'reused' - 'note')
             || jsonb_build_object(
                  'handedOver', true,
                  'handedOverChoice', coalesce(e.website_post_id, ''),
                  'note', 'This event’s website post was reused for a later event, so this event no longer changes it.')
  from public.events e
  where e.id = p.event_id
    and p.target = 'wordpress' and p.external_id = p_post_id and p.event_id <> p_event_id;

  update public.event_publications p
  set external_id = p_post_id, external_url = p_url
  where p.event_id = p_event_id and p.target = 'wordpress';

  return 'ok';
end;
$$;

revoke execute on function public.take_over_post(uuid, text, text) from public, anon, authenticated;
