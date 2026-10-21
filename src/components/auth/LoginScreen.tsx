import React, { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, AlertCircle, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface LoginScreenProps {
  onBack: () => void
  onNavigateToRegister: () => void
  onForgotPassword: () => void
  onSuccess?: () => void
  onRequireOtp?: (email: string) => void
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onBack,
  onNavigateToRegister,
  onForgotPassword,
  onSuccess,
  onRequireOtp,
}) => {
  const { signIn, signInWithOtp, isConfigured } = useAuth()

  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const validate = (): string | null => {
    if (!email.trim()) {
      return 'Please enter your email address.'
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return 'Please enter a valid email address.'
    }
    if (authMethod === 'password' && !password) {
      return 'Please enter your password.'
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage(null)

    if (!isConfigured) {
      setErrorMessage('Supabase authentication is not configured in this environment.')
      return
    }

    const validationError = validate()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      if (authMethod === 'otp') {
        const { error } = await signInWithOtp(email.trim())
        if (error) {
          setErrorMessage(error)
          setIsSubmitting(false)
          return
        }
        localStorage.setItem('moneymate_user_email', email.trim())
        if (onRequireOtp) {
          onRequireOtp(email.trim())
        }
        return
      }

      const { user, error } = await signIn(email, password)

      if (error) {
        if (error.toLowerCase().includes('invalid login credentials')) {
          setErrorMessage('Incorrect email or password. Please try again.')
          setIsSubmitting(false)
          return
        } else if (error.toLowerCase().includes('email not confirmed')) {
          // If Supabase requires email verification code
          if (onRequireOtp) {
            onRequireOtp(email.trim())
            return
          }
          localStorage.setItem('moneymate_user_email', email.trim())
          if (onSuccess) onSuccess()
          return
        } else {
          setErrorMessage(error)
          setIsSubmitting(false)
          return
        }
      }

      if (user) {
        localStorage.setItem('moneymate_user_email', email.trim())
        if (onSuccess) onSuccess()
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Sign in failed. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-login-screen" style={{ animation: 'authFadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Back button */}
      <button
        type="button"
        className="auth-back-btn"
        onClick={onBack}
        id="auth-login-back"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      <h1 className="auth-hero-heading" style={{ fontSize: '26px' }}>
        Welcome back
      </h1>
      <p className="auth-subtitle" style={{ marginBottom: '16px' }}>
        {authMethod === 'password'
          ? 'Enter your email and password to access your financial workspace.'
          : 'Enter your Gmail to receive a 6-digit verification code.'}
      </p>

      {/* Auth Method Segmented Tabs */}
      <div
        style={{
          display: 'flex',
          background: 'rgba(118, 118, 128, 0.08)',
          borderRadius: '12px',
          padding: '3px',
          marginBottom: '18px',
          border: '1px solid rgba(255, 255, 255, 0.5)',
        }}
      >
        <button
          type="button"
          onClick={() => {
            setAuthMethod('password')
            setErrorMessage(null)
          }}
          style={{
            flex: 1,
            padding: '7px 0',
            fontSize: '12px',
            fontWeight: authMethod === 'password' ? 700 : 500,
            color: authMethod === 'password' ? '#1f1a3d' : '#6b7280',
            background: authMethod === 'password' ? '#ffffff' : 'transparent',
            borderRadius: '9px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: authMethod === 'password' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => {
            setAuthMethod('otp')
            setErrorMessage(null)
          }}
          id="auth-toggle-otp-method"
          style={{
            flex: 1,
            padding: '7px 0',
            fontSize: '12px',
            fontWeight: authMethod === 'otp' ? 700 : 500,
            color: authMethod === 'otp' ? '#1f1a3d' : '#6b7280',
            background: authMethod === 'otp' ? '#ffffff' : 'transparent',
            borderRadius: '9px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: authMethod === 'otp' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          Gmail OTP Code
        </button>
      </div>

      {/* Unconfigured Alert */}
      {!isConfigured && (
        <div className="auth-alert warning" role="alert">
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <span>Supabase credentials are missing in this environment.</span>
        </div>
      )}

      {/* Error alert */}
      {errorMessage && (
        <div className="auth-alert error" role="alert" id="auth-login-error">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Email field */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="login-email">
            Email Address
          </label>
          <div className="auth-input-wrapper">
            <input
              id="login-email"
              type="email"
              className="auth-input"
              placeholder="name@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Password field - only in password mode */}
        {authMethod === 'password' && (
          <div className="auth-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="auth-label" htmlFor="login-password" style={{ margin: 0 }}>
                Password
              </label>
              <button
                type="button"
                className="auth-text-link"
                onClick={onForgotPassword}
                id="auth-forgot-password-link"
                style={{ fontSize: '11.5px' }}
              >
                Forgot Password?
              </button>
            </div>
            <div className="auth-input-wrapper with-toggle">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="auth-eye-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {authMethod === 'otp' && (
          <p style={{ fontSize: '12px', color: '#6b7280', margin: '4px 0 16px', lineHeight: 1.4 }}>
            We will send a 6-digit confirmation code directly to your email inbox. No password required.
          </p>
        )}

        {/* Submit CTA */}
        <button
          type="submit"
          className="auth-primary-btn"
          disabled={isSubmitting}
          id="auth-login-submit"
          style={{ marginTop: '10px' }}
        >
          {isSubmitting ? (
            <>
              <span className="auth-spinner" />
              <span>{authMethod === 'otp' ? 'Sending Code...' : 'Signing In...'}</span>
            </>
          ) : authMethod === 'otp' ? (
            'Send 6-Digit Code'
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      {/* Create Account link */}
      <div style={{ textAlign: 'center', marginTop: '22px', fontSize: '12.5px', color: '#5b5780' }}>
        Don&apos;t have an account?{' '}
        <button
          type="button"
          className="auth-text-link"
          onClick={onNavigateToRegister}
          id="auth-login-go-to-register"
        >
          Create Account
        </button>
      </div>
    </div>
  )
}
