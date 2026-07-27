import { useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  fetchHourlyGuests, fetchPaymentMix, fetchPopularDishes, fetchRevenueSeries, fetchSalesSummary,
  type SalesSummary,
} from '../lib/api'
import { useLive } from '../lib/useLive'
import {
  Button, C, Empty, ErrorBanner, Loading, PageHeader, Panel, StatCard, Toast, money, mono, serif,
} from '../components/ui'

const PIE_COLORS = [C.accent, C.brown, '#3B2C20', C.warning]
const PERIODS = ['day', 'week', 'month', 'year'] as const
type Period = (typeof PERIODS)[number]

const tooltipStyle = {
  background: '#1c1710',
  border: '1px solid rgba(142,107,87,0.2)',
  borderRadius: 10,
  fontSize: 12,
}

interface SalesData {
  summary: SalesSummary
  revenue: { name: string; revenue: number; orders: number }[]
  dishes: { name: string; orders: number; revenue: number }[]
  payments: { name: string; value: number }[]
  hourly: { hour: string; guests: number }[]
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function SalesPage() {
  const [period, setPeriod] = useState<Period>('week')
  const [toast, setToast] = useState('')

  const { data, error, loading } = useLive<SalesData>(
    async () => ({
      summary: await fetchSalesSummary(),
      revenue: await fetchRevenueSeries(period),
      dishes: await fetchPopularDishes(6),
      payments: await fetchPaymentMix(),
      hourly: await fetchHourlyGuests(),
    }),
    ['orders', 'order_items'],
    [period],
  )

  if (loading) return <Loading />

  const summary = data?.summary
  const revenue = (data?.revenue ?? []).map((r) => ({ ...r, revenue: Number(r.revenue) }))
  const dishes = (data?.dishes ?? []).map((d) => ({ ...d, orders: Number(d.orders) }))
  const payments = data?.payments ?? []
  const hourly = (data?.hourly ?? []).map((h) => ({ ...h, guests: Number(h.guests) }))

  const paymentTotal = payments.reduce((a, p) => a + Number(p.value), 0) || 1
  const paymentPct = payments.map((p) => ({
    name: p.name,
    value: Math.round((Number(p.value) / paymentTotal) * 100),
  }))

  const hasRevenue = revenue.some((r) => r.revenue > 0)

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Sales"
        subtitle="Every figure computed from paid orders in the shared database"
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: mono,
                  fontSize: 11,
                  textTransform: 'capitalize',
                  background: period === p ? C.accentDeep : 'transparent',
                  color: period === p ? C.accent : C.stone,
                  border: period === p ? 'none' : `1px solid ${C.hairline}`,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />

      <ErrorBanner message={error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Revenue This Month" value={Math.round(Number(summary?.total_revenue ?? 0))} prefix="$" accent={C.accent} />
        <StatCard label="Avg Order Value" value={Math.round(Number(summary?.avg_order_value ?? 0))} prefix="$" />
        <StatCard label="Paid Orders" value={Number(summary?.orders_paid ?? 0)} />
        <StatCard label="Cancellation Rate" value={Math.round(Number(summary?.cancellation_rate ?? 0))} suffix="%" accent={C.warning} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
            Revenue Trend
          </h2>
          {hasRevenue ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenue}>
                <defs>
                  <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
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
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: C.cream }}
                  formatter={(v: unknown) => [money(Number(v)), 'Revenue'] as [string, string]}
                />
                <Area type="monotone" dataKey="revenue" stroke={C.accent} strokeWidth={2.5} fill="url(#revG)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No paid orders in this period yet. Complete a checkout in the guest app.</Empty>
          )}
        </Panel>

        <Panel>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
            Payment Methods
          </h2>
          {paymentPct.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={paymentPct} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={4}>
                    {paymentPct.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => `${Number(v)}%`} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                {paymentPct.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: PIE_COLORS[i % PIE_COLORS.length],
                        display: 'inline-block',
                      }}
                    />
                    <span style={{ fontSize: 11, color: C.stone }}>
                      {d.name} {d.value}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty>No payments recorded yet.</Empty>
          )}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Panel>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
            Most Ordered Dishes
          </h2>
          {dishes.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dishes} layout="vertical">
                <XAxis type="number" tick={{ fill: C.stone, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: C.stone, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.cream }} />
                <Bar dataKey="orders" fill={C.accent} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No dishes ordered yet.</Empty>
          )}
        </Panel>

        <Panel>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
            Orders by Hour (today)
          </h2>
          {hourly.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,107,87,0.08)" />
                <XAxis dataKey="hour" tick={{ fill: C.stone, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.stone, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.cream }} />
                <Bar dataKey="guests" fill={C.brown} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No orders today yet.</Empty>
          )}
        </Panel>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button
          variant="outline"
          onClick={() => {
            downloadCsv(`maison-revenue-${period}.csv`, revenue)
            setToast('Revenue CSV downloaded.')
          }}
        >
          ↓ Revenue CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            downloadCsv('maison-dishes.csv', dishes)
            setToast('Dish report downloaded.')
          }}
        >
          ↓ Dishes CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            downloadCsv('maison-summary.csv', summary ? [summary as unknown as Record<string, unknown>] : [])
            setToast('Summary downloaded.')
          }}
        >
          ↓ Summary CSV
        </Button>
      </div>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
