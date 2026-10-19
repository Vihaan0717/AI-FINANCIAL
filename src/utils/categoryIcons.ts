import type { LucideIcon } from 'lucide-react'
import {
  Coffee,
  Utensils,
  House,
  Car,
  ShoppingBag,
  Zap,
  HeartPulse,
  Tv,
  Wrench,
  Gift,
  Briefcase,
  Laptop,
  Coins,
  TrendingUp,
  GraduationCap,
  Plane,
  Music,
  Smartphone,
  Sparkles,
  ShieldCheck,
  CreditCard,
  BookOpen,
  Dumbbell,
  PawPrint,
  Baby,
  Smile,
} from 'lucide-react'
import type { AllowedCategoryIcon } from '../types/category'
export type { AllowedCategoryIcon }

export const ICON_MAP: Record<AllowedCategoryIcon, LucideIcon> = {
  Coffee,
  Utensils,
  House,
  Car,
  ShoppingBag,
  Zap,
  HeartPulse,
  Tv,
  Wrench,
  Gift,
  Briefcase,
  Laptop,
  Coins,
  TrendingUp,
  GraduationCap,
  Plane,
  Music,
  Smartphone,
  Sparkles,
  ShieldCheck,
  CreditCard,
  BookOpen,
  Dumbbell,
  PawPrint,
  Baby,
  Smile,
}

/**
 * Returns the LucideIcon component for a given category icon identifier.
 * Falls back safely to Wrench if icon identifier is not in the registry.
 */
export function getLucideCategoryIcon(iconName?: string): LucideIcon {
  if (iconName && iconName in ICON_MAP) {
    return ICON_MAP[iconName as AllowedCategoryIcon]
  }
  return Wrench
}
