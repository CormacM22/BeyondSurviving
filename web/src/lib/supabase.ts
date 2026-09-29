import { createClient } from '@supabase/supabase-js'

// These two values are public by design (the anon key only grants what the
// database's row-level security allows). Server secrets never go here.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, anonKey)
