import React from 'react'
import { ArrowRight } from 'lucide-react'
import { DynamicLivingOrb } from './AppIntroSlides'

interface WelcomeScreenProps {
  onGetStarted: () => void
  onSignIn: () => void
  onContinueAsGuest?: () => void
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onGetStarted,
  onSignIn,
  onContinueAsGuest,
}) => {
  return (
    <div style={{ textAlign: 'center', padding: '10px 4px 6px' }}>
      {/* Dynamic Living 3D Hero Orb */}
      <div style={{ marginBottom: '22px', display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <DynamicLivingOrb size={104} showRings={true} interactive={true} />
      </div>

      <div style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
        Introducing
      </div>
      <h1 className="auth-hero-heading" style={{ fontSize: '26px', marginBottom: '8px', letterSpacing: '-0.02em' }}>
        FinanceAI
      </h1>
      <p className="auth-subtitle" style={{ maxWidth: '300px', margin: '0 auto 26px', fontSize: '12.5px', lineHeight: 1.45, color: '#9ca3af' }}>
        Smart analysis of your goals, budgets, and habits with private on-device intelligence.
      </p>

      {/* Action Buttons */}
      <div className="auth-actions-stack">
        <button
          type="button"
          className="auth-primary-btn"
          onClick={onGetStarted}
          id="auth-welcome-get-started"
        >
          <span>Get Started</span>
          <ArrowRight size={17} />
        </button>

        <button
          type="button"
          className="auth-secondary-btn"
          onClick={onSignIn}
          id="auth-welcome-sign-in"
        >
          I Already Have an Account
        </button>

        {onContinueAsGuest && (
          <button
            type="button"
            className="auth-secondary-btn"
            style={{ marginTop: '4px', opacity: 0.9 }}
            onClick={onContinueAsGuest}
            id="auth-welcome-continue-guest"
          >
            Explore App as Guest
          </button>
        )}
      </div>
    </div>
  )
}
