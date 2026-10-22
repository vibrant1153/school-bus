# SchoolBus Connect — Security Functions Catalog

This document defines the formal contract for every PostgreSQL database function (RPC), trigger function, and Edge Function across the SchoolBus Connect platform.

---

## 1. Security Architecture & Invariants

Every server-side function enforces the following non-negotiable security principles:
1. **Search Path Isolation:** Every function is declared with `SET search_path = ''`. All internal schema objects are explicitly qualified (e.g., `public.trips`, `app_security.current_user_role()`).
2. **Defensive Role Evaluation:** Role checks use `(SELECT app_security.current_user_role()) IS DISTINCT FROM '<role>'`. Any caller lacking an active profile record (`is_active = true`) evaluates to `NULL` and is immediately rejected with SQLSTATE `42501` (`insufficient_privilege`).
3. **Privilege Revocation:** Default execution privileges are revoked from `PUBLIC` and `anon`. Functions are callable strictly by designated roles (`authenticated` or `service_role`).
4. **Input Validation:** Strict type checking, nullability guards, range boundaries, and international regex validation.
5. **Multi-Tenant Boundaries:** Every query filters or asserts `school_id = (SELECT app_security.current_user_school_id())`.
6. **Audit Trail & Privacy:** High-privilege operations write an immutable event to `public.audit_log`. For sensitive tables (`students`, `guardians`, `absence_reasons`), triggers log only metadata (`record_id`, `school_id`, `operation`, `changed_columns`) and never store `absence_reasons.reason` or student row JSON.

---

## 2. Server Functions & RPCs Catalog

