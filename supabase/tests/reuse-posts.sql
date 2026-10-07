-- Checks handing a website post from one event to another (take_over_post).
--
-- Run against the linked project (no Docker needed):
--   npx supabase db query --linked -f supabase/tests/reuse-posts.sql
--
-- Like the other SQL tests, this ALWAYS ends by raising an error so that every
-- change is rolled back; the message is the report.

do $tests$
declare
  past1    constant uuid := '30000000-0000-0000-0000-000000000001';
  next1    constant uuid := '30000000-0000-0000-0000-000000000002';
  next2    constant uuid := '30000000-0000-0000-0000-000000000003';
  upcoming constant uuid := '30000000-0000-0000-0000-000000000004';
  report   text[] := '{}';
  failures int := 0;
  got      text;
begin
  insert into public.events (id, title, description, starts_at, ends_at, is_online, capacity, category, website_post_id) values
    (past1,    'Mayo (past)',     'x', now() - interval '30 days', now() - interval '30 days' + interval '90 minutes', true, 10, 'support_group', '900'),
    (next1,    'Mayo (next)',     'x', now() + interval '30 days', now() + interval '30 days' + interval '90 minutes', true, 10, 'support_group', '900'),
    (next2,    'Mayo (after)',    'x', now() + interval '60 days', now() + interval '60 days' + interval '90 minutes', true, 10, 'support_group', '900'),
    (upcoming, 'Galway (soon)',   'x', now() + interval '3 days',  now() + interval '3 days' + interval '90 minutes',  true, 10, 'support_group', null);

  -- A past event holds post 900 (and had a stale "needs check" flag).
  perform public.claim_publication(past1, 'wordpress');
  update public.event_publications
  set external_id = '900', status = 'live', in_progress_since = null, needs_check = true,
      meta = '{"lastSetStatus":"publish","statusOwnedByCiara":true,"reused":true}'
  where event_id = past1 and target = 'wordpress';

  -- 1. The next session takes it over.
  perform public.claim_publication(next1, 'wordpress');
  select public.take_over_post(next1, '900', 'https://site.test/900') into got;
  report := report || format('%s  a later event takes over a past session''s post (got %s)', case when got = 'ok' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'ok')::int;

  select external_id into got from public.event_publications where event_id = next1 and target = 'wordpress';
  report := report || format('%s  the post is recorded on the new event (got %s)', case when got = '900' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got is distinct from '900')::int;

  -- 2. The past event lets go, records its own choice, and loses its stale flags.
  select coalesce(external_id, 'none') || '/' || status || '/' || (meta->>'handedOver') || '/' || (meta->>'handedOverChoice')
         || '/' || coalesce(meta->>'statusOwnedByCiara', '-') || '/' || needs_check::text
  into got from public.event_publications where event_id = past1 and target = 'wordpress';
  report := report || format('%s  the earlier event lets go cleanly (got %s)',
    case when got = 'none/not_started/true/900/-/false' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'none/not_started/true/900/-/false')::int;

  -- 3. Two events can never hold the same post.
  begin
    update public.event_publications set external_id = '900' where event_id = past1 and target = 'wordpress';
    report := report || 'FAIL  two events can never hold the same post (they could)'::text;
    failures := failures + 1;
  exception when unique_violation then
    report := report || 'PASS  two events can never hold the same post'::text;
  end;

  -- 4. While the holder is mid-update (its lock is still held), others wait.
  perform public.claim_publication(next2, 'wordpress');
  select public.take_over_post(next2, '900', 'https://site.test/900') into got;
  report := report || format('%s  taking over waits while the holder is mid-update (got %s)', case when got = 'busy' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'busy')::int;

  -- 5. Once it's not mid-update: a post showing an upcoming session is never taken.
  update public.event_publications set in_progress_since = null where event_id = next1 and target = 'wordpress';
  select public.take_over_post(next2, '900', 'https://site.test/900') into got;
  report := report || format('%s  a post showing an upcoming session is never taken (got %s)', case when got = 'upcoming' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'upcoming')::int;

  select external_id into got from public.event_publications where event_id = next1 and target = 'wordpress';
  report := report || format('%s  ...and nothing changes (holder still %s)', case when got = '900' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got is distinct from '900')::int;

  -- 6. If that upcoming session is cancelled, its post can be reused, and it stays cancelled.
  update public.event_publications set status = 'cancelled' where event_id = next1 and target = 'wordpress';
  update public.events set status = 'cancelled' where id = next1;
  select public.take_over_post(next2, '900', 'https://site.test/900') into got;
  report := report || format('%s  a cancelled session''s post can be reused (got %s)', case when got = 'ok' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'ok')::int;
  select status::text into got from public.event_publications where event_id = next1 and target = 'wordpress';
  report := report || format('%s  ...and that event stays cancelled (got %s)', case when got = 'cancelled' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> 'cancelled')::int;

  -- 7. An event that created its own post records "new post" as its choice.
  perform public.claim_publication(upcoming, 'wordpress');
  update public.event_publications set external_id = '950', in_progress_since = null where event_id = upcoming and target = 'wordpress';
  update public.events set ends_at = now() - interval '1 day', starts_at = now() - interval '1 day' - interval '1 hour' where id = upcoming;
  select public.take_over_post(past1, '950', 'https://site.test/950') into got;
  select '[' || (meta->>'handedOverChoice') || ']' into got from public.event_publications where event_id = upcoming and target = 'wordpress';
  report := report || format('%s  an event that made its own post records "new post" as its choice (got %s)', case when got = '[]' then 'PASS' else 'FAIL' end, got);
  failures := failures + (got <> '[]')::int;

  -- 8. Only plain post numbers are accepted.
  begin
    update public.events set website_post_id = '123?status=publish' where id = past1;
    report := report || 'FAIL  only plain post numbers are accepted (it took one)'::text;
    failures := failures + 1;
  exception when check_violation then
    report := report || 'PASS  only plain post numbers are accepted'::text;
  end;

  -- 9. Signed-in users cannot call it themselves.
  perform set_config('role', 'authenticated', true);
  begin
    perform public.take_over_post(past1, '900', 'x');
    report := report || 'FAIL  signed-in users cannot call take_over_post (they could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  signed-in users cannot call take_over_post'::text;
  end;

  raise exception E'TEST REPORT (rolled back on purpose): % of % failed\n%',
    failures, array_length(report, 1), array_to_string(report, E'\n');
end
$tests$;
