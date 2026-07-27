import { useState } from 'react'
import {
  assignTableStaff,
  fetchReservations,
  fetchStaff,
  fetchTables,
  setTableStatus,
  type Reservation,
  type RestaurantTable,
  type StaffMember,
  type TableStatus,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, ErrorBanner, InfoRow, Loading, PageHeader, Panel, Select, Toast,
  TABLE_STATUS_COLOR, mono, sans, serif,
} from '../components/ui'

const STATUSES: TableStatus[] = ['available', 'occupied', 'reserved', 'cleaning', 'vip', 'out-of-service']

const STATUS_EMOJI: Record<TableStatus, string> = {
  available: '🟢',
  occupied: '🔴',
  reserved: '🟡',
  cleaning: '🔵',
  vip: '⭐',
  'out-of-service': '⚫',
}

export default function TablesPage() {
  const { data, error, loading, reload } = useLive<{
    tables: RestaurantTable[]
    staff: StaffMember[]
    reservations: Reservation[]
  }>(
    async () => ({
      tables: await fetchTables(),
      staff: await fetchStaff(),
      reservations: await fetchReservations(),
    }),
    ['restaurant_tables', 'staff_members', 'reservations'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [selected, setSelected] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  if (loading) return <Loading />

  const tables = data?.tables ?? []
  const staff = data?.staff ?? []
  const reservations = data?.reservations ?? []
  const table = tables.find((t) => t.id === selected) ?? null

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = table
    ? reservations
        .filter(
          (r) =>
            r.table_id === table.id &&
            r.reservation_date >= today &&
            ['pending', 'confirmed', 'seated'].includes(r.status),
        )
        .slice(0, 3)
    : []

  function cycle(t: RestaurantTable) {
    const next = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length]
    run(async () => {
      await setTableStatus(t.id, next)
      setToast(
        next === 'out-of-service'
          ? `T${t.id} out of service — guests can no longer book it.`
          : t.status === 'out-of-service'
            ? `T${t.id} back in service and bookable again.`
            : `T${t.id} → ${next}.`,
      )
    })
  }

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Table Management"
        subtitle="Click a table to cycle its status · out-of-service removes it from the guest floor plan"
        right={<Button variant="ghost" onClick={reload}>↻ Refresh</Button>}
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
            {tables.map((t) => {
              const server = staff.find((s) => s.id === t.assigned_staff_id)
              return (
                <div
                  key={t.id}
                  className="float-card"
                  style={{
                    borderRadius: 18,
                    padding: '18px 16px',
                    border: `1px solid ${
                      selected === t.id ? TABLE_STATUS_COLOR[t.status] : `${TABLE_STATUS_COLOR[t.status]}30`
                    }`,
                    background: `${TABLE_STATUS_COLOR[t.status]}10`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelected(selected === t.id ? null : t.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 20 }}>{STATUS_EMOJI[t.status]}</span>
                    <span
                      style={{
                        fontFamily: serif,
                        fontSize: 26,
                        color: TABLE_STATUS_COLOR[t.status],
                        lineHeight: 1,
                      }}
                    >
                      {t.id}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.cream, fontWeight: 600 }}>Table {t.id}</div>
                    <div style={{ fontSize: 10, color: C.stone }}>
                      {t.seats} seats · {t.zone}
                    </div>
                    <div style={{ fontSize: 10, color: server ? C.accent : C.stone, marginTop: 2 }}>
                      {server ? server.name.split(' ')[0] : 'unassigned'}
                    </div>
                  </div>
                  <Badge color={TABLE_STATUS_COLOR[t.status]}>{t.status}</Badge>
                  {/* Plain button rather than <Button>: it sits inside a
                      clickable card, so it needs the event to stop the click
                      from also toggling the detail panel. */}
                  <button
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      cycle(t)
                    }}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 8,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      fontFamily: sans,
                      background: 'transparent',
                      color: C.stone,
                      border: `1px solid ${C.hairline}`,
                      opacity: busy ? 0.45 : 1,
                    }}
                  >
                    Next status →
                  </button>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginTop: 22 }}>
            {STATUSES.map((s) => (
              <Panel key={s} style={{ padding: '12px 14px', borderTop: `2px solid ${TABLE_STATUS_COLOR[s]}` }}>
                <div style={{ fontSize: 20, fontFamily: serif, color: TABLE_STATUS_COLOR[s] }}>
                  {tables.filter((t) => t.status === s).length}
                </div>
                <div style={{ fontSize: 9, color: C.stone, fontFamily: mono, textTransform: 'capitalize' }}>
                  {s}
                </div>
              </Panel>
            ))}
          </div>
        </div>

        <Panel>
          {table ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <h3 style={{ fontFamily: serif, fontSize: 20, color: C.cream, margin: 0, fontWeight: 400 }}>
                  Table {table.id}
                </h3>
                <Badge color={TABLE_STATUS_COLOR[table.status]}>{table.status}</Badge>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                <InfoRow label="Seats" value={String(table.seats)} />
                <InfoRow label="Zone" value={table.zone} />
                <InfoRow
                  label="Bookable"
                  value={table.available ? 'Yes' : 'No'}
                  accent={table.available ? C.success : C.error}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                <Select
                  label="Status"
                  value={table.status}
                  onChange={(v) =>
                    run(async () => {
                      await setTableStatus(table.id, v as TableStatus)
                      setToast(`T${table.id} → ${v}.`)
                    })
                  }
                  options={STATUSES.map((s) => ({ value: s, label: s }))}
                />
                <Select
                  label="Assigned server"
                  value={table.assigned_staff_id ?? ''}
                  onChange={(v) =>
                    run(async () => {
                      await assignTableStaff(table.id, v || null)
                      setToast(v ? 'Server assigned.' : 'Server unassigned.')
                    })
                  }
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...staff.map((s) => ({ value: s.id, label: `${s.name} · ${s.role}` })),
                  ]}
                />
              </div>

              <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.1em', margin: '0 0 10px' }}>
                UPCOMING BOOKINGS
              </p>
              {upcoming.length === 0 ? (
                <p style={{ fontSize: 12, color: C.stone, margin: 0 }}>Nothing booked.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {upcoming.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'rgba(20,19,10,0.5)',
                        border: `1px solid ${C.hairline}`,
                        fontSize: 11,
                        color: C.stone,
                      }}
                    >
                      <span style={{ color: C.cream }}>
                        {r.guest_name || r.profiles?.name || 'Guest'}
                      </span>
                      <br />
                      {r.reservation_date} · {r.reservation_time} · {r.guests} guests
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 200,
                gap: 10,
              }}
            >
              <span style={{ fontSize: 32 }}>◫</span>
              <p style={{ color: C.stone, fontSize: 13, textAlign: 'center', margin: 0 }}>
                Select a table to manage it.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