| Function Name | Implementation Phase | Allowed Role(s) | Inputs & Signature | Input Validation Rules | Audited (Yes/No) | Target Writes / Side Effects |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **`is_student_absent`** | Built (Step 3) | `driver`, `manager` | `(p_student_id uuid, p_trip_date date, p_direction text)` | Non-null; direction in `('morning', 'afternoon', 'both')`; student in caller's school; returns unified generic `P0002` error (`Student not found`) if missing or in another school; for `driver`, verifies student is scheduled on driver's assigned trip | **No** | None (Read-only `STABLE` function; returns `boolean`). Does NOT expose personal/medical reasons. |
| **`get_trip_location_history`** | Built (Step 3) | `manager` | `(p_trip_id uuid)` | Non-null; trip exists within caller's `school_id` | **Yes** | Appends `SELECT_LOCATION_HISTORY` to `public.audit_log`. Returns real schema columns (`out_lat`, `out_lng`, `out_speed`, `out_heading`, `out_accuracy`, `out_recorded_at`). |
| **`update_school_settings`** | Built (Step 3) | `manager` | `(p_name text, p_timezone text, p_contact_phone text)` | `p_name` at least 2 chars; valid IANA timezone checked against `pg_timezone_names`; E.164 phone format | **Yes** | Updates `public.schools` row; appends `UPDATE_SCHOOL_SETTINGS` to `public.audit_log`. |
| **`get_school_health_metrics`** | Built (Step 3) | `owner`, `manager` | `()` | No parameters | **No** | Evaluated via efficient scalar subqueries per school (`total_buses`, `total_routes`, `total_students`, `active_trips_today`). Owner sees all schools; manager sees own school. Zero PII. |
| **`start_trip`** | Built (Step 3) | `driver` | `(p_trip_id uuid)` | Non-null; trip assigned to caller, status is `scheduled`, requires `trip_date = app_security.school_today(v_trip.school_id)` (otherwise raises 22000) | **No** | Updates `public.trips.status = 'in_progress'`, `started_at = now()`, `driver_profile_id = auth.uid()`. |
| **`ingest_location`** | Built (Step 3) | `driver` | `(p_trip_id uuid, p_lat double precision, p_lng double precision, p_heading double precision, p_speed double precision, p_accuracy double precision, p_recorded_at timestamptz)` | Coordinates within `[-90, 90]`, `[-180, 180]`; `accuracy >= 0 and <= 500`; freshness window `[-10 min, +5 min]`; speed cap `<= 140 km/h`; NULL `lat/lng/accuracy/recorded_at` rejected with 22023. Silently drops out-of-order pings (`recorded_at <= latest`) and jitter floods (< 2s from last stored point) | **No** | Upserts `public.bus_locations_latest`; appends to `public.bus_location_history`. |
| **`purge_location_history`**| Built (Step 3) | `manager` | `()` | Caller is manager | **Yes** | Deletes location history of `completed`, `cancelled`, and stale `in_progress` trips prior to start of today in school timezone. Never touches a currently active trip from today. Writes `PURGE_LOCATION_HISTORY` to `audit_log`. |
| **`app_security.purge_expired_location_history`**| Built (Step 3) | `service_role`, `postgres` | `(p_hours integer DEFAULT 72, p_summary_days integer DEFAULT 90)` | Internal maintenance; rejected (42501) if called by client | **Yes** | Deletes breadcrumbs older than `p_hours` (default 72h / 3 days) and trip summaries older than `p_summary_days` (default 90 days). Writes single `SYSTEM_PURGE_EXPIRED_LOCATION_HISTORY` row to `audit_log`. |
| **`create_alert_event`** | Built (Step 3) | Server / Service Role | `(p_school_id uuid, p_trip_id uuid, p_student_id uuid, p_stop_id uuid, p_event_type text, p_dedupe_key text, p_payload jsonb DEFAULT '{}', p_radius_meters integer DEFAULT NULL)` | `p_event_type` IN `('tripStarted', 'nearStop', 'delayed', 'tripCompleted', 'tripCancelled')`; `p_radius_meters` IN `(200, 500, 1000)`; internal guard blocks client callers (42501) | **No** | Inserts `public.alert_events` with `ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING`. |
| **`end_trip`** | Contract (Step 7) | `driver` | `(p_trip_id uuid)` | Trip is `in_progress` and assigned to caller | **Yes** | Updates `trips.status = 'completed'`, `ended_at = now()`; triggers calculation of `trip_summaries` (kept 90 days). |
| **`cancel_trip`** | Contract (Step 7) | `manager`, `driver` | `(p_trip_id uuid, p_reason text)` | Trip not completed; reason non-empty | **Yes** | Updates `trips.status = 'cancelled'`; generates `alert_events` (`event_type = 'tripCancelled'`); writes to `audit_log`. |
| **`report_delay`** | Contract (Step 7) | `driver`, `manager` | `(p_trip_id uuid, p_delay_minutes int, p_reason text)` | `delay_minutes > 0`; trip active | **Yes** | Inserts `alert_events` (`event_type = 'delayed'`); writes to `audit_log`. |
| **`cancel_absence_late`** | Contract (Step 5) | `manager` | `(p_absence_id uuid, p_override_reason text)` | Absence exists in school; trip already started or past date | **Yes** | Deletes/updates `absences`; logs override to `audit_log`. |
| **`create_school`** | Contract (Step 4) | `owner` | `(p_name text, p_code text, p_timezone text, p_contact_phone text)` | Unique code; valid timezone | **Yes** | Inserts `public.schools`; logs to `audit_log`. |
| **`provision_user`** | Contract (Step 4) | `service_role` (Edge Function) | `(p_email text, p_phone text, p_role text, p_school_id uuid, p_full_name text)` | Valid phone E.164, valid role enum, school exists | **Yes** | Creates `auth.users`, creates `public.profiles`, logs to `audit_log`. |
| **`reset_password`** | Contract (Step 4) | `service_role` (Edge Function) | `(p_target_profile_id uuid)` | Profile exists in manager's school | **Yes** | Dispatches reset email/SMS, logs manager action to `audit_log`. |

---

## 3. Automated Retention Schedule Example (pg_cron)

In production or hosted Supabase environments with `pg_cron` available, automated telemetry retention is scheduled via `app_security.purge_expired_location_history(72, 90)`:

```sql
-- Automated 3-day purge job (registered conditionally if pg_cron is available):
-- SELECT cron.schedule(
--     'purge-location-history-3-days',
--     '0 3 * * *', -- Daily at 03:00 AM UTC
--     'SELECT app_security.purge_expired_location_history(72, 90);'
-- );
```

