import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowRight, X, ArrowLeft, Check, Sparkles, TrendingUp, ShieldCheck, Coins, Target } from 'lucide-react'

/* ──────────────────────────────────────────────
   Inline keyframes injected once
   ────────────────────────────────────────────── */
const STYLE_ID = 'financeai-intro-anims'
const injectStyles = () => {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
    @keyframes faiFloat {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      33% { transform: translateY(-8px) rotate(1.5deg); }
      66% { transform: translateY(3px) rotate(-1deg); }
    }
    @keyframes faiPulseGlow {
      0%, 100% { box-shadow: 0 20px 45px rgba(124, 58, 237, 0.24), 0 0 0 0 rgba(124, 58, 237, 0); }
      50% { box-shadow: 0 20px 45px rgba(124, 58, 237, 0.32), 0 0 30px 8px rgba(124, 58, 237, 0.12); }
    }
    @keyframes faiPearlOrbit1 {
      0%, 100% { transform: translate(0, 0) scale(1); }
      25% { transform: translate(5px, -6px) scale(1.08); }
      50% { transform: translate(-3px, -10px) scale(0.96); }
      75% { transform: translate(6px, -3px) scale(1.04); }
    }
    @keyframes faiPearlOrbit2 {
      0%, 100% { transform: translate(0, 0) scale(1); }
      30% { transform: translate(-4px, 5px) scale(1.06); }
      60% { transform: translate(4px, -5px) scale(0.92); }
    }
    @keyframes faiSlideInRight {
      from { opacity: 0; transform: translateX(50px) scale(0.97); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes faiSlideInLeft {
      from { opacity: 0; transform: translateX(-50px) scale(0.97); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes faiCardStagger {
      from { opacity: 0; transform: translateY(16px) scale(0.94); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes faiWaveDraw {
      from { stroke-dashoffset: 600; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes faiConfetti {
      0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
      100% { transform: translateY(-130px) rotate(720deg) scale(0); opacity: 0; }
    }
    @keyframes faiCheckPop {
      0% { transform: scale(0); }
      60% { transform: scale(1.3); }
      100% { transform: scale(1); }
    }
    @keyframes faiRingPulse {
      0% { transform: scale(1); opacity: 0.25; }
      50% { transform: scale(1.08); opacity: 0.12; }
      100% { transform: scale(1); opacity: 0.25; }
    }
    @keyframes faiBadgeEnter {
      from { opacity: 0; transform: translateY(12px) scale(0.85); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes faiIndicatorPulse {
      0%, 100% { transform: scaleX(1); }
      50% { transform: scaleX(1.15); }
    }
    @keyframes orbFluidRotate {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.08); }
      100% { transform: rotate(360deg) scale(1); }
    }
    @keyframes orbPlasmaPulse {
      0%, 100% { filter: hue-rotate(0deg) brightness(1.06); }
      50% { filter: hue-rotate(40deg) brightness(1.18); }
    }
    @keyframes orbRingSpin {
      0% { transform: rotateX(68deg) rotateY(18deg) rotateZ(0deg); }
      100% { transform: rotateX(68deg) rotateY(18deg) rotateZ(360deg); }
    }
    @keyframes orbRingSpin2 {
      0% { transform: rotateX(-55deg) rotateY(25deg) rotateZ(360deg); }
      100% { transform: rotateX(-55deg) rotateY(25deg) rotateZ(0deg); }
    }
    @keyframes orbAuraPulse {
      0%, 100% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.18); opacity: 0.95; }
    }
  `
  document.head.appendChild(s)
}

/* ──────────────────────────────────────────────
   Dynamic Living 3D Orb Component (Apple Glass Grade)
   ────────────────────────────────────────────── */
export interface DynamicLivingOrbProps {
  size?: number
  showRings?: boolean
  interactive?: boolean
  variant?: 'default' | 'growth' | 'security' | 'dividends'
  icon?: React.ReactNode
}

export const DynamicLivingOrb: React.FC<DynamicLivingOrbProps> = ({
  size = 160,
  showRings = true,
  interactive = true,
  variant = 'default',
  icon,
}) => {
  const [hovered, setHovered] = useState(false)

  // Purpose-built visual palettes tailored to financial goals
  const themes = {
    default: {
      aura: 'radial-gradient(circle, rgba(124, 58, 237, 0.42) 0%, rgba(236, 72, 153, 0.22) 45%, transparent 70%)',
      ring1Border: '1.5px solid rgba(192, 132, 252, 0.45)',
      ring1Shadow: '0 0 16px rgba(168, 85, 247, 0.45), inset 0 0 16px rgba(168, 85, 247, 0.25)',
      ring1Dot: '#c084fc',
      ring2Border: '1.2px solid rgba(56, 189, 248, 0.45)',
      ring2Shadow: '0 0 14px rgba(56, 189, 248, 0.35)',
      ring2Dot: '#38bdf8',
      sphereShadow: '0 25px 60px rgba(124, 58, 237, 0.38), inset 0 0 30px rgba(255, 255, 255, 0.45)',
      plasmaBg: 'radial-gradient(circle at 30% 30%, #c084fc 0%, #7c3aed 30%, #4338ca 60%, #1e1b4b 100%)',
      grad1: ['#ec4899', '#8b5cf6', '#06b6d4'],
      grad2: ['#38bdf8', '#a855f7', '#f43f5e'],
      pearl1Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #c4b5fd 45%, #7c3aed 100%)',
      pearl1Shadow: '0 4px 14px rgba(124, 58, 237, 0.6), 0 0 10px rgba(255,255,255,0.8)',
      pearl2Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #fbcfe8 45%, #ec4899 100%)',
      pearl2Shadow: '0 3px 12px rgba(236, 72, 153, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      innerBorder: '2px solid rgba(255,255,255,0.5)',
      innerShadow: 'inset 0 10px 20px rgba(255,255,255,0.6), inset 0 -12px 24px rgba(79, 70, 229, 0.7)',
    },
    growth: {
      aura: 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(6, 182, 212, 0.25) 45%, transparent 70%)',
      ring1Border: '1.5px solid rgba(52, 211, 153, 0.55)',
      ring1Shadow: '0 0 16px rgba(16, 185, 129, 0.45)',
      ring1Dot: '#34d399',
      ring2Border: '1.2px solid rgba(6, 182, 212, 0.5)',
      ring2Shadow: '0 0 14px rgba(6, 182, 212, 0.35)',
      ring2Dot: '#06b6d4',
      sphereShadow: '0 16px 36px rgba(16, 185, 129, 0.4), inset 0 0 24px rgba(255, 255, 255, 0.55)',
      plasmaBg: 'radial-gradient(circle at 30% 30%, #6ee7b7 0%, #10b981 35%, #059669 65%, #064e3b 100%)',
      grad1: ['#34d399', '#059669', '#06b6d4'],
      grad2: ['#6ee7b7', '#10b981', '#047857'],
      pearl1Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #a7f3d0 45%, #10b981 100%)',
      pearl1Shadow: '0 3px 10px rgba(16, 185, 129, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      pearl2Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #67e8f9 45%, #06b6d4 100%)',
      pearl2Shadow: '0 3px 10px rgba(6, 182, 212, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      innerBorder: '2px solid rgba(255,255,255,0.6)',
      innerShadow: 'inset 0 8px 16px rgba(255,255,255,0.7), inset 0 -10px 20px rgba(6, 78, 59, 0.65)',
    },
    security: {
      aura: 'radial-gradient(circle, rgba(59, 130, 246, 0.45) 0%, rgba(99, 102, 241, 0.25) 45%, transparent 70%)',
      ring1Border: '1.5px solid rgba(96, 165, 250, 0.55)',
      ring1Shadow: '0 0 16px rgba(59, 130, 246, 0.45)',
      ring1Dot: '#60a5fa',
      ring2Border: '1.2px solid rgba(129, 140, 248, 0.5)',
      ring2Shadow: '0 0 14px rgba(99, 102, 241, 0.35)',
      ring2Dot: '#818cf8',
      sphereShadow: '0 16px 36px rgba(59, 130, 246, 0.4), inset 0 0 24px rgba(255, 255, 255, 0.55)',
      plasmaBg: 'radial-gradient(circle at 30% 30%, #93c5fd 0%, #3b82f6 35%, #1d4ed8 65%, #0f172a 100%)',
      grad1: ['#60a5fa', '#2563eb', '#38bdf8'],
      grad2: ['#93c5fd', '#3b82f6', '#1e40af'],
      pearl1Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #bfdbfe 45%, #3b82f6 100%)',
      pearl1Shadow: '0 3px 10px rgba(59, 130, 246, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      pearl2Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #c7d2fe 45%, #6366f1 100%)',
      pearl2Shadow: '0 3px 10px rgba(99, 102, 241, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      innerBorder: '2px solid rgba(255,255,255,0.6)',
      innerShadow: 'inset 0 8px 16px rgba(255,255,255,0.7), inset 0 -10px 20px rgba(15, 23, 42, 0.7)',
    },
    dividends: {
      aura: 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(251, 191, 36, 0.25) 45%, transparent 70%)',
      ring1Border: '1.5px solid rgba(251, 191, 36, 0.55)',
      ring1Shadow: '0 0 16px rgba(245, 158, 11, 0.45)',
      ring1Dot: '#fbbf24',
      ring2Border: '1.2px solid rgba(245, 158, 11, 0.5)',
      ring2Shadow: '0 0 14px rgba(245, 158, 11, 0.35)',
      ring2Dot: '#f59e0b',
      sphereShadow: '0 16px 36px rgba(245, 158, 11, 0.4), inset 0 0 24px rgba(255, 255, 255, 0.55)',
      plasmaBg: 'radial-gradient(circle at 30% 30%, #fef08a 0%, #f59e0b 35%, #d97706 65%, #78350f 100%)',
      grad1: ['#fbbf24', '#d97706', '#f59e0b'],
      grad2: ['#fde047', '#f59e0b', '#b45309'],
      pearl1Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #fef08a 45%, #f59e0b 100%)',
      pearl1Shadow: '0 3px 10px rgba(245, 158, 11, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      pearl2Bg: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #fed7aa 45%, #ea580c 100%)',
      pearl2Shadow: '0 3px 10px rgba(234, 88, 12, 0.6), 0 0 8px rgba(255,255,255,0.8)',
      innerBorder: '2px solid rgba(255,255,255,0.6)',
      innerShadow: 'inset 0 8px 16px rgba(255,255,255,0.7), inset 0 -10px 20px rgba(120, 53, 15, 0.7)',
    },
  }

  const t = themes[variant] || themes.default

  // Scale satellite pearls proportionally to orb size
  const isMini = size <= 60
  const pearl1Size = isMini ? Math.max(6, Math.round(size * 0.16)) : 18
  const pearl2Size = isMini ? Math.max(5, Math.round(size * 0.12)) : 13
  const pearl1Top = isMini ? `${Math.round(size * 0.08)}px` : '12px'
  const pearl1Right = isMini ? `-${Math.round(size * 0.14)}px` : '-16px'
  const pearl2Bottom = isMini ? `${Math.round(size * 0.06)}px` : '8px'
  const pearl2Left = isMini ? `-${Math.round(size * 0.12)}px` : '-14px'

  const g1Id = `orbG1_${variant}`
  const g2Id = `orbG2_${variant}`

  return (
    <div
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => interactive && setHovered(false)}
    >
      {/* Ambient Pulsing Aura Glow */}
      <div
        style={{
          position: 'absolute',
          inset: isMini ? '-10px' : '-22px',
          borderRadius: '50%',
          background: t.aura,
          filter: isMini ? 'blur(16px)' : 'blur(32px)',
          animation: 'orbAuraPulse 4s ease-in-out infinite',
          pointerEvents: 'none',
          transform: hovered ? 'scale(1.22)' : 'scale(1)',
          transition: 'transform 0.4s ease',
        }}
      />

      {/* 3D Gyroscopic Ring 1 */}
      {showRings && (
        <div
          style={{
            position: 'absolute',
            width: `${size * 1.35}px`,
            height: `${size * 1.35}px`,
            borderRadius: '50%',
            border: t.ring1Border,
            boxShadow: t.ring1Shadow,
            animation: 'orbRingSpin 10s linear infinite',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-4px',
              left: '50%',
              width: '8px',
              height: '8px',
              marginLeft: '-4px',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: `0 0 10px #ffffff, 0 0 18px ${t.ring1Dot}`,
            }}
          />
        </div>
      )}

      {/* 3D Gyroscopic Ring 2 */}
      {showRings && (
        <div
          style={{
            position: 'absolute',
            width: `${size * 1.24}px`,
            height: `${size * 1.24}px`,
            borderRadius: '50%',
            border: t.ring2Border,
            boxShadow: t.ring2Shadow,
            animation: 'orbRingSpin2 8s linear infinite',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              left: '50%',
              width: '7px',
              height: '7px',
              marginLeft: '-3.5px',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: `0 0 10px #ffffff, 0 0 16px ${t.ring2Dot}`,
            }}
          />
        </div>
      )}

      {/* Main Living Orb Sphere */}
      <div
        style={{
          position: 'relative',
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          overflow: 'hidden',
          boxShadow: t.sphereShadow,
          animation: 'faiFloat 5s ease-in-out infinite',
          transform: hovered ? 'scale(1.05)' : 'scale(1)',
          transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Inner Fluid Plasma Layer */}
        <div
          style={{
            position: 'absolute',
            inset: '-30%',
            background: t.plasmaBg,
            animation: 'orbFluidRotate 12s linear infinite, orbPlasmaPulse 6s ease-in-out infinite',
          }}
        />

        {/* Inner Fluid Wave Currents (SVG) */}
        <svg
          viewBox="0 0 200 200"
          style={{
            position: 'absolute',
            inset: '-10%',
            width: '120%',
            height: '120%',
            mixBlendMode: 'screen',
            opacity: 0.85,
            animation: 'orbFluidRotate 16s linear infinite reverse',
          }}
        >
          <defs>
            <linearGradient id={g1Id} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={t.grad1[0]} stopOpacity="0.85" />
              <stop offset="50%" stopColor={t.grad1[1]} stopOpacity="0.6" />
              <stop offset="100%" stopColor={t.grad1[2]} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id={g2Id} x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={t.grad2[0]} stopOpacity="0.8" />
              <stop offset="60%" stopColor={t.grad2[1]} stopOpacity="0.5" />
              <stop offset="100%" stopColor={t.grad2[2]} stopOpacity="0.75" />
            </linearGradient>
          </defs>
          <circle cx="95" cy="95" r="70" fill={`url(#${g1Id})`} filter="blur(16px)" />
          <circle cx="115" cy="115" r="58" fill={`url(#${g2Id})`} filter="blur(18px)" />
        </svg>

        {/* Purpose-specific emblem / icon overlay */}
        {icon && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              zIndex: 3,
              color: '#ffffff',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))',
              pointerEvents: 'none',
            }}
          >
            {icon}
          </div>
        )}

        {/* Specular Glint Top Left Arc */}
        <div
          style={{
            position: 'absolute',
            top: '8%',
            left: '12%',
            width: '45%',
            height: '35%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.6) 35%, transparent 75%)',
            transform: 'rotate(-32deg)',
            pointerEvents: 'none',
          }}
        />

        {/* Secondary Glass Highlight Bottom Arc */}
        <div
          style={{
            position: 'absolute',
            bottom: '10%',
            right: '12%',
            width: '35%',
            height: '25%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.45) 0%, transparent 70%)',
            transform: 'rotate(25deg)',
            pointerEvents: 'none',
          }}
        />

        {/* Inner Curved Refraction Ring */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: t.innerBorder,
            boxShadow: t.innerShadow,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Companion Luminous Satellite Pearl 1 */}
      <div
        style={{
          position: 'absolute',
          top: pearl1Top,
          right: pearl1Right,
          width: `${pearl1Size}px`,
          height: `${pearl1Size}px`,
          borderRadius: '50%',
          background: t.pearl1Bg,
          boxShadow: t.pearl1Shadow,
          animation: 'faiPearlOrbit1 4.5s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Companion Luminous Satellite Pearl 2 */}
      <div
        style={{
          position: 'absolute',
          bottom: pearl2Bottom,
          left: pearl2Left,
          width: `${pearl2Size}px`,
          height: `${pearl2Size}px`,
          borderRadius: '50%',
          background: t.pearl2Bg,
          boxShadow: t.pearl2Shadow,
          animation: 'faiPearlOrbit2 5.5s ease-in-out infinite 0.6s',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

/* ──────────────────────────────────────────────
   Confetti celebration burst
   ────────────────────────────────────────────── */
const ConfettiBurst: React.FC = () => {
  const colors = ['#7c3aed', '#ec4899', '#34d399', '#f59e0b', '#3b82f6', '#818cf8', '#f472b6']
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    x: Math.random() * 260 - 130,
    y: Math.random() * -170 - 40,
    size: 4 + Math.random() * 6,
    delay: Math.random() * 0.25,
    dur: 0.6 + Math.random() * 0.45,
  }))
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 99, overflow: 'hidden' }}>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '45%',
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: p.id % 3 === 0 ? '50%' : '2px',
            background: p.color,
            animation: `faiConfetti ${p.dur}s ease-out ${p.delay}s forwards`,
            transform: `translate(${p.x}px, 0)`,
            marginLeft: `${p.x}px`,
          }}
        />
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────── */
interface AppIntroSlidesProps {
  onComplete: () => void
  onSkip?: () => void
}

