import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  fetchDashboardStats, fetchForecast, fetchInventory, fetchPopularDishes,
  type DashboardStats, type InventoryItem,
} from '../lib/api'
import { useLive } from '../lib/useLive'
import {
  C, Empty, ErrorBanner, Loading, PageHeader, Panel, StatCard, INVENTORY_STATUS_COLOR, mono, money, serif,
} from '../components/ui'

interface AnalyticsData {
  forecast: { hour: string; predicted: number; actual: number | null }[]
  inventory: InventoryItem[]
  stats: DashboardStats
  dishes: { name: string; orders: number; revenue: number }[]
}

const tooltipStyle = {
  background: '#1c1710',
  border: '1px solid rgba(142,107,87,0.2)',
  borderRadius: 10,
  fontSize: 12,
}

export default function AnalyticsPage() {
  const { data, error, loading } = useLive<AnalyticsData>(
    async () => ({
      forecast: await fetchForecast(),
      inventory: await fetchInventory(),
      stats: await fetchDashboardStats(),
      dishes: await fetchPopularDishes(5),
    }),
    ['orders', 'inventory_items'],
  )

  if (loading) return <Loading />

  const forecast = (data?.forecast ?? []).map((f) => ({
    ...f,
    predicted: Number(f.predicted),
    actual: f.actual === null ? null : Number(f.actual),
  }))
  const inventory = data?.inventory ?? []
  const stats = data?.stats
  const dishes = data?.dishes ?? []

  const predictedTonight = forecast.reduce((a, f) => a + f.predicted, 0)
  const avgOrder = dishes.length > 0 ? dishes.reduce((a, d) => a + Number(d.revenue), 0) / dishes.reduce((a, d) => a + Number(d.orders), 0) : 0
  const expectedRevenue = Math.round(predictedTonight * (avgOrder || 0))

  // Staff needed scales with the tables we expect to turn over, floored at a
  // skeleton crew so an empty forecast doesn't suggest running with nobody.
  const requiredStaff = Math.max(4, Math.ceil(predictedTonight / 6))
  const scheduled = (stats?.staff_available ?? 0) + (stats?.staff_busy ?? 0)

  const atRisk = inventory
    .filter((i) => i.status !== 'ok')
    .sort((a, b) => Number(a.stock) / Number(a.min_stock || 1) - Number(b.stock) / Number(b.min_stock || 1))
    .slice(0, 6)

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Demand Forecasting"
        subtitle="Projected from the last four matching weekdays of real order history"
      />

      <ErrorBanner message={error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Predicted Orders Tonight" value={predictedTonight} sub="17:00 – 22:00 window" />
        <StatCard
          label="Required Staff"
          value={requiredStaff}
          sub={`${scheduled} currently on the roster`}
          accent={requiredStaff > scheduled ? C.warning : C.success}
        />
        <StatCard label="Expected Revenue" value={expectedRevenue} prefix="$" accent={C.accent} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
            Order Volume Forecast
          </h2>
          {forecast.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,107,87,0.1)" />
                <XAxis dataKey="hour" tick={{ fill: C.stone, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.stone, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.cream }} />
                <Legend wrapperStyle={{ color: C.stone, fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke={C.accent}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  name="Predicted"
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke={C.success}
                  strokeWidth={2.5}
                  dot={{ fill: C.success, r: 3 }}
                  name="Actual"
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty>Not enough order history to forecast yet.</Empty>
          )}
        </Panel>

        <Panel style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: 0, fontWeight: 400 }}>
            Stock at Risk
          </h2>
          {atRisk.length === 0 ? (
            <p style={{ fontSize: 12, color: C.stone, margin: 0 }}>
              Everything is above its minimum. Nothing to watch.
            </p>
          ) : (
            atRisk.map((item) => {
              const ratio = Math.min(100, (Number(item.stock) / (Number(item.min_stock) * 2 || 1)) * 100)
              return (
                <div key={item.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                    <span style={{ fontSize: 12, color: C.cream }}>{item.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: INVENTORY_STATUS_COLOR[item.status],
                        fontFamily: mono,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.stock} {item.unit}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(142,107,87,0.15)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        width: `${ratio}%`,
                        background: INVENTORY_STATUS_COLOR[item.status],
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </Panel>
      </div>

      <Panel>
        <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 20px', fontWeight: 400 }}>
          Restocking Recommendations
        </h2>
        {atRisk.length === 0 ? (
          <Empty>Nothing needs restocking right now.</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {atRisk.map((item) => {
              const suggested = Math.max(Number(item.min_stock) * 2 - Number(item.stock), 4)
              const critical = item.status === 'critical'
              return (
                <div
                  key={item.id}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: critical ? 'rgba(192,80,77,0.08)' : 'rgba(217,119,6,0.08)',
                    border: `1px solid ${critical ? 'rgba(192,80,77,0.2)' : 'rgba(217,119,6,0.2)'}`,
                  }}
                >
                  <div style={{ fontSize: 13, color: C.cream, fontWeight: 600, marginBottom: 4 }}>{item.name}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: critical ? C.error : C.warning,
                      marginBottom: 6,
                      fontWeight: 600,
                    }}
                  >
                    Order {suggested.toFixed(0)} {item.unit} from {item.supplier}
                  </div>
                  <div style={{ fontSize: 11, color: C.stone, lineHeight: 1.5 }}>
                    {item.stock} {item.unit} against a {item.min_stock} minimum
                    {item.dish_id ? ' — this one gates a live menu item.' : '.'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {dishes.length > 0 && (
        <Panel style={{ marginTop: 20 }}>
          <h2 style={{ fontFamily: serif, fontSize: 18, color: C.cream, margin: '0 0 16px', fontWeight: 400 }}>
            Revenue Contribution
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dishes.map((d) => {
              const max = Math.max(...dishes.map((x) => Number(x.revenue)))
              return (
                <div key={d.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.cream }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: C.accent, fontFamily: mono }}>
                      {money(d.revenue)} · {d.orders} sold
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'rgba(142,107,87,0.15)', borderRadius: 3 }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 3,
                        width: `${max > 0 ? (Number(d.revenue) / max) * 100 : 0}%`,
                        background: `linear-gradient(90deg, ${C.accent}, ${C.brown})`,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}
