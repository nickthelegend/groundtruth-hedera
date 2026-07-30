'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'light'
    setTheme(current)
  }, [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('gt-theme', next)
    } catch {}
    setTheme(next)
  }

  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to bright theme' : 'Switch to dark theme'}
      title={isDark ? 'Bright & Human' : 'Alive Dark'}
      className="relative flex items-center h-8 w-[62px] rounded-full border px-1 transition-colors"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-subtle)' }}
    >
      {/* track icons */}
      <span className="absolute left-2 text-[11px] leading-none" aria-hidden>☀️</span>
      <span className="absolute right-2 text-[11px] leading-none" aria-hidden>🌙</span>
      {/* knob */}
      <span
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] transition-transform duration-300"
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          transform: isDark ? 'translateX(30px)' : 'translateX(0)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  )
}
