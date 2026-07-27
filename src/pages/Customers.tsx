import { useState } from 'react'
import { fetchCustomers, type CustomerRow } from '../lib/api'
import { useLive } from '../lib/useLive'
import {
  Badge, C, Empty, ErrorBanner, Field, Loading, PageHeader, Panel, StatCard, money, mono, serif,
  timeAgo,
} from '../components/ui'

/** Derived from the guest's own data rather than a canned string. */
function insight(c: CustomerRow): string {
  if (c.allergies !== 'None') {
    return `Flag ${c.allergies} to the kitchen on every order — this is on their guest profile.`
  }
  if (c.visits >= 10) {
    return `Regular: ${c.visits} paid visits at ${money(c.avg_spend)} average. Worth a VIP table.`
  }
  if (c.dietary !== 'None') {
    return `${c.dietary}. Highlight matching dishes when they next order.`
  }
  if (c.favourite_dish) {
    return `Orders ${c.favourite_dish} most. Suggest a pairing on their next visit.`
  }
  return 'No order history yet — a first visit is the chance to set the tone.'
}

export default function CustomersPage() {
  const { data, error, loading } = useLive<CustomerRow[]>(fetchCustomers, ['orders', 'profiles'])
  const [search, setSearch] = useState('')

  if (loading) return <Loading />

  const customers = data ?? []
  const q = search.trim().toLowerCase()
  const filtered = q
    ? customers.filter(
        (c) =>
          (c.name ?? '').toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
      )
    : customers

  const totalSpend = customers.reduce((a, c) => a + Number(c.total_spend), 0)
  const withAllergies = customers.filter((c) => c.allergies !== 'None').length

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} guest profiles · dietary notes come straight from the guest app`}
        right={
          <div style={{ width: 240 }}>
            <Field value={search} onChange={setSearch} placeholder="Search name or email…" />
          </div>
        }
      />

      <ErrorBanner message={error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 26 }}>
        <StatCard label="Profiles" value={customers.length} />
        <StatCard label="Lifetime Revenue" value={Math.round(totalSpend)} prefix="$" accent={C.accent} />
        <StatCard label="Regulars (5+)" value={customers.filter((c) => c.visits >= 5).length} />
        <StatCard label="With Allergies" value={withAllergies} accent={C.error} />
      </div>

      {filtered.length === 0 ? (
        <Empty>
          {customers.length === 0
            ? 'No guest profiles yet. Sign up in the Maison app and they appear here.'
            : 'No customers match that search.'}
        </Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
          {filtered.map((c) => (
            <Panel key={c.id} className="float-card glass" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontFamily: serif, color: C.cream, marginBottom: 2 }}>
                    {c.name || c.email?.split('@')[0] || 'Guest'}
                  </div>
                  <div style={{ fontSize: 11, color: C.stone, wordBreak: 'break-all' }}>{c.email}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontFamily: serif, color: C.accent }}>{money(c.avg_spend)}</div>
                  <div style={{ fontSize: 10, color: C.stone }}>avg spend</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div>
                  <span style={{ fontSize: 10, color: C.stone, display: 'block' }}>Visits</span>
                  <span style={{ fontSize: 13, color: C.cream }}>{c.visits}</span>
                </div>
                <div>
                  <span style={{ fontSize: 10, color: C.stone, display: 'block' }}>Lifetime</span>
                  <span style={{ fontSize: 13, color: C.cream }}>{money(c.total_spend)}</span>
                </div>
                <div>
                  <span style={{ fontSize: 10, color: C.stone, display: 'block' }}>Favourite</span>
                  <span style={{ fontSize: 12, color: C.cream }}>{c.favourite_dish || '—'}</span>
                </div>
                <div>
                  <span style={{ fontSize: 10, color: C.stone, display: 'block' }}>Last visit</span>
                  <span style={{ fontSize: 12, color: C.cream }}>
                    {c.last_visit ? timeAgo(c.last_visit) : '—'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {c.mood && c.mood !== 'default' && <Badge color={C.brown}>{c.mood}</Badge>}
                {c.dietary !== 'None' && <Badge color={C.accent}>{c.dietary}</Badge>}
                {c.allergies !== 'None' && <Badge color={C.error}>⚠ {c.allergies}</Badge>}
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(123,153,86,0.08)',
                  border: '1px solid rgba(123,153,86,0.15)',
                }}
              >
                <div style={{ fontSize: 9, color: C.accent, fontFamily: mono, marginBottom: 3 }}>
                  ◊ AI INSIGHT
                </div>
                <div style={{ fontSize: 11, color: C.stone, lineHeight: 1.5 }}>{insight(c)}</div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
