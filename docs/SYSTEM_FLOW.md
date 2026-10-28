# SchoolBus Connect — Complete System Flow & Integration Guide

> **Audience:** Anyone who needs to understand how the entire SaaS works from the inside out —
> owners, managers, developers, and investors.  
> **What you'll find here:** The real business logic, the exact database tables involved at each step,
> and a day-by-day playbook from signing up a school to completing the first month of live trips.

---

## Part 1 — Who Are the Participants?

SchoolBus Connect is a **multi-tenant SaaS**. Every piece of data belongs to exactly one school.
No school can ever see another school's data.

| Role | Who they are | What they can do |
|---|---|---|
| **Owner** | The company that runs SchoolBus Connect (you) | Create schools, view platform-wide health metrics, purge data, reset any password |
| **Manager** | A staff member at one school (e.g., transport coordinator) | Manage their school's buses, routes, stops, students, parents, and drivers |
| **Driver** | The bus driver for one school | Run the pre-trip checklist, start a trip, broadcast live GPS, report a delay, end the trip |
| **Parent** | A guardian of one or more students at that school | Watch the live bus position on a map, read alerts, report a child's absence |

**Key rule:** A manager can only see their own school. A driver can only see their own assignment.
A parent can only see the bus their child is assigned to.

---

## Part 2 — The Full Business Flow (Big Picture)

```
SchoolBus Connect Platform (Owner)
        │
        ▼
  ┌─────────────────────────────┐
  │  School A (e.g. Sunshine    │   ← one row in the `schools` table
  │  International School)      │
  └─────────────────────────────┘
        │
        │   Manager logs in → sets up:
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  FLEET SETUP                                        │
  │  • Registers buses (Bus 1, Bus 2 …)                 │  ← `buses` table
  │  • Creates routes (Route A: Bole → CMC → School)    │  ← `routes` table
  │  • Adds stops in order (Bole, Sarbet, CMC, School)  │  ← `stops` table
  │  • Sets route schedule (weekdays, 07:00 morning)    │  ← `route_schedules` table
  │  • Assigns Bus 1 to Route A + Driver Tekeste         │  ← `bus_assignments` table
  └─────────────────────────────────────────────────────┘
        │
        │   Manager logs in → sets up:
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  STUDENT & PARENT SETUP                             │
  │  • Registers Student: Sara Mekdes, Grade 4          │  ← `students` table
  │  • Creates Parent account for Sara's mother         │  ← `profiles` (role=parent) + auth.users
  │  • Links mother to Sara as primary guardian         │  ← `guardians` table
  │  • Assigns Sara to "Sarbet" stop (morning pickup)   │  ← `student_stops` table
  │  • Assigns Sara to "School" stop (afternoon drop)   │  ← `student_stops` table
  └─────────────────────────────────────────────────────┘
        │
        │   EVERY SCHOOL DAY:
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  TRIP EXECUTION                                     │
  │  • System or manager pre-creates trip record        │  ← `trips` table (status=scheduled)
  │  • Driver opens app, does 4-step pre-trip checklist │
  │  • Driver taps "Start Trip" → status = in_progress  │
  │  • Driver's phone broadcasts GPS every 12 seconds   │  ← `bus_locations_latest` table
  │                                                     │    `bus_location_history` table
  │  • Parent's app shows live map with bus dot         │
  │  • System generates alerts (tripStarted, nearStop,  │  ← `alert_events` table
  │    delayed, tripCompleted)                          │
  │  • Driver taps "End Trip" → status = completed      │
  │  • Trip summary written (pings, accuracy, gap)      │  ← `trip_summaries` table
  └─────────────────────────────────────────────────────┘
```

---

## Part 3 — Detailed Participant Flow

### 3.1 — The Owner (Platform Level)

The Owner is **you** — the company behind SchoolBus Connect.

**What the owner does:**
1. **Signs in** at `/owner` using the Owner Portal.
2. **Creates a new school** via the "Add School" form on the Owner Dashboard.
   - Inputs: school name, unique code (e.g. `SIS-01`), timezone (default: `Africa/Addis_Ababa`), contact phone.
   - Under the hood: one row is inserted into the `schools` table.
