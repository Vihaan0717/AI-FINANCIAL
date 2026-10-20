-- ==============================================================================
-- MONEY MATE AI — SECURITY PATCH: RLS HARDENING & RELATIONAL DEFENSE
-- Migration: 20261020000001_harden_rls_policies.sql
-- 
-- PURPOSE:
-- Safely applies targeted RLS policy replacements to the existing Supabase
-- database without dropping tables, altering constraints, or risking existing records.
--
-- TARGETED FIXES:
-- 1. Adds missing DELETE policy on `import_batches` (required for import rollback).
-- 2. Hardens `transactions` INSERT/UPDATE to verify user ownership of `category_id` and `import_batch_id`
--    in addition to `account_id`, preventing cross-user foreign key references.
-- 3. Hardens `bill_instances` INSERT/UPDATE to verify user ownership of `schedule_id`.
-- 4. Hardens `shopping_list_items` INSERT/UPDATE to verify user ownership of `inventory_item_id`.
-- 5. Hardens `user_learned_preferences` INSERT/UPDATE to verify user ownership of `target_category_id`.
-- ==============================================================================

-- 1. IMPORT BATCHES: Add DELETE policy (if not exists)
DROP POLICY IF EXISTS "Users can delete own import batches" ON public.import_batches;
CREATE POLICY "Users can delete own import batches"
  ON public.import_batches FOR DELETE
  USING (auth.uid() = user_id);

-- 2. TRANSACTIONS: Replace INSERT & UPDATE policies with cross-relation ownership verification
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      account_id IS NULL OR
      EXISTS (SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid())
    )
    AND (
      category_id IS NULL OR
      EXISTS (SELECT 1 FROM public.categories WHERE id = category_id AND user_id = auth.uid())
    )
    AND (
      import_batch_id IS NULL OR
      EXISTS (SELECT 1 FROM public.import_batches WHERE id = import_batch_id AND user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      account_id IS NULL OR
      EXISTS (SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid())
    )
    AND (
      category_id IS NULL OR
      EXISTS (SELECT 1 FROM public.categories WHERE id = category_id AND user_id = auth.uid())
    )
    AND (
      import_batch_id IS NULL OR
      EXISTS (SELECT 1 FROM public.import_batches WHERE id = import_batch_id AND user_id = auth.uid())
    )
  );

-- 3. BILL INSTANCES: Replace INSERT & UPDATE policies with schedule_id ownership verification
DROP POLICY IF EXISTS "Users can insert own bill instances" ON public.bill_instances;
CREATE POLICY "Users can insert own bill instances"
  ON public.bill_instances FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      schedule_id IS NULL OR
      EXISTS (SELECT 1 FROM public.recurring_schedules WHERE id = schedule_id AND user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own bill instances" ON public.bill_instances;
CREATE POLICY "Users can update own bill instances"
  ON public.bill_instances FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      schedule_id IS NULL OR
      EXISTS (SELECT 1 FROM public.recurring_schedules WHERE id = schedule_id AND user_id = auth.uid())
    )
  );

-- 4. SHOPPING LIST ITEMS: Replace INSERT & UPDATE policies with inventory_item_id ownership verification
DROP POLICY IF EXISTS "Users can insert own shopping items" ON public.shopping_list_items;
CREATE POLICY "Users can insert own shopping items"
  ON public.shopping_list_items FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      inventory_item_id IS NULL OR
      EXISTS (SELECT 1 FROM public.inventory_items WHERE id = inventory_item_id AND user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own shopping items" ON public.shopping_list_items;
CREATE POLICY "Users can update own shopping items"
  ON public.shopping_list_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      inventory_item_id IS NULL OR
      EXISTS (SELECT 1 FROM public.inventory_items WHERE id = inventory_item_id AND user_id = auth.uid())
    )
  );

-- 5. USER LEARNED PREFERENCES: Replace INSERT & UPDATE policies with target_category_id ownership verification
DROP POLICY IF EXISTS "Users can insert own learned preferences" ON public.user_learned_preferences;
CREATE POLICY "Users can insert own learned preferences"
  ON public.user_learned_preferences FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      target_category_id IS NULL OR
      EXISTS (SELECT 1 FROM public.categories WHERE id = target_category_id AND user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own learned preferences" ON public.user_learned_preferences;
CREATE POLICY "Users can update own learned preferences"
  ON public.user_learned_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      target_category_id IS NULL OR
      EXISTS (SELECT 1 FROM public.categories WHERE id = target_category_id AND user_id = auth.uid())
    )
  );
