import React, { useState } from 'react'
import {
  X,
  ReceiptText,
  Activity,
  Package,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

interface AuthOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  initialTab?: 'onboarding' | 'auth'
  initialAuthMode?: 'signin' | 'signup'
}

interface SlideData {
  id: number
  badge: string
  title: string
  description: string
  icon: React.ComponentType<{ size?: number; color?: string; className?: string }>
  gradient: string
  features: string[]
}

const ONBOARDING_SLIDES: SlideData[] = [
  {
    id: 0,
    badge: 'AI RECEIPT SCANNER',
    title: 'Zero Manual Typing',
    description:
      'Snap paper bills or digital receipts. Client-side Tesseract & multimodal Gemini OCR parse rupees, merchants, and categories in seconds.',
    icon: ReceiptText,
    gradient: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
    features: [
      '100% private offline WebAssembly OCR',
      'Automatic Rupee & tax extraction',
      'Smart merchant and category tagging',
    ],
  },
  {
    id: 1,
    badge: 'LIQUID CASH FLOW',
    title: 'Dynamic Financial Waves',
    description:
      'Real-time spending waves and 50/30/20 needs-vs-wants classification give you instant clarity over your safe spendable funds.',
    icon: Activity,
    gradient: 'linear-gradient(135deg, #38bdf8, #2563eb)',
    features: [
      'Protected spendable balance after planned dues',
      'Inter-account transfer double-counting prevention',
      'Visual budget progress rings',
    ],
  },
  {
    id: 2,
    badge: 'INVENTORY & SHOPPING',
    title: 'Smart Kitchen & Pantry Sync',
    description:
      'Keep your essentials stocked. Real-time consumption tracking auto-populates shopping lists and calculates your true cost per meal.',
    icon: Package,
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    features: [
      'Low-stock auto replenishment triggers',
      'Unit price intelligence & store comparisons',
      'One-tap purchase resolution into transactions',
    ],
  },
  {
    id: 3,
    badge: 'BANK-GRADE SECURITY',
    title: 'Isolated Multi-Device Cloud',
    description:
      'Your financial records are protected by Supabase Row-Level Security (RLS). Encrypted, isolated, and accessible only by you.',
    icon: ShieldCheck,
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    features: [
      'Row-Level Security (RLS) guarantees data isolation',
      'Instant 6-digit email OTP or password auth',
      'Seamless multi-device cloud synchronization',
    ],
  },
]

