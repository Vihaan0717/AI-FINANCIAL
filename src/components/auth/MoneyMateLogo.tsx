import React from 'react'

interface MoneyMateLogoProps {
  size?: number
  animated?: boolean
  className?: string
  style?: React.CSSProperties
}

export const MoneyMateLogo: React.FC<MoneyMateLogoProps> = ({
  size = 40,
  animated = false,
  className = '',
  style = {},
}) => {
  return (
    <div
      className={`mm-logo-root ${animated ? 'animated' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        borderRadius: size * 0.28,
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          width: '100%',
          height: '100%',
          filter: animated ? 'drop-shadow(0 10px 25px rgba(124, 58, 237, 0.45))' : 'drop-shadow(0 4px 12px rgba(124, 58, 237, 0.25))',
        }}
      >
        <defs>
          {/* Main Squircle Glass Gradient */}
          <linearGradient id="mmGlassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="45%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>

          {/* Shimmer Sheen Wave */}
          <linearGradient id="mmSheenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.4)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>

          {/* Inner Glyph Gradient */}
          <linearGradient id="mmGlyphGrad" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#f5f3ff" />
            <stop offset="100%" stopColor="#e0e7ff" />
          </linearGradient>

          {/* Golden Sparkle Glow */}
          <linearGradient id="mmSparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>

          {/* Specular Rim */}
          <linearGradient id="mmRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.7)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
          </linearGradient>
        </defs>

        {/* Squircle Background Base */}
        <rect
          x="4"
          y="4"
          width="92"
          height="92"
          rx="26"
          fill="url(#mmGlassGrad)"
        />

        {/* Specular Edge Highlight */}
        <rect
          x="4.5"
          y="4.5"
          width="91"
          height="91"
          rx="25.5"
          stroke="url(#mmRimGrad)"
          strokeWidth="1.5"
          fill="none"
        />

        {/* Liquid Glass Overlay Dome */}
        <path
          d="M 4 30 Q 50 15 96 30 L 96 26 C 96 14 86 4 74 4 L 26 4 C 14 4 4 14 4 26 Z"
          fill="rgba(255, 255, 255, 0.18)"
        />

        {/* Modern Intertwined Money 'M' + Growth Trajectory Glyph */}
        <g transform="translate(18, 20)">
          {/* Main M Ribbon */}
          <path
            d="M 6 52 
               L 6 18 
               C 6 14.5 10.5 12.5 13.5 15 
               L 31 30 
               C 32 31 33 31 34 30 
               L 51 15 
               C 54 12.5 58.5 14.5 58.5 18 
               L 58.5 52"
            fill="none"
            stroke="url(#mmGlyphGrad)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Upward Ascending Financial Trend Surge */}
          <path
            d="M 18 44 
               L 32.5 32 
               L 46 44 
               L 56 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={animated ? "60" : "none"}
            className={animated ? "mm-surge-line" : ""}
          />

          {/* AI Intelligence Sparkle Diamond at Top-Right Apex */}
          <path
            d="M 56 12 
               C 56 8 58 6 62 6 
               C 58 6 56 4 56 0 
               C 56 4 54 6 50 6 
               C 54 6 56 8 56 12 Z"
            fill="url(#mmSparkleGrad)"
            className={animated ? "mm-sparkle-pulse" : ""}
          />
        </g>
      </svg>
    </div>
  )
}
