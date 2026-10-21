import React, { useState, useEffect, useCallback } from 'react'
import { Shield, Delete, AlertCircle, RefreshCw } from 'lucide-react'
import { pinAuthService } from '../../services/pinAuthService'
import { DynamicLivingOrb } from './AppIntroSlides'

interface PinLockScreenProps {
  onUnlockSuccess: (user: { id: string; fullName: string; email: string }) => void
  onSwitchAccount?: () => void
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  onUnlockSuccess,
  onSwitchAccount,
}) => {
  const [pin, setPin] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [shake, setShake] = useState(false)
  const [lockoutSeconds, setLockoutSeconds] = useState(0)

  const profile = pinAuthService.getProfile()

  // Sync lockout countdown
  useEffect(() => {
    const checkLockout = () => {
      const status = pinAuthService.getLockoutStatus()
      if (status.isLocked) {
        setLockoutSeconds(status.remainingSeconds)
      } else {
        setLockoutSeconds(0)
      }
    }

    checkLockout()
    const timer = setInterval(checkLockout, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleDigit = useCallback(
    (digit: string) => {
      if (lockoutSeconds > 0 || isVerifying) return
      setErrorMessage(null)
      if (pin.length < 4) {
        const next = pin + digit
        setPin(next)
        if (next.length === 4) {
          triggerVerify(next)
        }
      }
    },
    [pin, lockoutSeconds, isVerifying]
  )

  const handleDelete = useCallback(() => {
    if (lockoutSeconds > 0 || isVerifying) return
    setPin((prev) => prev.slice(0, -1))
    setErrorMessage(null)
  }, [lockoutSeconds, isVerifying])

  const handleClear = useCallback(() => {
    if (lockoutSeconds > 0 || isVerifying) return
    setPin('')
    setErrorMessage(null)
  }, [lockoutSeconds, isVerifying])

  // Support physical keyboard typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        handleDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        handleDelete()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleClear()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDigit, handleDelete, handleClear])

  const triggerVerify = async (pinToTest: string) => {
    setIsVerifying(true)
    const result = await pinAuthService.verifyPin(pinToTest)
    setIsVerifying(false)

    if (result.success && result.user) {
      onUnlockSuccess(result.user)
    } else {
      setErrorMessage(result.error || 'Incorrect PIN')
      setShake(true)
      setTimeout(() => {
        setShake(false)
        setPin('')
      }, 500)
      if (result.lockedForSeconds) {
        setLockoutSeconds(result.lockedForSeconds)
      }
    }
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div
      className="auth-pin-screen"
      style={{
        textAlign: 'center',
        padding: '12px 10px',
        animation: 'authFadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Living 3D Orb Header */}
      <div style={{ marginBottom: '18px', display: 'flex', justifyContent: 'center' }}>
        <DynamicLivingOrb size={88} showRings={true} interactive={true} />
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#8b5cf6', fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <Shield size={14} />
        <span>Bank-Grade PIN Protection</span>
      </div>

      <h1 className="auth-hero-heading" style={{ fontSize: '24px', marginBottom: '4px' }}>
        {profile?.fullName ? `Welcome back, ${profile.fullName.split(' ')[0]}` : 'Unlock Money Mate'}
      </h1>
      <p className="auth-subtitle" style={{ fontSize: '12.5px', marginBottom: '22px' }}>
        {lockoutSeconds > 0
          ? `Account locked. Please wait ${lockoutSeconds}s`
          : 'Enter your 4-digit security PIN'}
      </p>

      {/* 4-Dot Indicators */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '16px',
          marginBottom: '24px',
          transform: shake ? 'translateX(-6px)' : 'none',
          transition: shake ? 'transform 0.08s ease' : 'none',
        }}
      >
        {[0, 1, 2, 3].map((idx) => {
          const filled = pin.length > idx
          return (
            <div
              key={idx}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                border: filled ? '2px solid #8b5cf6' : '2px solid rgba(139, 92, 246, 0.25)',
                background: filled
                  ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
                  : 'rgba(255, 255, 255, 0.1)',
                boxShadow: filled
                  ? '0 0 16px rgba(139, 92, 246, 0.6), inset 0 1px 2px rgba(255,255,255,0.4)'
                  : 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                transform: filled ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          )
        })}
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '8px 14px',
            marginBottom: '18px',
            color: '#ef4444',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <AlertCircle size={15} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Liquid Glass Keypad */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          maxWidth: '280px',
          margin: '0 auto 20px',
        }}
      >
        {digits.map((num) => (
          <button
            key={num}
            type="button"
            disabled={lockoutSeconds > 0 || isVerifying}
            onClick={() => handleDigit(num)}
            className="pin-keypad-btn"
            style={{
              height: '56px',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: '#1e1b4b',
              fontSize: '22px',
              fontWeight: 700,
              cursor: lockoutSeconds > 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.15s ease',
              opacity: lockoutSeconds > 0 ? 0.4 : 1,
            }}
          >
            {num}
          </button>
        ))}

        {/* Clear Button */}
        <button
          type="button"
          disabled={lockoutSeconds > 0 || isVerifying || pin.length === 0}
          onClick={handleClear}
          style={{
            height: '56px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'transparent',
            color: '#6b7280',
            fontSize: '11px',
            fontWeight: 700,
            cursor: pin.length === 0 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pin.length > 0 ? 1 : 0.3,
            transition: 'all 0.15s ease',
          }}
        >
          Clear
        </button>

        {/* 0 Button */}
        <button
          type="button"
          disabled={lockoutSeconds > 0 || isVerifying}
          onClick={() => handleDigit('0')}
          className="pin-keypad-btn"
          style={{
            height: '56px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: '#1e1b4b',
            fontSize: '22px',
            fontWeight: 700,
            cursor: lockoutSeconds > 0 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
            transition: 'all 0.15s ease',
            opacity: lockoutSeconds > 0 ? 0.4 : 1,
          }}
        >
          0
        </button>

        {/* Backspace Button */}
        <button
          type="button"
          disabled={lockoutSeconds > 0 || isVerifying || pin.length === 0}
          onClick={handleDelete}
          style={{
            height: '56px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'transparent',
            color: '#6b7280',
            fontSize: '18px',
            cursor: pin.length === 0 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pin.length > 0 ? 1 : 0.3,
            transition: 'all 0.15s ease',
          }}
        >
          <Delete size={20} />
        </button>
      </div>

      {/* Switch Account / Reset Action */}
      {onSwitchAccount && (
        <button
          type="button"
          onClick={onSwitchAccount}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            transition: 'color 0.2s ease',
          }}
        >
          <RefreshCw size={13} />
          <span>Switch Account / Create New PIN</span>
        </button>
      )}
    </div>
  )
}
