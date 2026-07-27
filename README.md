# Maison ⇄ Manager — one shared Supabase database

Two front ends, one database. The guest app (Maison) and the manager app now
read and write the same tables, and actions on one side land on the other.

---

## Setup — three steps

### 1. Run the SQL

Supabase Dashboard → **SQL Editor** → New query → paste **all** of
`manager_schema.sql` → Run.

It expects your four existing Maison scripts to have been run already, in this
order: `schema.sql` → `schema_extras.sql` → `schema_wiring.sql` →
`schema_availability.sql`.

The file is purely additive — it never drops a guest table or removes a guest
policy — and it is safe to run more than once.

### 2. Create your manager account

```bash
cd Manager
npm install
npm run dev
```

On the login screen choose **Sign up** and create an account.

### 3. Grant it manager access

Back in the Supabase SQL Editor, run once with the email you just used:

```sql
select public.grant_manager('you@example.com');
```

Reload the Manager app. That's it.

> Both `.env` files already point at the same project:
> `https://rkydhdmpbotudzeawdvp.supabase.co`

Run the guest app the same way (`cd Maison && npm install && npm run dev`).

### Optional: real AI Insights

**AI Insights** works out of the box with a built-in rule-based generator —
no setup needed. To have it actually reason over live data with Groq instead:

1. Get a free key at [console.groq.com/keys](https://console.groq.com/keys).
2. Paste it into `Manager/.env` as `GROQ_API_KEY=...` (no `VITE_` prefix —
   this one stays server-side, see `api/_groqProxy.ts`).
3. Restart `npm run dev`.

That's the whole setup — **Re-analyse now** on the AI Insights page calls
`/api/groq-insights` (a serverless function in production, a dev-server
middleware locally), which calls Groq with the key kept server-side, and
silently falls back to the rule-based generator whenever the key is blank.

---

## What connects to what

Every row below was verified with an end-to-end test against a real Postgres
instance.

### Manager → Guest

| You do this in Manager | The guest sees |
|---|---|
| Drag an order across the kitchen board | Their live tracking timeline ticks to the matching stage |
| Move an order to **Accepted** | "Your order has been accepted" notification |
| Move an order to **Ready** | "Your order is ready" notification |
| Move an order to **Served** | Order becomes *received*; the "arrived at your table" banner and the **Ready for the bill** button appear |
| Approve a pending booking | Reservation-confirmed notification |
| Move a booking to another table or time | Reservation-updated notification |
| Cancel a booking | Reservation-cancelled notification |
| Mark a booking **Seated** | "Your table is ready" notification; the table flips to occupied |
| Seat or remove someone in the queue | Everyone behind renumbers and each person who moved is notified |
| Set a table **out of service** | It disappears from the guest's booking floor plan |
| Take a dish off the menu | It vanishes from the guest menu, recommendations and dashboard |
| Empty an ingredient | Its dish shows as **sold out** on the guest menu |
| Restock it | The dish becomes orderable again |
| Apply an AI insight | Actually performs the action — restocks, seats the queue, releases cleaned tables, reassigns a server |

### Guest → Manager

| The guest does this | You see |
|---|---|
| Places an order | A new card in the **New** column, with their table, items and total |
| Orders a dish | That dish's ingredient is drawn down in **Inventory**, `usage_today` rises |
| Books a table | A new row in **Reservations** |
| Joins the queue | A new party in **Queue**, tagged `APP` |
| Pays a bill | Revenue, sales, analytics and the customer's visit history update |
| Sets allergies or dietary notes on their profile | Shown on their card in **Customers** |

Both apps subscribe over Supabase Realtime, so neither needs refreshing. A slow
poll sits behind it in case a socket drops.

---

## The two apps stay independent

They share a database, not a codebase, and neither one is required for the
other to work.

**Maison runs perfectly well on its own.** On a database with only the four
Maison scripts and no manager schema at all, the menu loads all twelve dishes,
the queue accepts joins, orders seed their tracking timeline, and notifications
fire — verified. That is why the menu filters `available` in JavaScript rather
than with `.eq('available', true)`: a server-side filter on a column that
doesn't exist yet errors out and empties the whole menu. Undefined is read as
"no manager schema installed, show the dish".

**The manager schema never changes a function Maison owns.** It only ever
improves the *body* of `join_queue()`, `cancel_queue_position()` and
`get_table_availability()` — the signatures stay byte-for-byte identical to the
Maison scripts. An earlier draft added a `p_party_size` argument to
`join_queue()`; that meant re-running `schema_wiring.sql` left two versions in
the database and the guest app's `rpc('join_queue')` became ambiguous, so
**guests could not join the queue at all.** Fixed — walk-in party sizes come
from `manager_add_walkin()` instead, which is a manager-only function.

**A guest is never treated as a manager.** The manager policies are additional
permissive policies gated on `is_manager()`; the original guest policies are
untouched. A guest still sees only their own rows, and calling a manager RPC as
a guest is refused with "Manager access required."

---

## If you re-run a Maison script

Re-run `manager_schema.sql` afterwards. It's always safe to run again.

This matters because the Maison scripts are the guest app's own migrations and
they legitimately reset things the manager builds on. `schema.sql` opens with
`truncate table public.notification_copy`, which removes the mood-toned copy
for the six manager events, and it also replaces `emit_notification()`. In that
state, accepting an order fails with *"null value in column title violates
not-null constraint"* — the kitchen board refuses to move, because a missing
message template aborts the whole operation.

Two things guard against this:

- `emit_notification()` is hardened here to fall back to readable text derived
  from the event name, so a missing template costs you a nicely-worded
  notification rather than the operation that triggered it.
- The **self-check at the end of the file** reports the state of everything it
  depends on. Read its output after running. On a database broken this way it
  prints, precisely: *"manager notification copy | PROBLEM — copy missing (did
  you re-run schema.sql?); re-run this file"*.

