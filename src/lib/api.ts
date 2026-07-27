import { supabase } from './supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

export type KitchenStatus =
  | 'new' | 'accepted' | 'mise_en_place' | 'cooking' | 'quality_check' | 'ready' | 'served'

export type TableStatus =
  | 'available' | 'occupied' | 'reserved' | 'cleaning' | 'vip' | 'out-of-service'

export type StaffStatus = 'available' | 'busy' | 'break' | 'offline'

export type ReservationStatus =
  | 'pending' | 'confirmed' | 'seated' | 'cancelled' | 'completed'

export interface OrderItem {
  id: string
  dish_name: string
  price: number
  qty: number
}

export interface Order {
  id: string
  user_id: string
  status: string
  kitchen_status: KitchenStatus
  total: number | null
  table_id: number | null
  priority: 'high' | 'normal' | 'low'
  instructions: string | null
  assigned_staff_id: string | null
  payment_method: string | null
  created_at: string
  updated_at: string
  order_items: OrderItem[]
  profiles: { name: string | null; email: string | null } | null
}

export interface Reservation {
  id: string
  user_id: string
  table_id: number | null
  guests: number
  reservation_date: string
  reservation_time: string
  occasion: string | null
  status: ReservationStatus
  guest_name: string | null
  guest_phone: string | null
  notes: string | null
  bill_status: string
  created_at: string
  profiles: { name: string | null; email: string | null } | null
}

export interface QueueEntry {
  id: string
  user_id: string | null
  position: number
  status: 'waiting' | 'served' | 'cancelled'
  display_name: string | null
  party_size: number
  phone: string | null
  priority: boolean
  table_id: number | null
  created_at: string
  profiles: { name: string | null } | null
}

export interface RestaurantTable {
  id: number
  seats: number
  pos_x: number
  pos_y: number
  available: boolean
  status: TableStatus
  zone: string
  assigned_staff_id: string | null
}

export interface InventoryItem {
  id: string
  name: string
  unit: string
  stock: number
  min_stock: number
  usage_today: number
  supplier: string
  dish_id: number | null
  status: 'ok' | 'low' | 'critical'
  updated_at: string
}

export interface StaffMember {
  id: string
  user_id: string | null
  name: string
  role: string
  shift: string
  status: StaffStatus
  score: number
  photo: string | null
  is_manager: boolean
}

export interface Dish {
  id: number
  name: string
  subtitle: string | null
  price: number
  course: string
  stock: number
  /** Manager's on/off switch for the guest menu. */
  available: boolean
  /** Guest-app "Lesser known" curation badge — NOT a visibility flag. */
  hidden: boolean
  chef: boolean
  trending: boolean
  image: string | null
}

export interface AiInsight {
  id: string
  category: 'staffing' | 'inventory' | 'operations' | 'revenue'
  problem: string
  reason: string
  action: string
  improvement: string
  confidence: number
  status: 'open' | 'applied' | 'dismissed'
  action_type: string
  created_at: string
}

export interface DashboardStats {
  revenue_today: number
  revenue_yesterday: number
  orders_today: number
  orders_active: number
  customers_served: number
  tables_total: number
  tables_occupied: number
  tables_available: number
  tables_reserved: number
  queue_waiting: number
  queue_people: number
  inventory_low: number
  inventory_critical: number
  reservations_today: number
  reservations_pending: number
  staff_available: number
  staff_busy: number
}

export interface SalesSummary {
  total_revenue: number
  avg_order_value: number
  cancellation_rate: number
  orders_paid: number
  new_customers: number
  returning_customers: number
}

export interface CustomerRow {
  id: string
  name: string | null
  email: string | null
  visits: number
  total_spend: number
  avg_spend: number
  favourite_dish: string | null
  dietary: string
  allergies: string
  last_visit: string | null
  mood: string | null
}

// `throw`ing here rather than returning null keeps every caller honest: the
// pages all render through a shared error banner, so a failed policy or a
// missing migration surfaces on screen instead of silently showing "0".
function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function signUp(email: string, password: string, name: string): Promise<{ hasSession: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  })
  if (error) throw new Error(error.message)
  return { hasSession: !!data.session }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function isManager(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_manager')
  if (error) return false
  return data === true
}

