import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export const C = {
  cream: '#F2EDE6',
  stone: '#A89880',
  accent: '#7B9956',
  accentDeep: '#2F3D20',
  success: '#4CAF6E',
  warning: '#D97706',
  error: '#C0504D',
  brown: '#8E6B57',
  grey: '#6B7280',
  hairline: 'rgba(142,107,87,0.15)',
  panel: 'rgba(20,19,10,0.5)',
}

export const mono = "'JetBrains Mono', monospace"
export const serif = "'Fraunces', serif"
export const sans = "'DM Sans', sans-serif"

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 28,
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      <div>
        <h1 style={{ fontFamily: serif, fontSize: 34, color: C.cream, margin: '0 0 4px', fontWeight: 400 }}>
          {title}
        </h1>
        {subtitle && <p style={{ color: C.stone, margin: 0, fontSize: 14 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Panel({
  children,
  style,
  className = 'glass',
}: {
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  return (
    <div className={className} style={{ borderRadius: 20, padding: 24, ...style }}>
      {children}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  small,
  style,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  disabled?: boolean
  small?: boolean
  style?: CSSProperties
  title?: string
}) {
  const variants: Record<string, CSSProperties> = {
    primary: { background: C.accentDeep, color: C.accent, border: 'none' },
    outline: { background: 'transparent', color: C.accent, border: `1px solid rgba(123,153,86,0.3)` },
    ghost: { background: 'transparent', color: C.stone, border: `1px solid ${C.hairline}` },
    danger: { background: 'transparent', color: C.error, border: '1px solid rgba(192,80,77,0.3)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={variant === 'primary' ? 'glow-btn' : undefined}
      style={{
        padding: small ? '5px 11px' : '9px 18px',
        borderRadius: small ? 8 : 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: small ? 11 : 13,
        fontFamily: sans,
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
        ...variants[variant],
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  style,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  style?: CSSProperties
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && (
        <span style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.08em' }}>
          {label.toUpperCase()}
        </span>
      )}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '9px 14px',
          borderRadius: 10,
          border: `1px solid ${C.hairline}`,
          background: 'rgba(20,19,10,0.6)',
          color: C.cream,
          fontSize: 13,
          fontFamily: sans,
          outline: 'none',
          width: '100%',
        }}
      />
    </label>
  )
}

export function Select({
  label,
  value,
  onChange,
  options,
  style,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  style?: CSSProperties
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && (
        <span style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.08em' }}>
          {label.toUpperCase()}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '9px 12px',
          borderRadius: 10,
          border: `1px solid ${C.hairline}`,
          background: '#1c1710',
          color: C.cream,
          fontSize: 13,
          fontFamily: sans,
          outline: 'none',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Badge({
  children,
  color,
  bg,
}: {
  children: ReactNode
  color: string
  bg?: string
}) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 20,
        color,
        background: bg ?? `${color}1F`,
        fontFamily: mono,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/** Counts up to `value` on mount, and again whenever it changes. */
export function StatCard({
  label,
  value,
  sub,
  accent,
  prefix = '',
  suffix = '',
}: {
  label: string
  value: number
  sub?: string
  accent?: string
  prefix?: string
  suffix?: string
}) {
  const [displayed, setDisplayed] = useState(0)

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0
    if (target === 0) {
      setDisplayed(0)
      return
    }
    let current = 0
    const step = target / 24
    const timer = setInterval(() => {
      current += step
      if (current >= target) {
        setDisplayed(target)
        clearInterval(timer)
      } else {
        setDisplayed(Math.round(current))
      }
    }, 22)
    return () => clearInterval(timer)
  }, [value])

  return (
    <div
      className="float-card glass"
      style={{ borderRadius: 20, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <span
        style={{
          fontSize: 11,
          color: C.stone,
          fontFamily: mono,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 34,
          fontFamily: serif,
          fontWeight: 500,
          color: accent ?? C.cream,
          lineHeight: 1,
        }}
      >
        {prefix}
        {displayed.toLocaleString()}
        {suffix}
      </span>
      {sub && <span style={{ fontSize: 12, color: C.stone }}>{sub}</span>}
    </div>
  )
}

export function InfoRow({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11, color: C.stone, fontFamily: mono, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: accent ?? C.cream, fontWeight: 500, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null
  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 10,
        background: 'rgba(192,80,77,0.1)',
        border: '1px solid rgba(192,80,77,0.3)',
        color: C.error,
        fontSize: 12,
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', color: C.error, cursor: 'pointer', fontSize: 15 }}
        >
          ×
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: C.stone, fontSize: 13 }}>{children}</div>
  )
}

export function Loading() {
  return (
    <div style={{ padding: '64px 0', textAlign: 'center', color: C.stone, fontSize: 13, fontFamily: mono }}>
      Loading…
    </div>
  )
}

/** Short-lived confirmation that an action actually reached the database. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [message, onDone])

  if (!message) return null
  return (
    <div
      className="glass"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        padding: '12px 20px',
        borderRadius: 12,
        border: `1px solid rgba(123,153,86,0.3)`,
        color: C.cream,
        fontSize: 13,
        zIndex: 200,
        maxWidth: 340,
      }}
    >
      <span style={{ color: C.accent, marginRight: 8 }}>✓</span>
      {message}
    </div>
  )
}

export const TABLE_STATUS_COLOR: Record<string, string> = {
  available: C.success,
  occupied: C.error,
  reserved: C.warning,
  cleaning: C.accent,
  vip: C.brown,
  'out-of-service': C.grey,
}

export const STAFF_STATUS_COLOR: Record<string, string> = {
  available: C.success,
  busy: C.warning,
  break: C.accent,
  offline: C.grey,
}

export const RESERVATION_STATUS_COLOR: Record<string, string> = {
  pending: C.warning,
  confirmed: C.success,
  seated: C.brown,
  cancelled: C.error,
  completed: C.accent,
}

export const INVENTORY_STATUS_COLOR: Record<string, string> = {
  ok: C.success,
  low: C.warning,
  critical: C.error,
}

export function money(n: number | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}
