# SchoolBus Connect - Project Status

## Current Phase
- **Phase 2/3: Supabase Foundation & Database Integration**
- **Current Task**: Step 5 - Parent screens on real data (live tracking, child list, absence reporting).

---

## What Is Done
- **Phase 0: Planning & Product Architecture** (Approved).
- **Phase 1: UI & Prototype Screens** (Completed with mock/sample data).
- **Phase 2 - Step 1: Supabase Setup & Client Connection** (Completed & Verified).
- **Phase 2 - Step 2: Core Schema, Review Fixes & Dev Seed** (Completed & Verified).
- **Phase 2 - Step 3: Hardened RLS, Privilege Lockdown, Immutability Triggers, Manager Writes, and Realtime Authorization** (Completed & Verified in PGlite):
  - Forward-only migration `20261019000001_rls_policies_and_security.sql` fully reconciled and hardened against all review requirements (PGlite-verified, no push until approval).
  - Deactivated user protection: `can_cancel_absence` enforces `app_security.current_user_role()`; deactivated managers (`is_active = false`) and deactivated parents cannot cancel/delete absences.
  - Realtime safety: Section 8 avoids executing redundant `GRANT` statements on `realtime.messages` / `realtime` schema, wrapping policy creation in an exception block (`insufficient_privilege`) so hosted Supabase execution never aborts.
  - GPS Telemetry & Plausibility: `ingest_location` documents speed unit as meters per second (m/s; browser standard), caps speed at 45 m/s (~162 km/h), restricts freshness window to [-60s, +10s], enforces ~5s minimum interval between stored telemetry points, and rejects implausible jumps between consecutive points (>45 m/s delta + accuracy buffer).
  - Platform School Creation: Audited `public.create_school(name, code, timezone, phone)` RPC callable only by role `owner` with pg_timezone_names validation, code uniqueness, and audit_log record; Owner Dashboard wired to RPC.
  - Security Definer Privilege Integrity: Removed dead `current_user NOT IN (...)` checks from `create_alert_event` and `purge_expired_location_history`; functions are locked down via SQL privilege revocation (`REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT TO service_role`).
  - Search Path & Field Immutability: Added `SET search_path = ''` to `safe_uuid`; added trigger enforcement on `guardians` so only managers can mutate `is_primary` and `relationship`.
  - Comprehensive PGlite test suite (`scripts/test-pglite-rls.js`) passing with 14/14 suites green.

### pg_cron Setup & Purge Verification Guide
1. **Enable pg_cron Extension**:
   - In Supabase Dashboard: Navigate to **Database** -> **Extensions**, search for `pg_cron`, and toggle **Enable**.
   - Or via SQL Editor (if running with superuser privileges):
     ```sql
     CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
     ```
2. **Schedule the Daily Purge Job**:
   - Run in Supabase SQL Editor:
     ```sql
     SELECT cron.schedule(
       'purge-expired-location-history-daily',
       '0 2 * * *', -- Runs every day at 02:00 AM UTC
       $$SELECT app_security.purge_expired_location_history(72, 90);$$
     );
     ```
3. **Verify the Purge Job**:
   - Check registered job in `cron.job`:
     ```sql
     SELECT jobid, jobname, schedule, command, active
     FROM cron.job
     WHERE jobname = 'purge-expired-location-history-daily';
     ```
   - Check execution history and run status:
     ```sql
     SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
     FROM cron.job_run_details
     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'purge-expired-location-history-daily')
     ORDER BY start_time DESC
     LIMIT 10;
     ```

---

## Known Gaps & Untested Items
1. **No Backend Connection**: All screens currently use sample data (`prototype.js`, `managerData.js`).
2. **PWA Installability**: Previous temporary deployment showed shortcut only; requires DevTools manifest/installability audit under permanent HTTPS.
3. **Hardware Checks on Real Devices**: Geolocation and Screen Wake Lock require testing on actual Android phones under HTTPS.
4. **Route Protection**: `/driver` and `/manager` are currently publicly accessible.
5. **Map Tile Provider**: OpenStreetMap public tile server is for development only; production tile service needed before release.
6. **Amharic Copy**: Draft status; pending review by a native/fluent speaker.

---

## Build Order (Phase 2/3)
1. 🟢 **Step 1 (Done)**: Create Supabase project (dev), set up `.env`, connect client, verify connection.
2. 🟢 **Step 2 (Done & Verified)**: Core tables and review fixes applied, seeded with fake data, composite foreign keys fixed, RLS default-deny verified across SELECT/INSERT/UPDATE/DELETE.
3. 🟢 **Step 3 (Done & Verified on Remote Dev)**:
   - Migration `20261019000001_rls_policies_and_security.sql` applied successfully to remote dev database.
   - All 20 tables verified with hardened RLS and privilege revocation.
   - PGlite test suite (12/12 passing) and remote verification suite (20/20 passing).
4. 🟢 **Step 4 (Done & Verified)**: Real authentication, account provisioning Edge Function, role guards, and owner dashboard.
5. 🟢 **Step 5 (Done & Verified)**: Parent screens on real data (live tracking, multi-child support, Haversine distance, 60s staleness detection, radius preference updates, absence reporting & cancellation, alert events feed, and demo preview switcher).
6. 🟢 **Step 6 (Done & Verified)**: Manager screens on real data (School Office settings & contact phone updating, student roster with add student modal, bus fleet with license plates & add bus modal, setup health, and audited location history purge).
7. ⚪ **Step 7**: Trips with database-enforced state transitions.
8. ⚪ **Step 8**: Ingest location function, live map, and stale handling.
9. ⚪ **Step 9**: Alert triggers, deduplication, in-app feed, and push notifications.
