-- A cancelled event can't be edited from the app (it's cancelled on Eventbrite
-- too, and can't be undone). Only the server-side function changes its status.

alter policy "event managers can update events" on public.events
  using (public.has_permission('events.manage') and status <> 'cancelled')
  with check (public.has_permission('events.manage'));
