import { useState } from 'react'
import {
  addWalkin,
  cancelQueueEntry,
  fetchQueue,
  fetchTables,
  prioritiseQueueEntry,
  seatNext,
  type QueueEntry,
  type RestaurantTable,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, Empty, ErrorBanner, Field, Loading, PageHeader, Panel, StatCard, Toast,
  mono, sans, serif,
} from '../components/ui'

export default function QueuePage() {
  const { data, error, loading, reload } = useLive<{
    queue: QueueEntry[]
    tables: RestaurantTable[]
  }>(async () => ({ queue: await fetchQueue(), tables: await fetchTables() }), [
    'queue_entries',
    'restaurant_tables',
  ])
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [toast, setToast] = useState('')
  const [seatTable, setSeatTable] = useState('')
  const [walkin, setWalkin] = useState({ name: '', party: '2', phone: '' })
  const [showAdd, setShowAdd] = useState(false)

  if (loading) return <Loading />

  const all = data?.queue ?? []
  const waiting = all.filter((q) => q.status === 'waiting')
  const served = all.filter((q) => q.status === 'served').slice(0, 4)
  const freeTables = (data?.tables ?? []).filter((t) => t.status === 'available')

  const nameOf = (q: QueueEntry) => q.display_name || q.profiles?.name || 'Guest'

  function doSeat() {
    if (waiting.length === 0) return
    const front = waiting[0]
    run(async () => {
      await seatNext(seatTable ? Number(seatTable) : null)
      setToast(
        `${nameOf(front)} seated${seatTable ? ` at T${seatTable}` : ''}. Everyone behind moved up and was notified.`,
      )
      setSeatTable('')
    })
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1000 }}>
      <PageHeader
        title="Queue Management"
        subtitle={`${waiting.length} waiting · seating or cancelling renumbers the guest app live`}
        right={
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Close' : '+ Walk-in'}
          </Button>
        }
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      {showAdd && (
        <Panel style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="Name" value={walkin.name} onChange={(v) => setWalkin({ ...walkin, name: v })} placeholder="Nguyen Family" />
            <Field label="Party" value={walkin.party} onChange={(v) => setWalkin({ ...walkin, party: v })} type="number" />
            <Field label="Phone" value={walkin.phone} onChange={(v) => setWalkin({ ...walkin, phone: v })} placeholder="Optional" />
            <Button
              disabled={busy || !walkin.name.trim()}
              onClick={() =>
                run(async () => {
                  await addWalkin(walkin.name.trim(), Number(walkin.party) || 2, walkin.phone, false)
                  setToast(`${walkin.name.trim()} added to the queue.`)
                  setWalkin({ name: '', party: '2', phone: '' })
                  setShowAdd(false)
                })
              }
            >
              Add
            </Button>
          </div>
        </Panel>
      )}

      {/* Now serving */}
      <Panel style={{ marginBottom: 20, border: '1px solid rgba(76,175,110,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 10, color: C.success, fontFamily: mono, letterSpacing: '0.1em' }}>
              NEXT TO BE SEATED
            </span>
            <h2 style={{ fontFamily: serif, fontSize: 28, color: C.cream, margin: '4px 0', fontWeight: 400 }}>
              {waiting[0] ? nameOf(waiting[0]) : 'Nobody waiting'}
            </h2>
            <p style={{ color: C.stone, margin: 0, fontSize: 13 }}>
              {waiting[0]
                ? `Party of ${waiting[0].party_size}${waiting[0].phone ? ` · ${waiting[0].phone}` : ''}`
                : 'The queue is clear.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <select
              value={seatTable}
              onChange={(e) => setSeatTable(e.target.value)}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: `1px solid ${C.hairline}`,
                background: '#1c1710',
                color: C.cream,
                fontSize: 13,
                fontFamily: sans,
                cursor: 'pointer',
              }}
            >
              <option value="">Choose a table…</option>
              {freeTables.map((t) => (
                <option key={t.id} value={t.id}>
                  T{t.id} · {t.seats} seats · {t.zone}
                </option>
              ))}
            </select>
            <Button disabled={busy || waiting.length === 0} onClick={doSeat}>
              Seat next party →
            </Button>
          </div>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="People Waiting" value={waiting.reduce((a, q) => a + q.party_size, 0)} />
        <StatCard label="Parties" value={waiting.length} />
        <StatCard
          label="Priority"
          value={waiting.filter((q) => q.priority).length}
          accent={C.warning}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {waiting.map((entry) => (
          <div
            key={entry.id}
            className="float-card glass"
            style={{
              borderRadius: 14,
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              border: entry.priority ? '1px solid rgba(217,119,6,0.3)' : `1px solid ${C.hairline}`,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 22, fontFamily: serif, color: C.accent, minWidth: 32, textAlign: 'center' }}>
              {entry.position}
            </span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: C.cream, fontWeight: 600 }}>{nameOf(entry)}</span>
                {entry.priority && <Badge color={C.warning}>PRIORITY</Badge>}
                {entry.user_id && <Badge color={C.accent}>APP</Badge>}
              </div>
              <span style={{ fontSize: 12, color: C.stone }}>
                Party of {entry.party_size}
                {entry.phone ? ` · ${entry.phone}` : ''}
              </span>
            </div>
            <div style={{ textAlign: 'right', marginRight: 8 }}>
              <div style={{ fontSize: 13, color: C.cream, fontFamily: mono }}>
                ~{(entry.position - 1) * 7} min
              </div>
              <div style={{ fontSize: 10, color: C.stone }}>Est. wait</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                small
                variant="outline"
                disabled={busy || entry.position === 1}
                onClick={() =>
                  run(async () => {
                    await prioritiseQueueEntry(entry.id)
                    setToast(`${nameOf(entry)} moved to the front.`)
                  })
                }
              >
                ↑ Front
              </Button>
              <Button
                small
                variant="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await cancelQueueEntry(entry.id)
                    setToast(`${nameOf(entry)} removed. Queue renumbered and guests notified.`)
                  })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))}

        {waiting.length === 0 && <Empty>Nobody is waiting. Guests who join from the app appear here.</Empty>}
      </div>

      {served.length > 0 && (
        <>
          <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.1em', margin: '28px 0 12px' }}>
            RECENTLY SEATED
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {served.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: '10px 20px',
                  borderRadius: 12,
                  background: 'rgba(20,19,10,0.4)',
                  border: `1px solid ${C.hairline}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: C.stone,
                }}
              >
                <span>{nameOf(s)}</span>
                <span style={{ fontFamily: mono }}>{s.table_id ? `T${s.table_id}` : 'seated'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
