import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Also runs the tests for the server-side publishing logic in supabase/functions.
    include: ['src/**/*.test.ts', '../supabase/functions/**/*.test.ts'],
  },
})
