# SchoolBus Connect — Security Functions Catalog

This document defines the formal contract for every PostgreSQL database function (RPC), trigger function, and Edge Function across the SchoolBus Connect platform.

---

## 1. Security Architecture & Invariants

Every server-side function enforces the following non-negotiable security principles:
1. **Search Path Isolation:** Every function is declared with `SET search_path = ''`. All internal schema objects are explicitly qualified (e.g., `public.trips`, `app_security.current_user_role()`).
2. **Defensive Role Evaluation:** Role checks use `(SELECT app_security.current_user_role()) IS DISTINCT FROM '<role>'`. Any caller lacking an active profile record evaluates to `NULL` and is immediately rejected with SQLSTATE `42501` (`insufficient_privilege`).
3. **Privilege Revocation:** Default execution privileges are revoked from `PUBLIC` and `anon`. Functions are callable strictly by designated roles (`authenticated` or `service_role`).
4. **Input Validation:** Strict type checking, nullability guards, range boundaries, and international regex validation.
5. **Multi-Tenant Boundaries:** Every query filters or asserts `school_id = (SELECT app_security.current_user_school_id())`.
6. **Audit Trail:** High-privilege operations write an immutable event to `public.audit_log` before completing.

---

## 2. Server Functions & RPCs Catalog

| Function Name | Implementation Phase | Allowed Role(s) | Inputs & Signature | Input Validation Rules | Audited (Yes/No) | Target Writes / Side Effects |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **`is_student_absent`** | Step 3 (Implemented) | `driver`, `manager` | `(p_student_id uuid, p_trip_date date, p_direction text)` | Non-null; direction in `('morning', 'afternoon')`; student in caller's school; for `driver`, verifies student is scheduled on driver's assigned trip | **No** | None (Read-only `STABLE` function; returns `boolean`). Does NOT expose personal/medical reasons. |
| **`get_trip_location_history`** | Step 3 (Implemented) | `manager` | `(p_trip_id uuid)` | Non-null; trip exists within caller's `school_id` | **Yes** | Appends `SELECT_LOCATION_HISTORY` to `public.audit_log`. Returns location points. |
| **`update_school_settings`** | Step 3 (Implemented) | `manager` | `(p_name text, p_timezone text, p_contact_phone text)` | `p_name` non-empty; valid IANA timezone; E.164 phone format | **Yes** | Updates `public.schools` row; appends `UPDATE_SCHOOL_SETTINGS` to `public.audit_log`. |
| **`get_school_health_metrics`** | Step 3 (Implemented) | `owner` | `()` | No parameters | **No** | None (Aggregated counts only: total schools, buses, trips). Zero student PII exposed. |
| **`start_trip`** | Step 3 (Implemented) | `driver` | `(p_trip_id uuid)` | Non-null; trip belongs to caller, current date, status is `scheduled` | **No** | Updates `public.trips.status = 'in_progress'` and `started_at = now()`. |
| **`ingest_location`** | Step 3 (Implemented) | `driver` | `(p_trip_id uuid, p_lat float8, p_lng float8, p_heading float8, p_speed float8, p_accuracy float8, p_recorded_at timestamptz)` | Coordinates within `[-90, 90]`, `[-180, 180]`; `accuracy >= 0`; active trip in progress assigned to caller | **No** | Upserts `public.bus_locations_latest`; appends to `public.bus_location_history`. |
| **`end_trip`** | Step 7 (To be built) | `driver` | `(p_trip_id uuid)` | Trip is `in_progress` and assigned to caller | **Yes** | Updates `trips.status = 'completed'`, `ended_at = now()`; triggers calculation of `trip_summaries`. |
| **`cancel_trip`** | Step 7 (To be built) | `manager`, `driver` | `(p_trip_id uuid, p_reason text)` | Trip not completed; reason non-empty | **Yes** | Updates `trips.status = 'cancelled'`; generates `alert_events` (`event_type = 'tripCancelled'`); writes to `audit_log`. |
| **`report_delay`** | Step 7 (To be built) | `driver`, `manager` | `(p_trip_id uuid, p_delay_minutes int, p_reason text)` | `delay_minutes > 0`; trip active | **Yes** | Inserts `alert_events` (`event_type = 'delayed'`); writes to `audit_log`. |
| **`purge_location_history`**| Step 6 (To be built) | `manager` | `(p_before_date timestamptz)` | `p_before_date < now() - interval '30 days'` | **Yes** | Deletes rows from `bus_location_history` for caller's school; logs row count to `audit_log`. |
| **`cancel_absence_late`** | Step 5 (To be built) | `manager` | `(p_absence_id uuid, p_override_reason text)` | Absence exists in school; trip already started or past date | **Yes** | Deletes/updates `absences`; logs override to `audit_log`. |
| **`create_school`** | Step 4 (To be built) | `owner` | `(p_name text, p_code text, p_timezone text)` | Unique code; valid timezone | **Yes** | Inserts `public.schools`; logs to `audit_log`. |
| **`create_alert_event`** | Step 9 (To be built) | Server / Trigger | `(p_trip_id uuid, p_student_id uuid, p_stop_id uuid, p_event_type text, p_dedupe_key text, p_payload jsonb)` | Valid event type; dedupe uniqueness | **No** | Inserts `public.alert_events`; notifies realtime subscribers. |
| **`provision_user`** | Step 4 (To be built) | `service_role` (Edge Function) | `(p_email text, p_phone text, p_role text, p_school_id uuid, p_full_name text)` | Valid phone E.164, valid role enum, school exists | **Yes** | Creates `auth.users`, creates `public.profiles`, logs to `audit_log`. |
| **`reset_password`** | Step 4 (To be built) | `service_role` (Edge Function) | `(p_target_profile_id uuid)` | Profile exists in manager's school | **Yes** | Dispatches reset email/SMS, logs manager action to `audit_log`. |