3. **Creates the Manager account** for that school using the `provision-user` Edge Function.
   - Inputs: manager's name, phone or email.
   - The Edge Function:
     1. Creates the user in `auth.users` (Supabase authentication).
     2. Inserts a row in `profiles` with `role = 'manager'` and `school_id` pointing to the school.
     3. Sets `must_change_password = true` so the manager is forced to choose their own password at first login.
     4. Returns a temporary password which the owner sends to the manager via phone or email **offline** (WhatsApp, SMS, etc.).
   - Logs the action in `audit_log`.

**Owner Dashboard shows:**
- All schools registered on the platform.
- Per-school health: total buses, routes, students, active trips today.
- Ability to purge location history and manage all schools.

---

### 3.2 — The Manager (School Level)

The Manager runs the school's transportation operations.

#### Step A — First Login

1. Manager receives the temporary password from the owner (offline: WhatsApp/SMS).
2. Manager opens the app, switches to the **🚌 Staff & Driver tab**, enters email and temp password.
3. The system detects `must_change_password = true` and shows a **"Set New Password" modal**.
4. Manager sets their own password. From now on, no one else knows it.

#### Step B — School Settings

Manager goes to **School Settings** and fills in:
- School's full official name.
- Office contact phone number.
- Timezone confirmation (`Africa/Addis_Ababa`).

This updates the `schools` table row.

#### Step C — Add Buses

Manager goes to **Buses & Routes → + Add Bus**:

| Field | Example | Where stored |
|---|---|---|
| Bus name / number | Bus 1 | `buses.name` |
| License plate | 3-AA-1234 | `buses.plate_number` |
| Passenger capacity | 32 | `buses.capacity` |

Each bus gets a UUID and is tied to the school via `school_id`.

#### Step D — Create Routes & Stops

Manager creates a route (e.g. "Bole–CMC Route"):
- Route name, start time (e.g. 07:00), active days.
- Route row written to `routes` table.

Then adds stops in order:

| Stop # | Name | Location (lat/lng) | Is School? |
|---|---|---|---|
| 1 | Bole Terminal | 8.9800, 38.7890 | No |
| 2 | Sarbet Junction | 8.9950, 38.7640 | No |
| 3 | CMC Roundabout | 9.0130, 38.7610 | No |
| 4 | Sunshine School Gate | 9.0200, 38.7500 | Yes |

Each stop row in the `stops` table has:
- `sequence_morning` — the order for the morning run (1, 2, 3, 4).
- Afternoon run is automatically the reverse (school → CMC → Sarbet → Bole).
- `lat` and `lng` — used by the map and the near-stop alert engine.

Route schedules (which days, what time, morning vs afternoon) are stored in `route_schedules`.

#### Step E — Assign Bus + Driver to Route

The **bus assignment** ties everything together:

```
Bus 1  →  Bole–CMC Route  →  Driver: Tekeste Wolde  →  Effective from: today
```

This writes one row to `bus_assignments`:
- `bus_id` → Bus 1
- `route_id` → Bole–CMC Route
- `driver_profile_id` → Tekeste's profile UUID
- `is_active = true`

A database constraint ensures **one bus can only have one active assignment at a time**.

#### Step F — Create Driver Accounts

For each driver, the manager provisions them through the Edge Function:

1. Manager enters driver's name and phone number.
2. The `provision-user` Edge Function runs:
   - Creates user in `auth.users`.
   - Inserts `profiles` row with `role = 'driver'`, `school_id = manager's school`.
   - Marks `must_change_password = true`.
   - Returns a temporary password.
3. Manager tells the driver the temp password offline (WhatsApp/call).
4. Driver logs in for the first time, sets their own password.

All of this is logged in `audit_log`.

#### Step G — Register Students

For each child who rides the bus:

1. Manager clicks **+ Add Student**.
   - Inputs: student's full name, grade.
   - This creates one row in `students`.
2. Manager then **assigns the student to a stop**:
   - For morning pickup: select the route and the specific stop (e.g. Sara gets off at "Sarbet Junction").
   - For afternoon drop-off: select the destination stop.
   - These create rows in `student_stops` with `direction = 'morning'` and `direction = 'afternoon'`.

#### Step H — Create Parent Accounts & Link to Students

1. Manager creates a parent account for each student's primary guardian:
   - Name, phone number (Ethiopian format: `0911...` → auto-converted to `+25191...`).
   - Same `provision-user` Edge Function. Role = `parent`.
   - Temp password sent offline.
