import { useState, useEffect, useCallback } from 'react'
import { authService, type AuthState } from '../services/authService'

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
    isConfigured: authService.isConfigured(),
  })

  useEffect(() => {
    let isMounted = true

    async function initAuth() {
      const initial = await authService.getInitialSession()
      if (isMounted) {
        setAuthState(initial)
      }
    }

    initAuth()

    const { unsubscribe } = authService.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setAuthState({
          user: session?.user || null,
          session: session || null,
          loading: false,
          error: null,
          isConfigured: authService.isConfigured(),
        })
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const signUp = useCallback(async (email: string, pass: string) => {
    return authService.signUp(email, pass)
  }, [])

  const signIn = useCallback(async (email: string, pass: string) => {
    return authService.signIn(email, pass)
  }, [])

  const signOut = useCallback(async () => {
    return authService.signOut()
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    return authService.resetPasswordForEmail(email)
  }, [])

  return {
    ...authState,
    isAuthenticated: Boolean(authState.user),
    signUp,
    signIn,
    signOut,
    resetPassword,
  }
}
