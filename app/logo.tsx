/* GroundTruth logo — a location pin planted on a ground line ("ground truth"),
   with a verified check inside. Token-driven, so it's coral on the bright theme
   and cyan on dark, and it scales crisply from favicon to hero. */

export function LogoMark({ size = 32, ground = true }: { size?: number; ground?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="GroundTruth"
      style={{ display: 'block' }}
    >
      {/* ground line — the "planted" horizon the pin stands on */}
      {ground && (
        <g stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" opacity="0.9">
          <line x1="5" y1="36" x2="15.5" y2="36" />
          <line x1="24.5" y1="36" x2="35" y2="36" />
        </g>
      )}
      {/* pin body */}
      <path
        d="M20 3.5c-6.35 0-11.5 5.05-11.5 11.28 0 7.9 8.9 15.3 10.86 17.86.34.45.94.45 1.28 0C22.6 30.08 31.5 22.68 31.5 14.78 31.5 8.55 26.35 3.5 20 3.5Z"
        fill="var(--accent)"
      />
      {/* verified check */}
      <path
        d="M14.8 15.1l3.6 3.6 6.8-6.9"
        stroke="var(--accent-ink)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="inline-flex items-center justify-center transition-transform group-hover:-rotate-6"
        style={{ filter: 'drop-shadow(0 3px 6px color-mix(in srgb, var(--accent) 35%, transparent))' }}
      >
        <LogoMark size={size} />
      </span>
      <span className="font-display font-extrabold tracking-tight" style={{ color: 'var(--text)', fontSize: size * 0.5 }}>
        Ground<span style={{ color: 'var(--accent)' }}>Truth</span>
      </span>
    </span>
  )
}
