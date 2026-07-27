import { useState } from 'react'
import {
  fetchOrders,
  fetchStaff,
  setKitchenStatus,
  setOrderPriority,
  assignOrderStaff,
  type KitchenStatus,
  type Order,
  type StaffMember,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, ErrorBanner, Loading, PageHeader, Toast, elapsed, mono, money, sans,
} from '../components/ui'

const COLUMNS: { id: KitchenStatus; label: string; guestStep: string }[] = [
  { id: 'new', label: 'New', guestStep: 'Awaiting the pass' },
  { id: 'accepted', label: 'Accepted', guestStep: 'Accepted ✓' },
  { id: 'mise_en_place', label: 'Mise en place', guestStep: 'Mise en place ✓' },
  { id: 'cooking', label: 'Cooking', guestStep: 'Cooking ✓' },
  { id: 'quality_check', label: 'Quality check', guestStep: 'Quality check ✓' },
  { id: 'ready', label: 'Ready', guestStep: 'Ready ✓' },
  { id: 'served', label: 'Served', guestStep: 'Timeline complete' },
]

const PRIORITY_COLOR: Record<string, string> = {
  high: C.error,
  normal: C.warning,
  low: C.accent,
}

export default function OrdersPage() {
  const { data, error, loading, reload } = useLive<{ orders: Order[]; staff: StaffMember[] }>(
    async () => ({ orders: await fetchOrders(), staff: await fetchStaff() }),
    ['orders', 'order_items'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [dragging, setDragging] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<KitchenStatus | null>(null)
  const [toast, setToast] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  if (loading) return <Loading />

  const orders = data?.orders ?? []
  const staff = data?.staff ?? []
  const active = orders.filter((o) => o.kitchen_status !== 'served')

  function move(order: Order, to: KitchenStatus) {
    if (order.kitchen_status === to) return
    const col = COLUMNS.find((c) => c.id === to)
    run(async () => {
      await setKitchenStatus(order.id, to)
      setToast(`Order ${order.id.slice(0, 8).toUpperCase()} → ${col?.label}. Guest timeline: ${col?.guestStep}`)
    })
  }

  function advance(order: Order) {
    const idx = COLUMNS.findIndex((c) => c.id === order.kitchen_status)
    if (idx < COLUMNS.length - 1) move(order, COLUMNS[idx + 1].id)
  }

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Order Management"
        subtitle={`${active.length} active · drag a card, or press Next — the guest's tracking page follows along`}
        right={<Button variant="ghost" onClick={reload}>↻ Refresh</Button>}
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16 }}>
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.kitchen_status === col.id)
          return (
            <div
              key={col.id}
              className={`kanban-col ${overCol === col.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOverCol(col.id)
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={() => {
                const order = orders.find((o) => o.id === dragging)
                if (order) move(order, col.id)
                setDragging(null)
                setOverCol(null)
              }}
              style={{
                minWidth: 236,
                flex: '0 0 236px',
                borderRadius: 16,
                background: overCol === col.id ? 'rgba(123,153,86,0.06)' : 'rgba(30,23,16,0.6)',
                border: `1px solid ${overCol === col.id ? 'rgba(123,153,86,0.3)' : 'rgba(142,107,87,0.12)'}`,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.cream, fontWeight: 600 }}>{col.label}</span>
                <Badge color={col.id === 'new' ? C.error : col.id === 'served' ? C.success : C.stone}>
                  {colOrders.length}
                </Badge>
              </div>

              {colOrders.map((order) => {
                const isOpen = expanded === order.id
                const guest = order.profiles?.name || order.profiles?.email?.split('@')[0] || 'Guest'
                return (
                  <div
                    key={order.id}
                    draggable
                    onDragStart={() => setDragging(order.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                    className="float-card"
                    style={{
                      background: dragging === order.id ? 'rgba(123,153,86,0.1)' : 'rgba(20,19,10,0.7)',
                      borderRadius: 12,
                      padding: 12,
                      border: `1px solid ${dragging === order.id ? 'rgba(123,153,86,0.3)' : 'rgba(142,107,87,0.1)'}`,
                      cursor: 'grab',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
                      <span style={{ fontSize: 12, color: C.cream, fontWeight: 600 }}>{guest}</span>
                      <Badge color={PRIORITY_COLOR[order.priority]}>{order.priority.toUpperCase()}</Badge>
                    </div>

                    <div style={{ fontSize: 10, color: C.accent, marginBottom: 6, fontFamily: mono }}>
                      {order.table_id ? `T${order.table_id}` : 'No table'} · {money(order.total)}
                    </div>

                    {order.order_items.map((item) => (
                      <div key={item.id} style={{ fontSize: 11, color: C.stone, lineHeight: 1.5 }}>
                        • {item.dish_name}
                        {item.qty > 1 ? ` ×${item.qty}` : ''}
                      </div>
                    ))}

                    {order.instructions && (
                      <div style={{ fontSize: 10, color: C.warning, marginTop: 6, fontStyle: 'italic' }}>
                        ⚠ {order.instructions}
                      </div>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 10,
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 10, color: C.stone, fontFamily: mono }}>
                        ⏱ {elapsed(order.created_at)}
                      </span>
                      {order.kitchen_status !== 'served' && (
                        <Button
                          small
                          disabled={busy}
                          onClick={() => advance(order)}
                        >
                          Next →
                        </Button>
                      )}
                    </div>

                    {isOpen && (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: `1px solid ${C.hairline}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 10, color: C.stone, fontFamily: mono }}>
                          GUEST STATUS · {order.status.replace('_', ' ')}
                        </div>

                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['high', 'normal', 'low'] as const).map((p) => (
                            <button
                              key={p}
                              onClick={(e) => {
                                e.stopPropagation()
                                run(() => setOrderPriority(order.id, p))
                              }}
                              style={{
                                flex: 1,
                                padding: '4px 0',
                                borderRadius: 6,
                                fontSize: 9,
                                cursor: 'pointer',
                                fontFamily: mono,
                                border: `1px solid ${order.priority === p ? PRIORITY_COLOR[p] : C.hairline}`,
                                background: order.priority === p ? `${PRIORITY_COLOR[p]}20` : 'transparent',
                                color: order.priority === p ? PRIORITY_COLOR[p] : C.stone,
                              }}
                            >
                              {p.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <select
                          value={order.assigned_staff_id ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            run(() => assignOrderStaff(order.id, e.target.value || null))
                          }
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: `1px solid ${C.hairline}`,
                            background: '#1c1710',
                            color: C.cream,
                            fontSize: 10,
                            fontFamily: sans,
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">Unassigned</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {s.role}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}

              {colOrders.length === 0 && (
                <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 11, color: 'rgba(168,152,128,0.3)' }}>Drop here</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {orders.length === 0 && (
        <p style={{ color: C.stone, fontSize: 13, marginTop: 24 }}>
          No orders yet. Place one from the Maison guest app and it will appear here in the New column.
        </p>
      )}

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
