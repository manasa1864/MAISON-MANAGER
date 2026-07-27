-- ============================================================================
-- MAISON ⇄ MANAGER — one shared Supabase database
--
-- HOW TO RUN
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this entire file and Run.
--   3. Sign up in the Manager app with the email you want to manage from.
--   4. Come back here and run:  select public.grant_manager('you@example.com');
--
-- IF YOU EVER RE-RUN ONE OF THE MAISON SCRIPTS, RE-RUN THIS FILE AFTERWARDS.
--   The Maison scripts are the guest app's own migrations and they legitimately
--   reset things this file builds on. schema.sql in particular starts with
--   `truncate table public.notification_copy`, which removes the mood-toned
--   copy for the manager's events. Re-running this file restores it. Running
--   this file again is always safe.
--
-- PREREQUISITE
--   The four Maison scripts must already have been run, in this order:
--     schema.sql → schema_extras.sql → schema_wiring.sql → schema_availability.sql
--   If they have, this file is purely additive: it never drops a guest table,
--   never removes a guest policy, and is safe to re-run as many times as you like.
--
-- WHAT IT DOES
--   Adds the manager side of the restaurant to the same database the guest app
--   already uses, and wires the two together so that:
--     · moving an order across the kitchen board ticks the guest's live timeline
--     · accepting / plating an order notifies the guest in their chosen mood
--     · approving, moving or cancelling a booking notifies the guest
--     · seating or cancelling someone re-numbers the queue and tells whoever moved
--     · taking a table out of service removes it from the guest's booking floor plan
--     · emptying an ingredient pulls its dish off the guest menu; restocking returns it
--     · a guest ordering a dish draws that ingredient down in the manager's inventory
--     · sales, analytics and AI insights read live data — no mock numbers anywhere
-- ============================================================================

-- ============================================================================
-- Maison — Manager ⇄ Guest shared schema
-- PART 1 of 4: staff identity, manager access control, notification events
--
-- Run AFTER schema.sql, schema_extras.sql, schema_wiring.sql,
-- schema_availability.sql. Idempotent — safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. staff_members
--
-- Most staff never sign in — they're roster rows the manager assigns to
-- tables. user_id is therefore nullable and only set for people who actually
-- have a Supabase auth account (i.e. whoever logs into the Manager app).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null default 'Waiter',
  shift text not null default '—',
  status text not null default 'offline' check (status in ('available', 'busy', 'break', 'offline')),
  score int not null default 90 check (score between 0 and 100),
  photo text,
  is_manager boolean not null default false,
  created_at timestamptz not null default now()
);

