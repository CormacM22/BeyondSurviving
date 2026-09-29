-- Fixes from Supabase's security advisor after the init migration.

-- Pin the search path so the trigger can't be redirected to look-alike objects.
alter function public.set_updated_at() set search_path = '';

-- Signed-out visitors have no reason to ask about permissions. Signed-in users
-- keep access: the app and the row-level security policies rely on it, and it
-- only ever answers about the caller themselves.
revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- Evaluate auth.uid() once per query instead of once per row.
alter policy "users can read their own roles" on public.user_roles
  using (user_id = (select auth.uid()));
