import { useState } from 'react'
import { fetchDishes, setDishFlags, setDishVisibility, type Dish } from '../lib/api'
import { useAction, useLive } from '../lib/useLive'
import {
  Badge, Button, C, Empty, ErrorBanner, Loading, PageHeader, Panel, StatCard, Toast, money, mono, serif,
} from '../components/ui'

const COURSES = ['Antipasti', 'Primi', 'Secondi', 'Dolci']

export default function MenuPage() {
  const { data, error, loading, reload } = useLive<Dish[]>(fetchDishes, ['dishes', 'inventory_items'])
  const { run, busy, error: actionError, clearError } = useAction(reload)
  const [toast, setToast] = useState('')

  if (loading) return <Loading />

  const dishes = data ?? []
  const live = dishes.filter((d) => d.available)

  return (
    <div style={{ padding: '32px 36px' }}>
      <PageHeader
        title="Menu Visibility"
        subtitle={`${live.length} of ${dishes.length} dishes on the guest menu · changes apply immediately`}
        right={<Button variant="ghost" onClick={reload}>↻ Refresh</Button>}
      />

      <ErrorBanner message={error || actionError} onDismiss={clearError} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard label="Live on Menu" value={live.length} accent={C.success} />
        <StatCard label="Off Menu" value={dishes.length - live.length} accent={C.stone} />
        <StatCard label="Out of Stock" value={dishes.filter((d) => d.stock <= 0).length} accent={C.error} />
        <StatCard label="Lesser Known" value={dishes.filter((d) => d.hidden).length} accent={C.brown} />
      </div>

      {dishes.length === 0 && <Empty>No dishes found. Run the Maison schema scripts first.</Empty>}

      {COURSES.map((course) => {
        const inCourse = dishes.filter((d) => d.course === course)
        if (inCourse.length === 0) return null
        return (
          <div key={course} style={{ marginBottom: 28 }}>
            <p
              style={{
                fontSize: 10,
                color: C.stone,
                fontFamily: mono,
                letterSpacing: '0.15em',
                margin: '0 0 12px',
              }}
            >
              {course.toUpperCase()}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {inCourse.map((dish) => (
                <Panel
                  key={dish.id}
                  className="float-card glass"
                  style={{
                    padding: 18,
                    opacity: dish.available ? 1 : 0.55,
                    border: dish.available ? '1px solid rgba(123,153,86,0.18)' : `1px solid ${C.hairline}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 15, fontFamily: serif, color: C.cream }}>{dish.name}</div>
                      <div style={{ fontSize: 11, color: C.stone }}>{dish.subtitle || '—'}</div>
                    </div>
                    <div style={{ fontSize: 16, fontFamily: serif, color: C.accent, whiteSpace: 'nowrap' }}>
                      {money(dish.price)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                    <Badge color={dish.available ? C.success : C.stone}>
                      {dish.available ? 'ON MENU' : 'OFF MENU'}
                    </Badge>
                    <Badge color={dish.stock <= 0 ? C.error : dish.stock < 5 ? C.warning : C.stone}>
                      {dish.stock} in stock
                    </Badge>
                    {dish.chef && <Badge color={C.brown}>CHEF</Badge>}
                    {dish.trending && <Badge color={C.accent}>TRENDING</Badge>}
                    {dish.hidden && <Badge color={C.stone}>LESSER KNOWN</Badge>}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button
                      small
                      variant={dish.available ? 'danger' : 'primary'}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await setDishVisibility(dish.id, dish.available)
                          setToast(
                            dish.available
                              ? `${dish.name} removed from the guest menu.`
                              : `${dish.name} is back on the guest menu.`,
                          )
                        })
                      }
                    >
                      {dish.available ? 'Take off menu' : 'Put back on menu'}
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await setDishFlags(dish.id, { chef: !dish.chef })
                          setToast(`${dish.name} ${dish.chef ? 'removed from' : 'added to'} Chef's Selection.`)
                        })
                      }
                    >
                      {dish.chef ? '− Chef' : '+ Chef'}
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await setDishFlags(dish.id, { trending: !dish.trending })
                          setToast(`${dish.name} ${dish.trending ? 'no longer' : 'now'} trending.`)
                        })
                      }
                    >
                      {dish.trending ? '− Trending' : '+ Trending'}
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await setDishFlags(dish.id, { hidden: !dish.hidden })
                          setToast(
                            `${dish.name} ${dish.hidden ? 'removed from' : 'added to'} the Lesser Known tab.`,
                          )
                        })
                      }
                      title="Controls the guest app's hidden-gems tab — not menu visibility"
                    >
                      {dish.hidden ? '− Lesser known' : '+ Lesser known'}
                    </Button>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        )
      })}

      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  )
}
