import React, { useState } from 'react'
import { ArrowLeft, AlertCircle, CheckCircle2, ShieldAlert, KeyRound } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface ResetPasswordScreenProps {
  onBackToLogin: () => void
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onBackToLogin }) => {
  const { resetPassword, isConfigured } = useAuth()

  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage(null)
    setIsSuccess(false)

    if (!isConfigured) {
      setErrorMessage('Supabase authentication is not configured in this environment.')
      return
    }

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setErrorMessage('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)

    try {
      const res = await resetPassword(email.trim())

      if (res.error) {
        setErrorMessage(res.error)
        setIsSubmitting(false)
        return
      }

      setIsSuccess(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send password reset email.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <div className="auth-top-bar" style={{ marginBottom: '14px' }}>
        <button
          type="button"
          className="auth-icon-btn"
          onClick={onBackToLogin}
          aria-label="Back to sign in"
          title="Back to sign in"
        >
          <ArrowLeft size={17} />
        </button>
      </div>

      <div
        style={{
          width: '50px',
          height: '50px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #a78bfa, #6d3fe0)',
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          marginBottom: '16px',
          boxShadow: '0 6px 20px rgba(109, 40, 217, 0.28)',
        }}
      >
        <KeyRound size={24} />
      </div>

      <h1 className="auth-hero-heading" style={{ fontSize: '24px' }}>Reset Password</h1>
      <p className="auth-subtitle" style={{ marginBottom: '20px' }}>
        Enter the email address registered with your account. We will send you a secure link to reset your password.
      </p>

      {!isConfigured && (
        <div className="auth-alert error" style={{ marginBottom: '16px' }}>
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Missing Cloud Credentials</strong>
            <p style={{ margin: '2px 0 0', fontSize: '11px' }}>
              Supabase Auth is not configured in this environment.
            </p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="auth-alert error" style={{ marginBottom: '16px' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      {isSuccess ? (
        <div style={{ textAlign: 'center' }}>
          <div className="auth-alert success" style={{ marginBottom: '20px' }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>Reset link sent!</strong>
              <p style={{ margin: '2px 0 0', fontSize: '11.5px' }}>
                If an account exists for <strong>{email}</strong>, you will receive password reset instructions shortly.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="auth-primary-btn"
            onClick={onBackToLogin}
            id="auth-reset-back-to-login"
          >
            Back to Sign In
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reset-email">
              Email Address
            </label>
            <div className="auth-input-wrapper">
              <input
                id="reset-email"
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

          <button
            type="submit"
            className="auth-primary-btn"
            disabled={isSubmitting}
            id="auth-reset-submit"
            style={{ marginTop: '8px' }}
          >
            {isSubmitting ? (
              <>
                <span className="auth-spinner" />
                <span>Sending Reset Link...</span>
              </>
            ) : (
              'Send Reset Link'
            )}
          </button>

          <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <button
              type="button"
              className="auth-text-link"
              onClick={onBackToLogin}
            >
              Remember your password? Sign In
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
