import type { User, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
  isConfigured: boolean
}

export type AuthListener = (state: AuthState) => void

/**
 * Authentication Service managing registration, login, logout, password recovery,
 * and account deletion via Supabase Auth.
 */
export class SupabaseAuthService {
  private client = getSupabaseClient()

  isConfigured(): boolean {
    return this.client !== null
  }

  async getInitialSession(): Promise<AuthState> {
    if (!this.client) {
      return {
        user: null,
        session: null,
        loading: false,
        error: null,
        isConfigured: false,
      }
    }

    try {
      const { data, error } = await this.client.auth.getSession()
      if (error) {
        return {
          user: null,
          session: null,
          loading: false,
          error: error.message,
          isConfigured: true,
        }
      }

      return {
        user: data.session?.user || null,
        session: data.session || null,
        loading: false,
        error: null,
        isConfigured: true,
      }
    } catch (err) {
      return {
        user: null,
        session: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to retrieve session',
        isConfigured: true,
      }
    }
  }

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    if (!this.client) {
      return { unsubscribe: () => {} }
    }

    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      callback(event, session)
    })

    return {
      unsubscribe: () => {
        data.subscription.unsubscribe()
      },
    }
  }

  async signUp(email: string, password: string): Promise<{ user: User | null; error: string | null }> {
    if (!this.client) {
      return { user: null, error: 'Supabase authentication is not configured in this environment.' }
    }

    try {
      const { data, error } = await this.client.auth.signUp({
        email: email.trim(),
        password,
      })

      if (error) {
        return { user: null, error: error.message }
      }

      return { user: data.user, error: null }
    } catch (err) {
      return { user: null, error: err instanceof Error ? err.message : 'Sign up failed.' }
    }
  }

  async signIn(email: string, password: string): Promise<{ user: User | null; error: string | null }> {
    if (!this.client) {
      return { user: null, error: 'Supabase authentication is not configured in this environment.' }
    }

    try {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        return { user: null, error: error.message }
      }

      return { user: data.user, error: null }
    } catch (err) {
      return { user: null, error: err instanceof Error ? err.message : 'Login failed.' }
    }
  }

  async signOut(): Promise<{ error: string | null }> {
    if (!this.client) {
      return { error: null }
    }

    try {
      const { error } = await this.client.auth.signOut()
      if (error) {
        return { error: error.message }
      }
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Logout failed.' }
    }
  }

  async resetPasswordForEmail(email: string): Promise<{ error: string | null }> {
    if (!this.client) {
      return { error: 'Supabase authentication is not configured in this environment.' }
    }

    try {
      const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined
      const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      })

      if (error) {
        return { error: error.message }
      }

      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Password reset request failed.' }
    }
  }
}

export const authService = new SupabaseAuthService()
