import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSupabaseConfig, getSupabaseClient, resetSupabaseClient } from '../src/services/supabaseClient'
import { SupabaseAuthService } from '../src/services/authService'

describe('Supabase Client & Auth Security Architecture', () => {
  beforeEach(() => {
    resetSupabaseClient()
    vi.unstubAllEnvs()
  })

  it('detects unconfigured Supabase environment safely without throwing', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    const config = getSupabaseConfig()
    expect(config.isConfigured).toBe(false)
    expect(config.url).toBe('')
    expect(config.anonKey).toBe('')

    const client = getSupabaseClient()
    expect(client).toBeNull()

    const authService = new SupabaseAuthService()
    expect(authService.isConfigured()).toBe(false)
  })

  it('initializes Supabase client when public environment variables are supplied', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://mock-project-test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'mock-public-anon-key-12345')

    const config = getSupabaseConfig()
    expect(config.isConfigured).toBe(true)
    expect(config.url).toBe('https://mock-project-test.supabase.co')
    expect(config.anonKey).toBe('mock-public-anon-key-12345')

    const client = getSupabaseClient()
    expect(client).not.toBeNull()
  })

  it('returns appropriate errors when attempting auth operations while unconfigured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    const authService = new SupabaseAuthService()
    const sessionRes = await authService.getInitialSession()
    expect(sessionRes.user).toBeNull()
    expect(sessionRes.isConfigured).toBe(false)

    const signUpRes = await authService.signUp('test@example.com', 'TestPassword123!')
    expect(signUpRes.user).toBeNull()
    expect(signUpRes.error).toContain('not configured')

    const signInRes = await authService.signIn('test@example.com', 'TestPassword123!')
    expect(signInRes.user).toBeNull()
    expect(signInRes.error).toContain('not configured')

    const resetRes = await authService.resetPasswordForEmail('test@example.com')
    expect(resetRes.error).toContain('not configured')
  })
})

describe('PostgreSQL Row Level Security Static Policy Audit', () => {
  it('confirms RLS migration SQL implements mandatory multi-user isolation policies', async () => {
    // Read the migration file text to verify all tables enforce RLS and check auth.uid()
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261020000000_initial_schema_and_rls.sql')
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8')

    // 1. Mandatory tables have RLS enabled
    const requiredTables = [
      'user_profiles',
      'accounts',
      'categories',
      'import_batches',
      'transactions',
      'recurring_schedules',
      'bill_instances',
      'inventory_items',
      'shopping_list_items',
      'account_mappings',
      'user_learned_preferences',
    ]

    for (const table of requiredTables) {
      expect(sqlContent).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
    }

    // 2. Transactions table strictly checks account_id ownership to prevent User A linking User B's account
    expect(sqlContent).toContain('SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid()')

    // 3. Foreign key constraints enforce user ownership on CASCADE
    expect(sqlContent).toContain('user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE')
  })
})