export async function currentStaff(): Promise<StaffMember | null> {
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return null
  const { data } = await supabase
    .from('staff_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  return (data as StaffMember) ?? null
}

// ─── Orders ─────────────────────────────────────────────────────────────────

/**
 * Guest names are fetched and stitched on separately rather than embedded via
 * `profiles(...)`. The link from a row to its guest runs user_id -> auth.users,
 * and auth isn't part of the exposed schema, so PostgREST has no relationship
 * to follow even with the profile foreign keys in place. Two small queries are
 * cheaper than a join that might not resolve.
 */
async function attachProfiles<T extends { user_id: string | null }>(
  rows: T[],
): Promise<(T & { profiles: { name: string | null; email: string | null } | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))]
  if (ids.length === 0) return rows.map((r) => ({ ...r, profiles: null }))

  const { data } = await supabase.from('profiles').select('id, name, email').in('id', ids)
  const byId = new Map((data ?? []).map((p) => [p.id as string, p]))

  return rows.map((r) => {
    const p = r.user_id ? byId.get(r.user_id) : undefined
    return { ...r, profiles: p ? { name: p.name ?? null, email: p.email ?? null } : null }
  })
}

export async function fetchOrders(): Promise<Order[]> {
  const rows = unwrap<Omit<Order, 'profiles'>[]>(
    await supabase
      .from('orders')
      .select('*, order_items(id, dish_name, price, qty)')
      .order('created_at', { ascending: false })
      .limit(200),
  )
  return attachProfiles(rows)
}

/** Moving a card is what ticks the guest's live tracking timeline. */
export async function setKitchenStatus(orderId: string, status: KitchenStatus) {
  const { error } = await supabase
    .from('orders')
    .update({ kitchen_status: status })
    .eq('id', orderId)
  if (error) throw new Error(error.message)
}

export async function setOrderPriority(orderId: string, priority: 'high' | 'normal' | 'low') {
  const { error } = await supabase.from('orders').update({ priority }).eq('id', orderId)
  if (error) throw new Error(error.message)
}

export async function assignOrderStaff(orderId: string, staffId: string | null) {
  const { error } = await supabase
    .from('orders')
    .update({ assigned_staff_id: staffId })
    .eq('id', orderId)
  if (error) throw new Error(error.message)
}

// ─── Reservations ───────────────────────────────────────────────────────────

export async function fetchReservations(): Promise<Reservation[]> {
  const rows = unwrap<Omit<Reservation, 'profiles'>[]>(
    await supabase
      .from('reservations')
      .select('*')
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true })
      .limit(200),
  )
  return attachProfiles(rows)
}

