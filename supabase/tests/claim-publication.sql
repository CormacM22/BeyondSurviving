-- Checks the locking rules in claim_publication().
--
-- Run against the linked project (no Docker needed):
--   npx supabase db query --linked -f supabase/tests/claim-publication.sql
--
-- Like access-rules.sql, this ALWAYS ends by raising an error so that every
-- change is rolled back; the message is the report.

do $tests$
declare
  ev constant uuid := '20000000-0000-0000-0000-000000000001';
  report   text[] := '{}';
  failures int := 0;
  got      text;
begin
  insert into public.events (id, title, description, starts_at, ends_at, is_online, capacity, category)
  values (ev, 'Lock test', 'x', '2026-11-01 19:00+00', '2026-11-01 20:00+00', true, 10, 'support_group');

  -- 1. First claim creates the row and takes the lock.
  select outcome into got from public.claim_publication(ev, 'eventbrite');
  report := report || format('%s  first claim succeeds (got %s)', case when got = 'claimed' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'claimed')::int;

  -- 2. A second claim straight away is refused.
  select outcome into got from public.claim_publication(ev, 'eventbrite');
  report := report || format('%s  a second save at the same time is refused (got %s)', case when got = 'busy' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'busy')::int;

  -- 3. Other destinations have their own lock.
  select outcome into got from public.claim_publication(ev, 'wordpress');
  report := report || format('%s  WordPress has its own lock (got %s)', case when got = 'claimed' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'claimed')::int;

  -- 4. A stale lock with no Eventbrite id means "check before retrying".
  update public.event_publications set in_progress_since = now() - interval '10 minutes'
  where event_id = ev and target = 'eventbrite';
  select outcome into got from public.claim_publication(ev, 'eventbrite');
  report := report || format('%s  a stalled first save needs a check (got %s)', case when got = 'needs_check' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'needs_check')::int;

  select case when needs_check and last_error like '%check Eventbrite%' then 'flagged' else 'not flagged' end into got
  from public.event_publications where event_id = ev and target = 'eventbrite';
  report := report || format('%s  the row is flagged with a message for the user (got %s)', case when got = 'flagged' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'flagged')::int;

  -- 4b. Once flagged, it stays "needs check" even if the lock looks fresh.
  update public.event_publications set in_progress_since = now()
  where event_id = ev and target = 'eventbrite';
  select outcome into got from public.claim_publication(ev, 'eventbrite');
  report := report || format('%s  a flagged row stays needs-check (got %s)', case when got = 'needs_check' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'needs_check')::int;

  -- (what "I've checked Eventbrite" does)
  update public.event_publications set needs_check = false, in_progress_since = now() - interval '10 minutes'
  where event_id = ev and target = 'eventbrite';

  -- 5. A stale lock where the Eventbrite id IS recorded can be retaken safely.
  update public.event_publications set external_id = 'eb-1', meta = '{"ticketClassId":"t-1"}'
  where event_id = ev and target = 'eventbrite';
  select outcome into got from public.claim_publication(ev, 'eventbrite');
  report := report || format('%s  a stalled later save can be retried (got %s)', case when got = 'claimed' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'claimed')::int;

  -- 6. Stored ids survive a re-claim.
  select p.external_id || '/' || (p.meta->>'ticketClassId') into got
  from public.event_publications p
  where p.event_id = ev and p.target = 'eventbrite';
  report := report || format('%s  stored ids are kept (got %s)', case when got = 'eb-1/t-1' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got is distinct from 'eb-1/t-1')::int;

  -- 7. Signed-in users cannot take locks themselves.
  perform set_config('role', 'authenticated', true);
  begin
    perform public.claim_publication(ev, 'eventbrite');
    report := report || 'FAIL  signed-in users cannot call claim_publication (they could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  signed-in users cannot call claim_publication'::text;
  end;

  raise exception E'TEST REPORT (rolled back on purpose): % of % failed\n%',
    failures, array_length(report, 1), array_to_string(report, E'\n');
end
$tests$;