export const AuthOnboardingModal: React.FC<AuthOnboardingModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'onboarding',
  initialAuthMode = 'signin',
}) => {
  const { signIn, signUp, signInWithOtp, verifyOtp } = useAuth()

  const [activeView, setActiveView] = useState<'onboarding' | 'auth'>(initialTab)
  const [slideIndex, setSlideIndex] = useState(0)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>(initialAuthMode)
  const [authMethod, setAuthMethod] = useState<'otp' | 'password'>('password')

  // Form State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  if (!isOpen) return null

  const handleNextSlide = () => {
    if (slideIndex < ONBOARDING_SLIDES.length - 1) {
      setSlideIndex(slideIndex + 1)
    } else {
      setActiveView('auth')
    }
  }

  const handlePrevSlide = () => {
    if (slideIndex > 0) {
      setSlideIndex(slideIndex - 1)
    }
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid email address.' })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    const res = await signInWithOtp(email.trim())
    setIsSubmitting(false)

    if (res.error) {
      setStatusMessage({ type: 'error', text: res.error })
    } else {
      setOtpSent(true)
      setStatusMessage({ type: 'success', text: `6-digit verification code sent to ${email.trim()}!` })
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setStatusMessage({ type: 'error', text: 'Please enter the 6-digit code received in your email.' })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    const res = await verifyOtp(email.trim(), otpCode.trim())
    setIsSubmitting(false)

    if (res.error) {
      setStatusMessage({ type: 'error', text: res.error })
    } else {
      setStatusMessage({ type: 'success', text: 'Signed in successfully! Welcome to Money Mate.' })
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 700)
    }
  }

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid email address.' })
      return
    }

    if (password.length < 6) {
      setStatusMessage({ type: 'error', text: 'Password must be at least 6 characters long.' })
      return
    }

    if (authMode === 'signup' && password !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'Passwords do not match. Please re-enter.' })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    if (authMode === 'signin') {
      const res = await signIn(email.trim(), password)
      setIsSubmitting(false)

      if (res.error) {
        setStatusMessage({ type: 'error', text: res.error })
      } else {
        setStatusMessage({ type: 'success', text: 'Signed in successfully!' })
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 700)
      }
    } else {
      const res = await signUp(email.trim(), password)
      setIsSubmitting(false)

      if (res.error) {
        setStatusMessage({ type: 'error', text: res.error })
      } else {
        setStatusMessage({
          type: 'success',
          text: 'Registration successful! If confirmation is required, check your inbox.',
        })
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 1200)
      }
    }
  }

  const currentSlide = ONBOARDING_SLIDES[slideIndex]
  const SlideIcon = currentSlide.icon

  return (
    <div className="liquid-auth-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="liquid-auth-card" onClick={(e) => e.stopPropagation()}>
        <button className="liquid-auth-close-btn" onClick={onClose} aria-label="Close dialog">
          <X size={18} />
        </button>

        {activeView === 'onboarding' ? (
          <div>
            {/* Top view switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#6d3fe0',
                  textTransform: 'uppercase',
                }}
              >
                {currentSlide.badge}
              </span>
              <button
                className="liquid-auth-link"
                onClick={() => setActiveView('auth')}
                style={{ fontSize: '11px', color: '#5b5780' }}
              >
                Skip to Sign In →
              </button>
            </div>

            {/* Slide Body */}
            <div className="liquid-auth-slide-viewport">
              <div
                className="liquid-auth-slide-icon-wrap"
                style={{ background: currentSlide.gradient, color: '#ffffff' }}
              >
                <SlideIcon size={32} />
              </div>

              <h2 className="liquid-auth-slide-title">{currentSlide.title}</h2>
              <p className="liquid-auth-slide-desc">{currentSlide.description}</p>

              <div className="liquid-auth-feature-list">
                {currentSlide.features.map((feat, i) => (
                  <div key={i} className="liquid-auth-feature-pill">
                    <CheckCircle2 size={14} color="#10b981" />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Dots navigation */}
            <div className="liquid-auth-dots">
              {ONBOARDING_SLIDES.map((s, idx) => (
                <button
                  key={s.id}
                  className={`liquid-auth-dot ${slideIndex === idx ? 'active' : ''}`}
                  onClick={() => setSlideIndex(idx)}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>

            {/* Slide Controls */}
            <div style={{ display: 'flex', gap: '10px' }}>
              {slideIndex > 0 && (
                <button
                  className="outline-button"
                  onClick={handlePrevSlide}
                  style={{ flex: 1, height: '44px', borderRadius: '14px', fontSize: '13px' }}
                >
                  <ArrowLeft size={16} /> Back
                </button>
              )}
              <button
                className="liquid-auth-submit-btn"
                onClick={handleNextSlide}
                style={{ flex: 2 }}
              >
                {slideIndex === ONBOARDING_SLIDES.length - 1 ? (
                  <>
                    <span>Get Started</span>
                    <Sparkles size={16} />
                  </>
                ) : (
                  <>
                    <span>Next</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Auth Top Header */}
            <div style={{ textAlign: 'center', marginBottom: '18px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '999px',
                  background: 'rgba(109, 63, 224, 0.1)',
                  color: '#6d3fe0',
                  fontSize: '11px',
                  fontWeight: 700,
                  marginBottom: '8px',
                }}
              >
                <Sparkles size={13} />
                <span>MONEY MATE CLOUD</span>
              </div>
              <h2 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 4px', color: '#1f1a3d' }}>
                {authMode === 'signin' ? 'Welcome Back' : 'Create Your Account'}
              </h2>
              <p style={{ fontSize: '12px', color: '#5b5780', margin: 0 }}>
                {authMode === 'signin'
                  ? 'Access your encrypted transactions across all devices'
                  : 'Start syncing securely with isolated Row-Level Security'}
              </p>
            </div>

            {/* Mode Tabs (Sign In / Register) */}
            <div className="liquid-auth-tab-switch">
              <button
                className={`liquid-auth-tab-btn ${authMode === 'signin' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signin')
                  setStatusMessage(null)
                  setOtpSent(false)
                }}
              >
                Sign In
              </button>
              <button
                className={`liquid-auth-tab-btn ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signup')
                  setStatusMessage(null)
                  setOtpSent(false)
                }}
              >
                Register
              </button>
            </div>

            {/* Method Tabs (Email OTP vs Password) */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              <button
                type="button"
                className="liquid-auth-link"
                style={{
                  fontSize: '11.5px',
                  color: authMethod === 'password' ? '#6d3fe0' : '#8c87ab',
                  fontWeight: authMethod === 'password' ? 800 : 500,
                  borderBottom: authMethod === 'password' ? '2px solid #6d3fe0' : '2px solid transparent',
                  paddingBottom: '2px',
                }}
                onClick={() => {
                  setAuthMethod('password')
                  setStatusMessage(null)
                }}
              >
                Password Login
              </button>
              <span style={{ color: '#c4b5fd' }}>·</span>
              <button
                type="button"
                className="liquid-auth-link"
                style={{
                  fontSize: '11.5px',
                  color: authMethod === 'otp' ? '#6d3fe0' : '#8c87ab',
                  fontWeight: authMethod === 'otp' ? 800 : 500,
                  borderBottom: authMethod === 'otp' ? '2px solid #6d3fe0' : '2px solid transparent',
                  paddingBottom: '2px',
                }}
                onClick={() => {
                  setAuthMethod('otp')
                  setStatusMessage(null)
                }}
              >
                6-Digit Email OTP (Free)
              </button>
            </div>

            {/* Status alerts */}
            {statusMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  marginBottom: '14px',
                  fontSize: '12px',
                  background:
                    statusMessage.type === 'error'
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'rgba(16, 185, 129, 0.1)',
                  color: statusMessage.type === 'error' ? '#dc2626' : '#059669',
                  border: `1px solid ${
                    statusMessage.type === 'error'
                      ? 'rgba(239, 68, 68, 0.2)'
                      : 'rgba(16, 185, 129, 0.2)'
                  }`,
                }}
              >
                {statusMessage.type === 'error' ? (
                  <AlertCircle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Form */}
            {authMethod === 'password' ? (
              <form onSubmit={handlePasswordAuth} className="liquid-auth-form">
                <div className="liquid-auth-input-group">
                  <label>Email Address</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="email"
                      required
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="liquid-auth-input"
                    />
                  </div>
                </div>

                <div className="liquid-auth-input-group">
                  <label>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="liquid-auth-input"
                    />
                  </div>
                </div>

                {authMode === 'signup' && (
                  <div className="liquid-auth-input-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="liquid-auth-input"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="liquid-auth-submit-btn"
                >
                  {isSubmitting ? (
                    'Processing...'
                  ) : authMode === 'signin' ? (
                    <>
                      <span>Sign In with Password</span>
                      <ArrowRight size={16} />
                    </>
                  ) : (
                    <>
                      <span>Create Free Account</span>
                      <Sparkles size={16} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* OTP Form */
              <div className="liquid-auth-form">
                {!otpSent ? (
                  <form onSubmit={handleSendOtp} className="liquid-auth-form">
                    <div className="liquid-auth-input-group">
                      <label>Email Address for Instant OTP</label>
                      <input
                        type="email"
                        required
                        placeholder="you@domain.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="liquid-auth-input"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="liquid-auth-submit-btn"
                    >
                      {isSubmitting ? 'Sending Code...' : 'Send 6-Digit Code'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} className="liquid-auth-form">
                    <div className="liquid-auth-input-group">
                      <label>Enter 6-Digit Code sent to {email}</label>
                      <input
                        type="text"
                        maxLength={6}
                        required
                        autoFocus
                        placeholder="123456"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        className="liquid-auth-input"
                        style={{
                          letterSpacing: '0.4em',
                          textAlign: 'center',
                          fontSize: '18px',
                          fontWeight: 700,
                        }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="liquid-auth-submit-btn"
                    >
                      {isSubmitting ? 'Verifying...' : 'Verify & Enter App'}
                    </button>
                    <button
                      type="button"
                      className="liquid-auth-link"
                      onClick={() => setOtpSent(false)}
                      style={{ marginTop: '4px', fontSize: '11px', textAlign: 'center' }}
                    >
                      Change email or resend code
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Bottom Actions & Offline Guest Mode */}
            <div className="liquid-auth-alt-switch">
              <button
                type="button"
                className="liquid-auth-link"
                onClick={() => setActiveView('onboarding')}
              >
                ← View Feature Slides
              </button>
              <span>·</span>
              <button
                type="button"
                className="liquid-auth-link"
                onClick={onClose}
              >
                Continue in Guest Mode (Offline)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
