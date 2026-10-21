import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PinAuthService } from '../src/services/pinAuthService'

describe('Money Mate AI — Bank-Grade PIN & In-App Security Suite', () => {
  let pinService: PinAuthService
  const storageMock: Record<string, string> = {}

  beforeEach(() => {
    // Clear storage mock
    for (const k in storageMock) {
      delete storageMock[k]
    }

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageMock[k] || null,
      setItem: (k: string, v: string) => {
        storageMock[k] = v
      },
      removeItem: (k: string) => {
        delete storageMock[k]
      },
      clear: () => {
        for (const k in storageMock) delete storageMock[k]
      },
    })

    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storageMock['session_' + k] || null,
      setItem: (k: string, v: string) => {
        storageMock['session_' + k] = v
      },
      removeItem: (k: string) => {
        delete storageMock['session_' + k]
      },
      clear: () => {
        for (const k in storageMock) delete storageMock[k]
      },
    })

    pinService = new PinAuthService()
  })

  describe('PIN Account Setup & Validation', () => {
    it('rejects missing full name', async () => {
      const res = await pinService.setupAccount('', 'test@example.com', '1234')
      expect(res.success).toBe(false)
      expect(res.error).toBe('Please enter your full name.')
    })

    it('rejects invalid email address', async () => {
      const res = await pinService.setupAccount('Rohit Kanna', 'notanemail', '1234')
      expect(res.success).toBe(false)
      expect(res.error).toBe('Please enter a valid email address.')
    })

    it('enforces 4 to 6 digit numeric PIN constraint', async () => {
      const res1 = await pinService.setupAccount('Rohit Kanna', 'rohit@example.com', '123')
      expect(res1.success).toBe(false)
      expect(res1.error).toBe('PIN must be 4 to 6 numeric digits.')

      const res2 = await pinService.setupAccount('Rohit Kanna', 'rohit@example.com', 'abcd')
      expect(res2.success).toBe(false)
      expect(res2.error).toBe('PIN must be 4 to 6 numeric digits.')
    })

    it('successfully creates account, hashes PIN, and establishes unlocked session', async () => {
      const res = await pinService.setupAccount('Rohit Kanna', 'rohit@example.com', '4821')
      expect(res.success).toBe(true)
      expect(res.user?.fullName).toBe('Rohit Kanna')
      expect(res.user?.email).toBe('rohit@example.com')

      expect(pinService.hasPinAccount()).toBe(true)
      expect(pinService.isSessionUnlocked()).toBe(true)

      const profile = pinService.getProfile()
      expect(profile?.fullName).toBe('Rohit Kanna')
      expect(profile?.email).toBe('rohit@example.com')
      // Secret pin is not exposed in public profile
      expect((profile as any).pinHash).toBeUndefined()
    })
  })

  describe('PIN Verification & Session Locking', () => {
    beforeEach(async () => {
      await pinService.setupAccount('Rohit Kanna', 'rohit@example.com', '4821')
    })

    it('locks and unlocks session accurately with correct PIN', async () => {
      expect(pinService.isSessionUnlocked()).toBe(true)
      pinService.lockSession()
      expect(pinService.isSessionUnlocked()).toBe(false)

      const unlockRes = await pinService.verifyPin('4821')
      expect(unlockRes.success).toBe(true)
      expect(pinService.isSessionUnlocked()).toBe(true)
    })

    it('rejects incorrect PIN and calculates remaining attempts', async () => {
      pinService.lockSession()
      const res = await pinService.verifyPin('9999')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Incorrect PIN')
      expect(res.remainingAttempts).toBe(4)
      expect(pinService.isSessionUnlocked()).toBe(false)
    })

    it('triggers 30-second lockout after 5 consecutive incorrect attempts', async () => {
      pinService.lockSession()
      await pinService.verifyPin('0001')
      await pinService.verifyPin('0002')
      await pinService.verifyPin('0003')
      await pinService.verifyPin('0004')
      const fifthAttempt = await pinService.verifyPin('0005')

      expect(fifthAttempt.success).toBe(false)
      expect(fifthAttempt.error).toContain('Account locked for 30 seconds')
      expect(fifthAttempt.lockedForSeconds).toBe(30)

      const lockout = pinService.getLockoutStatus()
      expect(lockout.isLocked).toBe(true)
      expect(lockout.remainingSeconds).toBeGreaterThan(0)

      // Even correct PIN is blocked during active lockout
      const blockedAttempt = await pinService.verifyPin('4821')
      expect(blockedAttempt.success).toBe(false)
      expect(blockedAttempt.error).toContain('Account temporarily locked')
    })
  })

  describe('Instant In-App OTP Feature', () => {
    it('generates a 6-digit in-app code with valid expiration', () => {
      const { code, expiresAt } = pinService.generateInAppOtp('rohit@example.com')
      expect(code).toMatch(/^\d{6}$/)
      expect(expiresAt).toBeGreaterThan(Date.now())
    })

    it('verifies generated in-app code successfully', () => {
      const { code } = pinService.generateInAppOtp('rohit@example.com')
      const verifyRes = pinService.verifyInAppOtp('rohit@example.com', code)
      expect(verifyRes.success).toBe(true)
    })

    it('rejects mismatched email or wrong code', () => {
      const { code } = pinService.generateInAppOtp('rohit@example.com')
      const wrongEmail = pinService.verifyInAppOtp('other@example.com', code)
      expect(wrongEmail.success).toBe(false)
      expect(wrongEmail.error).toContain('does not match')

      const wrongCode = pinService.verifyInAppOtp('rohit@example.com', '000000')
      expect(wrongCode.success).toBe(false)
      expect(wrongCode.error).toContain('Invalid 6-digit code')
    })
  })
})
