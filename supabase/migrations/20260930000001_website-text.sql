-- The website post has its own title and short text; the description is
-- Eventbrite's longer text (as on Ciara's existing posts).

alter table public.events
  add column website_title text,
  add column website_text  text;

-- The app may write both (see the column grants in 20260929000003_review-fixes.sql).
grant insert (website_title, website_text) on public.events to authenticated;
grant update (website_title, website_text) on public.events to authenticated;
