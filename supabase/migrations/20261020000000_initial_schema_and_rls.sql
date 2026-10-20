-- ==============================================================================
-- MONEY MATE AI — PRODUCTION POSTGRESQL SCHEMA & ROW LEVEL SECURITY (RLS)
-- Multi-user isolation, integer paise monetary conventions, strict provenance
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. USER PROFILES
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  preferred_currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. FINANCIAL ACCOUNTS (Verified & owned accounts)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  institution TEXT NOT NULL, -- e.g. 'SBI', 'Union Bank of India', 'Other'
  account_type TEXT NOT NULL, -- 'savings', 'current', 'credit_card', 'wallet', 'other'
  currency TEXT NOT NULL DEFAULT 'INR',
  is_owned BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_user_alias_key UNIQUE (user_id, alias)
);

-- 4. CATEGORIES (User custom and active categories)
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'expense', 'income', 'transfer', 'refund'
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  classification TEXT NOT NULL DEFAULT 'unclassified', -- 'needs', 'wants', 'savings_investments', 'transfers', 'unclassified'
  is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT categories_user_name_type_key UNIQUE (user_id, name, type)
);

-- 5. IMPORT BATCHES (Provenance & Idempotency)
CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  source_provider TEXT NOT NULL,
  source_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  source_account_alias TEXT,
  commit_status TEXT NOT NULL DEFAULT 'committed', -- 'staged', 'committed', 'rolled_back'
  total_records INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  audit_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  CONSTRAINT import_batches_user_idempotency_key UNIQUE (user_id, idempotency_key)
);

-- 6. TRANSACTIONS (Canonical Financial Ledger)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,
  
  type TEXT NOT NULL, -- 'income', 'expense', 'transfer', 'refund'
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  date TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL, -- 'UPI', 'Bank transfer', 'Card', 'Cash', 'Other'
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed', 'pending', 'failed'
  
  from_account TEXT,
  to_account TEXT,
  external_ref TEXT,
  linked_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'receipt', 'screenshot', 'csv', 'statement_import'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. RECURRING SCHEDULES & BILLS
CREATE TABLE IF NOT EXISTS public.recurring_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_paise BIGINT,
  commitment_type TEXT NOT NULL, -- 'expense', 'savings', 'investment', 'income', 'reminder_only'
  frequency TEXT NOT NULL, -- 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'
  custom_interval_days INTEGER,
  preferred_day_of_month INTEGER,
  start_date DATE NOT NULL,
  end_date DATE,
  next_due_date DATE NOT NULL,
  notification_lead_days INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused', 'completed', 'cancelled'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bill_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES public.recurring_schedules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_paise BIGINT,
  commitment_type TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'due', 'overdue', 'paid', 'skipped', 'cancelled'
  linked_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  paid_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. INVENTORY & SMART SHOPPING
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  min_threshold NUMERIC CHECK (min_threshold >= 0),
  purchase_price_paise BIGINT,
  last_purchase_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  notes TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  linked_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shopping_list_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  category TEXT,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit TEXT NOT NULL,
  estimated_price_paise BIGINT,
  priority TEXT NOT NULL DEFAULT 'medium', -- 'highest', 'high', 'medium', 'low'
  status TEXT NOT NULL DEFAULT 'planned', -- 'planned', 'purchased', 'skipped', 'cancelled'
  purchase_deadline DATE,
  is_essential BOOLEAN NOT NULL DEFAULT FALSE,
  linked_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. USER MASKED ACCOUNT MAPPINGS (PhonePe / UPI Statement Mappings)
CREATE TABLE IF NOT EXISTS public.account_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  masked_account_id TEXT NOT NULL,
  target_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  target_account_alias TEXT NOT NULL,
  provider TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'user_explicit', -- 'user_explicit', 'persisted_rule'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_mappings_user_masked_provider_key UNIQUE (user_id, masked_account_id, provider)
);

-- 10. USER PERSONALISATION RULES & LEARNING PREFERENCES
CREATE TABLE IF NOT EXISTS public.user_learned_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_pattern TEXT NOT NULL,
  target_category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  target_category_name TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  user_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_learned_pref_pattern_key UNIQUE (user_id, merchant_pattern)
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE & FAST QUERIES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_import_batch ON public.transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ext_ref ON public.transactions(user_id, external_ref);
CREATE INDEX IF NOT EXISTS idx_bill_instances_due_date ON public.bill_instances(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_inventory_user_cat ON public.inventory_items(user_id, category);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — ZERO TRUST MULTI-USER ISOLATION
-- ==============================================================================

-- Enable RLS across all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_learned_preferences ENABLE ROW LEVEL SECURITY;

-- 1. USER PROFILES POLICIES
CREATE POLICY "Users can view their own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2. ACCOUNTS POLICIES
CREATE POLICY "Users can select own accounts"
  ON public.accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounts"
  ON public.accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounts"
  ON public.accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own accounts"
  ON public.accounts FOR DELETE
  USING (auth.uid() = user_id);

-- 3. CATEGORIES POLICIES
CREATE POLICY "Users can select own categories"
  ON public.categories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own categories"
  ON public.categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories"
  ON public.categories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own categories"
  ON public.categories FOR DELETE
  USING (auth.uid() = user_id);

-- 4. IMPORT BATCHES POLICIES
CREATE POLICY "Users can select own import batches"
  ON public.import_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own import batches"
  ON public.import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own import batches"
  ON public.import_batches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. TRANSACTIONS POLICIES (With cross-entity ownership check on account_id)
CREATE POLICY "Users can select own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      account_id IS NULL OR
      EXISTS (SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      account_id IS NULL OR
      EXISTS (SELECT 1 FROM public.accounts WHERE id = account_id AND user_id = auth.uid())
    )
  );

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);

-- 6. RECURRING SCHEDULES & BILLS POLICIES
CREATE POLICY "Users can view own recurring schedules"
  ON public.recurring_schedules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recurring schedules"
  ON public.recurring_schedules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recurring schedules"
  ON public.recurring_schedules FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own recurring schedules"
  ON public.recurring_schedules FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own bill instances"
  ON public.bill_instances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bill instances"
  ON public.bill_instances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bill instances"
  ON public.bill_instances FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bill instances"
  ON public.bill_instances FOR DELETE
  USING (auth.uid() = user_id);

-- 7. INVENTORY & SMART SHOPPING POLICIES
CREATE POLICY "Users can view own inventory items"
  ON public.inventory_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory items"
  ON public.inventory_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory items"
  ON public.inventory_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory items"
  ON public.inventory_items FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own shopping items"
  ON public.shopping_list_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shopping items"
  ON public.shopping_list_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shopping items"
  ON public.shopping_list_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own shopping items"
  ON public.shopping_list_items FOR DELETE
  USING (auth.uid() = user_id);

-- 8. ACCOUNT MAPPINGS & LEARNED PREFERENCES POLICIES
CREATE POLICY "Users can view own account mappings"
  ON public.account_mappings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own account mappings"
  ON public.account_mappings FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.accounts WHERE id = target_account_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can update own account mappings"
  ON public.account_mappings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.accounts WHERE id = target_account_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can delete own account mappings"
  ON public.account_mappings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own learned preferences"
  ON public.user_learned_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learned preferences"
  ON public.user_learned_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learned preferences"
  ON public.user_learned_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own learned preferences"
  ON public.user_learned_preferences FOR DELETE
  USING (auth.uid() = user_id);