---

## 3. Private Security Helpers (`app_security` Schema)

These functions are strictly internal to the database. They are housed in schema `app_security` and are never exposed to HTTP / PostgREST:

| Helper Function | Scope | Logic |
| :--- | :--- | :--- |
| **`app_security.current_user_role()`** | Internal | Returns `role` from `public.profiles` for `(SELECT auth.uid())`. Returns `NULL` if user has no profile. |
| **`app_security.current_user_school_id()`** | Internal | Returns `school_id` from `public.profiles` for `(SELECT auth.uid())`. |
| **`app_security.parent_has_child_on_trip(p_trip_id uuid)`** | Internal | Evaluates `(SELECT auth.uid())`. Checks if caller guards any student assigned to the stop/route/direction matching `p_trip_id`. |
| **`app_security.can_cancel_absence(p_absence_id uuid)`** | Internal | Evaluates `(SELECT auth.uid())`. For `both` direction, verifies **neither** morning nor afternoon trip has started. |

---

## 4. Trigger Invariants Catalog

| Trigger Name | Target Table | Trigger Timing | Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `trg_guardians_role_check` | `guardians` | `BEFORE INSERT OR UPDATE` | `NEW.profile_id` must belong to an active profile with `role = 'parent'` in the same `school_id`. |
| `trg_bus_assignments_driver_role_check` | `bus_assignments` | `BEFORE INSERT OR UPDATE` | `NEW.driver_profile_id` (if not null) must belong to an active profile with `role = 'driver'` in the same `school_id`. |
| `trg_trips_driver_role_check` | `trips` | `BEFORE INSERT OR UPDATE` | `NEW.driver_profile_id` (if not null) must belong to an active profile with `role = 'driver'` in the same `school_id`. |
| `trg_profiles_role_protect` | `profiles` | `BEFORE UPDATE OF role` | Modifying `role` column directly is forbidden for all callers except platform `owner`. |
