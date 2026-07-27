import { useState } from 'react'
import {
  addInventoryItem,
  deleteInventoryItem,
  fetchDishes,
  fetchInventory,
  restock,
  type Dish,
  type InventoryItem,
} from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, Empty, ErrorBanner, Field, Loading, PageHeader, Panel, Select, StatCard, Toast,
  INVENTORY_STATUS_COLOR, mono,
} from '../components/ui'

const BLANK = { name: '', unit: 'kg', stock: '10', min_stock: '4', supplier: '', dish_id: '' }

export default function InventoryPage() {
  const { data, error, loading, reload } = useLive<{ items: InventoryItem[]; dishes: Dish[] }>(
    async () => ({ items: await fetchInventory(), dishes: await fetchDishes() }),
    ['inventory_items', 'dishes'],
  )
  const { run, busy, error: actionError, clearError } = useAction(reload)

  const [toast, setToast] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(BLANK)

  if (loading) return <Loading />

  const items = data?.items ?? []
  const dishes = data?.dishes ?? []
  const dishName = (id: number | null) => dishes.find((d) => d.id === id)?.name ?? null
  const attention = items.filter((i) => i.status !== 'ok')

  function adjust(item: InventoryItem, qty: number) {
    run(async () => {
      await restock(item.id, qty)
      const next = item.stock + qty
      if (item.dish_id) {
        setToast(
          next <= 0
            ? `${dishName(item.dish_id)} is now hidden from the guest menu.`
            : item.stock <= 0
              ? `${dishName(item.dish_id)} is back on the guest menu.`
              : `${item.name} → ${next} ${item.unit}. Guest menu stock updated.`,
        )
      } else {
        setToast(`${item.name} → ${next} ${item.unit}.`)
      }
    })
  }

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Inventory"
        subtitle={`${attention.length} need attention · items linked to a dish control that dish on the guest menu`}
        right={
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Close' : '+ Add item'}
          </Button>
        }
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      {showAdd && (
        <Panel style={{ marginBottom: 20 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr 2fr auto',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
            <Field label="Stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} type="number" />
            <Field label="Min" value={form.min_stock} onChange={(v) => setForm({ ...form, min_stock: v })} type="number" />
            <Field label="Supplier" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
            <Select
              label="Controls dish"
              value={form.dish_id}
              onChange={(v) => setForm({ ...form, dish_id: v })}
              options={[
                { value: '', label: 'Pantry staple (no dish)' },
                ...dishes.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
            />
            <Button
              disabled={busy || !form.name.trim()}
              onClick={() =>
                run(async () => {
                  await addInventoryItem({
                    name: form.name.trim(),
                    unit: form.unit.trim() || 'kg',
                    stock: Number(form.stock) || 0,
                    min_stock: Number(form.min_stock) || 1,
                    supplier: form.supplier.trim() || 'Unassigned',
                    dish_id: form.dish_id ? Number(form.dish_id) : null,
                  })
                  setToast(`${form.name.trim()} added.`)
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Items" value={items.length} />
        <StatCard label="Critical" value={items.filter((i) => i.status === 'critical').length} accent={C.error} />
        <StatCard label="Low" value={items.filter((i) => i.status === 'low').length} accent={C.warning} />
        <StatCard label="Dishes Hidden" value={dishes.filter((d) => d.hidden).length} accent={C.stone} />
      </div>

      <Panel style={{ padding: 0, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <Empty>No inventory items yet.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.hairline}` }}>
                  {['Item', 'Controls', 'Stock', 'Min', 'Used Today', 'Supplier', 'Status', 'Actions'].map((h) => (
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
                {items.map((item) => {
                  const linked = dishName(item.dish_id)
                  const dish = dishes.find((d) => d.id === item.dish_id)
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid rgba(142,107,87,0.08)',
                        background:
                          item.status === 'critical'
                            ? 'rgba(192,80,77,0.04)'
                            : item.status === 'low'
                              ? 'rgba(217,119,6,0.04)'
                              : 'transparent',
                      }}
                    >
                      <td style={{ padding: '13px 16px', fontSize: 13, color: C.cream, fontWeight: 500 }}>
                        {item.name}
                      </td>
                      <td style={{ padding: '13px 16px', fontSize: 11 }}>
                        {linked ? (
                          <span style={{ color: dish?.hidden ? C.error : C.accent }}>
                            {linked}
                            {dish?.hidden ? ' · hidden' : ''}
                          </span>
                        ) : (
                          <span style={{ color: C.stone }}>—</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: '13px 16px',
                          fontSize: 13,
                          fontFamily: mono,
                          color: INVENTORY_STATUS_COLOR[item.status],
                        }}
                      >
                        {item.stock} {item.unit}
                      </td>
                      <td style={{ padding: '13px 16px', fontSize: 12, color: C.stone, fontFamily: mono }}>
                        {item.min_stock}
                      </td>
                      <td style={{ padding: '13px 16px', fontSize: 12, color: C.stone }}>{item.usage_today}</td>
                      <td style={{ padding: '13px 16px', fontSize: 12, color: C.stone }}>{item.supplier}</td>
                      <td style={{ padding: '13px 16px' }}>
                        <Badge color={INVENTORY_STATUS_COLOR[item.status]}>{item.status.toUpperCase()}</Badge>
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button small variant="outline" disabled={busy} onClick={() => adjust(item, 1)}>
                            +
                          </Button>
                          <Button small variant="ghost" disabled={busy} onClick={() => adjust(item, -1)}>
                            −
                          </Button>
                          <Button small disabled={busy} onClick={() => adjust(item, 10)}>
                            Restock
                          </Button>
                          <Button
                            small
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await deleteInventoryItem(item.id)
                                setToast(`${item.name} deleted.`)
                              })
                            }
                          >
                            ×
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