---

## Notes on a few decisions

**One anon key, two apps.** What separates them is identity, not credentials.
A guest sees only their own rows, via the policies your original schema already
had. A manager sees the restaurant, via new policies gated on `is_manager()` —
which checks for a `staff_members` row flagged as manager. Nothing was loosened
on the guest side.

**`hidden` was left alone.** In the guest app `dishes.hidden` drives the
"Lesser known" badge and the hidden-gems tab on the recommendations page — it's
a curation flag, not a visibility switch. Using it to pull a dish off the menu
would have relabelled and promoted the dish instead of removing it. Menu
visibility is a separate column, `dishes.available`. The Manager's Menu page
exposes both, clearly distinguished.

**Out of stock ≠ off menu.** A dish at zero stock stays on the guest menu,
greyed out and tagged sold-out, because that's what the guest app already did
well. `available` is the deliberate "take it off" switch.

**The guest app no longer advances its own kitchen timeline.** `Tracking.tsx`
used to tick through the stages on a client-side timer. With the manager now
driving the same rows, the two fought each other — last write won, and guests
could watch stages complete that the kitchen hadn't started. It now subscribes
and listens.

**Queue positions stay contiguous.** The guest page derives "parties ahead of
you" from `position - 1`, so a gap in the numbering made it misreport the wait.
Every queue mutation ends in a full renumber that notifies exactly the people
whose number changed.

**Notifications were removed from the Manager UI** as requested — the sidebar
button and the dashboard toasts are gone. The guest-facing notification system
is untouched and is now driven by manager actions.

---

## Files changed in Maison

Only three, all additive:

- `src/lib/useDishes.ts` — filters on `available`, subscribes to menu changes
- `src/components/Tracking.tsx` — auto-advance timer replaced with a realtime subscription
- `src/components/Queue.tsx` — subscribes so positions update when you seat someone

---

## Troubleshooting

**"This account isn't a manager yet"** — you skipped step 3. The screen shows
the exact SQL to run, with your email already filled in.

**Manager pages show "Manager access required."** — same cause.

**The guest menu looks empty** — every dish has `available = false`. Turn some
back on from the Manager's Menu page.

**Something stopped working after you re-ran a Maison script** — re-run
`manager_schema.sql`. The self-check at the bottom of it will tell you exactly
what was missing.

**Realtime seems slow** — check that Realtime is enabled for your project. Both
apps poll as a fallback, so worst case data is ~20–30 seconds stale.