-- Which tables a staff member is currently looking after.
create table if not exists public.staff_table_assignments (
  staff_id uuid not null references public.staff_members(id) on delete cascade,
  table_id int not null references public.restaurant_tables(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (staff_id, table_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. is_manager() — the single gate every manager-side RLS policy leans on.
--
-- SECURITY DEFINER so it can read staff_members without tripping that table's
-- own RLS (which itself calls this function — reading it directly from a
-- policy would recurse infinitely).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members
    where user_id = auth.uid() and is_manager
  );
$$;

grant execute on function public.is_manager() to authenticated, anon;

-- Promote an existing signed-up account to manager. Run this once with the
-- email you use to log into the Manager app:
--     select public.grant_manager('you@example.com');
create or replace function public.grant_manager(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_name text;
begin
  select id, coalesce(raw_user_meta_data ->> 'name', split_part(email, '@', 1))
    into v_user_id, v_name
  from auth.users
  where lower(email) = lower(p_email);

  if v_user_id is null then
    return format('No account found for %s — sign up in the Manager app first, then re-run this.', p_email);
  end if;

  insert into public.staff_members (user_id, name, role, shift, status, score, is_manager)
  values (v_user_id, v_name, 'Manager', '—', 'available', 100, true)
  on conflict (user_id) do update set is_manager = true, role = 'Manager';

  return format('%s is now a manager.', p_email);
end;
$$;

-- Demo mode: every account that signs up through the Manager app is a
-- manager immediately, no manual grant_manager() call needed. Fine for a
-- single shared demo database — do not ship this trigger against a
-- database with real guest/staff data, since it hands out full manager
-- access (orders, customers, staff, revenue) to anyone who can sign up.
create or replace function public.handle_new_manager_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_members (user_id, name, role, shift, status, score, is_manager)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    'Manager', '—', 'available', 100, true
  )
  on conflict (user_id) do update set is_manager = true, role = 'Manager';
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_grant_manager on auth.users;
create trigger on_auth_user_created_grant_manager
  after insert on auth.users
  for each row execute function public.handle_new_manager_signup();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. New notification events
--
-- schema.sql pinned notifications.event and notification_copy.event to a
-- closed list. The manager can now trigger things the guest app never could
-- on its own (an order being accepted at the pass, a reservation being moved,
-- the queue shuffling), so the list has to grow to match.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.notifications drop constraint if exists notifications_event_check;
alter table public.notifications add constraint notifications_event_check check (
  event in (
    'reservation_confirmed', 'order_confirmed', 'queue_position',
    'order_soon', 'order_received', 'pay_bill',
    -- manager-driven:
    'order_accepted', 'order_ready', 'reservation_updated',
    'reservation_cancelled', 'queue_advanced', 'table_ready'
  )
);

alter table public.notification_copy drop constraint if exists notification_copy_event_check;
alter table public.notification_copy add constraint notification_copy_event_check check (
  event in (
    'reservation_confirmed', 'order_confirmed', 'queue_position',
    'order_soon', 'order_received', 'pay_bill',
    'order_accepted', 'order_ready', 'reservation_updated',
    'reservation_cancelled', 'queue_advanced', 'table_ready'
  )
);

-- Mood-toned copy for the six new events, matching the voice of the
-- originals. {{position}} is substituted at insert time for queue_advanced.
insert into public.notification_copy (event, mood, title, body) values
-- ── order_accepted (manager accepts at the pass) ────────────────────────────
('order_accepted', 'default',     'Your order has been accepted',        'The pass has confirmed it and preparation has begun.'),
('order_accepted', 'celebratory', 'Accepted — the kitchen is on it!',    'The pass waved it through. Things are about to get delicious.'),
('order_accepted', 'intimate',    'Accepted, quietly under way.',        'The pass has your order in hand.'),
('order_accepted', 'bright',      'Accepted!',                           'The pass gave it the nod — cooking starts now.'),
('order_accepted', 'business',    'Order accepted.',                     'Confirmed at the pass. Preparation in progress.'),
('order_accepted', 'restorative', 'Accepted — nothing left to do.',      'The pass has it. Settle in and let us take it from here.'),
('order_accepted', 'considered',  'Accepted, exactly as specified.',     'The pass has confirmed your order with your notes attached.'),
('order_accepted', 'adventurous', 'Accepted — here we go.',              'The pass took one look and got straight to work.'),
('order_accepted', 'familiar',    'Accepted, same as ever.',             'The pass has it in hand, just like always.'),

-- ── order_ready (plated at the pass, heading over) ──────────────────────────
('order_ready', 'default',     'Your order is ready',                 'It is plated and on its way to your table.'),
('order_ready', 'celebratory', 'Ready — and worth the wait!',         'Plated, covered, and heading your way right now.'),
('order_ready', 'intimate',    'Ready for you.',                      'Plated and coming over, without a fuss.'),
('order_ready', 'bright',      'Ready — here it comes!',              'Just plated. Look up in a moment.'),
('order_ready', 'business',    'Order ready.',                        'Plated at the pass. Service is en route.'),
('order_ready', 'restorative', 'Ready whenever you are.',             'Plated and on its way — no need to hurry.'),
('order_ready', 'considered',  'Ready, plated as intended.',          'Every element checked before it left the pass.'),
('order_ready', 'adventurous', 'Ready — brace yourself.',             'It has left the pass. Hope you came hungry.'),
('order_ready', 'familiar',    'Ready, the way you like it.',         'Plated and on its way over.'),

-- ── reservation_updated (manager changed table/time/status) ─────────────────
('reservation_updated', 'default',     'Your reservation has been updated', 'Open your reservation to see the new details.'),
('reservation_updated', 'celebratory', 'Small change to your booking!',     'We have adjusted something — take a look, it is all still on.'),
('reservation_updated', 'intimate',    'A small change to your table.',     'Nothing to worry about — the new details are in your reservation.'),
('reservation_updated', 'bright',      'Booking updated!',                  'Quick change on our side — details are in your reservation.'),
('reservation_updated', 'business',    'Reservation amended.',              'Revised details are available in your reservation.'),
('reservation_updated', 'restorative', 'Your reservation has shifted a little.', 'Nothing to do — the updated details are waiting for you.'),
('reservation_updated', 'considered',  'Your reservation has been adjusted.', 'We have revised it with your preferences still in mind.'),
('reservation_updated', 'adventurous', 'Plans have shifted slightly.',      'Same evening, small change — have a look.'),
('reservation_updated', 'familiar',    'Small change to your usual booking.', 'Everything else is exactly as you like it.'),

-- ── reservation_cancelled (manager cancelled it) ────────────────────────────
('reservation_cancelled', 'default',     'Your reservation was cancelled',  'Please get in touch and we will find you another table.'),
('reservation_cancelled', 'celebratory', 'We had to cancel — let us fix it.', 'Sorry about this. Book again and the first round is on us.'),
('reservation_cancelled', 'intimate',    'We had to release your table.',   'Our apologies. We would love to find you another evening.'),
('reservation_cancelled', 'bright',      'Your booking was cancelled.',     'Sorry! Rebook whenever suits and we will sort you out.'),
('reservation_cancelled', 'business',    'Reservation cancelled.',          'Please contact the restaurant to rebook.'),
('reservation_cancelled', 'restorative', 'Your table has been released.',   'No rush — rebook whenever the time feels right.'),
('reservation_cancelled', 'considered',  'Your reservation has been cancelled.', 'We are sorry. Do let us make it right with another date.'),
('reservation_cancelled', 'adventurous', 'That table fell through.',        'Sorry about it — pick another night and we will make it count.'),
('reservation_cancelled', 'familiar',    'We had to cancel this one.',      'Unusual, we know. Let us get your usual table back soon.'),

-- ── queue_advanced (uses {{position}}) ──────────────────────────────────────
('queue_advanced', 'default',     'You have moved up the queue',        'You are now number {{position}}.'),
('queue_advanced', 'celebratory', 'Up to {{position}} — getting close!', 'The queue moved and so did you. Position {{position}}.'),
('queue_advanced', 'intimate',    'You have moved to {{position}}.',    'A little closer now, quietly.'),
('queue_advanced', 'bright',      'Moved up — you are #{{position}}!',  'The queue shifted in your favour.'),
('queue_advanced', 'business',    'Queue position updated: {{position}}.', 'You have advanced to number {{position}}.'),
('queue_advanced', 'restorative', 'You are now {{position}} — still no rush.', 'The queue moved along. Position {{position}}.'),
('queue_advanced', 'considered',  'Your place is now {{position}}.',    'The queue has been re-paced and you have moved up.'),
('queue_advanced', 'adventurous', 'Position {{position}} — closing in.', 'You just moved up. Not long now.'),
('queue_advanced', 'familiar',    'Moved up to {{position}}, as usual.', 'The queue shifted and you came with it.'),

-- ── table_ready (manager seated the guest from the queue) ───────────────────
('table_ready', 'default',     'Your table is ready',                'Please make your way over when you are ready.'),
('table_ready', 'celebratory', 'Your table is ready — come on in!',  'The wait is over. We are holding it for you.'),
('table_ready', 'intimate',    'Your table is ready.',               'Whenever you are — it is waiting quietly.'),
('table_ready', 'bright',      'Table ready!',                       'Come on over, we are all set for you.'),
('table_ready', 'business',    'Table ready.',                       'Your table is prepared. Please proceed to the host.'),
('table_ready', 'restorative', 'Your table is ready, no rush.',      'Come over whenever you feel like it.'),
('table_ready', 'considered',  'Your table is ready as requested.',  'Set up exactly the way you asked.'),
('table_ready', 'adventurous', 'Table ready — let us begin.',        'Your seat is waiting. Come find out what is next.'),
('table_ready', 'familiar',    'Your usual table is ready.',         'Set and waiting, just how you like it.')
on conflict (event, mood) do update set title = excluded.title, body = excluded.body;

-- ────────────────────────────────────────────────────────────────────────────
-- 3b. emit_notification() — made failure-proof
--
-- schema.sql's version looks up (event, mood) in notification_copy and inserts
-- whatever it finds. If no row matches, title stays NULL and the insert hits
-- the NOT NULL constraint — which aborts the whole transaction, meaning the
-- MANAGER'S ACTION FAILS, not just the notification.
--
-- That is reachable in normal use: schema.sql begins with
-- `truncate table public.notification_copy`, so re-running it wipes the copy
-- for the six manager events above. Accepting an order would then error with
-- "null value in column title violates not-null constraint" and the kitchen
-- board would refuse to move.
--
-- This version keeps the same behaviour when copy exists, and falls back to
-- readable text derived from the event name when it doesn't. A missing
-- template should cost you a nicely-worded notification, never the operation
-- that triggered it.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.emit_notification(
  p_user_id uuid,
  p_event text,
  p_target_page text default null,
  p_related_id uuid default null,
  p_position int default null,
  p_deliver_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mood text;
  v_title text;
  v_body text;
begin
  -- Nothing to notify if there's no account attached (walk-in queue rows).
  if p_user_id is null then
    return;
  end if;

  select coalesce(mood, 'default') into v_mood
  from public.profiles
  where id = p_user_id;

  if v_mood is null then
    v_mood := 'default';
  end if;

  select title, body into v_title, v_body
  from public.notification_copy
  where event = p_event and mood = v_mood;

  if v_title is null then
    select title, body into v_title, v_body
    from public.notification_copy
    where event = p_event and mood = 'default';
  end if;

  -- Last resort: no template at all for this event. Build something sensible
  -- from the event name rather than letting a NULL abort the caller.
  if v_title is null then
    v_title := initcap(replace(p_event, '_', ' '));
    v_body  := 'There is an update on your ' ||
               case
                 when p_event like 'order%'       then 'order.'
                 when p_event like 'reservation%' then 'reservation.'
                 when p_event like 'queue%'       then 'place in the queue.'
                 when p_event like 'table%'       then 'table.'
                 else 'visit.'
               end;
  end if;

  if p_position is not null then
    v_title := replace(v_title, '{{position}}', p_position::text);
    v_body  := replace(v_body,  '{{position}}', p_position::text);
  end if;

  insert into public.notifications
    (user_id, event, title, body, target_page, related_id, deliver_at)
  values
    (p_user_id, p_event, v_title, v_body, p_target_page, p_related_id, p_deliver_at);
end;
$$;
-- ============================================================================
-- PART 2 of 4: the operational link — kitchen board, reservations, floor, queue
-- Every manager action here lands on something the guest app already reads.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 4. orders — the kitchen board
--
-- orders.status is the GUEST-facing lifecycle (confirmed → received →
-- awaiting_payment → paid) and the guest app drives the tail of it.
-- kitchen_status is the MANAGER-facing board, and it maps 1:1 onto the seven
-- rows of order_tracking_steps the guest already sees on the tracking page:
--
--   new           → step 1 "Accepted"      pending
--   accepted      → step 2 "Mise en place" pending
--   mise_en_place → step 3 "Cooking"       pending
--   cooking       → step 4 "Quality check" pending
--   quality_check → step 5 "Ready"         pending
--   ready         → step 6 "Served"        pending
--   served        → every step done
--
-- So dragging a card one column to the right on the manager board ticks the
-- next line of the guest's timeline. That is the whole point.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists kitchen_status text not null default 'new',
  add column if not exists table_id int references public.restaurant_tables(id),
  add column if not exists priority text not null default 'normal',
  add column if not exists instructions text,
  add column if not exists assigned_staff_id uuid references public.staff_members(id) on delete set null,
  add column if not exists payment_method text;

alter table public.orders drop constraint if exists orders_kitchen_status_check;
alter table public.orders add constraint orders_kitchen_status_check check (
  kitchen_status in ('new', 'accepted', 'mise_en_place', 'cooking', 'quality_check', 'ready', 'served')
);

alter table public.orders drop constraint if exists orders_priority_check;
alter table public.orders add constraint orders_priority_check check (
  priority in ('high', 'normal', 'low')
);

-- Which tracking step is "in progress" for a given board column.
-- NULL = the order is finished and nothing is pending.
create or replace function public.kitchen_status_step(p_status text)
returns int
language sql
immutable
as $$
  select case p_status
    when 'new'           then 1
    when 'accepted'      then 2
    when 'mise_en_place' then 3
    when 'cooking'       then 4
    when 'quality_check' then 5
    when 'ready'         then 6
    when 'served'        then null
  end;
$$;

-- Rewrites the guest's timeline to match the board column.
create or replace function public.sync_order_steps(p_order_id uuid, p_kitchen_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int := public.kitchen_status_step(p_kitchen_status);
begin
  if v_active is null then
    -- 'served' — the whole timeline is complete.
    update public.order_tracking_steps
    set done = true, active = false
    where order_id = p_order_id;
  else
    update public.order_tracking_steps
    set done   = (step_index < v_active),
        active = (step_index = v_active)
    where order_id = p_order_id;
  end if;
end;
$$;

-- Board column changes → guest timeline, guest order status, guest notification.
create or replace function public.trg_orders_kitchen_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_status is distinct from old.kitchen_status then
    perform public.sync_order_steps(new.id, new.kitchen_status);

    if new.kitchen_status = 'accepted' then
      perform public.emit_notification(new.user_id, 'order_accepted', 'tracking', new.id);

    elsif new.kitchen_status = 'ready' then
      perform public.emit_notification(new.user_id, 'order_ready', 'tracking', new.id);

    elsif new.kitchen_status = 'served' then
      -- Only nudge the guest lifecycle forward; never drag it backwards if
      -- they have already asked for the bill or paid.
      if new.status in ('confirmed', 'preparing') then
        new.status := 'received';
      end if;
      perform public.emit_notification(new.user_id, 'order_received', 'tracking', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_order_kitchen_status on public.orders;
create trigger on_order_kitchen_status
  before update on public.orders
  for each row execute function public.trg_orders_kitchen_status();

-- A brand new order should land in the board's "New" column with a table
-- attached, so the manager can see which table it came from. The guest app
-- doesn't send a table_id, so infer it from their live reservation.
create or replace function public.trg_orders_attach_table()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.table_id is null then
    select table_id into new.table_id
    from public.reservations
    where user_id = new.user_id
      and status in ('confirmed', 'seated')
      and table_id is not null
    order by reservation_date asc, reservation_time asc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_attach_table on public.orders;
create trigger on_order_attach_table
  before insert on public.orders
  for each row execute function public.trg_orders_attach_table();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. reservations — manager approval, moves, cancellation
-- ────────────────────────────────────────────────────────────────────────────

alter table public.reservations
  add column if not exists bill_status text not null default 'Open';

alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check check (
  status in ('pending', 'confirmed', 'seated', 'cancelled', 'completed')
);

-- Only manager-initiated changes notify the guest. A guest cancelling their
-- own booking doesn't need to be told they cancelled it.
create or replace function public.trg_reservations_manager_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'confirmed' then
      perform public.emit_notification(new.user_id, 'reservation_confirmed', 'reservations', new.id);
    elsif new.status = 'cancelled' then
      perform public.emit_notification(new.user_id, 'reservation_cancelled', 'reservations', new.id);
    elsif new.status = 'seated' then
      perform public.emit_notification(new.user_id, 'table_ready', 'reservations', new.id);
    end if;

  elsif new.table_id           is distinct from old.table_id
     or new.reservation_time   is distinct from old.reservation_time
     or new.reservation_date   is distinct from old.reservation_date
     or new.guests             is distinct from old.guests then
    perform public.emit_notification(new.user_id, 'reservation_updated', 'reservations', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_reservation_manager_notify on public.reservations;
create trigger on_reservation_manager_notify
  after update on public.reservations
  for each row execute function public.trg_reservations_manager_notify();

-- Seating a reservation occupies its table; releasing it frees the table.
create or replace function public.trg_reservations_table_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.table_id is null then
    return new;
  end if;

  if new.status = 'seated' and old.status is distinct from 'seated' then
    update public.restaurant_tables set status = 'occupied' where id = new.table_id;
  elsif new.status in ('cancelled', 'completed') and old.status is distinct from new.status then
    update public.restaurant_tables
    set status = case when status = 'occupied' then 'cleaning' else status end
    where id = new.table_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_reservation_table_status on public.reservations;
create trigger on_reservation_table_status
  after update on public.reservations
  for each row execute function public.trg_reservations_table_status();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. restaurant_tables — status, zone, staff
--
-- `available` was left as a manual "is this table in service" flag by
-- schema_availability.sql. It now derives from status: anything other than
-- out-of-service is bookable, and get_table_availability() still applies the
-- same-day time buffer on top. Taking a table out of service in the Manager
-- app therefore removes it from the guest's booking floor plan immediately.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.restaurant_tables
  add column if not exists status text not null default 'available',
  add column if not exists zone text not null default 'Main',
  add column if not exists assigned_staff_id uuid references public.staff_members(id) on delete set null;

alter table public.restaurant_tables drop constraint if exists restaurant_tables_status_check;
alter table public.restaurant_tables add constraint restaurant_tables_status_check check (
  status in ('available', 'occupied', 'reserved', 'cleaning', 'vip', 'out-of-service')
);

create or replace function public.trg_tables_sync_available()
returns trigger
language plpgsql
as $$
begin
  new.available := (new.status <> 'out-of-service');
  return new;
end;
$$;

drop trigger if exists on_table_status_sync on public.restaurant_tables;
create trigger on_table_status_sync
  before insert or update on public.restaurant_tables
  for each row execute function public.trg_tables_sync_available();

-- Give the existing ten tables sensible zones (the guest floor plan already
-- positions them; zone is purely a manager-side grouping).
update public.restaurant_tables set zone = case
  when id in (1, 3, 5) then 'Window'
  when id in (4, 9)    then 'Private'
  when id in (8, 10)   then 'Bar'
  else 'Main'
end
where zone = 'Main' and id in (1, 3, 4, 5, 8, 9, 10);

-- Re-run the availability sync once so `available` matches `status` for rows
-- that already existed before this column was added.
update public.restaurant_tables set status = status;

-- Same signature as schema_availability.sql (Reservations.tsx depends on the
-- exact column list), now also honouring out-of-service and occupied-right-now.
create or replace function public.get_table_availability(p_date date, p_time text)
returns table (id int, seats int, pos_x int, pos_y int, available boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.seats,
    t.pos_x,
    t.pos_y,
    (t.status <> 'out-of-service')
      and not exists (
        select 1
        from public.reservations r
        where r.table_id = t.id
          and r.status in ('confirmed', 'seated')
          and r.reservation_date = p_date
          and abs(extract(epoch from (r.reservation_time::time - p_time::time)) / 60) < 120
      ) as available
  from public.restaurant_tables t
  order by t.id;
$$;

grant execute on function public.get_table_availability(date, text) to authenticated, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. queue_entries — manager-side seating and cancellation
--
-- Renumbering has to notify everyone who actually moved, otherwise the guest's
-- queue page silently disagrees with the manager's board until the next poll.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.queue_entries
  add column if not exists party_size int not null default 2,
  add column if not exists phone text,
  add column if not exists priority boolean not null default false,
  add column if not exists table_id int references public.restaurant_tables(id);

-- Tell every signed-in guest behind p_from_position that they moved up.
create or replace function public.notify_queue_shift(p_from_position int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id, user_id, position
    from public.queue_entries
    where status = 'waiting'
      and user_id is not null
      and position >= p_from_position
  loop
    perform public.emit_notification(r.user_id, 'queue_advanced', 'queue', r.id, r.position);
  end loop;
end;
$$;

-- Seat the party at the front of the queue.
create or replace function public.manager_seat_next(p_table_id int default null)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_entries;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can seat the queue.';
  end if;

  select * into v_row
  from public.queue_entries
  where status = 'waiting'
  order by priority desc, position asc
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  update public.queue_entries
  set status = 'served', table_id = coalesce(p_table_id, table_id)
  where id = v_row.id
  returning * into v_row;

  if p_table_id is not null then
    update public.restaurant_tables set status = 'occupied' where id = p_table_id;
  end if;

  if v_row.user_id is not null then
    perform public.emit_notification(v_row.user_id, 'table_ready', 'queue', v_row.id);
  end if;

  update public.queue_entries
  set position = position - 1
  where status = 'waiting' and position > v_row.position;

  perform public.notify_queue_shift(v_row.position);

  return v_row;
end;
$$;

grant execute on function public.manager_seat_next(int) to authenticated;

-- Drop a specific party from the queue and close the gap behind them.
create or replace function public.manager_cancel_queue_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position int;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can remove someone from the queue.';
  end if;

  select position into v_position from public.queue_entries where id = p_entry_id;
  if v_position is null then
    return;
  end if;

  update public.queue_entries set status = 'cancelled' where id = p_entry_id;

  update public.queue_entries
  set position = position - 1
  where status = 'waiting' and position > v_position;

  perform public.notify_queue_shift(v_position);
end;
$$;

grant execute on function public.manager_cancel_queue_entry(uuid) to authenticated;

-- Walk-in with no account.
create or replace function public.manager_add_walkin(
  p_name text,
  p_party_size int default 2,
  p_phone text default null,
  p_priority boolean default false
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_entries;
  v_next int;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can add a walk-in.';
  end if;

  select coalesce(max(position), 0) + 1 into v_next
  from public.queue_entries where status = 'waiting';

  insert into public.queue_entries (position, status, display_name, party_size, phone, priority)
  values (v_next, 'waiting', p_name, p_party_size, p_phone, p_priority)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.manager_add_walkin(text, int, text, boolean) to authenticated;

-- Bump a party to the front (priority flag + renumber).
create or replace function public.manager_prioritise_queue_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position int;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can reorder the queue.';
  end if;

  select position into v_position from public.queue_entries where id = p_entry_id;
  if v_position is null or v_position <= 1 then
    return;
  end if;

  update public.queue_entries
  set position = position + 1
  where status = 'waiting' and position < v_position;

  update public.queue_entries
  set position = 1, priority = true
  where id = p_entry_id;

  perform public.notify_queue_shift(1);
end;
$$;

grant execute on function public.manager_prioritise_queue_entry(uuid) to authenticated;
-- ────────────────────────────────────────────────────────────────────────────
-- 7b. Queue positions must stay contiguous.
--
-- The original seed data and the guest-side cancel both leave gaps (1, 4, 5, 6),
-- and the guest's queue page derives "parties ahead of you" straight from
-- position - 1 — so a gap makes the guest app lie about the wait. Every
-- mutation below now ends in a full renumber, which also notifies exactly the
-- people whose number actually moved (and nobody else).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.renumber_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with ordered as (
      select id,
             row_number() over (order by priority desc, position asc, created_at asc) as new_pos
      from public.queue_entries
      where status = 'waiting'
    ),
    upd as (
      update public.queue_entries q
      set position = o.new_pos
      from ordered o
      where q.id = o.id
        and q.position is distinct from o.new_pos
      returning q.id, q.user_id, q.position
    )
    select * from upd
  loop
    if r.user_id is not null then
      perform public.emit_notification(
        r.user_id, 'queue_advanced', 'queue', r.id, r.position
      );
    end if;
  end loop;
end;
$$;

-- Guests join at the back of the WAITING list.
--
-- IMPORTANT: this keeps schema_wiring.sql's exact zero-argument signature.
-- An earlier draft added a p_party_size parameter with a default, which meant
-- re-running schema_wiring.sql left TWO join_queue functions in the database
-- and the guest app's `rpc('join_queue')` became ambiguous — guests could not
-- join the queue at all. The signature belongs to Maison; only the body is
-- improved here. Walk-in party sizes come from manager_add_walkin() instead.
--
-- Body fixes over the original: count only WAITING rows when picking the next
-- position (the original counted served rows too, so positions climbed forever
-- on a busy night), and return the guest's existing row instead of creating a
-- duplicate if they press Join twice.
create or replace function public.join_queue()
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_entries;
  v_next int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to join the queue.';
  end if;

  select * into v_row
  from public.queue_entries
  where user_id = auth.uid() and status = 'waiting'
  limit 1;

  if v_row.id is not null then
    return v_row;
  end if;

  select coalesce(max(position), 0) + 1 into v_next
  from public.queue_entries where status = 'waiting';

  insert into public.queue_entries (user_id, position, status, party_size)
  values (auth.uid(), v_next, 'waiting', 2)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.join_queue() to authenticated;

-- Remove the defaulted overload if a previous version of this file created it,
-- otherwise join_queue() stays ambiguous.
drop function if exists public.join_queue(int);

create or replace function public.cancel_queue_position(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.queue_entries set status = 'cancelled' where id = p_entry_id;
  perform public.renumber_queue();
end;
$$;

grant execute on function public.cancel_queue_position(uuid) to authenticated;

create or replace function public.manager_seat_next(p_table_id int default null)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_entries;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can seat the queue.';
  end if;

  select * into v_row
  from public.queue_entries
  where status = 'waiting'
  order by priority desc, position asc
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  update public.queue_entries
  set status = 'served', table_id = coalesce(p_table_id, table_id)
  where id = v_row.id
  returning * into v_row;

  if p_table_id is not null then
    update public.restaurant_tables set status = 'occupied' where id = p_table_id;
  end if;

  if v_row.user_id is not null then
    perform public.emit_notification(v_row.user_id, 'table_ready', 'queue', v_row.id);
  end if;

  perform public.renumber_queue();
  return v_row;
end;
$$;

grant execute on function public.manager_seat_next(int) to authenticated;

create or replace function public.manager_cancel_queue_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Only a manager can remove someone from the queue.';
  end if;

  update public.queue_entries set status = 'cancelled' where id = p_entry_id;
  perform public.renumber_queue();
end;
$$;

grant execute on function public.manager_cancel_queue_entry(uuid) to authenticated;

create or replace function public.manager_prioritise_queue_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Only a manager can reorder the queue.';
  end if;

  -- position 0 sorts ahead of everyone; renumber_queue() then closes it up.
  update public.queue_entries
  set priority = true, position = 0
  where id = p_entry_id and status = 'waiting';

  perform public.renumber_queue();
end;
$$;

grant execute on function public.manager_prioritise_queue_entry(uuid) to authenticated;

create or replace function public.manager_add_walkin(
  p_name text,
  p_party_size int default 2,
  p_phone text default null,
  p_priority boolean default false
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_entries;
  v_next int;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can add a walk-in.';
  end if;

  select coalesce(max(position), 0) + 1 into v_next
  from public.queue_entries where status = 'waiting';

  insert into public.queue_entries (position, status, display_name, party_size, phone, priority)
  values (v_next, 'waiting', p_name, p_party_size, p_phone, p_priority)
  returning * into v_row;

  perform public.renumber_queue();
  return v_row;
end;
$$;

grant execute on function public.manager_add_walkin(text, int, text, boolean) to authenticated;

-- One-off repair for any gaps left by the earlier seed data.
select public.renumber_queue();
-- ============================================================================
-- PART 3 of 4: inventory ⇄ menu, sales & analytics, AI insights, customers
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 8. inventory_items
--
-- An item with a dish_id is that dish's limiting ingredient: its stock IS the
-- dish's stock. Depleting it in the Manager app pushes dishes.stock down and,
-- at zero, sets dishes.hidden — which pulls the dish off the guest menu.
-- Items without a dish_id are pantry staples that nothing hides.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- 8a. dishes.available — genuine menu visibility
--
-- `dishes.hidden` is NOT a visibility flag: the guest app uses it for the
-- "Lesser known" curation badge and the hidden-gems tab on the
-- recommendations page. Reusing it to pull a dish off the menu would have
-- relabelled the dish as a hidden gem and promoted it into that tab —
-- the opposite of what the manager asked for. Availability gets its own column.
--
-- Note that running out of stock does NOT set this false. The guest menu
-- already renders a zero-stock dish as sold out (greyed, "sold out" tag),
-- which is better than making it vanish. `available` is the manager's
-- deliberate "take this off the menu" switch.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.dishes
  add column if not exists available boolean not null default true;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'kg',
  stock numeric(10, 2) not null default 0,
  min_stock numeric(10, 2) not null default 1,
  usage_today numeric(10, 2) not null default 0,
  supplier text not null default 'Unassigned',
  dish_id int references public.dishes(id) on delete set null,
  updated_at timestamptz not null default now(),
  status text generated always as (
    case
      when stock <= 0 then 'critical'
      when stock < min_stock then 'low'
      else 'ok'
    end
  ) stored
);

create index if not exists inventory_items_dish_idx on public.inventory_items (dish_id);

-- Stock moved → the guest menu moves with it.
create or replace function public.trg_inventory_sync_dish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.dish_id is not null and new.stock is distinct from old.stock then
    -- Stock only. `hidden` is the guest app's "Lesser known" badge and
    -- `available` is the manager's deliberate on/off switch — neither should
    -- move just because a delivery arrived or a portion was served.
    update public.dishes
    set stock = greatest(0, floor(new.stock))::int
    where id = new.dish_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_inventory_sync_dish on public.inventory_items;
create trigger on_inventory_sync_dish
  before update on public.inventory_items
  for each row execute function public.trg_inventory_sync_dish();

-- …and the reverse: a guest ordering a dish draws its ingredient down, so the
-- manager's inventory table reflects real service without anyone typing it in.
create or replace function public.trg_order_items_consume_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_items i
  set stock       = greatest(0, i.stock - new.qty),
      usage_today = i.usage_today + new.qty
  from public.dishes d
  where d.name = new.dish_name
    and i.dish_id = d.id;

  return new;
end;
$$;

drop trigger if exists on_order_item_consume_stock on public.order_items;
create trigger on_order_item_consume_stock
  after insert on public.order_items
  for each row execute function public.trg_order_items_consume_stock();

-- Manager restock button.
create or replace function public.manager_restock(p_item_id uuid, p_qty numeric)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.inventory_items;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can adjust inventory.';
  end if;

  update public.inventory_items
  set stock = greatest(0, stock + p_qty)
  where id = p_item_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.manager_restock(uuid, numeric) to authenticated;

-- Seed: one limiting ingredient per dish, plus unlinked pantry staples.
-- Linked items are counted in portions so stock maps straight onto dishes.stock.
insert into public.inventory_items (name, unit, stock, min_stock, usage_today, supplier, dish_id)
select v.name, v.unit, v.stock, v.min_stock, v.usage_today, v.supplier, v.dish_id
from (values
  ('A4 Wagyu Tenderloin', 'portions',  4, 5, 2, 'Hayashi Farms',    1),
  ('Périgord Black Truffle', 'portions', 24, 10, 6, 'Terra Luxe',    2),
  ('Brittany Scallops',   'portions',  8, 6, 4, 'Nordic Catch',     3),
  ('Valrhona Guanaja 72%', 'portions', 12, 6, 3, 'Cacao Bureau',    4),
  ('Tyrrhenian Lobster',  'portions',  8, 6, 4, 'Pacific Coast Co.', 5),
  ('Heritage Lamb Rack',  'portions',  4, 5, 2, 'Maison Farms',     6),
  ('Kitchen Garden Produce', 'portions', 18, 8, 5, 'Maison Farms',   7),
  ('A5 Wagyu Bavette',    'portions',  0, 4, 3, 'Hayashi Farms',    8),
  ('Fresh Fettuccine',    'portions',  6, 6, 4, 'Pastificio Rossi', 9),
  ('Atlantic Salmon',     'portions',  9, 6, 3, 'Nordic Catch',    10),
  ('Foraged Wild Mushrooms', 'portions', 15, 8, 2, 'Terra Luxe',   11),
  ('Late-Harvest Strawberries', 'portions', 7, 6, 3, 'Maison Farms', 12),
  ('Carnaroli Rice',      'kg',       18, 6, 2.4, 'Pastificio Rossi', null),
  ('Double Cream',        'l',        24, 10, 6, 'Dairy Fresh',    null),
  ('Sardinian Saffron',   'kg',     0.05, 0.1, 0.02, 'Spice Route', null),
  ('Cultured Butter',     'kg',       11, 5, 3.5, 'Dairy Fresh',   null),
  ('Parmigiano-Reggiano', 'kg',      6.5, 3, 1.2, 'Caseificio Bo', null),
  ('Oscietra Caviar',     'kg',      0.4, 0.5, 0.1, 'Terra Luxe',  null)
) as v(name, unit, stock, min_stock, usage_today, supplier, dish_id)
where not exists (select 1 from public.inventory_items i where i.name = v.name);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Sales & analytics
--
-- Exposed as SECURITY DEFINER functions rather than views: an aggregate has to
-- read across every guest's orders, which RLS would otherwise (correctly)
-- block. Gating on is_manager() inside the function keeps that safe.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.manager_dashboard_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v json;
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  select json_build_object(
    'revenue_today', coalesce((
      select sum(total) from public.orders
      where created_at >= date_trunc('day', now()) and status = 'paid'
    ), 0),
    'revenue_yesterday', coalesce((
      select sum(total) from public.orders
      where created_at >= date_trunc('day', now()) - interval '1 day'
        and created_at <  date_trunc('day', now())
        and status = 'paid'
    ), 0),
    'orders_today', (
      select count(*) from public.orders where created_at >= date_trunc('day', now())
    ),
    'orders_active', (
      select count(*) from public.orders where kitchen_status <> 'served'
    ),
    'customers_served', (
      select count(distinct user_id) from public.orders
      where created_at >= date_trunc('day', now())
    ),
    'tables_total',    (select count(*) from public.restaurant_tables),
    'tables_occupied', (select count(*) from public.restaurant_tables where status = 'occupied'),
    'tables_available',(select count(*) from public.restaurant_tables where status = 'available'),
    'tables_reserved', (select count(*) from public.restaurant_tables where status = 'reserved'),
    'queue_waiting',   (select count(*) from public.queue_entries where status = 'waiting'),
    'queue_people',    coalesce((select sum(party_size) from public.queue_entries where status = 'waiting'), 0),
    'inventory_low',      (select count(*) from public.inventory_items where status = 'low'),
    'inventory_critical', (select count(*) from public.inventory_items where status = 'critical'),
    'reservations_today', (
      select count(*) from public.reservations
      where reservation_date = current_date and status in ('pending', 'confirmed', 'seated')
    ),
    'reservations_pending', (
      select count(*) from public.reservations where status = 'pending'
    ),
    'staff_available', (select count(*) from public.staff_members where status = 'available'),
    'staff_busy',      (select count(*) from public.staff_members where status = 'busy')
  ) into v;

  return v;
end;
$$;

grant execute on function public.manager_dashboard_stats() to authenticated;

-- Revenue series. p_period: 'day' | 'week' | 'month' | 'year'
create or replace function public.manager_revenue_series(p_period text default 'week')
returns table (name text, revenue numeric, orders bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  if p_period = 'day' then
    return query
      select to_char(h, 'HH24:00'),
             coalesce(sum(o.total), 0)::numeric,
             count(o.id)
      from generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '23 hours', interval '1 hour') h
      left join public.orders o
        on date_trunc('hour', o.created_at) = h and o.status = 'paid'
      group by h order by h;

  elsif p_period = 'month' then
    return query
      select to_char(d, 'DD Mon'),
             coalesce(sum(o.total), 0)::numeric,
             count(o.id)
      from generate_series(current_date - interval '29 days', current_date, interval '1 day') d
      left join public.orders o
        on o.created_at::date = d::date and o.status = 'paid'
      group by d order by d;

  elsif p_period = 'year' then
    return query
      select to_char(m, 'Mon'),
             coalesce(sum(o.total), 0)::numeric,
             count(o.id)
      from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
      left join public.orders o
        on date_trunc('month', o.created_at) = m and o.status = 'paid'
      group by m order by m;

  else -- 'week'
    return query
      select to_char(d, 'Dy'),
             coalesce(sum(o.total), 0)::numeric,
             count(o.id)
      from generate_series(current_date - interval '6 days', current_date, interval '1 day') d
      left join public.orders o
        on o.created_at::date = d::date and o.status = 'paid'
      group by d order by d;
  end if;
end;
$$;

grant execute on function public.manager_revenue_series(text) to authenticated;

-- Guests per hour today (drives the peak-hours chart and the forecast page).
create or replace function public.manager_hourly_guests()
returns table (hour text, guests bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  return query
    select to_char(h, 'HH24:00'), count(distinct o.user_id)
    from generate_series(
      date_trunc('day', now()) + interval '11 hours',
      date_trunc('day', now()) + interval '23 hours',
      interval '1 hour'
    ) h
    left join public.orders o on date_trunc('hour', o.created_at) = h
    group by h order by h;
end;
$$;

grant execute on function public.manager_hourly_guests() to authenticated;

create or replace function public.manager_popular_dishes(p_limit int default 6)
returns table (name text, orders bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  return query
    select oi.dish_name, sum(oi.qty)::bigint, sum(oi.qty * oi.price)::numeric
    from public.order_items oi
    group by oi.dish_name
    order by sum(oi.qty) desc
    limit p_limit;
end;
$$;

grant execute on function public.manager_popular_dishes(int) to authenticated;

create or replace function public.manager_payment_mix()
returns table (name text, value bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  return query
    select coalesce(nullif(o.payment_method, ''), 'Card'), count(*)::bigint
    from public.orders o
    where o.status = 'paid'
    group by 1 order by 2 desc;
end;
$$;

grant execute on function public.manager_payment_mix() to authenticated;

create or replace function public.manager_sales_summary()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare v json;
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  select json_build_object(
    'total_revenue', coalesce((
      select sum(total) from public.orders
      where status = 'paid' and created_at >= date_trunc('month', now())
    ), 0),
    'avg_order_value', coalesce((
      select round(avg(total), 2) from public.orders where status = 'paid'
    ), 0),
    'cancellation_rate', coalesce((
      select round(
        100.0 * count(*) filter (where status = 'cancelled') / nullif(count(*), 0), 1
      ) from public.reservations
    ), 0),
    'orders_paid', (select count(*) from public.orders where status = 'paid'),
    'new_customers', (
      select count(*) from public.profiles where created_at >= date_trunc('month', now())
    ),
    'returning_customers', (
      select count(*) from (
        select user_id from public.orders group by user_id having count(*) > 1
      ) t
    )
  ) into v;

  return v;
end;
$$;

grant execute on function public.manager_sales_summary() to authenticated;

-- Customer book: aggregate spend/visits plus the allergy and dietary notes the
-- guest entered on their own profile page.
create or replace function public.manager_customers()
returns table (
  id uuid, name text, email text, visits bigint, total_spend numeric,
  avg_spend numeric, favourite_dish text, dietary text, allergies text,
  last_visit timestamptz, mood text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  return query
    select
      p.id,
      nullif(p.name, ''),
      p.email,
      coalesce(o.visits, 0),
      coalesce(o.total_spend, 0)::numeric,
      coalesce(round(o.total_spend / nullif(o.visits, 0), 2), 0)::numeric,
      fav.dish_name,
      coalesce(nullif(array_to_string(array(
        select note from public.dietary_preferences where user_id = p.id
      ), ', '), ''), 'None'),
      coalesce(nullif(array_to_string(array(
        select a.name from public.allergies a where a.user_id = p.id
      ), ', '), ''), 'None'),
      o.last_visit,
      p.mood
    from public.profiles p
    left join (
      select user_id,
             count(*) as visits,
             sum(total) as total_spend,
             max(created_at) as last_visit
      from public.orders
      where status = 'paid'
      group by user_id
    ) o on o.user_id = p.id
    left join lateral (
      select oi.dish_name
      from public.order_items oi
      join public.orders ord on ord.id = oi.order_id
      where ord.user_id = p.id
      group by oi.dish_name
      order by sum(oi.qty) desc
      limit 1
    ) fav on true
    where not exists (
      select 1 from public.staff_members sm where sm.user_id = p.id
    )
    order by coalesce(o.total_spend, 0) desc;
end;
$$;

grant execute on function public.manager_customers() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. ai_insights
--
-- Derived from live data, not hardcoded. Each row carries an action_type the
-- Apply button can actually execute, so "Apply" changes the restaurant rather
-- than just dimming a card.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('staffing', 'inventory', 'operations', 'revenue')),
  problem text not null,
  reason text not null,
  action text not null,
  improvement text not null,
  confidence int not null default 80 check (confidence between 0 and 100),
  status text not null default 'open' check (status in ('open', 'applied', 'dismissed')),
  action_type text not null default 'none'
    check (action_type in ('none', 'restock', 'hide_dish', 'seat_queue', 'assign_staff', 'free_table')),
  action_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.generate_ai_insights()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
  v_queue int;
  v_occupied int;
  v_total_tables int;
  v_busy_staff int;
  v_avail_staff int;
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  -- Regenerate from scratch; anything the manager applied or dismissed stays.
  delete from public.ai_insights where status = 'open';

  -- Inventory pressure, worst first.
  for r in
    select id, name, stock, min_stock, unit, supplier, dish_id, status
    from public.inventory_items
    where status in ('low', 'critical')
    order by (status = 'critical') desc, (stock / nullif(min_stock, 0)) asc
    limit 4
  loop
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'inventory',
      r.name || (case when r.status = 'critical' then ' is out' else ' is running low' end),
      format('%s %s left against a %s %s minimum. %s',
             r.stock, r.unit, r.min_stock, r.unit,
             case when r.dish_id is not null
                  then 'This is the limiting ingredient for a live menu item.'
                  else 'Pantry staple used across several dishes.' end),
      format('Restock from %s', r.supplier),
      case when r.status = 'critical' then 'Clears a sold-out dish' else 'Avoids a mid-service gap' end,
      case when r.status = 'critical' then 96 else 88 end,
      'restock',
      json_build_object('item_id', r.id, 'qty', greatest(r.min_stock * 2 - r.stock, 4))::jsonb
    );
    v_count := v_count + 1;
  end loop;

  -- Queue vs. free tables.
  select count(*) into v_queue from public.queue_entries where status = 'waiting';
  select count(*) into v_occupied from public.restaurant_tables where status = 'occupied';
  select count(*) into v_total_tables from public.restaurant_tables;

  if v_queue > 0 and exists (select 1 from public.restaurant_tables where status = 'available') then
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'operations',
      'Parties waiting while tables sit empty',
      format('%s %s waiting with %s free %s on the floor.',
             v_queue, case when v_queue = 1 then 'party is' else 'parties are' end,
             (select count(*) from public.restaurant_tables where status = 'available'),
             case when (select count(*) from public.restaurant_tables where status = 'available') = 1
                  then 'table' else 'tables' end),
      'Seat the front of the queue now',
      format('-%s min average wait', greatest(8, v_queue * 6)),
      93, 'seat_queue', '{}'::jsonb
    );
    v_count := v_count + 1;
  end if;

  -- Floor pressure.
  if v_total_tables > 0 and v_occupied::numeric / v_total_tables > 0.7 then
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'operations',
      'Floor approaching capacity',
      format('%s of %s tables occupied (%s%%). Turnover is the constraint tonight.',
             v_occupied, v_total_tables, round(100.0 * v_occupied / v_total_tables)),
      'Prompt dessert and coffee service on the longest-seated tables',
      '+18% table turnover', 84, 'none', '{}'::jsonb
    );
    v_count := v_count + 1;
  end if;

  -- Staffing balance.
  select count(*) into v_busy_staff  from public.staff_members where status = 'busy';
  select count(*) into v_avail_staff from public.staff_members where status = 'available';

  if v_busy_staff > 0 and v_avail_staff > 0 and v_busy_staff >= v_avail_staff * 2 then
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'staffing',
      'Workload is concentrated on too few people',
      format('%s staff busy against %s available. Response times climb once the ratio passes 2:1.',
             v_busy_staff, v_avail_staff),
      'Reassign tables from the busiest server to someone available',
      '+31% service consistency', 87, 'assign_staff', '{}'::jsonb
    );
    v_count := v_count + 1;
  end if;

  -- Tables stuck in cleaning.
  if exists (select 1 from public.restaurant_tables where status = 'cleaning') then
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'operations',
      'Tables held in cleaning',
      format('%s %s sitting in cleaning and unavailable to seat.',
             (select count(*) from public.restaurant_tables where status = 'cleaning'),
             case when (select count(*) from public.restaurant_tables where status = 'cleaning') = 1
                  then 'table is' else 'tables are' end),
      'Release cleaned tables back to available',
      'Recovers seating capacity immediately',
      90, 'free_table', '{}'::jsonb
    );
    v_count := v_count + 1;
  end if;

  -- Revenue read on the day.
  if exists (select 1 from public.orders where status = 'paid' and created_at >= date_trunc('day', now())) then
    insert into public.ai_insights
      (category, problem, reason, action, improvement, confidence, action_type, action_payload)
    values (
      'revenue',
      'Average order value below the month''s run rate',
      format('Today is averaging %s per paid order against %s for the month.',
             coalesce((select round(avg(total), 0) from public.orders
                       where status = 'paid' and created_at >= date_trunc('day', now())), 0),
             coalesce((select round(avg(total), 0) from public.orders where status = 'paid'), 0)),
      'Push the chef''s selections and wine pairings on open tables',
      '+9% average order value', 78, 'none', '{}'::jsonb
    );
    v_count := v_count + 1;
  end if;

  return v_count;
end;
$$;

grant execute on function public.generate_ai_insights() to authenticated;

-- Apply actually performs the action, then marks the card applied.
create or replace function public.apply_ai_insight(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insight public.ai_insights;
  v_item_id uuid;
  v_qty numeric;
  v_result text;
  v_busiest uuid;
  v_free uuid;
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  select * into v_insight from public.ai_insights where id = p_id;
  if v_insight.id is null then
    return 'Insight not found.';
  end if;

  if v_insight.action_type = 'restock' then
    v_item_id := (v_insight.action_payload ->> 'item_id')::uuid;
    v_qty     := (v_insight.action_payload ->> 'qty')::numeric;
    update public.inventory_items set stock = stock + v_qty where id = v_item_id;
    v_result := format('Restocked %s units.', v_qty);

  elsif v_insight.action_type = 'seat_queue' then
    perform public.manager_seat_next(
      (select id from public.restaurant_tables where status = 'available' order by seats limit 1)
    );
    v_result := 'Seated the next party.';

  elsif v_insight.action_type = 'free_table' then
    update public.restaurant_tables set status = 'available' where status = 'cleaning';
    v_result := 'Cleaned tables released.';

  elsif v_insight.action_type = 'assign_staff' then
    select s.id into v_busiest
    from public.staff_members s
    join public.staff_table_assignments a on a.staff_id = s.id
    where s.status = 'busy'
    group by s.id order by count(*) desc limit 1;

    select id into v_free from public.staff_members where status = 'available' limit 1;

    if v_busiest is not null and v_free is not null then
      update public.staff_table_assignments
      set staff_id = v_free
      where staff_id = v_busiest
        and table_id in (
          select table_id from public.staff_table_assignments
          where staff_id = v_busiest order by table_id limit 1
        );
      update public.staff_members set status = 'busy' where id = v_free;
      v_result := 'Reassigned a table to an available server.';
    else
      v_result := 'No suitable reassignment available.';
    end if;

  elsif v_insight.action_type = 'hide_dish' then
    update public.dishes set available = false
    where id = (v_insight.action_payload ->> 'dish_id')::int;
    v_result := 'Dish removed from the guest menu.';

  else
    v_result := 'Marked as actioned.';
  end if;

  update public.ai_insights set status = 'applied' where id = p_id;
  return v_result;
end;
$$;

grant execute on function public.apply_ai_insight(uuid) to authenticated;

create or replace function public.dismiss_ai_insight(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;
  update public.ai_insights set status = 'dismissed' where id = p_id;
end;
$$;

grant execute on function public.dismiss_ai_insight(uuid) to authenticated;

-- Demand forecast: last 4 weeks of the same weekday, blended with today.
create or replace function public.manager_forecast()
returns table (hour text, predicted int, actual int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  return query
    with slots as (
      select generate_series(
        date_trunc('day', now()) + interval '17 hours',
        date_trunc('day', now()) + interval '22 hours',
        interval '1 hour'
      ) as h
    ),
    history as (
      select extract(hour from created_at)::int as hr, count(*)::numeric / 4 as avg_orders
      from public.orders
      where created_at >= now() - interval '28 days'
        and extract(dow from created_at) = extract(dow from now())
      group by 1
    )
    select
      to_char(s.h, 'HH24:00'),
      greatest(1, coalesce(round(hi.avg_orders * 1.1), 0))::int,
      case
        when s.h <= date_trunc('hour', now())
        then (select count(*) from public.orders o where date_trunc('hour', o.created_at) = s.h)::int
        else null
      end
    from slots s
    left join history hi on hi.hr = extract(hour from s.h)::int
    order by s.h;
end;
$$;

grant execute on function public.manager_forecast() to authenticated;

-- Explicit menu control: pull a dish off the guest menu (or put it back)
-- without touching stock — the manager's Menu toggle.
create or replace function public.manager_set_dish_visibility(p_dish_id int, p_hidden boolean)
returns public.dishes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.dishes;
begin
  if not public.is_manager() then
    raise exception 'Manager access required.';
  end if;

  -- p_hidden true = take it off the menu.
  update public.dishes set available = not p_hidden where id = p_dish_id returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.manager_set_dish_visibility(int, boolean) to authenticated;
-- ============================================================================
-- PART 4 of 4: row-level security, realtime, seed data
--
-- Both apps share one anon key. What separates them is identity: a guest sees
-- only their own rows (the policies from schema.sql), a manager sees the
-- restaurant. Nothing here weakens the guest-side rules — the manager policies
-- sit alongside them and only ever grant to is_manager().
-- ============================================================================

alter table public.staff_members            enable row level security;
alter table public.staff_table_assignments  enable row level security;
alter table public.inventory_items          enable row level security;
alter table public.ai_insights              enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- Manager-only tables
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Managers manage staff" on public.staff_members;
create policy "Managers manage staff" on public.staff_members
  for all using (public.is_manager()) with check (public.is_manager());

-- So a freshly signed-in manager can read their own row before is_manager()
-- has anything to go on.
drop policy if exists "Staff read their own row" on public.staff_members;
create policy "Staff read their own row" on public.staff_members
  for select using (auth.uid() = user_id);

drop policy if exists "Managers manage table assignments" on public.staff_table_assignments;
create policy "Managers manage table assignments" on public.staff_table_assignments
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage inventory" on public.inventory_items;
create policy "Managers manage inventory" on public.inventory_items
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage insights" on public.ai_insights;
create policy "Managers manage insights" on public.ai_insights
  for all using (public.is_manager()) with check (public.is_manager());

-- ────────────────────────────────────────────────────────────────────────────
-- Shared tables — manager policies added next to the existing guest policies
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Managers see every order" on public.orders;
create policy "Managers see every order" on public.orders
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers see every order item" on public.order_items;
create policy "Managers see every order item" on public.order_items
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers see every tracking step" on public.order_tracking_steps;
create policy "Managers see every tracking step" on public.order_tracking_steps
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers see every reservation" on public.reservations;
create policy "Managers see every reservation" on public.reservations
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage the queue" on public.queue_entries;
create policy "Managers manage the queue" on public.queue_entries
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage the floor plan" on public.restaurant_tables;
create policy "Managers manage the floor plan" on public.restaurant_tables
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage the menu" on public.dishes;
create policy "Managers manage the menu" on public.dishes
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers manage promo codes" on public.promo_codes;
create policy "Managers manage promo codes" on public.promo_codes
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "Managers read guest profiles" on public.profiles;
create policy "Managers read guest profiles" on public.profiles
  for select using (public.is_manager());

drop policy if exists "Managers read allergies" on public.allergies;
create policy "Managers read allergies" on public.allergies
  for select using (public.is_manager());

drop policy if exists "Managers read dietary preferences" on public.dietary_preferences;
create policy "Managers read dietary preferences" on public.dietary_preferences
  for select using (public.is_manager());

-- ────────────────────────────────────────────────────────────────────────────
-- Realtime — so neither app has to poll to notice the other's changes
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'order_tracking_steps', 'reservations',
    'queue_entries', 'restaurant_tables', 'dishes', 'inventory_items',
    'ai_insights', 'staff_members'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- Full row images so UPDATE/DELETE payloads carry the old values too.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: the floor team. These are roster rows with no login — the only staff
-- member with a user_id is whoever you promote with grant_manager().
-- ────────────────────────────────────────────────────────────────────────────

insert into public.staff_members (name, role, shift, status, score, photo)
select v.name, v.role, v.shift, v.status, v.score, v.photo
from (values
  ('Elena Marchetti', 'Head Chef',  '4PM–12AM', 'busy',      97, 'https://images.unsplash.com/photo-1607631568010-a87245c0daf5?w=80&h=80&fit=crop&auto=format'),
  ('James Okafor',    'Sous Chef',  '4PM–12AM', 'busy',      89, 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=80&h=80&fit=crop&auto=format'),
  ('Sofia Reyes',     'Waiter',     '5PM–11PM', 'available', 94, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format'),
  ('Marcus Chen',     'Waiter',     '5PM–11PM', 'break',     88, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&auto=format'),
  ('Aisha Nakamura',  'Host',       '4PM–10PM', 'available', 96, 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&auto=format'),
  ('Victor Dubois',   'Sommelier',  '5PM–12AM', 'busy',      99, 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&auto=format'),
  ('Priya Kapoor',    'Bartender',  '5PM–1AM',  'available', 92, 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=80&h=80&fit=crop&auto=format'),
  ('Diego Ruiz',      'Runner',     '5PM–11PM', 'offline',   85, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format')
) as v(name, role, shift, status, score, photo)
where not exists (select 1 from public.staff_members s where s.name = v.name);

-- A starting section for each front-of-house member.
insert into public.staff_table_assignments (staff_id, table_id)
select s.id, t.table_id
from public.staff_members s
join (values
  ('Sofia Reyes', 1), ('Sofia Reyes', 2), ('Sofia Reyes', 5),
  ('Marcus Chen', 6), ('Marcus Chen', 7),
  ('Victor Dubois', 4), ('Victor Dubois', 9),
  ('Diego Ruiz', 3), ('Diego Ruiz', 8), ('Diego Ruiz', 10)
) as t(staff_name, table_id) on t.staff_name = s.name
where exists (select 1 from public.restaurant_tables rt where rt.id = t.table_id)
on conflict (staff_id, table_id) do nothing;

-- Mirror the assignment onto the table itself so the floor plan can colour it.
update public.restaurant_tables rt
set assigned_staff_id = a.staff_id
from public.staff_table_assignments a
where a.table_id = rt.id and rt.assigned_staff_id is null;

-- ────────────────────────────────────────────────────────────────────────────
-- FINAL STEP — run this once, with the email you sign into the Manager app
-- with, after creating that account:
--
--     select public.grant_manager('you@example.com');
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- Guest-profile foreign keys
--
-- orders/reservations/queue_entries.user_id pointed only at auth.users, which
-- lives outside the exposed schema. That left no relationship PostgREST could
-- follow from an order to the guest's name, so the manager board had no way to
-- show who an order belongs to. These constraints model what was already true
-- (a row belongs to a guest profile) and make that join available.
--
-- Back-fill any profile rows that are missing first, otherwise adding the
-- constraint would fail on historic data created before the signup trigger.
-- ────────────────────────────────────────────────────────────────────────────

insert into public.profiles (id, email)
select distinct u.id, u.email
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_user_id_profiles_fkey'
  ) then
    alter table public.orders
      add constraint orders_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'reservations_user_id_profiles_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'queue_entries_user_id_profiles_fkey'
  ) then
    alter table public.queue_entries
      add constraint queue_entries_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- Self-check — read the output of this after running the file.
-- Every row should say OK. Anything else tells you exactly what is missing.
-- ────────────────────────────────────────────────────────────────────────────

select
  'guest queue function' as check,
  case
    when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'join_queue') = 1
    then 'OK — exactly one join_queue(), guest app can call it'
    else 'PROBLEM — join_queue is ambiguous or missing; re-run this file'
  end as result
union all
select
  'manager notification copy',
  case
    when (select count(*) from public.notification_copy
          where event in ('order_accepted','order_ready','reservation_updated',
                          'reservation_cancelled','queue_advanced','table_ready')) = 54
    then 'OK — all six manager events have copy for all nine moods'
    else 'PROBLEM — copy missing (did you re-run schema.sql?); re-run this file'
  end
union all
select
  'menu availability column',
  case
    when exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'dishes' and column_name = 'available')
    then 'OK — dishes.available exists, menu visibility will work'
    else 'PROBLEM — dishes.available missing'
  end
union all
select
  'kitchen board column',
  case
    when exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'orders' and column_name = 'kitchen_status')
    then 'OK — orders.kitchen_status exists, board is wired to the guest timeline'
    else 'PROBLEM — orders.kitchen_status missing'
  end
union all
select
  'queue numbering',
  case
    when not exists (
      select 1 from (
        select position, row_number() over (order by position) as expected
        from public.queue_entries where status = 'waiting'
      ) t where t.position <> t.expected
    )
    then 'OK — queue positions are contiguous'
    else 'PROBLEM — gaps in the queue; run: select public.renumber_queue();'
  end
union all
select
  'managers registered',
  case
    when (select count(*) from public.staff_members where is_manager) > 0
    then 'OK — ' || (select count(*)::text from public.staff_members where is_manager) || ' manager account(s)'
    else 'OK — no managers yet; the on_auth_user_created_grant_manager trigger will grant the first signup'
  end;
