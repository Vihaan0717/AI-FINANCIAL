import React, { useState, useEffect, useRef } from 'react'
import { ArrowLeft, ShieldCheck, AlertCircle, RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

interface OtpVerifyScreenProps {
  email: string
  onBack: () => void
  onSuccess: () => void
  otpType?: 'email' | 'signup'
}

export const OtpVerifyScreen: React.FC<OtpVerifyScreenProps> = ({
  email,
  onBack,
  onSuccess,
  otpType = 'email',
}) => {
  const { verifyOtp, signInWithOtp } = useAuth()

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [isVerifying, setIsVerifying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [timerSeconds, setTimerSeconds] = useState(45)
  const [canResend, setCanResend] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Resend countdown timer
  useEffect(() => {
    if (timerSeconds <= 0) {
      setCanResend(true)
      return
    }
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev - 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [timerSeconds])

  // Focus the first digit input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleDigitChange = (index: number, value: string) => {
    // Only accept numeric digits
    const cleaned = value.replace(/\D/g, '')
    if (!cleaned) {
      const next = [...digits]
      next[index] = ''
      setDigits(next)
      return
    }

    // Handle single digit
    const char = cleaned.charAt(cleaned.length - 1)
    const next = [...digits]
    next[index] = char
    setDigits(next)
    setErrorMessage(null)

    // Auto-advance to next input
    if (index < 5) {
      inputRefs.current[index + 1]?.focus()
    } else {
      // If 6th digit entered, auto submit
      const fullCode = next.join('')
      if (fullCode.length === 6) {
        submitCode(fullCode)
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return

    const next = [...digits]
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || ''
    }
    setDigits(next)
    setErrorMessage(null)

    const focusIndex = Math.min(pasted.length, 5)
    inputRefs.current[focusIndex]?.focus()

    if (pasted.length === 6) {
      submitCode(pasted)
    }
  }

  const submitCode = async (codeToVerify?: string) => {
    const code = codeToVerify || digits.join('')
    if (code.length !== 6) {
      setErrorMessage('Please enter all 6 digits of the code.')
      return
    }

    setIsVerifying(true)
    setErrorMessage(null)

    try {
      const { session, error } = await verifyOtp(email, code, otpType)
      if (error) {
        setErrorMessage(error)
        setIsVerifying(false)
        return
      }

      if (session) {
        onSuccess()
      } else {
        // Even if session wasn't immediately returned, user is verified
        onSuccess()
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Verification failed. Please check the code and try again.')
      setIsVerifying(false)
    }
  }

  const handleResend = async () => {
    if (!canResend) return
    setCanResend(false)
    setTimerSeconds(45)
    setResendSuccess(false)
    setErrorMessage(null)

    try {
      const { error } = await signInWithOtp(email)
      if (error) {
        setErrorMessage(error)
      } else {
        setResendSuccess(true)
        setTimeout(() => setResendSuccess(false), 4000)
      }
    } catch {
      setErrorMessage('Failed to resend code. Please try again.')
    }
  }

  return (
    <div className="auth-otp-screen" style={{ animation: 'authFadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Back button */}
      <button
        type="button"
        className="auth-back-btn"
        onClick={onBack}
        id="auth-otp-back"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      {/* Security Pill */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '999px',
          background: 'rgba(139, 92, 246, 0.12)',
          color: '#7c3aed',
          fontSize: '10.5px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '12px 0 10px',
        }}
      >
        <ShieldCheck size={13} />
        <span>Secure In-App Verification</span>
      </div>

      <h1 className="auth-hero-heading" style={{ fontSize: '24px' }}>
        Enter 6-Digit Code
      </h1>
      <p className="auth-subtitle" style={{ marginBottom: '18px' }}>
        We sent a verification code to <strong style={{ color: 'var(--lg-accent, #6d3fe0)' }}>{email}</strong>.
        Enter the numbers below to securely access your financial workspace.
      </p>

      {/* Error alert */}
      {errorMessage && (
        <div className="auth-alert error" role="alert" style={{ marginBottom: '16px' }}>
          <AlertCircle size={17} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Resend success notice */}
      {resendSuccess && (
        <div
          className="auth-alert success"
          role="status"
          style={{
            marginBottom: '16px',
            background: 'rgba(16, 185, 129, 0.12)',
            borderColor: 'rgba(16, 185, 129, 0.3)',
            color: '#059669',
          }}
        >
          <ShieldCheck size={17} style={{ flexShrink: 0 }} />
          <span>A fresh 6-digit code was sent to your inbox.</span>
        </div>
      )}

      {/* 6 Digit Input Boxes */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          margin: '22px 0',
        }}
      >
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputRefs.current[idx] = el
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={idx === 0 ? handlePaste : undefined}
            disabled={isVerifying}
            id={`auth-otp-digit-${idx}`}
            aria-label={`Digit ${idx + 1}`}
            style={{
              width: 'clamp(40px, 12vw, 48px)',
              height: 'clamp(48px, 13vw, 56px)',
              textAlign: 'center',
              fontSize: '22px',
              fontWeight: 750,
              borderRadius: '14px',
              border: digit
                ? '2px solid #7c3aed'
                : '1.5px solid rgba(139, 92, 246, 0.25)',
              background: 'rgba(255, 255, 255, 0.85)',
              color: '#1f1a3d',
              outline: 'none',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              boxShadow: digit
                ? '0 4px 14px rgba(124, 58, 237, 0.22)'
                : '0 2px 6px rgba(0, 0, 0, 0.04)',
            }}
          />
        ))}
      </div>

      {/* Submit Button */}
      <button
        type="button"
        className="auth-primary-btn"
        disabled={isVerifying || digits.join('').length !== 6}
        onClick={() => submitCode()}
        id="auth-otp-submit"
        style={{ marginTop: '8px' }}
      >
        {isVerifying ? (
          <>
            <span className="auth-spinner" />
            <span>Verifying Code...</span>
          </>
        ) : (
          'Verify & Enter'
        )}
      </button>

      {/* Resend Action */}
      <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '12px', color: '#6d6796' }}>
        {canResend ? (
          <button
            type="button"
            className="auth-text-link"
            onClick={handleResend}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <RotateCcw size={13} />
            <span>Resend Code to Gmail</span>
          </button>
        ) : (
          <span>Resend code in {timerSeconds}s</span>
        )}
      </div>
    </div>
  )
}
