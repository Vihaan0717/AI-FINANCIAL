import React, { useState } from 'react'
import { ArrowLeft, ShieldCheck, Eye, EyeOff, AlertCircle, CheckCircle2, Sparkles, KeyRound } from 'lucide-react'
import { pinAuthService } from '../../services/pinAuthService'

interface PinSetupScreenProps {
  onBack: () => void
  onSuccess: (user: { id: string; fullName: string; email: string }) => void
}

export const PinSetupScreen: React.FC<PinSetupScreenProps> = ({ onBack, onSuccess }) => {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Instant In-App OTP Preview feature
  const [showOtpTest, setShowOtpTest] = useState(false)
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null)
  const [enteredOtp, setEnteredOtp] = useState('')
  const [otpVerified, setOtpVerified] = useState(false)

  const validate = (): string | null => {
    if (!fullName.trim()) return 'Please enter your full name.'
    if (!email.trim() || !email.includes('@')) return 'Please enter a valid email address.'
    if (!/^\d{4}$/.test(pin.trim())) return 'PIN must be exactly 4 digits (e.g. 1234).'
    if (pin.trim() !== confirmPin.trim()) return 'PINs do not match. Please verify.'
    return null
  }

  const handleGenerateInAppOtp = () => {
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter an email first to test instant verification.')
      return
    }
    const res = pinAuthService.generateInAppOtp(email.trim())
    setGeneratedOtp(res.code)
    setShowOtpTest(true)
    setErrorMessage(null)
  }

  const handleVerifyInAppOtp = () => {
    if (!enteredOtp || enteredOtp.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit code shown above.')
      return
    }
    const res = pinAuthService.verifyInAppOtp(email.trim(), enteredOtp.trim())
    if (res.success) {
      setOtpVerified(true)
      setErrorMessage(null)
    } else {
      setErrorMessage(res.error || 'Invalid code.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    const err = validate()
    if (err) {
      setErrorMessage(err)
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const res = await pinAuthService.setupAccount(fullName.trim(), email.trim(), pin.trim())
      if (res.success && res.user) {
        onSuccess(res.user)
      } else {
        setErrorMessage(res.error || 'Account setup failed.')
        setIsSubmitting(false)
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create account.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-pin-setup-screen" style={{ animation: 'authFadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Back button */}
      <button
        type="button"
        className="auth-back-btn"
        onClick={onBack}
        id="auth-pin-setup-back"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <ShieldCheck size={15} />
        <span>Instant Offline & Online Security</span>
      </div>

      <h1 className="auth-hero-heading" style={{ fontSize: '24px', marginBottom: '6px' }}>
        Create Account & Set PIN
      </h1>
      <p className="auth-subtitle" style={{ marginBottom: '18px', fontSize: '12.5px' }}>
        Protect your personal finances with a private 4-digit PIN. No email delays, 100% instant access.
      </p>

      {/* Error Message */}
      {errorMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '9px 12px',
            marginBottom: '16px',
            color: '#ef4444',
            fontSize: '12.5px',
            fontWeight: 500,
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Full Name */}
        <div className="auth-field-group">
          <label className="auth-field-label" htmlFor="pin-setup-name">
            Full Name
          </label>
          <input
            id="pin-setup-name"
            type="text"
            className="auth-input"
            placeholder="e.g. Rohit Kanna"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>

        {/* Email */}
        <div className="auth-field-group">
          <label className="auth-field-label" htmlFor="pin-setup-email">
            Email Address
          </label>
          <input
            id="pin-setup-email"
            type="email"
            className="auth-input"
            placeholder="e.g. yourname@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        {/* 4-digit PIN inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          <div className="auth-field-group" style={{ marginBottom: 0 }}>
            <label className="auth-field-label" htmlFor="pin-setup-pin">
              4-Digit PIN
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="pin-setup-pin"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                className="auth-input"
                placeholder="••••"
                style={{ textAlign: 'center', letterSpacing: '4px', fontSize: '18px', fontWeight: 700 }}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>
          </div>

          <div className="auth-field-group" style={{ marginBottom: 0 }}>
            <label className="auth-field-label" htmlFor="pin-setup-confirm">
              Confirm PIN
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="pin-setup-confirm"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                className="auth-input"
                placeholder="••••"
                style={{ textAlign: 'center', letterSpacing: '4px', fontSize: '18px', fontWeight: 700 }}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>
          </div>
        </div>

        {/* Show / Hide toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => setShowPin(!showPin)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{showPin ? 'Hide PIN' : 'View PIN'}</span>
          </button>
        </div>

        {/* Optional Instant In-App OTP Preview Banner */}
        <div
          style={{
            background: 'rgba(139, 92, 246, 0.06)',
            border: '1px dashed rgba(139, 92, 246, 0.3)',
            borderRadius: '12px',
            padding: '12px 14px',
            marginBottom: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showOtpTest ? '10px' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="#8b5cf6" />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#6d28d9' }}>
                Instant OTP Verification
              </span>
            </div>
            {!showOtpTest && (
              <button
                type="button"
                onClick={handleGenerateInAppOtp}
                style={{
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  color: '#6d28d9',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Test OTP
              </button>
            )}
          </div>

          {showOtpTest && (
            <div style={{ animation: 'authFadeInUp 0.2s ease' }}>
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  marginBottom: '10px',
                  fontSize: '11.5px',
                  color: '#065f46',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>🔒 Security Code: <strong>{generatedOtp}</strong></span>
                <span style={{ fontSize: '10px', opacity: 0.8 }}>Valid 5 mins</span>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={enteredOtp}
                  onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{
                    flex: 1,
                    height: '36px',
                    borderRadius: '8px',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    background: '#ffffff',
                    padding: '0 10px',
                    fontSize: '13px',
                    letterSpacing: '2px',
                    fontWeight: 700,
                  }}
                />
                <button
                  type="button"
                  onClick={handleVerifyInAppOtp}
                  disabled={otpVerified}
                  style={{
                    background: otpVerified ? '#10b981' : '#8b5cf6',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0 12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: otpVerified ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {otpVerified ? <CheckCircle2 size={14} /> : null}
                  <span>{otpVerified ? 'Verified' : 'Verify'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="auth-primary-btn"
          disabled={isSubmitting}
          id="auth-pin-setup-submit"
          style={{ width: '100%' }}
        >
          {isSubmitting ? (
            <>
              <span className="auth-spinner" />
              <span>Securing Workspace...</span>
            </>
          ) : (
            <>
              <KeyRound size={17} />
              <span>Activate PIN & Enter App</span>
            </>
          )}
        </button>
      </form>
    </div>
  )
}
