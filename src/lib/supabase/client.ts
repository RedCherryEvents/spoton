import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

// createBrowserClient throws if either value is missing. During `next
// build`, client pages still render once on the server (static
// generation). Hosts that have not yet injected NEXT_PUBLIC_* — or
// that only inject them at runtime — would otherwise crash prerender
// of /forgot-password and any other page that constructs the client
// during render. These placeholders are never cached so a real
// browser session always builds the live client.
const PRERENDER_URL = 'https://placeholder.supabase.co'
const PRERENDER_ANON_KEY = 'placeholder-anon-key'

export function createClient() {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    if (typeof window === 'undefined') {
      return createBrowserClient(PRERENDER_URL, PRERENDER_ANON_KEY)
    }
    throw new Error(
      '@supabase/ssr: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required to create a Supabase client.',
    )
  }

  browserClient = createBrowserClient(url, anonKey)

  return browserClient
}
