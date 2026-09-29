# BeyondSurviving

An admin dashboard for Beyond Surviving. The first feature, now being built, is an
event-publishing page: enter an event once, and it's published to Eventbrite and to the
Events section of beyondsurviving.ie.

## Structure

- `web/`: the dashboard page (Vite + React + TypeScript), hosted on Cloudflare Pages.
- `supabase/`: the database schema (`migrations/`) and, later, the server-side functions
  that talk to Eventbrite and WordPress. Runs on Supabase's free tier.

## Running locally

Needs Node 22+ and Docker Desktop (running).

1. `npx supabase start`: starts a local database and login server, and prints its URL and
   anon key.
2. `cd web`, copy `.env.example` to `.env.local`, and fill in those two values.
3. `npm install`, then `npm run dev`.

## Secrets

The Eventbrite token and the WordPress Application Password are never committed. They're
set as Supabase function secrets and never reach the browser.

## Accounts

Public sign-up is switched off. Users are invited from the Supabase dashboard and given a
role in the `user_roles` table.
