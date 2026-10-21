/**
 * PinAuthService - Bank-Grade Local Security PIN & Authentication System
 * Provides offline-first, instant, zero-email-dependency PIN security
 * with SHA-256 salted hashing and brute-force lockout protection.
 */

export interface PinUserProfile {
  id: string
  fullName: string
  email: string
  pinHash: string
  salt: string
  createdAt: string
  updatedAt: string
}

export interface PinSession {
  unlocked: boolean
  user: {
    id: string
    fullName: string
    email: string
  } | null
  unlockedAt: number | null
}

const STORAGE_KEY_PROFILE = 'moneymate_pin_profile'
const STORAGE_KEY_SESSION = 'moneymate_pin_session'
const STORAGE_KEY_ATTEMPTS = 'moneymate_pin_attempts'
const STORAGE_KEY_LOCKOUT = 'moneymate_pin_lockout'
const STORAGE_KEY_INAPP_OTP = 'moneymate_inapp_otp'

const MAX_ATTEMPTS = 5
const LOCKOUT_SECONDS = 30

export class PinAuthService {
  /**
   * Generates a random cryptographic salt hex string
   */
  private generateSalt(): string {
    const arr = new Uint8Array(16)
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : window.crypto
    cryptoObj.getRandomValues(arr)
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Hashes a PIN with a salt using Web Crypto SHA-256
   */
  private async hashPin(pin: string, salt: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(salt + pin)
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : window.crypto
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private isStorageAvailable(): boolean {
    return typeof localStorage !== 'undefined'
  }

  /**
   * Checks whether a PIN-secured account already exists
   */
  hasPinAccount(): boolean {
    if (!this.isStorageAvailable()) return false
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE)
    return Boolean(raw)
  }

  /**
   * Retrieves the configured profile metadata (without secrets)
   */
  getProfile(): { id: string; fullName: string; email: string; createdAt: string } | null {
    if (!this.isStorageAvailable()) return null
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE)
    if (!raw) return null
    try {
      const parsed: PinUserProfile = JSON.parse(raw)
      return {
        id: parsed.id,
        fullName: parsed.fullName,
        email: parsed.email,
        createdAt: parsed.createdAt,
      }
    } catch {
      return null
    }
  }

  /**
   * Checks if the app is currently in brute-force lockout
   */
  getLockoutStatus(): { isLocked: boolean; remainingSeconds: number } {
    if (!this.isStorageAvailable()) return { isLocked: false, remainingSeconds: 0 }
    const rawLockout = localStorage.getItem(STORAGE_KEY_LOCKOUT)
    if (!rawLockout) return { isLocked: false, remainingSeconds: 0 }

    const lockoutUntil = parseInt(rawLockout, 10)
    const now = Date.now()
    if (now < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000)
      return { isLocked: true, remainingSeconds }
    }

