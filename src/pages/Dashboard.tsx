import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  fetchDashboardStats, fetchOrders, fetchRevenueSeries, fetchStaff, fetchTables,
  setTableStatus, type DashboardStats, type Order, type RestaurantTable, type StaffMember,
  type TableStatus,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import type { Page } from '../components/Sidebar'
import {
  Badge, Button, C, ErrorBanner, InfoRow, Loading, Panel, StatCard, Toast,
  TABLE_STATUS_COLOR, elapsed, money, mono, serif,
} from '../components/ui'

interface DashData {
  stats: DashboardStats
  tables: RestaurantTable[]
  orders: Order[]
  revenue: { name: string; revenue: number; orders: number }[]
  staff: StaffMember[]
}

const STATUS_CYCLE: TableStatus[] = ['available', 'occupied', 'reserved', 'cleaning', 'vip', 'out-of-service']

export default function DashboardPage({ setPage }: { setPage: (p: Page) => void }) {
  const { data, error, loading, reload } = useLive<DashData>(
    async () => ({
      stats: await fetchDashboardStats(),
      tables: await fetchTables(),
      orders: await fetchOrders(),
      revenue: await fetchRevenueSeries('week'),
      staff: await fetchStaff(),
    }),
    ['orders', 'restaurant_tables', 'queue_entries', 'reservations', 'inventory_items'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [clock, setClock] = useState(new Date())
  const [selected, setSelected] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  if (loading) return <Loading />

  const stats = data?.stats
  const tables = data?.tables ?? []
  const orders = data?.orders ?? []
  const staff = data?.staff ?? []
  const revenue = (data?.revenue ?? []).map((r) => ({ ...r, revenue: Number(r.revenue) }))

  const table = tables.find((t) => t.id === selected) ?? null
  const tableOrders = table
    ? orders.filter((o) => o.table_id === table.id && o.kitchen_status !== 'served')
    : []
  const server = table ? staff.find((s) => s.id === table.assigned_staff_id) : null

  const revToday = Number(stats?.revenue_today ?? 0)
  const revYesterday = Number(stats?.revenue_yesterday ?? 0)
  const delta = revYesterday > 0 ? Math.round(((revToday - revYesterday) / revYesterday) * 100) : 0
  const occupancy = stats && stats.tables_total > 0
    ? Math.round((stats.tables_occupied / stats.tables_total) * 100)
    : 0

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 38, fontWeight: 400, color: C.cream, margin: 0, lineHeight: 1.1 }}>
            Good {clock.getHours() < 12 ? 'morning' : clock.getHours() < 17 ? 'afternoon' : 'evening'}
          </h1>
          <p style={{ color: C.stone, margin: '6px 0 0', fontSize: 14 }}>
            {clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
        <Button variant="ghost" onClick={reload}>↻ Refresh</Button>
      </div>

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        <StatCard
          label="Today's Revenue"
          value={Math.round(revToday)}
          prefix="$"
          sub={revYesterday > 0 ? `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs yesterday` : 'First day of trading'}
          accent={C.accent}
        />
        <StatCard label="Orders Today" value={Number(stats?.orders_today ?? 0)} sub={`${stats?.orders_active ?? 0} still active`} />
        <StatCard label="Customers Served" value={Number(stats?.customers_served ?? 0)} sub="Distinct guests today" />
        <StatCard
          label="Occupancy"
          value={occupancy}
          suffix="%"
          sub={`${stats?.tables_occupied ?? 0} of ${stats?.tables_total ?? 0} tables`}
          accent={C.warning}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Queue" value={Number(stats?.queue_waiting ?? 0)} sub={`${stats?.queue_people ?? 0} people waiting`} />
        <StatCard label="Pending Bookings" value={Number(stats?.reservations_pending ?? 0)} sub={`${stats?.reservations_today ?? 0} booked today`} />
        <StatCard
          label="Stock Alerts"
          value={Number(stats?.inventory_critical ?? 0) + Number(stats?.inventory_low ?? 0)}
          sub={`${stats?.inventory_critical ?? 0} critical, ${stats?.inventory_low ?? 0} low`}
          accent={C.error}
        />
        <StatCard label="Staff On Shift" value={Number(stats?.staff_available ?? 0) + Number(stats?.staff_busy ?? 0)} sub={`${stats?.staff_available ?? 0} available now`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 20, marginBottom: 28 }}>
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: serif, fontSize: 20, color: C.cream, margin: 0, fontWeight: 400 }}>
              Live Restaurant Floor
            </h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {STATUS_CYCLE.slice(0, 5).map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: TABLE_STATUS_COLOR[s],
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontSize: 10, color: C.stone, fontFamily: mono, textTransform: 'capitalize' }}>
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 12 }}>
            {tables.map((t) => {
              const liveOrders = orders.filter((o) => o.table_id === t.id && o.kitchen_status !== 'served').length
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(selected === t.id ? null : t.id)}
                  style={{
                    borderRadius: 14,
                    border: `2px solid ${selected === t.id ? TABLE_STATUS_COLOR[t.status] : 'rgba(142,107,87,0.15)'}`,
                    background: selected === t.id ? `${TABLE_STATUS_COLOR[t.status]}18` : 'rgba(20,19,10,0.5)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    height: 100,
                    position: 'relative',
                    overflow: 'hidden',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      background: TABLE_STATUS_COLOR[t.status],
                      opacity: 0.8,
                    }}
                  />
                  <span style={{ fontSize: 18, color: TABLE_STATUS_COLOR[t.status] }}>⊡</span>
                  <span style={{ fontSize: 11, color: C.cream, fontWeight: 600 }}>T{t.id}</span>
                  <span style={{ fontSize: 9, color: C.stone, fontFamily: mono }}>{t.seats} seats</span>
                  {liveOrders > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        fontSize: 9,
                        color: C.accent,
                        fontFamily: mono,
                      }}
                    >
                      {liveOrders}●
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel>
          {table ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <h3 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: 0, fontWeight: 400 }}>
                  Table {table.id}
                </h3>
                <Badge color={TABLE_STATUS_COLOR[table.status]}>{table.status}</Badge>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                <InfoRow label="Seats" value={String(table.seats)} />
                <InfoRow label="Zone" value={table.zone} />
                <InfoRow label="Server" value={server?.name ?? 'Unassigned'} />
                <InfoRow label="Live orders" value={String(tableOrders.length)} accent={C.accent} />
                <InfoRow
                  label="Open bill"
                  value={money(tableOrders.reduce((a, o) => a + Number(o.total ?? 0), 0))}
                  accent={C.accent}
                />
                <InfoRow label="Bookable" value={table.available ? 'Yes' : 'No'} accent={table.available ? C.success : C.error} />
              </div>

              {tableOrders.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, margin: '0 0 8px' }}>IN THE KITCHEN</p>
                  {tableOrders.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'rgba(20,19,10,0.5)',
                        border: `1px solid ${C.hairline}`,
                        marginBottom: 6,
                        fontSize: 11,
                        color: C.stone,
                      }}
                    >
                      <span style={{ color: C.cream }}>{o.kitchen_status.replace('_', ' ')}</span> ·{' '}
                      {elapsed(o.created_at)} · {o.order_items.length} item
                      {o.order_items.length === 1 ? '' : 's'}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  small
                  disabled={busy}
                  onClick={() => {
                    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(table.status) + 1) % STATUS_CYCLE.length]
                    run(async () => {
                      await setTableStatus(table.id, next)
                      setToast(`T${table.id} → ${next}.`)
                    })
                  }}
                >
                  Next status
                </Button>
                <Button small variant="ghost" onClick={() => setPage('tables')}>
                  Manage
                </Button>
                {tableOrders.length > 0 && (
                  <Button small variant="outline" onClick={() => setPage('orders')}>
                    Kitchen board
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h3 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: 0, fontWeight: 400 }}>
                Live Status
              </h3>
              {[
                ['Tables available', String(stats?.tables_available ?? 0), C.success],
                ['Tables occupied', String(stats?.tables_occupied ?? 0), C.error],
                ['Tables reserved', String(stats?.tables_reserved ?? 0), C.warning],
                ['Active orders', String(stats?.orders_active ?? 0), C.cream],
                ['Queue length', `${stats?.queue_waiting ?? 0} parties`, C.cream],
                ['Pending bookings', String(stats?.reservations_pending ?? 0), C.warning],
                ['Critical stock', String(stats?.inventory_critical ?? 0), C.error],
                ['Staff available', String(stats?.staff_available ?? 0), C.success],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: 10,
                    borderBottom: '1px solid rgba(142,107,87,0.1)',
                  }}
                >
                  <span style={{ fontSize: 12, color: C.stone }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color, fontFamily: mono }}>{value}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: C.stone, margin: 0 }}>
                Click any table on the floor plan for its detail.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: serif, fontSize: 20, color: C.cream, margin: 0, fontWeight: 400 }}>
            This Week
          </h2>
          <button
            onClick={() => setPage('sales')}
            style={{ background: 'none', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: mono }}
          >
            Full report →
          </button>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={revenue}>
            <defs>
              <linearGradient id="dashRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.accent} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,107,87,0.1)" />
            <XAxis dataKey="name" tick={{ fill: C.stone, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: C.stone, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
            />
            <Tooltip
              contentStyle={{ background: '#1c1710', border: '1px solid rgba(142,107,87,0.2)', borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: C.cream }}
              formatter={(v: unknown) => [money(Number(v)), 'Revenue'] as [string, string]}
            />
            <Area type="monotone" dataKey="revenue" stroke={C.accent} strokeWidth={2} fill="url(#dashRev)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