---

## 4. Private Security Helpers (`app_security` Schema)

These functions are strictly internal to the database. They are housed in schema `app_security` and are never exposed to HTTP / PostgREST:

| Helper Function | Scope | Logic |
| :--- | :--- | :--- |
| **`app_security.current_user_role()`** | Internal | Returns `role` from `public.profiles` for `(SELECT auth.uid())` WHERE `is_active = true`. Returns `NULL` if user has no profile or profile is deactivated. |
| **`app_security.current_user_school_id()`** | Internal | Returns `school_id` from `public.profiles` for `(SELECT auth.uid())` WHERE `is_active = true`. Returns `NULL` if deactivated. |
| **`app_security.school_today(p_school_id uuid)`** | Internal | Returns local calendar date `date` for the given school based on its `schools.timezone`. |
| **`app_security.parent_has_child_on_trip(p_trip_id uuid)`** | Internal | Evaluates `(SELECT auth.uid())`. Checks if caller guards any student assigned to the stop/route/direction matching `p_trip_id`. |
| **`app_security.parent_can_access_stop(p_stop_id uuid)`** | Internal (Breaks recursion) | Security definer check verifying if caller guards a student assigned to the stop via `student_stops`. |
| **`app_security.driver_can_access_stop(p_route_id uuid)`** | Internal (Breaks recursion) | Security definer check verifying if caller is a driver assigned to `p_route_id`. |
| **`app_security.driver_can_access_student_stop(p_stop_id uuid)`** | Internal (Breaks recursion) | Security definer check verifying if caller is a driver assigned to the route containing `p_stop_id`. |
| **`app_security.can_cancel_absence(p_absence_id uuid)`** | Internal | Evaluates `(SELECT auth.uid())`. For `both` direction, verifies **neither** morning nor afternoon trip has started. |
| **`app_security.safe_uuid(p_text text)`** | Internal | Safely casts text matching UUID regex pattern to `uuid`, returning `NULL` on mismatch to prevent planner casting errors. |

---

## 5. Trigger Invariants Catalog

| Trigger Name | Target Table | Trigger Timing | Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `trg_profiles_immutable_fields` | `profiles` | `BEFORE UPDATE` | Blocks direct updates to `role`, `school_id`, `id`, `phone` when caller is an end-user session (`auth.uid() IS NOT NULL`). Allows administrative/service_role provisioning when `auth.uid() IS NULL`. Raises 42501 `Immutable field violation`. |
| `trg_guardians_immutable_fields` | `guardians` | `BEFORE UPDATE` | Blocks direct updates to `student_id`, `profile_id`, `school_id`. Raises 42501 `Immutable field violation`. |
| `trg_guardians_role_check` | `guardians` | `BEFORE INSERT OR UPDATE` | `NEW.profile_id` must belong to an active profile with `role = 'parent'` in the same `school_id`. |
| `trg_bus_assignments_driver_role_check` | `bus_assignments` | `BEFORE INSERT OR UPDATE` | `NEW.driver_profile_id` (if not null) must belong to an active profile with `role = 'driver'` in the same `school_id`. |
| `trg_trips_driver_role_check` | `trips` | `BEFORE INSERT OR UPDATE` | `NEW.driver_profile_id` (if not null) must belong to an active profile with `role = 'driver'` in the same `school_id`. |
| `trg_absences_reported_by_role_check` | `absences` | `BEFORE INSERT OR UPDATE` | `NEW.reported_by` must belong to an active profile with `role IN ('parent', 'manager')`. |
| `trg_*_fill_school_id` | 11 Managed Tables | `BEFORE INSERT` | Enforces `NEW.school_id = app_security.current_user_school_id()`. |
| `trg_audit_manager_mutations` | 11 Managed Tables | `AFTER INSERT OR UPDATE OR DELETE` | Writes audited mutation to `audit_log`. For sensitive tables (`students`, `guardians`, `absence_reasons`), logs only metadata (`record_id`, `school_id`, `operation`, `changed_columns`) and never exposes `reason` or student row JSON. |