export async function setReservationStatus(id: string, status: ReservationStatus) {
  const { error } = await supabase.from('reservations').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateReservation(
  id: string,
  patch: Partial<Pick<Reservation, 'table_id' | 'reservation_time' | 'reservation_date' | 'guests' | 'bill_status'>>,
) {
  const { error } = await supabase.from('reservations').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export async function fetchQueue(): Promise<QueueEntry[]> {
  const rows = unwrap<Omit<QueueEntry, 'profiles'>[]>(
    await supabase
      .from('queue_entries')
      .select('*')
      .neq('status', 'cancelled')
      .order('position'),
  )
  return attachProfiles(rows)
}

export async function seatNext(tableId: number | null) {
  const { error } = await supabase.rpc('manager_seat_next', { p_table_id: tableId })
  if (error) throw new Error(error.message)
}

export async function cancelQueueEntry(id: string) {
  const { error } = await supabase.rpc('manager_cancel_queue_entry', { p_entry_id: id })
  if (error) throw new Error(error.message)
}

export async function prioritiseQueueEntry(id: string) {
  const { error } = await supabase.rpc('manager_prioritise_queue_entry', { p_entry_id: id })
  if (error) throw new Error(error.message)
}

export async function addWalkin(name: string, partySize: number, phone: string, priority: boolean) {
  const { error } = await supabase.rpc('manager_add_walkin', {
    p_name: name,
    p_party_size: partySize,
    p_phone: phone || null,
    p_priority: priority,
  })
  if (error) throw new Error(error.message)
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function fetchTables(): Promise<RestaurantTable[]> {
  return unwrap(await supabase.from('restaurant_tables').select('*').order('id'))
}

export async function setTableStatus(id: number, status: TableStatus) {
  const { error } = await supabase.from('restaurant_tables').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function assignTableStaff(tableId: number, staffId: string | null) {
  const { error } = await supabase
    .from('restaurant_tables')
    .update({ assigned_staff_id: staffId })
    .eq('id', tableId)
  if (error) throw new Error(error.message)

  // Keep the join table in step so staff cards show their real section.
  await supabase.from('staff_table_assignments').delete().eq('table_id', tableId)
  if (staffId) {
    await supabase.from('staff_table_assignments').insert({ staff_id: staffId, table_id: tableId })
  }
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export async function fetchInventory(): Promise<InventoryItem[]> {
  return unwrap(await supabase.from('inventory_items').select('*').order('name'))
}

export async function restock(itemId: string, qty: number) {
  const { error } = await supabase.rpc('manager_restock', { p_item_id: itemId, p_qty: qty })
  if (error) throw new Error(error.message)
}

export async function addInventoryItem(item: {
  name: string
  unit: string
  stock: number
  min_stock: number
  supplier: string
  dish_id: number | null
}) {
  const { error } = await supabase.from('inventory_items').insert(item)
  if (error) throw new Error(error.message)
}

export async function deleteInventoryItem(id: string) {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Menu ───────────────────────────────────────────────────────────────────

export async function fetchDishes(): Promise<Dish[]> {
  return unwrap(
    await supabase
      .from('dishes')
      .select('id, name, subtitle, price, course, stock, available, hidden, chef, trending, image')
      .order('id'),
  )
}

export async function setDishVisibility(dishId: number, hidden: boolean) {
  const { error } = await supabase.rpc('manager_set_dish_visibility', {
    p_dish_id: dishId,
    p_hidden: hidden,
  })
  if (error) throw new Error(error.message)
}

export async function setDishFlags(
  dishId: number,
  patch: { chef?: boolean; trending?: boolean; hidden?: boolean },
) {
  const { error } = await supabase.from('dishes').update(patch).eq('id', dishId)
  if (error) throw new Error(error.message)
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function fetchStaff(): Promise<StaffMember[]> {
  return unwrap(await supabase.from('staff_members').select('*').order('name'))
}

export async function fetchStaffAssignments(): Promise<{ staff_id: string; table_id: number }[]> {
  return unwrap(await supabase.from('staff_table_assignments').select('staff_id, table_id'))
}

export async function setStaffStatus(id: string, status: StaffStatus) {
  const { error } = await supabase.from('staff_members').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function addStaff(member: {
  name: string
  role: string
  shift: string
  status: StaffStatus
}) {
  const { error } = await supabase.from('staff_members').insert(member)
  if (error) throw new Error(error.message)
}

export async function removeStaff(id: string) {
  const { error } = await supabase.from('staff_members').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Move one table from whoever holds it to `staffId`. */
export async function assignStaffToTable(staffId: string, tableId: number) {
  await supabase.from('staff_table_assignments').delete().eq('table_id', tableId)
  const { error } = await supabase
    .from('staff_table_assignments')
    .insert({ staff_id: staffId, table_id: tableId })
  if (error) throw new Error(error.message)
  await supabase.from('restaurant_tables').update({ assigned_staff_id: staffId }).eq('id', tableId)
}

export async function unassignTable(tableId: number) {
  await supabase.from('staff_table_assignments').delete().eq('table_id', tableId)
  await supabase.from('restaurant_tables').update({ assigned_staff_id: null }).eq('id', tableId)
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export async function fetchDashboardStats(): Promise<DashboardStats> {
  return unwrap(await supabase.rpc('manager_dashboard_stats'))
}

export async function fetchRevenueSeries(
  period: 'day' | 'week' | 'month' | 'year',
): Promise<{ name: string; revenue: number; orders: number }[]> {
  return unwrap(await supabase.rpc('manager_revenue_series', { p_period: period }))
}

export async function fetchHourlyGuests(): Promise<{ hour: string; guests: number }[]> {
  return unwrap(await supabase.rpc('manager_hourly_guests'))
}

export async function fetchPopularDishes(
  limit = 6,
): Promise<{ name: string; orders: number; revenue: number }[]> {
  return unwrap(await supabase.rpc('manager_popular_dishes', { p_limit: limit }))
}

export async function fetchPaymentMix(): Promise<{ name: string; value: number }[]> {
  return unwrap(await supabase.rpc('manager_payment_mix'))
}

export async function fetchSalesSummary(): Promise<SalesSummary> {
  return unwrap(await supabase.rpc('manager_sales_summary'))
}

export async function fetchForecast(): Promise<
  { hour: string; predicted: number; actual: number | null }[]
> {
  return unwrap(await supabase.rpc('manager_forecast'))
}

export async function fetchCustomers(): Promise<CustomerRow[]> {
  return unwrap(await supabase.rpc('manager_customers'))
}

// ─── AI insights ────────────────────────────────────────────────────────────

export async function fetchInsights(): Promise<AiInsight[]> {
  return unwrap(
    await supabase
      .from('ai_insights')
      .select('*')
      .order('status')
      .order('confidence', { ascending: false }),
  )
}

/** Thrown by draftInsightsFromGroq() when the server has no GROQ_API_KEY set. */
class GroqNotConfigured extends Error {}

type Draft = Pick<
  AiInsight,
  'category' | 'problem' | 'reason' | 'action' | 'improvement' | 'confidence' | 'action_type'
> & { action_payload: Record<string, unknown> }

const CATEGORIES: AiInsight['category'][] = ['staffing', 'inventory', 'operations', 'revenue']
const ACTION_TYPES: AiInsight['action_type'][] = [
  'none', 'restock', 'hide_dish', 'seat_queue', 'assign_staff', 'free_table',
]

const INSIGHT_SYSTEM_PROMPT = `You are the general manager's analyst for Maison, a fine-dining restaurant. \
You are given a live JSON snapshot of the floor, kitchen, queue, staff and inventory. Read it like a GM \
would and flag real, currently-visible problems only — never invent numbers that aren't in the data, and \
return fewer well-reasoned insights rather than padding to a count. 0 insights is a valid answer if nothing \
needs attention.

Respond with ONLY a JSON object of the shape {"insights": [...]}, each item shaped exactly as:
{
  "category": "staffing" | "inventory" | "operations" | "revenue",
  "problem": short headline, under 60 characters,
  "reason": one sentence citing the actual numbers behind it,
  "action": one sentence recommending what to do,
  "improvement": short expected outcome, e.g. "-8 min average wait",
  "confidence": integer 0-100,
  "action_type": "none" | "restock" | "hide_dish" | "seat_queue" | "assign_staff" | "free_table",
  "action_payload": {}
}

"action_type" controls what pressing Apply actually does, so only choose one of the non-"none" values when \
its payload can be filled from real data in the snapshot:
- "restock": action_payload must be {"item_id": <inventory item's id, copied exactly from the snapshot>, "qty": <number>}
- "hide_dish": action_payload must be {"dish_id": <dish's id, copied exactly from the snapshot>}
- "seat_queue", "assign_staff", "free_table": action_payload must be {}
- "none": action_payload must be {}
Never invent an item_id or dish_id that isn't present in the snapshot you were given.`

/**
 * Reads the live floor the same way generate_ai_insights() (manager_schema.sql)
 * does, but hands it to Groq instead of fixed SQL thresholds — actual reasoning
 * over the numbers rather than a handful of hardcoded rules. That SQL function
 * stays in place as the fallback below when no key is configured.
 */
async function draftInsightsFromGroq(): Promise<Draft[]> {
  const [inventory, queue, tables, staff, dishes, stats] = await Promise.all([
    fetchInventory(),
    fetchQueue(),
    fetchTables(),
    fetchStaff(),
    fetchDishes(),
    fetchDashboardStats(),
  ])

  const snapshot = {
    inventory: inventory.map((i) => ({
      id: i.id, name: i.name, stock: i.stock, min_stock: i.min_stock,
      unit: i.unit, status: i.status, supplier: i.supplier, dish_id: i.dish_id,
    })),
    dishes: dishes.map((d) => ({ id: d.id, name: d.name, available: d.available, stock: d.stock })),
    queue_waiting: queue.filter((q) => q.status === 'waiting').length,
    tables: tables.map((t) => ({ id: t.id, status: t.status })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    stats,
  }

  // Routed through our own /api/groq-insights rather than calling Groq
  // directly — that keeps the API key server-side (see api/_groqProxy.ts)
  // instead of shipping it in the client bundle.
  const res = await fetch('/api/groq-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: INSIGHT_SYSTEM_PROMPT, snapshot }),
  })

  if (res.status === 501) throw new GroqNotConfigured()
  if (!res.ok) {
    throw new Error(`Groq request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }

  const body = await res.json()
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('Groq returned no content.')

  const parsed = JSON.parse(content)
  const raw = Array.isArray(parsed.insights) ? parsed.insights : []

  const inventoryIds = new Set(inventory.map((i) => i.id))
  const dishIds = new Set(dishes.map((d) => d.id))

  return raw
    .filter((r: Record<string, unknown>) => r && typeof r.problem === 'string' && typeof r.action === 'string')
    .map((r: Record<string, unknown>): Draft => {
      let actionType = ACTION_TYPES.includes(r.action_type as AiInsight['action_type'])
        ? (r.action_type as AiInsight['action_type'])
        : 'none'
      let payload = (r.action_payload && typeof r.action_payload === 'object' ? r.action_payload : {}) as Record<
        string,
        unknown
      >

      if (actionType === 'restock' && !inventoryIds.has(payload.item_id as string)) {
        actionType = 'none'
        payload = {}
      }
      if (actionType === 'hide_dish' && !dishIds.has(Number(payload.dish_id))) {
        actionType = 'none'
        payload = {}
      }

      return {
        category: CATEGORIES.includes(r.category as AiInsight['category'])
          ? (r.category as AiInsight['category'])
          : 'operations',
        problem: String(r.problem).slice(0, 200),
        reason: String(r.reason ?? '').slice(0, 500),
        action: String(r.action ?? '').slice(0, 300),
        improvement: String(r.improvement ?? '').slice(0, 100),
        confidence: Math.max(0, Math.min(100, Math.round(Number(r.confidence)) || 70)),
        action_type: actionType,
        action_payload: payload,
      }
    })
    .slice(0, 6)
}

export async function generateInsights(): Promise<number> {
  let drafts: Draft[]
  try {
    drafts = await draftInsightsFromGroq()
  } catch (e) {
    if (!(e instanceof GroqNotConfigured)) throw e
    // No key configured — fall back to the built-in rule-based generator so
    // this still works with zero setup.
    const { data, error } = await supabase.rpc('generate_ai_insights')
    if (error) throw new Error(error.message)
    return (data as number) ?? 0
  }

  // Regenerate from scratch, same rule the SQL version follows: anything the
  // manager already applied or dismissed stays untouched.
  const { error: deleteError } = await supabase.from('ai_insights').delete().eq('status', 'open')
  if (deleteError) throw new Error(deleteError.message)

  if (drafts.length > 0) {
    const { error: insertError } = await supabase.from('ai_insights').insert(drafts)
    if (insertError) throw new Error(insertError.message)
  }

  return drafts.length
}

export async function applyInsight(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('apply_ai_insight', { p_id: id })
  if (error) throw new Error(error.message)
  return (data as string) ?? 'Applied.'
}

export async function dismissInsight(id: string) {
  const { error } = await supabase.rpc('dismiss_ai_insight', { p_id: id })
  if (error) throw new Error(error.message)
}