    // Lockout expired, clear attempts
    localStorage.removeItem(STORAGE_KEY_LOCKOUT)
    localStorage.removeItem(STORAGE_KEY_ATTEMPTS)
    return { isLocked: false, remainingSeconds: 0 }
  }

  /**
   * Registers a new user account secured by a 4-digit or 6-digit PIN
   */
  async setupAccount(
    fullName: string,
    email: string,
    pin: string
  ): Promise<{ success: boolean; user?: { id: string; fullName: string; email: string }; error?: string }> {
    if (!fullName.trim()) {
      return { success: false, error: 'Please enter your full name.' }
    }
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, error: 'Please enter a valid email address.' }
    }
    const cleanPin = pin.trim()
    if (!/^\d{4,6}$/.test(cleanPin)) {
      return { success: false, error: 'PIN must be 4 to 6 numeric digits.' }
    }

    const salt = this.generateSalt()
    const pinHash = await this.hashPin(cleanPin, salt)
    const id = 'pin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()

    const profile: PinUserProfile = {
      id,
      fullName: fullName.trim(),
      email: cleanEmail,
      pinHash,
      salt,
      createdAt: now,
      updatedAt: now,
    }

    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile))
    localStorage.setItem('moneymate_display_name', profile.fullName)
    localStorage.setItem('moneymate_user_email', profile.email)

    // Unlock session immediately
    const user = { id: profile.id, fullName: profile.fullName, email: profile.email }
    this.unlockSession(user)

    return { success: true, user }
  }

  /**
   * Verifies the entered PIN against the stored hash with lockout protection
   */
  async verifyPin(
    enteredPin: string
  ): Promise<{
    success: boolean
    user?: { id: string; fullName: string; email: string }
    error?: string
    remainingAttempts?: number
    lockedForSeconds?: number
  }> {
    const lockout = this.getLockoutStatus()
    if (lockout.isLocked) {
      return {
        success: false,
        error: `Account temporarily locked due to multiple failed attempts. Please wait ${lockout.remainingSeconds}s.`,
        lockedForSeconds: lockout.remainingSeconds,
      }
    }

    const raw = localStorage.getItem(STORAGE_KEY_PROFILE)
    if (!raw) {
      return { success: false, error: 'No PIN account found. Please register first.' }
    }

    let profile: PinUserProfile
    try {
      profile = JSON.parse(raw)
    } catch {
      return { success: false, error: 'Failed to read account security data.' }
    }

    const testHash = await this.hashPin(enteredPin.trim(), profile.salt)
    if (testHash === profile.pinHash) {
      // Success! Clear failed attempts
      localStorage.removeItem(STORAGE_KEY_ATTEMPTS)
      localStorage.removeItem(STORAGE_KEY_LOCKOUT)

      const user = { id: profile.id, fullName: profile.fullName, email: profile.email }
      this.unlockSession(user)
      return { success: true, user }
    }

    // Failure: record attempt
    const currentAttempts = parseInt(localStorage.getItem(STORAGE_KEY_ATTEMPTS) || '0', 10) + 1
    localStorage.setItem(STORAGE_KEY_ATTEMPTS, currentAttempts.toString())

    if (currentAttempts >= MAX_ATTEMPTS) {
      const lockUntil = Date.now() + LOCKOUT_SECONDS * 1000
      localStorage.setItem(STORAGE_KEY_LOCKOUT, lockUntil.toString())
      return {
        success: false,
        error: `Too many incorrect attempts. Account locked for ${LOCKOUT_SECONDS} seconds.`,
        lockedForSeconds: LOCKOUT_SECONDS,
      }
    }

    const remaining = MAX_ATTEMPTS - currentAttempts
    return {
      success: false,
      error: `Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      remainingAttempts: remaining,
    }
  }

  /**
   * Unlocks the active session in storage
   */
  unlockSession(user: { id: string; fullName: string; email: string }): void {
    if (!this.isStorageAvailable()) return
    const session: PinSession = {
      unlocked: true,
      user,
      unlockedAt: Date.now(),
    }
    sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session))
    localStorage.setItem('moneymate_display_name', user.fullName)
    localStorage.setItem('moneymate_user_email', user.email)
  }

  /**
   * Locks the active session
   */
  lockSession(): void {
    if (!this.isStorageAvailable()) return
    sessionStorage.removeItem(STORAGE_KEY_SESSION)
  }

  /**
   * Checks whether active session is unlocked
   */
  isSessionUnlocked(): boolean {
    if (!this.isStorageAvailable()) return false
    const raw = sessionStorage.getItem(STORAGE_KEY_SESSION)
    if (!raw) return false
    try {
      const parsed: PinSession = JSON.parse(raw)
      return parsed.unlocked === true && Boolean(parsed.user)
    } catch {
      return false
    }
  }

  /**
   * Gets current logged-in user if unlocked
   */
  getActiveUser(): { id: string; fullName: string; email: string } | null {
    if (!this.isStorageAvailable()) return null
    const raw = sessionStorage.getItem(STORAGE_KEY_SESSION)
    if (!raw) return null
    try {
      const parsed: PinSession = JSON.parse(raw)
      return parsed.unlocked ? parsed.user : null
    } catch {
      return null
    }
  }

  /**
   * Fully deletes the PIN account and sessions
   */
  clearAccount(): void {
    if (!this.isStorageAvailable()) return
    localStorage.removeItem(STORAGE_KEY_PROFILE)
    localStorage.removeItem(STORAGE_KEY_ATTEMPTS)
    localStorage.removeItem(STORAGE_KEY_LOCKOUT)
    sessionStorage.removeItem(STORAGE_KEY_SESSION)
    localStorage.removeItem(STORAGE_KEY_INAPP_OTP)
  }

  /**
   * Generates a realistic 6-digit In-App OTP for instant zero-dependency verification
   */
  generateInAppOtp(email: string): { code: string; expiresAt: number } {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes
    const data = { email: email.toLowerCase().trim(), code, expiresAt }
    localStorage.setItem(STORAGE_KEY_INAPP_OTP, JSON.stringify(data))
    return { code, expiresAt }
  }

  /**
   * Verifies an in-app generated OTP
   */
  verifyInAppOtp(email: string, code: string): { success: boolean; error?: string } {
    const raw = localStorage.getItem(STORAGE_KEY_INAPP_OTP)
    if (!raw) {
      return { success: false, error: 'No verification code requested or code expired.' }
    }
    try {
      const data = JSON.parse(raw)
      if (Date.now() > data.expiresAt) {
        localStorage.removeItem(STORAGE_KEY_INAPP_OTP)
        return { success: false, error: 'Verification code has expired. Please request a new one.' }
      }
      if (data.email !== email.toLowerCase().trim()) {
        return { success: false, error: 'Verification code does not match this email address.' }
      }
      if (data.code !== code.trim()) {
        return { success: false, error: 'Invalid 6-digit code. Please verify and try again.' }
      }
      localStorage.removeItem(STORAGE_KEY_INAPP_OTP)
      return { success: true }
    } catch {
      return { success: false, error: 'Failed to verify code.' }
    }
  }
}

export const pinAuthService = new PinAuthService()