2. The manager then **links the parent to the student** via the `guardians` table:
   - `student_id` → Sara
   - `profile_id` → Sara's mother
   - `relationship = 'parent'`
   - `is_primary = true`
   - `alert_radius_m = 500` (parent gets near-stop alert when bus is 500 m away; can be changed to 200 m or 1000 m from the parent app)
3. Parent's first login: opens app, switches to **👨‍👩‍👧 Parent Portal tab**, enters phone number + temp password, sets their own password.

---

### 3.3 — The Driver (Every School Day)

The driver opens the app on their phone. They see the **Driver Portal** at `/driver`.

#### Pre-Trip Checklist (4 steps)

Before the driver can start a trip, they must confirm:

| Step | What it checks |
|---|---|
| ✅ Vehicle check | Tires, brakes, lights — driver confirms OK |
| ✅ GPS signal | The app confirms the phone has an active GPS fix (accuracy < 50 m) |
| ✅ Bus assignment | App confirms this driver is assigned to a route today |
| ✅ No active trip | No trip already in progress for this bus today |

Once all 4 are green, the **"Start Trip" button** activates.

#### Starting the Trip

Driver taps **"Start Trip"**:
- A `trips` row is created (or updated from `scheduled` → `in_progress`):
  - `status = 'in_progress'`
  - `started_at = now()`
  - `bus_id`, `route_id`, `driver_profile_id`, `trip_date`, `direction`
- An `alert_events` row is written: `event_type = 'tripStarted'`.
- All parents on this route instantly see in their Alert feed: *"Bus 1 has started the morning route."*

#### Live GPS Broadcasting

While the trip is in progress, the driver's phone:
1. Reads GPS position every **12 seconds**.
2. Sends it to the `ingest_location` database function:
   - **Overwrites** the single row in `bus_locations_latest` (so parents always see the freshest position instantly).
   - **Appends** a new row in `bus_location_history` (trail for analysis and near-stop detection).
3. Real-time broadcast fires via Supabase Realtime — every parent app subscribed to this bus updates its map dot in real time **without refreshing the page**.

If GPS is lost for more than 30 seconds, the driver screen shows a **red "GPS Lost"** warning.

#### Reporting a Delay

If the driver is stuck in traffic:
1. Driver taps **"Report Delay (+15 min)"**.
2. Selects reason: Traffic, Breakdown, or Other.
3. An `alert_events` row is written: `event_type = 'delayed'`, `payload_json = { reason: 'traffic' }`.
4. All parents on this route see in their Alerts: *"Bus 1 is running approximately 15 minutes late due to traffic."*

#### Ending the Trip (Normal & Fail-Safe Recovery)

**Normal Path:**
1. Driver arrives at the school or final stop, taps **"End Trip"** → confirms:
2. `trips` row updated: `status = 'completed'`, `ended_at = now()`.
3. `bus_locations_latest` cleared for the bus so parents no longer see an active vehicle on route.
4. A `trip_summaries` row is written with:
   - `total_pings` — how many GPS pings were received.
   - `longest_gap_seconds` — longest interruption in GPS.
   - `avg_accuracy_meters` — average GPS accuracy.
5. `alert_events` row: `event_type = 'tripCompleted'`.
6. Parents see: *"Bus 1 has completed the morning route."*

**What if the Driver Forgot to Click "End Trip" or Went Out of the App? (Fail-Safe Recovery)**
If a driver closes the browser, locks their phone, or leaves the bus without tapping "End Trip", SchoolBus Connect provides a 3-layer safety net:

1. **Driver Portal Auto-Detection & Recovery Card (`/driver`):**
   - When the driver reopens the app, the system checks for any in-progress trip on their assigned bus.
   - Instead of stranding the driver with a locked "Start Trip" button, a prominent **Unfinished Trip Banner** appears:
     - **"▶ Resume Trip & GPS"**: Returns straight to the live transmission screen and re-engages wake lock.
     - **"🛑 End & Complete Trip Now"**: Immediately ends the trip, closes the database lock, and resets the bus for the next route.
   - If a new trip start is attempted while another is active, a **"Force End Previous Active Trip"** button is directly provided.

