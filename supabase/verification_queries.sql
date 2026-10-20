-- ==============================================================================
-- MONEY MATE AI — READ-ONLY RLS & SCHEMA AUDIT QUERIES
-- 
-- PURPOSE:
-- Run these queries in the Supabase SQL Editor to safely inspect tables,
-- RLS enablement, active policies, and foreign-key constraints WITHOUT
-- modifying any data or database objects.
-- ==============================================================================

-- 1. INSPECT ALL 11 APPLICATION TABLES AND RLS STATUS
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
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
    'user_learned_preferences'
  )
ORDER BY tablename;

-- 2. INSPECT ALL ACTIVE POLICIES, COMMANDS, AND EXPRESSIONS
SELECT
  tablename,
  policyname,
  cmd AS command_type, -- SELECT, INSERT, UPDATE, DELETE, ALL
  roles,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 3. VERIFY SPECIFIC TARGETED POLICIES AND HARDENED CHECK EXPRESSIONS
-- Check whether 'transactions' has ownership checks for category_id and import_batch_id
SELECT
  policyname,
  cmd,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transactions'
  AND cmd IN ('INSERT', 'UPDATE');

-- Check whether 'import_batches' has a DELETE policy
SELECT
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'import_batches'
  AND cmd = 'DELETE';

-- 4. INSPECT FOREIGN KEY CONSTRAINTS ACROSS ALL APPLICATION TABLES
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
