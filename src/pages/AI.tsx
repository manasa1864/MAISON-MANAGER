import { useState } from 'react'
import {
  applyInsight, dismissInsight, fetchInsights, fetchStaff, fetchStaffAssignments,
  generateInsights, type AiInsight, type StaffMember,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, Empty, ErrorBanner, Loading, PageHeader, Panel, Toast, mono, serif, timeAgo,
} from '../components/ui'

const CAT_COLOR: Record<string, string> = {
  staffing: C.accent,
  inventory: C.warning,
  operations: C.brown,
  revenue: C.success,
}

const CAT_ICON: Record<string, string> = {
  staffing: '👥',
  inventory: '📦',
  operations: '⚙️',
  revenue: '📈',
}

export default function AIPage() {
  const { data, error, loading, reload } = useLive<{
    insights: AiInsight[]
    staff: StaffMember[]
    assignments: { staff_id: string; table_id: number }[]
  }>(
    async () => ({
      insights: await fetchInsights(),
      staff: await fetchStaff(),
      assignments: await fetchStaffAssignments(),
    }),
    ['ai_insights', 'staff_members'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)
  const [toast, setToast] = useState('')

  if (loading) return <Loading />

  const insights = data?.insights ?? []
  const staff = data?.staff ?? []
  const assignments = data?.assignments ?? []
  const open = insights.filter((i) => i.status === 'open')
  const handled = insights.filter((i) => i.status !== 'open').slice(0, 6)

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Restaurant Intelligence"
        subtitle={`${open.length} open recommendations · derived from live inventory, queue, floor and order data`}
        right={
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const n = await generateInsights()
                setToast(`${n} recommendation${n === 1 ? '' : 's'} generated from current data.`)
              })
            }
          >
            ⟳ Re-analyse now
          </Button>
        }
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      {open.length === 0 ? (
        <Panel style={{ marginBottom: 32 }}>
          <Empty>
            Nothing flagged. Press <strong style={{ color: C.accent }}>Re-analyse now</strong> to scan the
            current state of the restaurant.
          </Empty>
        </Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 36 }}>
          {open.map((insight) => (
            <Panel
              key={insight.id}
              className="float-card glass"
              style={{ border: `1px solid ${CAT_COLOR[insight.category]}22` }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) auto',
                  gap: 20,
                  alignItems: 'start',
                }}
              >
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span>{CAT_ICON[insight.category]}</span>
                    <span
                      style={{
                        fontSize: 10,
                        color: CAT_COLOR[insight.category],
                        fontFamily: mono,
                        textTransform: 'uppercase',
                      }}
                    >
                      {insight.category}
                    </span>
                    <span style={{ fontSize: 10, color: C.stone, fontFamily: mono }}>
                      · {timeAgo(insight.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontFamily: serif, color: C.cream, marginBottom: 6 }}>
                    {insight.problem}
                  </div>
                  <div style={{ fontSize: 12, color: C.stone, lineHeight: 1.6 }}>{insight.reason}</div>
                </div>

                <div>
                  <div style={{ fontSize: 10, color: C.stone, fontFamily: mono, marginBottom: 6 }}>
                    SUGGESTED ACTION
                  </div>
                  <div style={{ fontSize: 13, color: C.cream, lineHeight: 1.5 }}>{insight.action}</div>
                </div>

                <div>
                  <div style={{ fontSize: 10, color: C.stone, fontFamily: mono, marginBottom: 6 }}>
                    EXPECTED
                  </div>
                  <div style={{ fontSize: 13, color: C.success, fontWeight: 600 }}>{insight.improvement}</div>
                </div>

                <div style={{ textAlign: 'center', minWidth: 70 }}>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: '50%',
                      background: `conic-gradient(${CAT_COLOR[insight.category]} ${
                        insight.confidence * 3.6
                      }deg, rgba(142,107,87,0.15) 0deg)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 6px',
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: '#14130A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontFamily: mono,
                        color: CAT_COLOR[insight.category],
                        fontWeight: 700,
                      }}
                    >
                      {insight.confidence}%
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: C.stone, fontFamily: mono }}>CONFIDENCE</div>
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                {insight.action_type !== 'none' && (
                  <span style={{ fontSize: 10, color: C.stone, fontFamily: mono, marginRight: 'auto' }}>
                    Apply will actually run this: {insight.action_type.replace('_', ' ')}
                  </span>
                )}
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await applyInsight(insight.id)
                      setToast(result)
                    })
                  }
                >
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await dismissInsight(insight.id)
                      setToast('Dismissed.')
                    })
                  }
                >
                  Dismiss
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel>
        <h2 style={{ fontFamily: serif, fontSize: 20, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
          Staff Workload
        </h2>
        {staff.length === 0 ? (
          <Empty>No staff on the roster.</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {staff.map((s) => {
              // Load is driven by the section they actually hold, not a fixed
              // number per status — four tables is a heavy section anywhere.
              const tables = assignments.filter((a) => a.staff_id === s.id).length
              const base = s.status === 'busy' ? 0.5 : s.status === 'break' ? 0.3 : s.status === 'offline' ? 0 : 0.15
              const load = Math.min(1, base + tables * 0.15)
              const color = load > 0.75 ? C.error : load > 0.5 ? C.warning : C.success
              return (
                <div
                  key={s.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'rgba(20,19,10,0.5)',
                    border: `1px solid ${C.hairline}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
                    <span style={{ fontSize: 12, color: C.cream }}>{s.name.split(' ')[0]}</span>
                    <span style={{ fontSize: 10, color, fontFamily: mono }}>{Math.round(load * 100)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(142,107,87,0.15)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        width: `${load * 100}%`,
                        background: color,
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 9, color: C.stone, fontFamily: mono, marginTop: 6 }}>
                    {tables} table{tables === 1 ? '' : 's'} · {s.status}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {handled.length > 0 && (
        <>
          <p style={{ fontSize: 10, color: C.stone, fontFamily: mono, letterSpacing: '0.12em', margin: '28px 0 12px' }}>
            RECENTLY HANDLED
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {handled.map((i) => (
              <div
                key={i.id}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: 'rgba(20,19,10,0.4)',
                  border: `1px solid ${C.hairline}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 12, color: C.stone }}>{i.problem}</span>
                <Badge color={i.status === 'applied' ? C.success : C.stone}>{i.status}</Badge>
              </div>
            ))}
          </div>
        </>
      )}

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