2. **School Manager Remote Override (`/manager` Dashboard):**
   - In the **Today's Trips** table on the School Manager Dashboard, every in-progress trip has an **"🛑 End Trip"** button in the Action column.
   - If a driver went home, lost their phone, or forgot, the school administrator can end and complete the trip with 1 click from their desk, clearing the live tracking dot for parents and freeing the bus for the afternoon run.

3. **Automated Stale Trip Cleanup:**
   - The database routine checks for stale trips (>12 hours old or from a previous school day) and automatically transitions them to `completed` upon next session check, ensuring no bus is ever permanently stuck in an active state.

---

### 3.4 — The Parent (Every School Day)

Parents use the app at three screens:

#### Home Screen (`/home`)
- Shows child's name, assigned bus number, assigned stop name.
- Live status card: "Bus 1 is about 2.3 km away" OR "No trip is scheduled right now."
- **Report Absence** button: parent selects date, direction (morning / afternoon / both), and optional reason. This writes to the `absences` table.
- If parent has more than one child on different buses, they can switch between children with a tab selector.

#### Map Screen (`/map`)
- Full-screen OpenStreetMap with:
  - 🟡 Bus dot (live position from `bus_locations_latest`, updated every 12 seconds).
  - 📍 Child's stop pin.
  - 🟢 Dashed green circle = the alert radius (200 m / 500 m / 1000 m, parent's choice).
  - Dotted yellow line = bus route path.
- Stale warning banner if bus location is older than 90 seconds.

#### Alerts Screen (`/alerts`)
- Chronological list of all events for this parent's child's bus today and recent days.
- Events are read from `alert_events`, filtered by the guardian's student's assigned route.

---

## Part 4 — The Database: Every Table and Its Role

| Table | Purpose | Created by |
|---|---|---|
| `schools` | Root of every tenant. Every other table points here. | Owner |
| `profiles` | One row per user. Has `role` and `school_id`. | provision-user Edge Function |
| `buses` | The physical vehicles. Name, plate, capacity. | Manager |
| `routes` | Named road paths. Name, start time. | Manager |
| `route_schedules` | Which days of the week and at what time each route runs. | Manager |
| `stops` | Individual pickup/dropoff points on a route, in sequence. Lat/lng. | Manager |
| `students` | Each child who rides the bus. Name, grade. | Manager |
| `guardians` | Links a student to a parent profile. Stores alert_radius_m preference. | Manager |
| `student_stops` | Which stop a student uses for morning pickup and afternoon drop-off. | Manager |
| `bus_assignments` | Links a bus to a route and a driver. Only one active assignment per bus. | Manager |
| `trips` | One record per daily bus run. Lifecycle: scheduled → in_progress → completed/cancelled. | Driver / System |
| `bus_locations_latest` | Always the single most recent GPS ping per bus. For real-time map. | Driver's phone |
| `bus_location_history` | Full GPS trail per trip (12-second interval). For near-stop detection. | Driver's phone |
| `absences` | A parent's report that their child won't be riding today. | Parent |
| `alert_events` | Trip event notifications: started, nearStop, delayed, completed, cancelled. | System / Driver |
| `push_subscriptions` | Web Push tokens (for future push notification delivery). | Parent's browser |
| `trip_summaries` | Aggregated quality metrics per completed trip (pings, gaps, accuracy). | System (on trip end) |
| `audit_log` | Immutable log of manager actions: user creation, password resets, purges. | System |

---

## Part 5 — Step-by-Step Integration Playbook

### Phase 0 — Platform Setup (Owner, Day 0)

| Step | Action | What happens in the database |
|---|---|---|
| 1 | Owner creates account on SchoolBus Connect | `auth.users` + `profiles (role=owner, school_id=null)` |
| 2 | Owner logs into `/owner` dashboard | Sees zero schools registered |
| 3 | Owner clicks "Add School", fills name + code + timezone + phone | One row inserted into `schools` table |
| 4 | Owner provisions the school's manager account | `auth.users` + `profiles (role=manager, school_id=school)`. Temp password returned. |
| 5 | Owner sends manager email + temp password via WhatsApp | Offline — nothing in the system |

---

### Phase 1 — School Setup (Manager, Days 1–3)

| Day | Action | Tables affected |
|---|---|---|
| D-1 | Manager first login; prompted to set new password | `auth.users.app_metadata.must_change_password` cleared |
| D-1 | Manager sets school name, timezone, contact phone | `schools` row updated |
| D-1 | Manager adds Bus 1 (plate: 3-AA-1234, capacity: 32) | `buses` row inserted |
| D-1 | Manager adds Bus 2 (plate: 3-BB-5678, capacity: 40) | `buses` row inserted |
| D-1 | Manager creates Route A "Bole–CMC Morning" (start: 07:00) | `routes` row, `route_schedules` row (Mon–Fri, 07:00, morning) |
| D-1 | Manager adds 4 stops to Route A in order | 4 `stops` rows with lat/lng and sequence_morning values |
| D-2 | Manager creates Route B "Qality–School Morning" | Same pattern |
| D-2 | Manager provisions Driver 1: Tekeste Wolde, phone 0911234567 | `auth.users` + `profiles (role=driver)`. Temp password returned. |
| D-2 | Manager provisions Driver 2: Abebe Girma, phone 0922345678 | Same |
| D-2 | Manager assigns Bus 1 → Route A → Tekeste | `bus_assignments` row, `is_active=true` |
| D-2 | Manager assigns Bus 2 → Route B → Abebe | `bus_assignments` row |
| D-2 | Manager calls drivers, gives them app URL + temp password | Offline (WhatsApp/call) |
| D-2 | Drivers log in, set own passwords | `auth.users` updated, `must_change_password` cleared |
| D-3 | Manager registers Student 1: Sara Mekdes, Grade 4 | `students` row |
| D-3 | Manager provisions Parent 1: Tigist Haile, phone 0933456789 | `auth.users` + `profiles (role=parent)`. Temp password returned. |
| D-3 | Manager links Tigist to Sara | `guardians` row (student_id=Sara, profile_id=Tigist, is_primary=true) |
| D-3 | Manager assigns Sara to "Sarbet" stop (morning pickup) | `student_stops` row (direction=morning, stop_id=Sarbet) |
| D-3 | Manager assigns Sara to "School Gate" stop (afternoon drop) | `student_stops` row (direction=afternoon, stop_id=School Gate) |
| D-3 | Manager repeats for all 30 students | 30 `students`, 30 `guardians`, 30–60 `student_stops` rows |
| D-3 | Manager sends parents app URL + temp password | Offline (WhatsApp/SMS) |
| D-3 | Parents log in, set own passwords, see home screen | `auth.users` updated |

---

### Phase 2 — First Live Trip (Day 4, First Day of Service)

| Time | Who | Action | System effect |
|---|---|---|---|
| 06:45 | Driver (Tekeste) | Opens app on his phone, sees Driver Portal | App reads `bus_assignments` for his profile |
| 06:45 | Driver | Completes 4-step pre-trip checklist | UI reads assignment data; confirms GPS lock |
| 07:00 | Driver | Taps **"Start Trip"** | `trips` row: `status=in_progress`, `started_at=07:00`. `alert_events`: tripStarted |
| 07:00 | Parents (all Route A) | See alert: "Bus 1 has started the morning route" | Read from `alert_events` |
| 07:01 | Driver's phone | First GPS ping sent | `bus_locations_latest` upserted, `bus_location_history` appended |
| 07:01 | Parent (Tigist) | Opens app → sees bus dot appear on the map | Supabase Realtime pushes the new location |
| 07:01 onward | Driver's phone | GPS ping every 12 seconds throughout the trip | Continuous DB writes; map updates in real time |
| 07:08 | System | Bus is now 500 m from Sarbet stop | Distance check against stop lat/lng coordinates |
| 07:08 | Parent (Tigist) | Alert: "Bus 1 is approaching Sarbet Junction" | `alert_events`: nearStop, radius_meters=500 |
| 07:09 | Driver | Stops at Sarbet, Sara boards | No system action (boarding tracking not yet built) |
| 07:28 | Driver | All students picked up, approaching school | GPS ping continues |
| 07:30 | Driver | Taps **"End Trip"** | `trips`: `status=completed`, `ended_at=07:30`. `trip_summaries` written. `alert_events`: tripCompleted |
| 07:30 | Parents | Alert: "Bus 1 has completed the morning route" | Read from `alert_events` |

**The first trip is complete.** All GPS pings, alerts, and the trip record are in the database.

---

### Phase 3 — First Week of Regular Operation

| When | Event | System behavior |
|---|---|---|
| Each morning | Driver starts trip → GPS flows → alerts fire → trip ends | Full cycle repeats automatically |
| Any morning | Parent reports Sara absent today | `absences` row inserted |
| Mid-week | Driver is stuck in traffic | Driver reports delay → `alert_events`: delayed → all parents notified |
| End of week | Manager reviews Manager Dashboard | Trip list, counts of in-progress, completed, cancelled |
| End of week | Manager reviews Audit Log | Every provision-user, password-reset, purge action from this week |

---

### Phase 4 — First Month of Operation

| When | Event | What to do |
|---|---|---|
| Week 1–2 | Parent forgot password | Manager uses reset-password Edge Function; new temp password sent offline |
| Week 1–2 | New student enrollment mid-month | Manager adds student, links parent, assigns stop — same as Phase 1 D-3 |
| Week 2 | Driver is sick; replacement driver needed | Manager deactivates old `bus_assignments`, creates new one for replacement driver |
| Week 3 | Add afternoon bus service | Create new `routes` + `route_schedules` (direction=afternoon) + `stops` + `bus_assignments` |
| End of month | Privacy maintenance | Manager purges `bus_location_history` older than today via Dashboard |
| End of month | Owner reviews platform growth | Owner Dashboard shows all schools, buses, students, trips across all tenants |

---

## Part 6 — Security Architecture

Every one of the 18 database tables has **Row Level Security (RLS)** enabled.
Postgres itself enforces isolation — not just the app code.

**Key rules enforced at the database level:**
- A manager can only read/write rows where `school_id = their own school`.
- A parent can only read students and trips connected to their guardian relationship.
- A driver can only write GPS data for the bus they are currently assigned to.
- The `provision-user` Edge Function uses a Service Role key but first validates the caller is an active manager or owner before creating any user.
- Cross-tenant password resets are blocked: Manager 1 trying to reset a password in School 2 gets HTTP 403 Forbidden.
- Deactivated accounts (`is_active = false`) are automatically signed out at the next login attempt.

---

## Part 7 — Feature Status

### ✅ Built and Working Today

- Multi-tenant school isolation (18 tables, full RLS)
- Owner dashboard: school management + platform health metrics
- Manager portal: buses, routes, stops, students, driver/parent account provisioning
- Driver portal: pre-trip checklist, trip start, live GPS broadcast, delay reporting, trip end
- Parent portal: home screen (live distance), map (live position), alerts feed, absence reporting
- Real-time map updates via Supabase Realtime (no page refresh needed)
- Role-based login with strict portal tab enforcement
- Secure forced password change on first login
- Audit log for all manager actions
- Trip summaries (GPS quality metrics per completed trip)
- Location history purge (privacy protection)

### 🚧 Not Yet Built

| Feature | What it needs |
|---|---|
| Boarding / drop-off confirmation | Driver taps each student as they board or alight |
| Push notifications (phone pop-up) | Web Push server implementation |
| Near-stop alert auto-trigger | PostGIS distance query every 12 seconds on GPS ingest |
| SMS alerts | Twilio or Africa's Talking integration |
| Afternoon trip scheduling in driver UI | Separate afternoon route support |
| Driver seeing absence list before departure | Show which students reported absent |
| Stop assignment UI for manager | Currently done via database seed; UI form needed |
| Route displayed on map in manager view | Interactive stop map in BusesRoutes page |
| Amharic translation (full review) | Strings exist; native speaker review needed |
| Parent self-registration | Currently manager-initiated only |

---

## One-Paragraph Summary

**SchoolBus Connect is a multi-tenant SaaS.** The Owner creates a school and provisions a Manager. The Manager sets up buses, routes with ordered stops, and assigns drivers to buses. The Manager registers students and creates parent accounts, linking each parent to their child and assigning each child to a specific pickup stop. Every school morning, the Driver completes a 4-step pre-trip checklist, taps "Start Trip," and their phone broadcasts GPS every 12 seconds. Parents see the live bus dot move on a map in real time and receive in-app alerts when the bus starts, approaches their child's stop, and completes the route. The database enforces strict data isolation via Row Level Security — no school can ever see another school's data, and no parent can ever see a bus their child is not assigned to.
