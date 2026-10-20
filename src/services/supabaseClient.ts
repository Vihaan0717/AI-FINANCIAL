import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
  isConfigured: boolean
}

/**
 * Retrieve public Supabase configuration from Vite environment variables.
 * Only VITE_ prefixed public variables are exposed to the browser.
 * The service_role secret is NEVER accessed or stored here.
 */
export function getSupabaseConfig(): SupabaseConfig {
  const url = import.meta.env.VITE_SUPABASE_URL || ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  const isConfigured = Boolean(url.trim() && anonKey.trim())

  return {
    url: url.trim(),
    anonKey: anonKey.trim(),
    isConfigured,
  }
}

let cachedClient: SupabaseClient | null = null

/**
 * Returns a singleton browser SupabaseClient using only the public anon key.
 * If credentials are not configured, returns null without throwing, allowing graceful offline operation.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseConfig()

  if (!isConfigured) {
    return null
  }

  if (!cachedClient) {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }

  return cachedClient
}

/**
 * Clears the cached client (useful for unit tests or account switching)
 */
export function resetSupabaseClient(): void {
  cachedClient = null
}
