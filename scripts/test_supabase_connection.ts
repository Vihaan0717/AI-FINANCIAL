import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// Read credentials from .env directly for test runner
const envPath = path.resolve(process.cwd(), '.env')
const envContent = fs.readFileSync(envPath, 'utf-8')

let supabaseUrl = ''
let supabaseAnonKey = ''

for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (trimmed.startsWith('VITE_SUPABASE_URL=')) {
    supabaseUrl = trimmed.split('=')[1].trim()
  } else if (trimmed.startsWith('VITE_SUPABASE_ANON_KEY=')) {
    supabaseAnonKey = trimmed.split('=')[1].trim()
  }
}

console.log('Testing Supabase Cloud Connection...')
console.log('Target URL:', supabaseUrl)

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function runLiveVerification() {
  console.log('\n--- 1. Testing Auth Endpoint Availability ---')
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) {
    console.error('Auth session error:', sessionErr.message)
  } else {
    console.log('Auth endpoint accessible. Active session:', sessionData.session ? 'Yes' : 'No (Expected for public client)')
  }

  console.log('\n--- 2. Testing Database Tables & RLS Status ---')
  const tables = [
    'accounts',
    'categories',
    'transactions',
    'import_batches',
    'recurring_schedules',
    'bill_instances',
    'inventory_items',
    'shopping_list_items',
    'account_mappings',
    'user_learned_preferences',
  ]

  for (const table of tables) {
    const { data, error, status } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`Table [${table}]: Status ${status} - Error: ${error.message} (Code: ${error.code})`)
    } else {
      console.log(`Table [${table}]: Status ${status} - OK (Empty array returned under RLS: ${Array.isArray(data) ? 'Yes' : 'No'})`)
    }
  }

  console.log('\n--- 3. Testing Synthetic User Auth & CRUD Isolation ---')
  const testEmail = `testuser${Date.now()}@gmail.com`
  const testPass = 'MoneyMateTest#2026!Secure'

  console.log(`Creating ephemeral synthetic test user: ${testEmail}...`)
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: testEmail,
    password: testPass,
  })

  if (authErr) {
    console.log('Auth signup notice (e.g. email confirmations required):', authErr.message)
  } else if (authData.user) {
    const userId = authData.user.id
    console.log('Synthetic user created successfully. User ID:', userId)
    console.log('Session returned immediately:', authData.session ? 'Yes (auto-confirmed)' : 'No (Email confirmation required by project settings)')

    if (authData.session) {
      // Authenticated client
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
      })

      // Test creating an account row
      console.log('Attempting insert into accounts table as authenticated user...')
      const { data: accData, error: accErr } = await authClient
        .from('accounts')
        .insert({
          user_id: userId,
          alias: 'Test Operating Account',
        institution: 'SBI',
        account_type: 'savings',
        currency: 'INR',
        is_owned: true,
      })
      .select()

    if (accErr) {
      console.error('Account insert error:', accErr.message)
    } else {
      console.log('Account insert successful! Inserted ID:', accData?.[0]?.id)
      const insertedAccId = accData?.[0]?.id

      // Test inserting a transaction
      console.log('Attempting insert into transactions table...')
      const { data: txData, error: txErr } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          account_id: insertedAccId,
          type: 'expense',
          amount_paise: 25000, // ₹250.00
          currency: 'INR',
          date: new Date().toISOString(),
          description: 'Synthetic Test Coffee',
          category: 'Food & dining',
          payment_method: 'UPI',
          status: 'completed',
        })
        .select()

      if (txErr) {
        console.error('Transaction insert error:', txErr.message)
      } else {
        console.log('Transaction insert successful! Inserted ID:', txData?.[0]?.id)

        // Read back
        const { data: readTxs } = await supabase.from('transactions').select('*')
        console.log(`Read back transactions for user: ${readTxs?.length} record(s) found.`)

        // Clean up test transaction
        console.log('Cleaning up test transaction...')
        await supabase.from('transactions').delete().eq('id', txData[0].id)
      }

      // Clean up test account
      console.log('Cleaning up test account...')
      await supabase.from('accounts').delete().eq('id', insertedAccId)
    }
  }

  // Sign out
  await supabase.auth.signOut()
  console.log('Synthetic user signed out cleanly.')
}

  console.log('\nVerification complete.')
}

runLiveVerification().catch(console.error)
