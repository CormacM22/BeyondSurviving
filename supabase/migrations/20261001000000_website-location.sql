-- The location line on the website's event card ("Online (Weekly)", "Castlebar,
-- Co. Mayo"). Optional: when blank, the area (or "Online") is used.

alter table public.events add column website_location text;

grant insert (website_location) on public.events to authenticated;
grant update (website_location) on public.events to authenticated;
