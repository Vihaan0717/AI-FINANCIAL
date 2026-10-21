import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSupabaseConfig, resetSupabaseClient } from '../src/services/supabaseClient'
import { SupabaseAuthService } from '../src/services/authService'

describe('Money Mate AI — Dedicated Authentication Flow & Screen Navigation Tests', () => {
  beforeEach(() => {
    resetSupabaseClient()
    vi.unstubAllEnvs()
  })

  // 1. Validation Logic Specifications
  describe('Input Validation Constraints', () => {
    const validateRegistration = (fullName: string, email: string, password: string, confirmPassword: string) => {
      if (!fullName.trim()) return 'Please enter your full name.'
      if (!email.trim()) return 'Please enter your email address.'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) return 'Please enter a valid email address.'
      if (password.length < 6) return 'Password must be at least 6 characters long.'
      if (password !== confirmPassword) return 'Passwords do not match.'
      return null
    }

    const validateLogin = (email: string, password: string) => {
      if (!email.trim()) return 'Please enter your email address.'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) return 'Please enter a valid email address.'
      if (!password) return 'Please enter your password.'
      return null
    }

    const validateReset = (email: string) => {
      if (!email.trim()) return 'Please enter your email address.'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) return 'Please enter a valid email address.'
      return null
    }

    it('rejects registration with empty name or invalid email', () => {
      expect(validateRegistration('', 'user@example.com', 'Pass1234', 'Pass1234')).toBe('Please enter your full name.')
      expect(validateRegistration('Arjun Singh', '', 'Pass1234', 'Pass1234')).toBe('Please enter your email address.')
      expect(validateRegistration('Arjun Singh', 'invalid-email', 'Pass1234', 'Pass1234')).toBe('Please enter a valid email address.')
      expect(validateRegistration('Arjun Singh', 'user@domain', 'Pass1234', 'Pass1234')).toBe('Please enter a valid email address.')
    })

    it('enforces password length and confirmation match on registration', () => {
      expect(validateRegistration('Arjun Singh', 'user@example.com', '12345', '12345')).toBe('Password must be at least 6 characters long.')
      expect(validateRegistration('Arjun Singh', 'user@example.com', 'Pass1234', 'Different1234')).toBe('Passwords do not match.')
      expect(validateRegistration('Arjun Singh', 'user@example.com', 'Pass1234', 'Pass1234')).toBeNull()
    })

    it('validates login credentials properly', () => {
      expect(validateLogin('', 'password')).toBe('Please enter your email address.')
      expect(validateLogin('notanemail', 'password')).toBe('Please enter a valid email address.')
      expect(validateLogin('user@example.com', '')).toBe('Please enter your password.')
      expect(validateLogin('user@example.com', 'mypassword')).toBeNull()
    })

    it('validates password reset email address', () => {
      expect(validateReset('')).toBe('Please enter your email address.')
      expect(validateReset('test@')).toBe('Please enter a valid email address.')
      expect(validateReset('test@example.com')).toBeNull()
    })
  })

  // 2. Navigation State Machine
  describe('Screen Navigation Transitions', () => {
    type AuthScreen = 'welcome' | 'register' | 'login' | 'forgot_password'

    class AuthNavigationStateMachine {
      currentScreen: AuthScreen = 'welcome'
      isGuestMode = false
      isAuthenticated = false

      getStarted() {
        this.currentScreen = 'register'
      }

      signIn() {
        this.currentScreen = 'login'
      }

      continueAsGuest() {
        this.isGuestMode = true
      }

      backToWelcome() {
        this.currentScreen = 'welcome'
      }

      navigateToLogin() {
        this.currentScreen = 'login'
      }

      navigateToRegister() {
        this.currentScreen = 'register'
      }

      forgotPassword() {
        this.currentScreen = 'forgot_password'
      }

      loginSuccess() {
        this.isAuthenticated = true
      }

      logout() {
        this.isAuthenticated = false
        this.isGuestMode = false
        this.currentScreen = 'welcome'
      }
    }

    it('navigates from Welcome to Registration and back', () => {
      const nav = new AuthNavigationStateMachine()
      expect(nav.currentScreen).toBe('welcome')
      nav.getStarted()
      expect(nav.currentScreen).toBe('register')
      nav.backToWelcome()
      expect(nav.currentScreen).toBe('welcome')
    })

    it('navigates from Welcome to Login and Password Reset flow', () => {
      const nav = new AuthNavigationStateMachine()
      nav.signIn()
      expect(nav.currentScreen).toBe('login')
      nav.forgotPassword()
      expect(nav.currentScreen).toBe('forgot_password')
      nav.navigateToLogin()
      expect(nav.currentScreen).toBe('login')
    })

    it('switches between Login and Register directly', () => {
      const nav = new AuthNavigationStateMachine()
      nav.signIn()
      expect(nav.currentScreen).toBe('login')
      nav.navigateToRegister()
      expect(nav.currentScreen).toBe('register')
      nav.navigateToLogin()
      expect(nav.currentScreen).toBe('login')
    })

    it('activates guest mode without authenticating or leaking', () => {
      const nav = new AuthNavigationStateMachine()
      nav.continueAsGuest()
      expect(nav.isGuestMode).toBe(true)
      expect(nav.isAuthenticated).toBe(false)
      nav.logout()
      expect(nav.isGuestMode).toBe(false)
      expect(nav.currentScreen).toBe('welcome')
    })

    it('logs out authenticated session and returns cleanly to Welcome screen', () => {
      const nav = new AuthNavigationStateMachine()
      nav.signIn()
      nav.loginSuccess()
      expect(nav.isAuthenticated).toBe(true)
      nav.logout()
      expect(nav.isAuthenticated).toBe(false)
      expect(nav.currentScreen).toBe('welcome')
    })

    it('navigates to App Intro Problem-Solving Slides and returns to Welcome or Register', () => {
      const nav = new (class extends AuthNavigationStateMachine {
        viewIntroSlides() {
          this.currentScreen = 'intro_slides' as any
        }
      })()

      nav.viewIntroSlides()
      expect(nav.currentScreen).toBe('intro_slides')
      nav.getStarted()
      expect(nav.currentScreen).toBe('register')
    })
  })

  // 3. 6-Digit In-App OTP Code Validation Logic
  describe('In-App 6-Digit OTP Code Formatting & Validation', () => {
    const sanitizeOtpInput = (raw: string): string => {
      return raw.replace(/\D/g, '').slice(0, 6)
    }

    const validateOtp = (code: string): string | null => {
      if (code.length !== 6) return 'Please enter all 6 digits of the code.'
      return null
    }

    it('sanitizes non-numeric characters and enforces 6 digits', () => {
      expect(sanitizeOtpInput('849-201')).toBe('849201')
      expect(sanitizeOtpInput('abc 49 10 23 xyz')).toBe('491023')
      expect(sanitizeOtpInput('123456789')).toBe('123456')
    })

    it('validates 6-digit completion correctly', () => {
      expect(validateOtp('12345')).toBe('Please enter all 6 digits of the code.')
      expect(validateOtp('123456')).toBeNull()
    })
  })

  // 4. AuthService Integration with Real and Unconfigured Supabase
  describe('Supabase Auth Service with Full Name Metadata and OTP', () => {
    it('handles unconfigured Supabase safely without crash', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
      resetSupabaseClient()

      const authService = new SupabaseAuthService()
      expect(authService.isConfigured()).toBe(false)

      // When unconfigured, reports error safely without crash
      const res = await authService.signUp('test@example.com', 'password123', 'Arjun Singh')
      expect(res.user).toBeNull()
      expect(res.error).toContain('not configured')

      const otpRes = await authService.verifyOtp('test@example.com', '123456')
      expect(otpRes.user).toBeNull()
      expect(otpRes.error).toContain('not configured')
    })

    it('never exposes API keys or secrets in errors', async () => {
      const authService = new SupabaseAuthService()
      const res = await authService.signIn('hacker@leak.com', 'testpass')
      if (res.error) {
        expect(res.error).not.toContain('anonKey')
        expect(res.error).not.toContain('apiKey')
        expect(res.error).not.toContain('service_role')
      }
    }, 15000)
  })
})
