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
  it('confirms RLS migrations implement mandatory multi-user isolation and relational defense policies', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const initialMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261020000000_initial_schema_and_rls.sql')
    const patchMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261020000001_harden_rls_policies.sql')

    const initialSql = fs.readFileSync(initialMigrationPath, 'utf-8')
    const patchSql = fs.readFileSync(patchMigrationPath, 'utf-8')
    const combinedSql = `${initialSql}\n${patchSql}`

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
      expect(initialSql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
    }

    // 2. Security patch strictly hardens transactions account_id, category_id, and import_batch_id ownership
    expect(patchSql).toContain('SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid()')
    expect(patchSql).toContain('SELECT 1 FROM public.categories WHERE id = category_id AND user_id = auth.uid()')
    expect(patchSql).toContain('SELECT 1 FROM public.import_batches WHERE id = import_batch_id AND user_id = auth.uid()')

    // 3. Security patch hardens bill instances recurring schedule ownership
    expect(patchSql).toContain('SELECT 1 FROM public.recurring_schedules WHERE id = schedule_id AND user_id = auth.uid()')

    // 4. Security patch hardens shopping list inventory item ownership
    expect(patchSql).toContain('SELECT 1 FROM public.inventory_items WHERE id = inventory_item_id AND user_id = auth.uid()')

    // 5. Security patch hardens user learned preferences category ownership
    expect(patchSql).toContain('SELECT 1 FROM public.categories WHERE id = target_category_id AND user_id = auth.uid()')

    // 6. Security patch adds missing DELETE policy on import_batches
    expect(patchSql).toContain('CREATE POLICY "Users can delete own import batches"')

    // 7. Foreign key constraints enforce user ownership on CASCADE in base schema
    expect(initialSql).toContain('user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE')
  })

  it('verifies that no table allows public or unauthenticated INSERT/UPDATE/DELETE access in any migration', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const initialMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261020000000_initial_schema_and_rls.sql')
    const patchMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261020000001_harden_rls_policies.sql')

    const combinedSql = `${fs.readFileSync(initialMigrationPath, 'utf-8')}\n${fs.readFileSync(patchMigrationPath, 'utf-8')}`

    // No policies should use 'anon', 'true', or '1=1' in WITH CHECK
    expect(combinedSql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
    expect(combinedSql).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(combinedSql).not.toMatch(/TO anon/i)
  })
})

describe('Synthetic Two-User Isolation Simulation (In-Memory Policy Model — Not Live PostgreSQL)', () => {
  interface SimulatedDbRow {
    id: string
    userId: string
    data: string
    accountId?: string
  }

  it('simulates RLS policy evaluation ensuring User A and User B cannot access or cross-link each other\'s records', () => {
    const userA = 'user-uuid-1111'
    const userB = 'user-uuid-2222'

    // Mock tables
    const accountsTable: SimulatedDbRow[] = [
      { id: 'acc-a-1', userId: userA, data: 'User A SBI' },
      { id: 'acc-b-1', userId: userB, data: 'User B Union Bank' },
    ]

    const transactionsTable: SimulatedDbRow[] = [
      { id: 'tx-a-1', userId: userA, accountId: 'acc-a-1', data: 'User A Lunch ₹200' },
      { id: 'tx-b-1', userId: userB, accountId: 'acc-b-1', data: 'User B Groceries ₹500' },
    ]

    // RLS Policy Simulator for SELECT: (auth.uid() = user_id)
    const selectTransactions = (currentAuthUid: string) => {
      return transactionsTable.filter((row) => row.userId === currentAuthUid)
    }

    // 1. User A can read their own records but NOT User B's
    const userAReads = selectTransactions(userA)
    expect(userAReads.length).toBe(1)
    expect(userAReads[0].id).toBe('tx-a-1')
    expect(userAReads.some((r) => r.userId === userB)).toBe(false)

    // 2. User B can read their own records but NOT User A's
    const userBReads = selectTransactions(userB)
    expect(userBReads.length).toBe(1)
    expect(userBReads[0].id).toBe('tx-b-1')
    expect(userBReads.some((r) => r.userId === userA)).toBe(false)

    // 3. Unauthenticated read returns 0 rows
    const unauthReads = selectTransactions('')
    expect(unauthReads.length).toBe(0)

    // RLS Policy Simulator for INSERT:
    // WITH CHECK (auth.uid() = user_id AND (account_id IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE id = account_id AND user_id = auth.uid())))
    const insertTransaction = (
      currentAuthUid: string,
      newRow: { id: string; userId: string; accountId?: string; data: string }
    ): { success: boolean; error?: string } => {
      if (newRow.userId !== currentAuthUid) {
        return { success: false, error: 'new row violates row-level security policy: user_id mismatch' }
      }
      if (newRow.accountId) {
        const accountOwned = accountsTable.some(
          (acc) => acc.id === newRow.accountId && acc.userId === currentAuthUid
        )
        if (!accountOwned) {
          return { success: false, error: 'new row violates row-level security policy: account not owned by user' }
        }
      }
      transactionsTable.push(newRow)
      return { success: true }
    }

    // 4. User A attempts to create a transaction claiming User B's account: strictly BLOCKED
    const rogueInsert = insertTransaction(userA, {
      id: 'tx-rogue-1',
      userId: userA,
      accountId: 'acc-b-1', // User B's account!
      data: 'Rogue cross-user transaction',
    })
    expect(rogueInsert.success).toBe(false)
    expect(rogueInsert.error).toContain('account not owned by user')

    // 5. User A attempts to forge userId as User B: strictly BLOCKED
    const spoofedInsert = insertTransaction(userA, {
      id: 'tx-spoof-1',
      userId: userB,
      accountId: 'acc-b-1',
      data: 'Spoofed User ID',
    })
    expect(spoofedInsert.success).toBe(false)
    expect(spoofedInsert.error).toContain('user_id mismatch')

    // 6. Legitimate User A insert succeeds
    const legitInsert = insertTransaction(userA, {
      id: 'tx-legit-1',
      userId: userA,
      accountId: 'acc-a-1',
      data: 'Legitimate Tea ₹30',
    })
    expect(legitInsert.success).toBe(true)
  })
})
