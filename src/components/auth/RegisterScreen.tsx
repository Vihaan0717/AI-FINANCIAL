import React, { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, AlertCircle, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface RegisterScreenProps {
  onBack: () => void
  onNavigateToLogin: () => void
  onSuccess?: () => void
  onRequireOtp?: (email: string) => void
}

export const RegisterScreen: React.FC<RegisterScreenProps> = ({
  onBack,
  onNavigateToLogin,
  onSuccess,
  onRequireOtp,
}) => {
  const { signUp, signIn, isConfigured } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const validate = (): string | null => {
    if (!fullName.trim()) {
      return 'Please enter your full name.'
    }
    if (!email.trim()) {
      return 'Please enter your email address.'
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return 'Please enter a valid email address.'
    }
    if (!password) {
      return 'Please choose a password.'
    }
    if (password.length < 6) {
      return 'Password must be at least 6 characters long.'
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match. Please verify.'
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage(null)

    if (!isConfigured) {
      setErrorMessage(
        'Supabase authentication is not configured in this environment.'
      )
      return
    }

    const validationError = validate()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      const res = await signUp(email.trim(), password, fullName.trim())

      if (res.error) {
        if (res.error.toLowerCase().includes('already registered')) {
          setErrorMessage('This email is already registered. Please sign in instead.')
        } else {
          setErrorMessage(res.error)
        }
        setIsSubmitting(false)
        return
      }

      // Persist user display name and email for profile
      if (fullName.trim()) {
        localStorage.setItem('moneymate_display_name', fullName.trim())
      }
      localStorage.setItem('moneymate_user_email', email.trim())

      // If email confirmation is required by Supabase (no active session returned),
      // transition to the 6-digit OTP verification screen
      if (!res.session && onRequireOtp) {
        onRequireOtp(email.trim())
        return
      }

      // Auto sign in to establish session
      await signIn(email.trim(), password)

      // Advance directly to post-registration onboarding instructions
      if (onSuccess) {
        onSuccess()
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred during account creation.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-register-screen" style={{ animation: 'authFadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Back button */}
      <button
        type="button"
        className="auth-back-btn"
        onClick={onBack}
        id="auth-register-back"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      <h1 className="auth-hero-heading" style={{ fontSize: '26px' }}>
        Create an Account
      </h1>
      <p className="auth-subtitle" style={{ marginBottom: '22px' }}>
        Enter your details to create your private financial workspace.
      </p>

      {!isConfigured && (
        <div className="auth-alert warning" role="alert">
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <span>Supabase credentials are missing in this environment.</span>
        </div>
      )}

      {errorMessage && (
        <div className="auth-alert error" style={{ marginBottom: '16px' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {/* Full Name */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-fullname">
            Full Name
          </label>
          <div className="auth-input-wrapper">
            <input
              id="register-fullname"
              type="text"
              className="auth-input"
              placeholder="e.g. Arjun Singh"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Email */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-email">
            Email Address
          </label>
          <div className="auth-input-wrapper">
            <input
              id="register-email"
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

        {/* Password */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-password">
            Password <span style={{ fontSize: '10px', color: '#7c77a3', fontWeight: 500 }}>(min. 6 characters)</span>
          </label>
          <div className="auth-input-wrapper with-toggle">
            <input
              id="register-password"
              type={showPassword ? 'text' : 'password'}
              className="auth-input"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-confirm-password">
            Confirm Password
          </label>
          <div className="auth-input-wrapper with-toggle">
            <input
              id="register-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              className="auth-input"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="auth-primary-btn"
          disabled={isSubmitting}
          id="auth-register-submit"
          style={{ marginTop: '8px' }}
        >
          {isSubmitting ? (
            <>
              <span className="auth-spinner" />
              <span>Creating Account...</span>
            </>
          ) : (
            'Create Account'
          )}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12.5px', color: '#5b5780' }}>
        Already have an account?{' '}
        <button
          type="button"
          className="auth-text-link"
          onClick={onNavigateToLogin}
          id="auth-register-go-to-login"
        >
          Sign In
        </button>
      </div>
    </div>
  )
}
