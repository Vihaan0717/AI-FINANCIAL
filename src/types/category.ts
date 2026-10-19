import type { TransactionType } from './transaction'
import type { NeedsWantsCategoryGroup } from './insights'

export type CategoryClassification = NeedsWantsCategoryGroup

export interface Category {
  id: string
  name: string
  type: TransactionType // 'expense' | 'income' (and optionally 'transfer' | 'refund' if ever extended)
  icon: string // Lucide icon identifier from ALLOWED_CATEGORY_ICONS
  color: string // Valid Hex color code (e.g. '#3b82f6')
  description?: string
  classification: CategoryClassification // 'needs' | 'wants' | 'savings_investments' | 'transfers' | 'unclassified'
  isBuiltIn: boolean
  isArchived: boolean
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  isDemo?: boolean
}

export type CategoryCreateInput = {
  name: string
  type: TransactionType
  icon?: string
  color?: string
  description?: string
  classification?: CategoryClassification
  isDemo?: boolean
}

export type CategoryUpdateInput = {
  name?: string
  icon?: string
  color?: string
  description?: string
  classification?: CategoryClassification
  isArchived?: boolean
}

/** Predefined safe allowlist of Lucide icon identifiers for categories */
export const ALLOWED_CATEGORY_ICONS = [
  'Coffee',
  'Utensils',
  'House',
  'Car',
  'ShoppingBag',
  'Zap',
  'HeartPulse',
  'Tv',
  'Wrench',
  'Gift',
  'Briefcase',
  'Laptop',
  'Coins',
  'TrendingUp',
  'GraduationCap',
  'Plane',
  'Music',
  'Smartphone',
  'Sparkles',
  'ShieldCheck',
  'CreditCard',
  'BookOpen',
  'Dumbbell',
  'PawPrint',
  'Baby',
  'Smile',
] as const

export type AllowedCategoryIcon = (typeof ALLOWED_CATEGORY_ICONS)[number]

/** Predefined curated color palette for category customization */
export const CURATED_CATEGORY_COLORS = [
  '#f97316', // Orange
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#eab308', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#84cc16', // Lime
  '#64748b', // Slate
] as const

/**
 * Built-in default categories reconciling all categories established in Milestones 1–6.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  // Expense Built-ins
  {
    id: 'cat-exp-food-dining',
    name: 'Food & dining',
    type: 'expense',
    icon: 'Coffee',
    color: '#f97316',
    description: 'Restaurants, cafes, takeout, and snacks',
    classification: 'wants',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-groceries',
    name: 'Groceries',
    type: 'expense',
    icon: 'Utensils',
    color: '#10b981',
    description: 'Supermarket, vegetables, pantry, and daily provisions',
    classification: 'needs',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-home',
    name: 'Home',
    type: 'expense',
    icon: 'House',
    color: '#3b82f6',
    description: 'Rent, maintenance, furniture, and home improvement',
    classification: 'needs',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-transport',
    name: 'Transport',
    type: 'expense',
    icon: 'Car',
    color: '#06b6d4',
    description: 'Fuel, metro, cabs, auto, and transit tickets',
    classification: 'needs',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-shopping',
    name: 'Shopping',
    type: 'expense',
    icon: 'ShoppingBag',
    color: '#ec4899',
    description: 'Clothing, gadgets, electronics, and personal purchases',
    classification: 'wants',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-utilities',
    name: 'Utilities',
    type: 'expense',
    icon: 'Zap',
    color: '#eab308',
    description: 'Electricity, water, gas, broadband, and mobile recharge',
    classification: 'needs',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-health',
    name: 'Health',
    type: 'expense',
    icon: 'HeartPulse',
    color: '#ef4444',
    description: 'Pharmacy, doctors, clinics, and health insurance',
    classification: 'needs',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-entertainment',
    name: 'Entertainment',
    type: 'expense',
    icon: 'Tv',
    color: '#8b5cf6',
    description: 'Movies, streaming subscriptions, events, and games',
    classification: 'wants',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-exp-other',
    name: 'Other',
    type: 'expense',
    icon: 'Wrench',
    color: '#64748b',
    description: 'Miscellaneous expense items',
    classification: 'unclassified',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },

  // Income Built-ins
  {
    id: 'cat-inc-income',
    name: 'Income',
    type: 'income',
    icon: 'Coins',
    color: '#3b82f6',
    description: 'General income inflows',
    classification: 'savings_investments',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-inc-salary',
    name: 'Salary',
    type: 'income',
    icon: 'Briefcase',
    color: '#10b981',
    description: 'Primary salary and employment compensation',
    classification: 'savings_investments',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-inc-freelance',
    name: 'Freelance',
    type: 'income',
    icon: 'Laptop',
    color: '#06b6d4',
    description: 'Consulting, freelance retainers, and side projects',
    classification: 'savings_investments',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-inc-investment',
    name: 'Investment',
    type: 'income',
    icon: 'TrendingUp',
    color: '#8b5cf6',
    description: 'Dividends, capital gains, and interest returns',
    classification: 'savings_investments',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-inc-gift',
    name: 'Gift',
    type: 'income',
    icon: 'Gift',
    color: '#ec4899',
    description: 'Gifts received and festive tokens',
    classification: 'wants',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'cat-inc-other',
    name: 'Other',
    type: 'income',
    icon: 'Wrench',
    color: '#64748b',
    description: 'Miscellaneous income credits',
    classification: 'unclassified',
    isBuiltIn: true,
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
]
