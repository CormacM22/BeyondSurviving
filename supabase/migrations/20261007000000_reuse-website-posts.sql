-- Reusing Ciara's existing website posts (she keeps a few per group and updates
-- them with each new date), instead of creating a new post per event.

-- The existing post chosen for an event, if any.
alter table public.events add column website_post_id text;
grant insert (website_post_id) on public.events to authenticated;
grant update (website_post_id) on public.events to authenticated;

-- Only one event can hold a given website post at a time.
create unique index event_publications_one_holder
  on public.event_publications (target, external_id)
  where external_id is not null;

-- Makes p_event_id the event holding website post p_post_id, handing it over
-- from any earlier event, which keeps a note and never touches the post again.
-- Returns 'busy' (and changes nothing) if that earlier event is mid-update.
-- The caller must already hold p_event_id's own lock (claim_publication).
create function public.take_over_post(p_event_id uuid, p_post_id text, p_url text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  other public.event_publications;
begin
  for other in
    select * from public.event_publications p
    where p.target = 'wordpress' and p.external_id = p_post_id and p.event_id <> p_event_id
    for update
  loop
    if other.in_progress_since is not null and other.in_progress_since > now() - interval '5 minutes' then
      return 'busy';
    end if;
  end loop;

  update public.event_publications p
  set external_id = null,
      external_url = null,
      status = case when p.status = 'cancelled' then 'cancelled'::public.publication_status
                    else 'not_started'::public.publication_status end,
      meta = p.meta || jsonb_build_object(
        'handedOver', true,
        'note', 'This event’s website post was reused for a later event, so this event no longer changes it.')
  where p.target = 'wordpress' and p.external_id = p_post_id and p.event_id <> p_event_id;

  update public.event_publications p
  set external_id = p_post_id, external_url = p_url
  where p.event_id = p_event_id and p.target = 'wordpress';

  return 'ok';
end;
$$;

revoke execute on function public.take_over_post(uuid, text, text) from public, anon, authenticated;
