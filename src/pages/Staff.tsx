import { useState } from 'react'
import {
  addStaff,
  assignStaffToTable,
  fetchStaff,
  fetchStaffAssignments,
  fetchTables,
  removeStaff,
  setStaffStatus,
  unassignTable,
  type RestaurantTable,
  type StaffMember,
  type StaffStatus,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Button, C, Empty, ErrorBanner, Field, Loading, PageHeader, Panel, Select, StatCard, Toast,
  STAFF_STATUS_COLOR, mono,
} from '../components/ui'

const STATUSES: StaffStatus[] = ['available', 'busy', 'break', 'offline']
const ROLES = ['Head Chef', 'Sous Chef', 'Waiter', 'Host', 'Sommelier', 'Bartender', 'Runner', 'Manager']
const BLANK = { name: '', role: 'Waiter', shift: '5PM–11PM' }

export default function StaffPage() {
  const { data, error, loading, reload } = useLive<{
    staff: StaffMember[]
    tables: RestaurantTable[]
    assignments: { staff_id: string; table_id: number }[]
  }>(
    async () => ({
      staff: await fetchStaff(),
      tables: await fetchTables(),
      assignments: await fetchStaffAssignments(),
    }),
    ['staff_members', 'staff_table_assignments', 'restaurant_tables'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [toast, setToast] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [dragging, setDragging] = useState<string | null>(null)

  if (loading) return <Loading />

  const staff = data?.staff ?? []
  const tables = data?.tables ?? []
  const assignments = data?.assignments ?? []

  const tablesOf = (id: string) =>
    assignments.filter((a) => a.staff_id === id).map((a) => a.table_id).sort((a, b) => a - b)

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Staff & Allocation"
        subtitle={`${staff.filter((s) => s.status === 'available').length} available · drag a card onto a table to allocate`}
        right={
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Close' : '+ Add staff'}
          </Button>
        }
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      {showAdd && (
        <Panel style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Select
              label="Role"
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={ROLES.map((r) => ({ value: r, label: r }))}
            />
            <Field label="Shift" value={form.shift} onChange={(v) => setForm({ ...form, shift: v })} />
            <Button
              disabled={busy || !form.name.trim()}
              onClick={() =>
                run(async () => {
                  await addStaff({ ...form, name: form.name.trim(), status: 'available' })
                  setToast(`${form.name.trim()} added to the roster.`)
                  setForm(BLANK)
                  setShowAdd(false)
                })
              }
            >
              Add
            </Button>
          </div>
        </Panel>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 26 }}>
        {STATUSES.map((s) => (
          <StatCard
            key={s}
            label={s}
            value={staff.filter((m) => m.status === s).length}
            accent={STAFF_STATUS_COLOR[s]}
          />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 20 }}>
        <div>
          <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.12em', margin: '0 0 12px' }}>
            ROSTER
          </p>
          {staff.length === 0 ? (
            <Empty>No staff yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {staff.map((member) => {
                const myTables = tablesOf(member.id)
                return (
                  <div
                    key={member.id}
                    className="float-card glass"
                    draggable
                    onDragStart={() => setDragging(member.id)}
                    onDragEnd={() => setDragging(null)}
                    style={{
                      borderRadius: 20,
                      padding: 20,
                      opacity: member.status === 'offline' ? 0.55 : 1,
                      cursor: 'grab',
                      border:
                        dragging === member.id
                          ? '1px solid rgba(123,153,86,0.4)'
                          : `1px solid ${C.hairline}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {member.photo ? (
                          <img
                            src={member.photo}
                            alt={member.name}
                            style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', background: '#3B2C20' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: '50%',
                              background: '#3B2C20',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: C.cream,
                              fontSize: 16,
                            }}
                          >
                            {member.name.charAt(0)}
                          </div>
                        )}
                        <span
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            background: STAFF_STATUS_COLOR[member.status],
                            border: '2px solid #14130A',
                          }}
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.cream, fontWeight: 600 }}>{member.name}</div>
                        <div style={{ fontSize: 11, color: C.stone }}>{member.role}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 10, color: C.stone }}>Shift</span>
                        <span style={{ fontSize: 11, color: C.cream, fontFamily: mono }}>{member.shift}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 10, color: C.stone }}>Tables</span>
                        <span style={{ fontSize: 11, color: C.accent, textAlign: 'right' }}>
                          {myTables.length > 0 ? myTables.map((t) => `T${t}`).join(', ') : '—'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 10, color: C.stone }}>Score</span>
                        <span style={{ fontSize: 11, color: C.cream, fontFamily: mono }}>{member.score}%</span>
                      </div>
                    </div>

                    <div style={{ height: 3, background: 'rgba(142,107,87,0.15)', borderRadius: 2, marginBottom: 12 }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: 2,
                          width: `${member.score}%`,
                          background: member.score > 90 ? C.success : member.score > 75 ? C.accent : C.warning,
                          transition: 'width 0.6s ease',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await setStaffStatus(member.id, s)
                              setToast(`${member.name} → ${s}.`)
                            })
                          }
                          style={{
                            flex: 1,
                            minWidth: 46,
                            padding: '4px 0',
                            borderRadius: 6,
                            fontSize: 9,
                            cursor: 'pointer',
                            fontFamily: mono,
                            border: `1px solid ${member.status === s ? STAFF_STATUS_COLOR[s] : C.hairline}`,
                            background: member.status === s ? `${STAFF_STATUS_COLOR[s]}20` : 'transparent',
                            color: member.status === s ? STAFF_STATUS_COLOR[s] : C.stone,
                          }}
                        >
                          {s.slice(0, 4).toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {!member.is_manager && (
                      <Button
                        small
                        variant="danger"
                        disabled={busy}
                        style={{ width: '100%', marginTop: 8 }}
                        onClick={() =>
                          run(async () => {
                            await removeStaff(member.id)
                            setToast(`${member.name} removed from the roster.`)
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.12em', margin: '0 0 12px' }}>
            SECTIONS — DROP A CARD HERE
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tables.map((t) => {
              const owner = staff.find((s) => tablesOf(s.id).includes(t.id))
              return (
                <div
                  key={t.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (!dragging) return
                    const member = staff.find((s) => s.id === dragging)
                    run(async () => {
                      await assignStaffToTable(dragging, t.id)
                      setToast(`T${t.id} assigned to ${member?.name ?? 'staff'}.`)
                    })
                    setDragging(null)
                  }}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: dragging ? 'rgba(123,153,86,0.08)' : 'rgba(20,19,10,0.5)',
                    border: `1px solid ${dragging ? 'rgba(123,153,86,0.3)' : C.hairline}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: C.cream }}>
                      T{t.id}{' '}
                      <span style={{ color: C.stone, fontSize: 10 }}>
                        · {t.seats} seats · {t.zone}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: owner ? C.accent : C.stone }}>
                      {owner ? owner.name : 'unassigned'}
                    </div>
                  </div>
                  {owner && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await unassignTable(t.id)
                          setToast(`T${t.id} unassigned.`)
                        })
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        color: C.stone,
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                      title="Unassign"
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
