import { useEffect, useState } from 'react'
import type { DashboardStats } from '../lib/api'
import { C, mono, sans, serif } from './ui'

export type Page =
  | 'dashboard' | 'orders' | 'reservations' | 'queue'
  | 'inventory' | 'menu' | 'tables' | 'staff' | 'customers'
  | 'sales' | 'analytics' | 'ai'

const navItems: { id: Page; label: string; icon: string; badge?: keyof DashboardStats }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'orders', label: 'Orders', icon: '◈', badge: 'orders_active' },
  { id: 'reservations', label: 'Reservations', icon: '◉', badge: 'reservations_pending' },
  { id: 'queue', label: 'Queue', icon: '▤', badge: 'queue_waiting' },
  { id: 'inventory', label: 'Inventory', icon: '⬡', badge: 'inventory_critical' },
  { id: 'menu', label: 'Menu', icon: '☰' },
  { id: 'tables', label: 'Tables', icon: '◫' },
  { id: 'staff', label: 'Staff', icon: '✦' },
  { id: 'customers', label: 'Customers', icon: '◯' },
  { id: 'sales', label: 'Sales', icon: '◇' },
  { id: 'analytics', label: 'Analytics', icon: '▦' },
  { id: 'ai', label: 'AI Insights', icon: '◊' },
]

export default function Sidebar({
  page,
  setPage,
  stats,
  staffName,
  onLogout,
}: {
  page: Page
  setPage: (p: Page) => void
  stats: DashboardStats | null
  staffName: string
  onLogout: () => void
}) {
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: 'linear-gradient(180deg, #1c1710 0%, #160f08 100%)',
        borderRight: '1px solid rgba(142,107,87,0.12)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      <div style={{ padding: '0 20px 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: 'rgba(123,153,86,0.08)',
            borderRadius: 12,
            border: '1px solid rgba(123,153,86,0.15)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentDeep})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: C.cream,
              fontFamily: serif,
            }}
          >
            M
          </div>
          <div>
            <div style={{ fontFamily: serif, fontSize: 14, color: C.cream, fontWeight: 500 }}>Maison</div>
            <div style={{ fontSize: 10, color: C.accent, fontFamily: mono }}>RESTAURANT OS</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'rgba(76,175,110,0.08)',
            borderRadius: 8,
            border: '1px solid rgba(76,175,110,0.15)',
          }}
        >
          <span
            className="pulse"
            style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, display: 'inline-block' }}
          />
          <span style={{ fontSize: 11, color: C.success, fontFamily: mono }}>
            LIVE · {clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '0 12px' }}>
        {navItems.map((item) => {
          const active = page === item.id
          const count = item.badge && stats ? Number(stats[item.badge] ?? 0) : 0
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '9px 12px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                marginBottom: 2,
                background: active ? 'rgba(123,153,86,0.15)' : 'transparent',
                color: active ? C.accent : C.stone,
                fontSize: 13,
                fontFamily: sans,
                fontWeight: active ? 600 : 400,
                textAlign: 'left',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'rgba(142,107,87,0.08)'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              {active && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 3,
                    height: 18,
                    background: C.accent,
                    borderRadius: '0 3px 3px 0',
                  }}
                />
              )}
              <span style={{ fontSize: 15, opacity: 0.85 }}>{item.icon}</span>
              <span>{item.label}</span>
              {count > 0 && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    padding: '2px 6px',
                    background: item.id === 'inventory' ? 'rgba(192,80,77,0.2)' : 'rgba(123,153,86,0.2)',
                    color: item.id === 'inventory' ? C.error : C.accent,
                    borderRadius: 8,
                    fontFamily: mono,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div style={{ padding: '16px 12px 0', borderTop: `1px solid ${C.hairline}`, marginTop: 12 }}>
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ fontSize: 12, color: C.cream }}>{staffName}</div>
          <div style={{ fontSize: 10, color: C.stone, fontFamily: mono }}>MANAGER</div>
        </div>
        <button
          onClick={onLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '9px 12px',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: C.stone,
            fontSize: 13,
            fontFamily: sans,
          }}
        >
          <span>⏻</span> Sign out
        </button>
      </div>
    </aside>
  )
}
