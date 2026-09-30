-- Checks the row-level security and data rules in the init migration.
--
-- Run against the linked project (no Docker needed):
--   npx supabase db query --linked -f supabase/tests/access-rules.sql
--
-- The whole script is one block that ALWAYS ends by raising an error. That is
-- deliberate: the error rolls back every change the tests made, so nothing is
-- left in the database, and its message carries the report. Read the report,
-- not the word "error": each line is PASS or FAIL.

do $tests$
declare
  admin_id  constant uuid := '00000000-0000-0000-0000-00000000000a';
  test_ev   constant uuid := '10000000-0000-0000-0000-000000000001';
  norole_id constant uuid := '00000000-0000-0000-0000-00000000000b';
  report   text[] := '{}';
  failures int := 0;
  passed   boolean;
  n        int;
begin
  -- Test users: an admin, and a signed-in user with no role at all.
  insert into auth.users (id, email) values
    (admin_id, 'admin@test.invalid'),
    (norole_id, 'norole@test.invalid');
  insert into public.user_roles (user_id, role_id) values (admin_id, 'admin');

  ------------------------------------------------------------------ admin
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  passed := public.has_permission('events.manage');
  report := report || format('%s  admin has events.manage', case when passed then 'PASS' else 'FAIL' end);
  failures := failures + (not passed)::int;

  begin
    insert into public.events (id, title, description, starts_at, ends_at, public_area,
                               venue_address, capacity, category)
    values ('10000000-0000-0000-0000-000000000001', 'Support Group - Mayo', 'Monthly group',
            '2026-10-10 11:00+01', '2026-10-10 13:00+01', 'Mayo', '1 Main St, Castlebar',
            12, 'support_group');
    report := report || 'PASS  admin can create an in-person event'::text;
  exception when others then
    report := report || ('FAIL  admin can create an in-person event: ' || sqlerrm);
    failures := failures + 1;
  end;

  select count(*) into n from public.events where id = test_ev;
  passed := n = 1;
  report := report || format('%s  admin can read events (saw %s)', case when passed then 'PASS' else 'FAIL' end, n);
  failures := failures + (not passed)::int;

  passed := (select created_by from public.events where id = test_ev) is not distinct from admin_id;
  report := report || format('%s  created_by is filled in automatically', case when passed then 'PASS' else 'FAIL' end);
  failures := failures + (not passed)::int;

  update public.events set title = 'Support Group - Mayo (Oct)' where id = test_ev;
  get diagnostics n = row_count;
  passed := n = 1;
  report := report || format('%s  admin can edit an event', case when passed then 'PASS' else 'FAIL' end);
  failures := failures + (not passed)::int;

  delete from public.events where id = test_ev;
  select count(*) into n from public.events where id = test_ev;
  passed := n = 1;
  report := report || format('%s  events cannot be deleted, even by admin', case when passed then 'PASS' else 'FAIL' end);
  failures := failures + (not passed)::int;

  begin
    insert into public.event_publications (event_id, target)
    values (test_ev, 'eventbrite');
    report := report || 'FAIL  the app cannot write publication records directly (it could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  the app cannot write publication records directly'::text;
  end;

  begin
    insert into public.events (title, description, starts_at, ends_at, capacity, category)
    values ('No venue', 'x', '2026-10-10 11:00+01', '2026-10-10 13:00+01', 10, 'support_group');
    report := report || 'FAIL  an in-person event needs a public area and venue address (accepted)'::text;
    failures := failures + 1;
  exception when check_violation then
    report := report || 'PASS  an in-person event needs a public area and venue address'::text;
  end;

  begin
    insert into public.events (title, description, starts_at, ends_at, is_online, capacity, category)
    values ('Online group', 'x', '2026-10-10 19:00+01', '2026-10-10 20:00+01', true, 10, 'support_group');
    report := report || 'PASS  an online event needs no address'::text;
  exception when others then
    report := report || ('FAIL  an online event needs no address: ' || sqlerrm);
    failures := failures + 1;
  end;

  begin
    insert into public.events (title, description, starts_at, ends_at, is_online, capacity, category)
    values ('Backwards', 'x', '2026-10-10 13:00+01', '2026-10-10 11:00+01', true, 10, 'support_group');
    report := report || 'FAIL  an event cannot end before it starts (accepted)'::text;
    failures := failures + 1;
  exception when check_violation then
    report := report || 'PASS  an event cannot end before it starts'::text;
  end;

  begin
    insert into public.events (title, description, starts_at, ends_at, is_online, capacity, category)
    values ('Bad category', 'x', '2026-10-10 19:00+01', '2026-10-10 20:00+01', true, 10, 'party');
    report := report || 'FAIL  category must be a known one (accepted)'::text;
    failures := failures + 1;
  exception when check_violation then
    report := report || 'PASS  category must be a known one'::text;
  end;

  begin
    update public.events set status = 'published' where id = test_ev;
    report := report || 'FAIL  the app cannot mark an event published itself (it could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  the app cannot mark an event published itself'::text;
  end;

  begin
    insert into public.events (title, description, starts_at, ends_at, is_online, capacity, category, status)
    values ('Pre-published', 'x', '2026-10-10 19:00+01', '2026-10-10 20:00+01', true, 10, 'support_group', 'published');
    report := report || 'FAIL  the app cannot create an event as already published (it could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  the app cannot create an event as already published'::text;
  end;

  -- A cancelled event is read-only for the app. (Set as the table owner, as the server function would.)
  perform set_config('role', 'postgres', true);
  update public.events set status = 'cancelled' where id = test_ev;
  perform set_config('role', 'authenticated', true);
  update public.events set title = 'Edited after cancel' where id = test_ev;
  get diagnostics n = row_count;
  passed := n = 0;
  report := report || format('%s  a cancelled event cannot be edited (%s rows changed)', case when passed then 'PASS' else 'FAIL' end, n);
  failures := failures + (not passed)::int;

  ------------------------------------------------------------------ no role
  perform set_config('request.jwt.claims',
    json_build_object('sub', norole_id, 'role', 'authenticated')::text, true);

  passed := not public.has_permission('events.manage');
  report := report || format('%s  user without a role lacks events.manage', case when passed then 'PASS' else 'FAIL' end);
  failures := failures + (not passed)::int;

  select count(*) into n from public.events;
  passed := n = 0;
  report := report || format('%s  user without a role sees no events (saw %s)', case when passed then 'PASS' else 'FAIL' end, n);
  failures := failures + (not passed)::int;

  begin
    insert into public.events (title, description, starts_at, ends_at, is_online, capacity, category)
    values ('Sneaky', 'x', '2026-10-10 19:00+01', '2026-10-10 20:00+01', true, 10, 'support_group');
    report := report || 'FAIL  user without a role cannot create events (it could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  user without a role cannot create events'::text;
  end;

  begin
    insert into public.user_roles (user_id, role_id) values (norole_id, 'admin');
    report := report || 'FAIL  a user cannot give themselves a role (it could)'::text;
    failures := failures + 1;
  exception when insufficient_privilege then
    report := report || 'PASS  a user cannot give themselves a role'::text;
  end;

  ------------------------------------------------------------------ signed out
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  begin
    select count(*) into n from public.events;
    passed := n = 0;
    report := report || format('%s  signed-out visitors see no events (saw %s)', case when passed then 'PASS' else 'FAIL' end, n);
    failures := failures + (not passed)::int;
  exception when insufficient_privilege then
    report := report || 'PASS  signed-out visitors see no events (no access at all)'::text;
  end;

  raise exception E'TEST REPORT (rolled back on purpose): % of % failed\n%',
    failures, array_length(report, 1), array_to_string(report, E'\n');
end
$tests$;
