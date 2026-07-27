import { useState } from 'react'
import {
  fetchReservations,
  fetchTables,
  setReservationStatus,
  updateReservation,
  type Reservation,
  type ReservationStatus,
  type RestaurantTable,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, Empty, ErrorBanner, InfoRow, Loading, PageHeader, Panel, Select, Toast,
  RESERVATION_STATUS_COLOR, mono,
} from '../components/ui'

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'seated', label: 'Seated' },
  { id: 'today', label: 'Today' },
]

export default function ReservationsPage() {
  const { data, error, loading, reload } = useLive<{
    reservations: Reservation[]
    tables: RestaurantTable[]
  }>(async () => ({ reservations: await fetchReservations(), tables: await fetchTables() }), [
    'reservations',
    'restaurant_tables',
  ])
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [toast, setToast] = useState('')

  if (loading) return <Loading />

  const all = data?.reservations ?? []
  const tables = data?.tables ?? []
  const today = new Date().toISOString().slice(0, 10)

  const list = all.filter((r) => {
    if (filter === 'all') return true
    if (filter === 'today') return r.reservation_date === today
    return r.status === filter
  })

  const res = list.find((r) => r.id === selected) ?? all.find((r) => r.id === selected) ?? null

  const guestOf = (r: Reservation) =>
    r.guest_name || r.profiles?.name || r.profiles?.email?.split('@')[0] || 'Guest'

  function changeStatus(r: Reservation, status: ReservationStatus, note: string) {
    run(async () => {
      await setReservationStatus(r.id, status)
      setToast(note)
    })
  }

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Reservations"
        subtitle={`${all.length} total · approving, moving or cancelling notifies the guest instantly`}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: mono,
                  fontSize: 11,
                  background: filter === f.id ? C.accentDeep : 'transparent',
                  color: filter === f.id ? C.accent : C.stone,
                  border: filter === f.id ? 'none' : `1px solid ${C.hairline}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }}>
        <Panel style={{ padding: 0, overflow: 'hidden' }}>
          {list.length === 0 ? (
            <Empty>No reservations match this filter.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.hairline}` }}>
                    {['Guest', 'Date', 'Time', 'Guests', 'Table', 'Occasion', 'Status'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '14px 16px',
                          textAlign: 'left',
                          fontSize: 10,
                          color: C.stone,
                          fontFamily: mono,
                          letterSpacing: '0.08em',
                          fontWeight: 400,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(selected === r.id ? null : r.id)}
                      style={{
                        borderBottom: '1px solid rgba(142,107,87,0.08)',
                        cursor: 'pointer',
                        background: selected === r.id ? 'rgba(123,153,86,0.06)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontSize: 13, color: C.cream }}>{guestOf(r)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.stone, fontFamily: mono }}>
                        {r.reservation_date}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.stone, fontFamily: mono }}>
                        {r.reservation_time}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: C.cream }}>{r.guests}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.accent, fontFamily: mono }}>
                        {r.table_id ? `T${r.table_id}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11, color: r.occasion ? C.warning : C.stone }}>
                        {r.occasion || '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <Badge color={RESERVATION_STATUS_COLOR[r.status] ?? C.stone}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          {res ? (
            <>
              <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: C.cream, margin: '0 0 18px', fontWeight: 400 }}>
                {guestOf(res)}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <InfoRow label="Date" value={res.reservation_date} />
                <InfoRow label="Time" value={res.reservation_time} />
                <InfoRow label="Guests" value={String(res.guests)} />
                <InfoRow label="Occasion" value={res.occasion || 'None'} />
                <InfoRow label="Phone" value={res.guest_phone || '—'} />
                <InfoRow label="Notes" value={res.notes || 'None'} />
                <InfoRow label="Bill" value={res.bill_status} />
                <InfoRow
                  label="Status"
                  value={res.status}
                  accent={RESERVATION_STATUS_COLOR[res.status]}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <Select
                  label="Move to table"
                  value={res.table_id ? String(res.table_id) : ''}
                  onChange={(v) =>
                    run(async () => {
                      await updateReservation(res.id, { table_id: v ? Number(v) : null })
                      setToast('Table changed — the guest has been notified.')
                    })
                  }
                  options={[
                    { value: '', label: 'No table' },
                    ...tables.map((t) => ({
                      value: String(t.id),
                      label: `T${t.id} · ${t.seats} seats · ${t.zone}`,
                    })),
                  ]}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Button
                  small
                  disabled={busy || res.status === 'confirmed'}
                  onClick={() => changeStatus(res, 'confirmed', 'Confirmed — the guest has been notified.')}
                >
                  Approve
                </Button>
                <Button
                  small
                  variant="outline"
                  disabled={busy || res.status === 'seated'}
                  onClick={() =>
                    changeStatus(res, 'seated', 'Seated — the guest was told their table is ready.')
                  }
                >
                  Seat
                </Button>
                <Button
                  small
                  variant="ghost"
                  disabled={busy || res.status === 'completed'}
                  onClick={() => changeStatus(res, 'completed', 'Marked complete. The table is freed.')}
                >
                  Complete
                </Button>
                <Button
                  small
                  variant="danger"
                  disabled={busy || res.status === 'cancelled'}
                  onClick={() =>
                    changeStatus(res, 'cancelled', 'Cancelled — the guest has been notified.')
                  }
                >
                  Cancel
                </Button>
              </div>
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
              <span style={{ fontSize: 32 }}>◉</span>
              <p style={{ color: C.stone, fontSize: 13, textAlign: 'center', margin: 0 }}>
                Select a reservation to manage it.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
