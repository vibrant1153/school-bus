# SchoolBus Connect - Row Level Security (RLS) & Access Control Matrix

## Role Definitions
- **anon / Unauthenticated**: Completely blocked on all public tables and server functions.
- **authenticated (Base DB Role)**: Default role for all logged-in JWT sessions. Application roles (`owner`, `manager`, `driver`, `parent`) are determined strictly by querying `profiles.role` joined with `profiles.school_id` via trusted `app_security` helper functions (`app_security.current_user_role()`, `app_security.current_user_school_id()`). Returns `NULL` if `profiles.is_active = false`. JWT metadata claims are never trusted for role checks.

---

## 1. Table-Level CRUD Permission Matrix

| Table | Owner | School Manager | Driver | Parent |
| :--- | :--- | :--- | :--- | :--- |
| **schools** | **SELECT** (All) | **SELECT**, **UPDATE** (Own school settings via RPC) | **SELECT** (Own school) | **SELECT** (Own school) |
| **profiles** | **SELECT** (`role = 'manager' OR id = auth.uid()`) | **SELECT** (Own school); Column-level grant: `GRANT UPDATE (full_name, language_pref)` only | **SELECT** (Self only), **UPDATE** (Self `full_name`, `language_pref`) | **SELECT** (Self only), **UPDATE** (Self `full_name`, `language_pref`) |
| **buses** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Assigned bus) | **SELECT** (Name/id of bus assigned to child's trip) |
| **bus_plates** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Assigned bus plate) | ❌ **DENY** |
| **routes** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Assigned routes) | **SELECT** (Child's assigned route) |
| **route_schedules** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Assigned route schedules) | **SELECT** (Child's route schedules) |
| **stops** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Assigned route stops) | **SELECT** (Child's route stops) |
| **students** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Students on active assigned trip) | **SELECT** (Own linked children) |
| **guardians** | ❌ **DENY** | **ALL** (Own school CRUD; audited; immutability trigger blocks re-pointing) | ❌ **DENY** | **SELECT** (Self links), **UPDATE** (`alert_radius_m` only) |
| **student_stops** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Stops on assigned route) | **SELECT** (Own child's stop mappings) |
| **bus_assignments** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | **SELECT** (Self active assignments) | ❌ **DENY** |
| **trips** | ❌ **DENY** | **SELECT** (Own school; direct writes blocked) | **SELECT** (Assigned trips; transitions via RPC) | **SELECT** (Trips carrying child) |
| **bus_locations_latest** | ❌ **DENY** | **SELECT** (Own school; direct writes blocked) | **SELECT** (Assigned bus; writes via RPC) | **SELECT** (Bus executing child's active trip) |
| **bus_location_history** | ❌ **DENY** | ❌ **DENY Direct** (Audited `get_trip_location_history()` only) | ❌ **DENY Direct** (Server ingest only) | ❌ **DENY Direct** |
| **absences** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | ❌ **DENY Direct** (`is_student_absent()` RPC only) | **SELECT**, **INSERT**, **DELETE** (Future/unstarted trips for own child) |
| **absence_reasons** | ❌ **DENY** | **ALL** (Own school CRUD; audited; `school_id` filled by DB) | ❌ **DENY** | **SELECT**, **INSERT** (Absences reported by self) |
| **alert_events** | ❌ **DENY** | **SELECT** (Own school; direct writes blocked) | ❌ **DENY Direct** | **SELECT** (Child alerts or trip alerts carrying child) |
| **push_subscriptions** | ❌ **DENY** | **ALL** (Self subscriptions) | **ALL** (Self subscriptions) | **ALL** (Self subscriptions) |
| **trip_summaries** | ❌ **DENY** | **SELECT** (Own school; direct writes blocked) | ❌ **DENY** | ❌ **DENY** |
| **audit_log** | ❌ **DENY** | **SELECT** (Own school; direct writes blocked; triggers write) | ❌ **DENY** | ❌ **DENY** |

---

## 2. Server Functions & RPC Access Matrix

| Function | Allowed Roles | Description & Restrictions |
| :--- | :--- | :--- |
| `get_school_health_metrics()` | **owner**, **manager** | Aggregated school system metrics via scalar subqueries (total_buses, total_routes, total_students, active_trips_today). Owner sees all schools; manager sees own school. |
| `get_trip_location_history(trip_id)`| **manager** | Audited location breadcrumbs for dispute resolution. Direct table access is blocked. Real schema columns. |
| `start_trip(trip_id)` | **driver** | Starts assigned trip. Direct UPDATE on `trips` is blocked. Transition to `in_progress`. Requires `trip_date = school_today`. |
| `end_trip(trip_id)` | **driver** (Contract Step 7) | Completes assigned trip, writes `trip_summaries`. Direct UPDATE on `trips` is blocked. |
| `cancel_trip(trip_id, reason)` | **manager**, **driver** (Contract Step 7) | Cancels scheduled trip. Emits alert event. |
| `report_delay(trip_id, minutes, note)`| **driver** (Contract Step 7) | Audited driver delay report. Dispatches delayed alert event. |
| `is_student_absent(student_id, date, direction)` | **driver**, **manager** | Drivers query attendance strictly for students assigned to their current trip. Returns boolean flag only (no medical reason). Unified generic `P0002` error if missing or other school. |
| `update_school_settings(...)` | **manager** | Updates settings for manager's own school with phone and `pg_timezone_names` validation; audited. |
| `cancel_absence_late(absence_id)` | **manager** (Contract Step 5) | Audited manager override to cancel an absence after trip start. |
| `purge_location_history()`| **manager** (audited) | Deletes location history of `completed`, `cancelled`, and stale `in_progress` trips before start of today (school-local date). Never touches today's active in_progress trips. |
| `app_security.purge_expired_location_history(p_hours)`| **service_role**, **postgres** | Deletes location history older than `p_hours` regardless of status. Writes single `SYSTEM_PURGE_EXPIRED_LOCATION_HISTORY` audit log. |
| `ingest_location(...)` | **driver** (active trip) | High-throughput telemetry ingest with coordinate bounds, accuracy, speed cap <= 140, freshness `[-10m, +5m]`. Drops out-of-order and jitter (<2s) pings. |
| `create_alert_event(...)` | **service_role**, **postgres** | 8 parameters matching alert_events check constraint. Internal caller guard blocks client callers (42501). |
| `create_school(...)` | **owner** (Contract Step 4) | Provisions new school tenant. |
| `provision_user(...)` | **service_role** only (Contract Step 4) | Edge Function for user signup, role assignment, and onboarding. |
| `reset_password(...)` | **service_role** only (Contract Step 4) | Edge Function for authenticated manager password resets. |

---

## 3. Realtime Broadcast Authorization Matrix

| Channel / Topic | Allowed Roles | Policy & Authorization Rule |
| :--- | :--- | :--- |
| `trip:<trip_id>` | **manager**, **parent** | Only allowed on `realtime.messages` with `extension = 'broadcast'` AND `realtime.topic() LIKE 'trip:%'`. UUID parsed via `app_security.safe_uuid(substring(topic FROM 6))`. Any other topic prefix denied. |
| `trip:<trip_id>` (Drivers) | ❌ **DENY** | Drivers send telemetry via HTTP RPC; drivers do not subscribe to realtime websockets. |
| `trip:<trip_id>` (Client INSERT) | ❌ **DENY ALL** | No client INSERT policy exists. Broadcasts are emitted strictly by PostgreSQL server triggers. |

---

## 4. Role Integrity & Immutability Triggers

- **User Lifecycle (`profiles.is_active`)**:
  - Setting `is_active = false` immediately locks out the user. `current_user_role()` and `current_user_school_id()` return `NULL`, causing all RLS policies to evaluate to false.
- **Immutability Triggers (BEFORE UPDATE)**:
  - `trg_profiles_immutable_fields`: Blocks direct client modifications to `profiles.role`, `profiles.school_id`, `profiles.id`, `profiles.phone` when caller is an end-user session (`auth.uid() IS NOT NULL`). Allows administrative/service_role provisioning when `auth.uid() IS NULL`. Raises 42501 `Immutable field violation`.
  - `trg_guardians_immutable_fields`: Blocks direct client modifications to `guardians.student_id`, `guardians.profile_id`, `guardians.school_id`. Raises 42501 `Immutable field violation`.
- **Role Invariant Triggers (BEFORE INSERT OR UPDATE)**:
  - `guardians.profile_id` MUST have role `'parent'`. (Rejects driver/manager/owner).
  - `bus_assignments.driver_profile_id` MUST have role `'driver'`.
  - `absences.reported_by` MUST have role `'parent'` or `'manager'`.
  - `trips.driver_profile_id` MUST have role `'driver'`.
- **Manager Automatic School Scoping & Audit Triggers**:
  - `trg_*_fill_school_id`: Enforces `NEW.school_id = app_security.current_user_school_id()`.
  - `trg_audit_manager_mutations`: Writes manager mutations to `audit_log`. For sensitive tables (`students`, `guardians`, `absence_reasons`), logs only metadata (`record_id`, `school_id`, `operation`, `changed_columns`) and never exposes `reason` or student row JSON. Normal tables keep full row JSON.