export const AppIntroSlides: React.FC<AppIntroSlidesProps> = ({ onComplete, onSkip }) => {
  const [currentScreen, setCurrentScreen] = useState<0 | 1 | 2>(0)
  const [slideDir, setSlideDir] = useState<'right' | 'left'>('right')
  const [selectedGoals, setSelectedGoals] = useState<string[]>(['Growth', 'Security'])
  const [customGoal, setCustomGoal] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<'12' | '6' | '1'>('6')
  const [showConfetti, setShowConfetti] = useState(false)
  const [pressedBtn, setPressedBtn] = useState<string | null>(null)
  const touchStartX = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    injectStyles()
  }, [])

  const goTo = useCallback((target: 0 | 1 | 2) => {
    setSlideDir(target > currentScreen ? 'right' : 'left')
    setCurrentScreen(target)
  }, [currentScreen])

  const toggleGoal = (goal: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    )
  }

  const handleComplete = () => {
    try {
      localStorage.setItem(
        'moneymate_user_goals',
        JSON.stringify(customGoal ? [...selectedGoals, customGoal] : selectedGoals)
      )
      localStorage.setItem('moneymate_user_plan', selectedPlan)
    } catch {
      // ignore quota
    }
    setShowConfetti(true)
    setTimeout(() => onComplete(), 750)
  }

  // Swipe navigation
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) < 50) return
    if (dx < 0 && currentScreen < 2) goTo((currentScreen + 1) as 0 | 1 | 2)
    if (dx > 0 && currentScreen > 0) goTo((currentScreen - 1) as 0 | 1 | 2)
  }

  const slideAnim = slideDir === 'right' ? 'faiSlideInRight' : 'faiSlideInLeft'

  const btnPress = (id: string) => {
    setPressedBtn(id)
    setTimeout(() => setPressedBtn(null), 150)
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        minHeight: '100dvh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 20%, #f1f4ff 0%, #f6f1ff 40%, #ece8fc 100%)',
        position: 'relative',
        padding: '20px 16px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Ambient background glows */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: '440px', height: '440px', top: '-140px', right: '-120px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,139,250,0.5) 0%, transparent 70%)', filter: 'blur(80px)', animation: 'faiFloat 8s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: '380px', height: '380px', bottom: '-100px', left: '-120px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.4) 0%, transparent 70%)', filter: 'blur(80px)', animation: 'faiFloat 10s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', width: '260px', height: '260px', top: '50%', left: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 70%)', filter: 'blur(60px)', animation: 'faiFloat 12s ease-in-out infinite 2s' }} />
      </div>

      {showConfetti && <ConfettiBurst />}

      {/* Standalone iOS Phone Canvas */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '360px',
          minHeight: '660px',
          borderRadius: '44px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(246,248,255,0.92) 100%)',
          border: '1.5px solid rgba(255,255,255,0.95)',
          boxShadow: '0 28px 70px rgba(139,92,246,0.18), 0 4px 20px rgba(0,0,0,0.04), inset 0 1px 3px rgba(255,255,255,1)',
          padding: '28px 22px 24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
          boxSizing: 'border-box',
          animation: 'faiBadgeEnter 0.35s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Step Indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '12px' }}>
          {[0, 1, 2].map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => goTo(step as 0 | 1 | 2)}
              aria-label={`Slide ${step + 1}`}
              style={{
                height: '4px',
                width: currentScreen === step ? '24px' : '6px',
                borderRadius: '999px',
                border: 0,
                background: currentScreen === step
                  ? 'linear-gradient(90deg, #7c3aed, #a855f7)'
                  : 'rgba(124,58,237,0.18)',
                cursor: 'pointer',
                transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
                padding: 0,
                animation: currentScreen === step ? 'faiIndicatorPulse 2s ease-in-out infinite' : 'none',
              }}
            />
          ))}
        </div>

        {/* ═══════════════════════════════════════════
            SLIDE 1 — Introducing FinanceAI
            ═══════════════════════════════════════════ */}
        {currentScreen === 0 && (
          <div
            key="slide-0"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              animation: `${slideAnim} 0.4s cubic-bezier(0.16,1,0.3,1)`,
            }}
          >
            <div style={{ position: 'relative', height: '240px', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DynamicLivingOrb size={165} showRings={true} interactive={true} />
            </div>

            {/* Animated wave lines */}
            <svg
              viewBox="0 0 320 90"
              fill="none"
              style={{
                position: 'absolute',
                bottom: '95px',
                left: 0,
                right: 0,
                width: '100%',
                pointerEvents: 'none',
                opacity: 0.8,
              }}
            >
              <path
                d="M-10,55 Q70,25 155,60 T330,35"
                stroke="rgba(167,139,250,0.45)"
                strokeWidth="1.6"
                fill="none"
                strokeDasharray="600"
                style={{ animation: 'faiWaveDraw 2s ease-out forwards' }}
              />
              <path
                d="M-10,72 Q85,45 175,72 T330,50"
                stroke="rgba(196,181,253,0.3)"
                strokeWidth="1.2"
                fill="none"
                strokeDasharray="600"
                style={{ animation: 'faiWaveDraw 2.5s ease-out 0.3s forwards' }}
              />
            </svg>

            {/* Text */}
            <div style={{ position: 'relative', zIndex: 2, marginBottom: '24px' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#64748b',
                  marginBottom: '4px',
                  animation: 'faiCardStagger 0.5s ease-out 0.1s both',
                }}
              >
                Introducing
              </div>
              <div
                style={{
                  fontSize: '30px',
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.03em',
                  marginBottom: '8px',
                  animation: 'faiCardStagger 0.5s ease-out 0.2s both',
                }}
              >
                FinanceAI
              </div>
              <p
                style={{
                  fontSize: '13.5px',
                  color: '#94a3b8',
                  margin: 0,
                  lineHeight: 1.5,
                  maxWidth: '260px',
                  animation: 'faiCardStagger 0.5s ease-out 0.3s both',
                }}
              >
                Smart analysis of your goals and habits
              </p>
            </div>

            {/* CTA — Get started */}
            <button
              type="button"
              onClick={() => {
                btnPress('get-started')
                goTo(1)
              }}
              id="financeai-get-started"
              style={{
                position: 'relative',
                zIndex: 2,
                width: '100%',
                height: '56px',
                borderRadius: '999px',
                background:
                  pressedBtn === 'get-started'
                    ? 'rgba(240,238,255,0.95)'
                    : 'linear-gradient(90deg, rgba(255,255,255,0.92) 0%, rgba(248,245,255,0.88) 100%)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.95)',
                boxShadow: '0 10px 30px rgba(124,58,237,0.14), inset 0 1px 2px rgba(255,255,255,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px 6px 26px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
                transform: pressedBtn === 'get-started' ? 'scale(0.97)' : 'scale(1)',
                animation: 'faiCardStagger 0.5s ease-out 0.4s both',
              }}
            >
              <span style={{ fontSize: '14.5px', fontWeight: 600, color: '#1e293b' }}>Get started</span>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #ffffff, #f3f0ff)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#6366f1',
                  transition: 'transform 0.2s ease',
                }}
              >
                <ArrowRight size={18} strokeWidth={2.4} />
              </div>
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            SLIDE 2 — Choose your financial goals
            ═══════════════════════════════════════════ */}
        {currentScreen === 1 && (
          <div
            key="slide-1"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              animation: `${slideAnim} 0.4s cubic-bezier(0.16,1,0.3,1)`,
            }}
          >
            <div>
              {/* Close button */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <button
                  type="button"
                  onClick={onSkip || onComplete}
                  aria-label="Close"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(255,255,255,0.95)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#475569',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    transition: 'transform 0.15s ease',
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Headline */}
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#0f172a',
                  lineHeight: 1.25,
                  margin: '0 0 6px 0',
                  letterSpacing: '-0.02em',
                  animation: 'faiCardStagger 0.4s ease-out both',
                }}
              >
                Choose your<br />financial goals
              </h2>
              <p
                style={{
                  fontSize: '12px',
                  color: '#64748b',
                  margin: '0 0 20px 0',
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                  animation: 'faiCardStagger 0.4s ease-out 0.05s both',
                }}
              >
                Select your strategies to tailor AI allocations &amp; insights
              </p>

              {/* Goal cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
                {[
                  {
                    name: 'Growth',
                    purpose: 'Capital & Yield',
                    badge: 'Compounding',
                    variant: 'growth' as const,
                    icon: <TrendingUp size={19} strokeWidth={2.8} />,
                    accent: '#10b981',
                    accentSoft: 'rgba(16, 185, 129, 0.12)',
                    accentBorder: 'rgba(16, 185, 129, 0.55)',
                    badgeBg: 'rgba(16, 185, 129, 0.14)',
                    badgeColor: '#059669',
                  },
                  {
                    name: 'Security',
                    purpose: 'Safety & Shield',
                    badge: 'Emergency Fund',
                    variant: 'security' as const,
                    icon: <ShieldCheck size={19} strokeWidth={2.8} />,
                    accent: '#3b82f6',
                    accentSoft: 'rgba(59, 130, 246, 0.12)',
                    accentBorder: 'rgba(59, 130, 246, 0.55)',
                    badgeBg: 'rgba(59, 130, 246, 0.14)',
                    badgeColor: '#2563eb',
                  },
                  {
                    name: 'Dividends',
                    purpose: 'Passive Income',
                    badge: 'Monthly Flow',
                    variant: 'dividends' as const,
                    icon: <Coins size={19} strokeWidth={2.8} />,
                    accent: '#f59e0b',
                    accentSoft: 'rgba(245, 158, 11, 0.14)',
                    accentBorder: 'rgba(245, 158, 11, 0.55)',
                    badgeBg: 'rgba(245, 158, 11, 0.16)',
                    badgeColor: '#d97706',
                  },
                ].map((goal, idx) => {
                  const isSelected = selectedGoals.includes(goal.name)
                  return (
                    <button
                      key={goal.name}
                      type="button"
                      onClick={() => {
                        toggleGoal(goal.name)
                        btnPress(`goal-${goal.name}`)
                      }}
                      style={{
                        position: 'relative',
                        borderRadius: '22px',
                        background: isSelected
                          ? `linear-gradient(180deg, rgba(255,255,255,0.98) 0%, ${goal.accentSoft} 100%)`
                          : 'rgba(255,255,255,0.85)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: isSelected
                          ? `1.5px solid ${goal.accentBorder}`
                          : '1px solid rgba(255,255,255,0.95)',
                        boxShadow: isSelected
                          ? `0 10px 24px ${goal.accentSoft}, 0 2px 8px rgba(0,0,0,0.04)`
                          : '0 4px 14px rgba(140,130,200,0.06)',
                        padding: '16px 4px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: '144px',
                        cursor: 'pointer',
                        transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                        transform: isSelected ? 'scale(1.04)' : 'scale(1)',
                        animation: `faiCardStagger 0.4s ease-out ${0.1 + idx * 0.08}s both`,
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Dynamic Purpose Orb with embedded emblem icon */}
                      <div
                        style={{
                          width: '46px',
                          height: '46px',
                          marginBottom: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'transform 0.25s ease',
                          transform: isSelected ? 'scale(1.08)' : 'scale(1)',
                        }}
                      >
                        <DynamicLivingOrb
                          size={44}
                          showRings={false}
                          interactive={false}
                          variant={goal.variant}
                          icon={goal.icon}
                        />
                      </div>

                      {/* Text aligned with name & purpose */}
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#0f172a',
                            letterSpacing: '-0.02em',
                            lineHeight: 1.2,
                          }}
                        >
                          {goal.name}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '9.5px',
                            fontWeight: 600,
                            color: isSelected ? goal.badgeColor : '#64748b',
                            marginTop: '2px',
                            letterSpacing: '-0.01em',
                            lineHeight: 1.2,
                          }}
                        >
                          {goal.purpose}
                        </span>
                      </div>

                      {/* Purpose Tag / Badge */}
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '3px 6px',
                          borderRadius: '999px',
                          background: isSelected ? goal.badgeBg : 'rgba(0,0,0,0.04)',
                          color: isSelected ? goal.badgeColor : '#64748b',
                          fontSize: '9px',
                          fontWeight: 700,
                          letterSpacing: '-0.01em',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {goal.badge}
                      </div>

                      {/* Checkmark Pop Badge */}
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '-5px',
                            right: '-5px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: goal.accent,
                            color: '#ffffff',
                            display: 'grid',
                            placeItems: 'center',
                            boxShadow: `0 3px 8px ${goal.accent}66`,
                            animation: 'faiCheckPop 0.3s cubic-bezier(0.16,1,0.3,1)',
                            zIndex: 4,
                          }}
                        >
                          <Check size={11} strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Custom goal input */}
              <div
                style={{
                  borderRadius: '20px',
                  background: 'rgba(255,255,255,0.88)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: customGoal ? '1.5px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.95)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  boxShadow: customGoal ? '0 8px 20px rgba(124,58,237,0.12)' : '0 4px 14px rgba(0,0,0,0.03)',
                  animation: 'faiCardStagger 0.4s ease-out 0.35s both',
                  transition: 'all 0.2s ease',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #c4b5fd 45%, #7c3aed 100%)',
                    boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  <Target size={14} strokeWidth={2.4} />
                </div>
                <input
                  type="text"
                  placeholder="Custom goal: e.g. Dream home, Travel, Car..."
                  value={customGoal}
                  onChange={(e) => setCustomGoal(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: '12.5px',
                    color: '#0f172a',
                    width: '100%',
                    fontWeight: 500,
                  }}
                />
                {customGoal && (
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: '#7c3aed',
                      background: 'rgba(124,58,237,0.1)',
                      padding: '3px 8px',
                      borderRadius: '999px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Custom
                  </span>
                )}
              </div>
            </div>

            {/* Confirm CTA */}
            <button
              type="button"
              onClick={() => {
                btnPress('confirm')
                goTo(2)
              }}
              id="financeai-confirm"
              disabled={selectedGoals.length === 0 && !customGoal}
              style={{
                width: '100%',
                height: '50px',
                borderRadius: '999px',
                background:
                  selectedGoals.length > 0 || customGoal
                    ? 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(245,238,255,0.9) 100%)'
                    : 'rgba(240,240,245,0.7)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.95)',
                boxShadow: '0 10px 26px rgba(124,58,237,0.1)',
                fontSize: '14px',
                fontWeight: 600,
                color: selectedGoals.length > 0 || customGoal ? '#0f172a' : '#94a3b8',
                cursor: selectedGoals.length > 0 || customGoal ? 'pointer' : 'default',
                marginTop: '18px',
                transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
                transform: pressedBtn === 'confirm' ? 'scale(0.97)' : 'scale(1)',
                opacity: selectedGoals.length > 0 || customGoal ? 1 : 0.6,
                animation: 'faiCardStagger 0.4s ease-out 0.45s both',
              }}
            >
              Confirm
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            SLIDE 3 — AI-assisted Planning
            ═══════════════════════════════════════════ */}
        {currentScreen === 2 && (
          <div
            key="slide-2"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              animation: `${slideAnim} 0.4s cubic-bezier(0.16,1,0.3,1)`,
            }}
          >
            <div>
              {/* Back arrow */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  aria-label="Back"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(255,255,255,0.95)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#475569',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                    transition: 'transform 0.15s ease',
                  }}
                >
                  <ArrowLeft size={16} />
                </button>
              </div>

              {/* Center sphere + badge */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <div style={{ height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <DynamicLivingOrb size={92} showRings={true} interactive={false} />
                </div>

                {/* Balance badge */}
                <div
                  style={{
                    marginTop: '-12px',
                    position: 'relative',
                    zIndex: 3,
                    background: 'rgba(15,23,42,0.92)',
                    backdropFilter: 'blur(24px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                    border: '1px solid rgba(255,255,255,0.4)',
                    borderRadius: '999px',
                    padding: '7px 16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
                    animation: 'faiBadgeEnter 0.5s ease-out 0.2s both',
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
                    {selectedPlan === '12' ? '₹1,48,200' : selectedPlan === '6' ? '₹1,26,400' : '₹1,12,000'}
                  </span>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: '#34d399',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <Sparkles size={11} /> {selectedPlan === '12' ? '+18.4%' : selectedPlan === '6' ? '+12.6%' : '+7.2%'}
                  </span>
                </div>

                {/* Subtle Dots */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#a78bfa' }} />
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'rgba(167,139,250,0.3)' }} />
                </div>

                {/* Headlines */}
                <div style={{ marginTop: '14px', textAlign: 'center' }}>
                  <h3
                    style={{
                      fontSize: '17px',
                      fontWeight: 700,
                      color: '#0f172a',
                      margin: '0 0 4px 0',
                      letterSpacing: '-0.02em',
                      animation: 'faiCardStagger 0.4s ease-out 0.1s both',
                    }}
                  >
                    AI-assisted Planning
                  </h3>
                  <p
                    style={{
                      fontSize: '12px',
                      color: '#64748b',
                      margin: 0,
                      animation: 'faiCardStagger 0.4s ease-out 0.2s both',
                    }}
                  >
                    Smart analysis of your goals, cash flow &amp; habits
                  </p>
                </div>
              </div>

              {/* Plan selection cards - Minimalist iOS Glass */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  marginTop: '20px',
                }}
              >
                {[
                  { months: '12' as const, price: '₹499/mo', label: 'Save 45%', labelColor: '#7c3aed' },
                  { months: '6' as const, price: '₹699/mo', label: 'Save 25%', labelColor: '#ec4899' },
                  { months: '1' as const, price: '₹899/mo', label: 'Flexible', labelColor: '#64748b' },
                ].map((plan, idx) => {
                  const isActive = selectedPlan === plan.months
                  return (
                    <button
                      key={plan.months}
                      type="button"
                      onClick={() => {
                        setSelectedPlan(plan.months)
                        btnPress(`plan-${plan.months}`)
                      }}
                      style={{
                        borderRadius: '20px',
                        background: isActive
                          ? 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,240,255,0.9) 100%)'
                          : 'rgba(255,255,255,0.65)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: isActive
                          ? '1.5px solid rgba(124,58,237,0.55)'
                          : '1px solid rgba(255,255,255,0.95)',
                        boxShadow: isActive
                          ? '0 10px 28px rgba(124,58,237,0.18), inset 0 1px 2px #fff'
                          : '0 2px 8px rgba(0,0,0,0.03)',
                        padding: '14px 4px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transform: isActive
                          ? 'scale(1.04)'
                          : pressedBtn === `plan-${plan.months}`
                          ? 'scale(0.95)'
                          : 'scale(1)',
                        transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                        animation: `faiCardStagger 0.4s ease-out ${0.15 + idx * 0.08}s both`,
                      }}
                    >
                      <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                        {plan.months}
                      </div>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', marginTop: '3px' }}>
                        {plan.months === '1' ? 'month' : 'months'}
                      </div>
                      <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#1e293b', marginTop: '4px' }}>{plan.price}</div>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: plan.labelColor, marginTop: '6px' }}>
                        {plan.label}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* CTAs */}
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  btnPress('continue')
                  handleComplete()
                }}
                id="financeai-continue"
                style={{
                  width: '100%',
                  height: '50px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(245,238,255,0.94) 100%)',
                  border: '1px solid rgba(255,255,255,0.95)',
                  boxShadow: '0 10px 30px rgba(140,130,210,0.18)',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#0f172a',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
                  transform: pressedBtn === 'continue' ? 'scale(0.97)' : 'scale(1)',
                  animation: 'faiCardStagger 0.4s ease-out 0.4s both',
                }}
              >
                Continue
              </button>

              <button
                type="button"
                onClick={handleComplete}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '11.5px',
                  color: '#94a3b8',
                  marginTop: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#64748b')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
              >
                No thanks
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
