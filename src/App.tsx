import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './lib/supabase'
import { currentStaff, fetchDashboardStats, isManager, signOut, type DashboardStats } from './lib/api'
import { useLive } from './lib/useLive'
import Login from './components/Login'
import Sidebar, { type Page } from './components/Sidebar'
import { Button, C, mono, serif } from './components/ui'
import DashboardPage from './pages/Dashboard'
import OrdersPage from './pages/Orders'
import ReservationsPage from './pages/Reservations'
import QueuePage from './pages/Queue'
import InventoryPage from './pages/Inventory'
import MenuPage from './pages/Menu'
import TablesPage from './pages/Tables'
import StaffPage from './pages/Staff'
import CustomersPage from './pages/Customers'
import SalesPage from './pages/Sales'
import AnalyticsPage from './pages/Analytics'
import AIPage from './pages/AI'

type Gate = 'checking' | 'signed-out' | 'not-manager' | 'ready'

export default function App() {
  const [gate, setGate] = useState<Gate>('checking')
  const [page, setPage] = useState<Page>('dashboard')
  const [name, setName] = useState('Manager')
  const [email, setEmail] = useState('')

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setGate('signed-out')
      return
    }
    setEmail(data.session.user.email ?? '')

    if (!(await isManager())) {
      setGate('not-manager')
      return
    }

    const staff = await currentStaff()
    setName(staff?.name || data.session.user.email?.split('@')[0] || 'Manager')
    setGate('ready')
  }, [])

  useEffect(() => {
    check()
    const { data: sub } = supabase.auth.onAuthStateChange(() => check())
    return () => sub.subscription.unsubscribe()
  }, [check])

  if (gate === 'checking') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#14130A',
          color: C.stone,
          fontFamily: mono,
          fontSize: 13,
        }}
      >
        Connecting to Maison…
      </div>
    )
  }

  if (gate === 'signed-out') return <Login onSignedIn={check} />

  if (gate === 'not-manager') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#14130A',
          padding: 24,
        }}
      >
        <div className="glass" style={{ maxWidth: 460, borderRadius: 20, padding: 36 }}>
          <h1 style={{ fontFamily: serif, fontSize: 24, color: C.cream, margin: '0 0 12px', fontWeight: 400 }}>
            This account isn't a manager yet
          </h1>
          <p style={{ color: C.stone, fontSize: 13, lineHeight: 1.7, margin: '0 0 18px' }}>
            You're signed in as <span style={{ color: C.cream }}>{email}</span>, but that account hasn't
            been granted manager access. Run this once in the Supabase SQL editor, then check again:
          </p>
          <code
            style={{
              display: 'block',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(20,19,10,0.7)',
              border: `1px solid ${C.hairline}`,
              color: C.accent,
              fontSize: 12,
              fontFamily: mono,
              wordBreak: 'break-all',
              marginBottom: 20,
            }}
          >
            select public.grant_manager('{email}');
          </code>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={check}>Check again</Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut()
                setGate('signed-out')
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <Shell page={page} setPage={setPage} name={name} onSignedOut={() => setGate('signed-out')} />
}

/** Split out so the stats subscription only mounts once access is confirmed. */
function Shell({
  page,
  setPage,
  name,
  onSignedOut,
}: {
  page: Page
  setPage: (p: Page) => void
  name: string
  onSignedOut: () => void
}) {
  const { data: stats } = useLive<DashboardStats>(fetchDashboardStats, [
    'orders',
    'reservations',
    'queue_entries',
    'inventory_items',
  ])

  const pages: Record<Page, ReactNode> = {
    dashboard: <DashboardPage setPage={setPage} />,
    orders: <OrdersPage />,
    reservations: <ReservationsPage />,
    queue: <QueuePage />,
    inventory: <InventoryPage />,
    menu: <MenuPage />,
    tables: <TablesPage />,
    staff: <StaffPage />,
    customers: <CustomersPage />,
    sales: <SalesPage />,
    analytics: <AnalyticsPage />,
    ai: <AIPage />,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#14130A' }}>
      <Sidebar
        page={page}
        setPage={setPage}
        stats={stats}
        staffName={name}
        onLogout={async () => {
          await signOut()
          onSignedOut()
        }}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          background:
            'radial-gradient(ellipse at 20% 10%, rgba(59,44,32,0.25) 0%, transparent 60%), #14130A',
        }}
        className="scrollable"
      >
        {pages[page]}
      </main>
    </div>
  )
}
