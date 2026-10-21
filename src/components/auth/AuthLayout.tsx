import React from 'react'
import { Sun, Moon, ShieldCheck } from 'lucide-react'
import { MoneyMateLogo } from './MoneyMateLogo'
import './auth.css'

interface AuthLayoutProps {
  children: React.ReactNode
  dark: boolean
  onToggleTheme: () => void
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, dark, onToggleTheme }) => {
  return (
    <div className={`auth-page-root ${dark ? 'dark' : 'light'}`}>
      {/* Ambient background glows */}
      <div className="auth-ambient" aria-hidden="true">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />
      </div>

      <div className="auth-container">
        <header className="auth-top-bar">
          <div className="auth-brand">
            <MoneyMateLogo size={32} />
            <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginLeft: '8px' }}>
              money<strong style={{ color: '#7c3aed' }}>mate</strong>
            </span>
          </div>

          <button
            type="button"
            className="auth-icon-btn"
            onClick={onToggleTheme}
            aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
            title={`Switch to ${dark ? 'light' : 'dark'} mode`}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>

        <main className="auth-glass-card">{children}</main>

        <footer className="auth-footer-note">
          <ShieldCheck size={14} />
          <span>Developed by KANNALAB</span>
        </footer>
      </div>
    </div>
  )
}
