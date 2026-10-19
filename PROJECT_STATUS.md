# SchoolBus Connect - Project Status

## Current Phase
- **Phase 2/3: Supabase Foundation & Database Integration**
- **Current Task**: Step 4 - Real authentication & account provisioning Edge Function.

---

## What Is Done
- **Phase 0: Planning & Product Architecture** (Approved).
- **Phase 1: UI & Prototype Screens** (Completed with mock/sample data).
- **Phase 2 - Step 1: Supabase Setup & Client Connection** (Completed & Verified).
- **Phase 2 - Step 2: Core Schema, Review Fixes & Dev Seed** (Completed & Verified).
- **Phase 2 - Step 3: Hardened RLS, Privilege Lockdown, Immutability Triggers, Manager Writes, and Realtime Authorization** (Completed & Verified on Remote Dev):
  - Applied migration `20261019000001_rls_policies_and_security.sql` to remote dev database (`debcrfoznffbcwmwporw`).
  - Schema reconciliation verified against real applied schema.
  - Sensitive columns relocated (`bus_plates`, `absence_reasons`) with full data preservation.
  - Privileges hardened: `REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC`.
  - Immutability triggers enforced on `profiles` (`role`, `school_id`, `id`, `phone`) and `guardians` (`student_id`, `profile_id`, `school_id`).
  - Manager writes active across 11 tables with database-enforced `school_id` assignment and automated audit logging to `audit_log`.
  - Decisions implemented: `app_security.school_today()`, coordinate sanity checks, revised `purge_location_history()`, timezone validation against `pg_timezone_names`, privacy isolation (parents/drivers see only own profile).
  - Realtime authorization policy deployed on `realtime.messages` with `extension = 'broadcast'` and safe UUID parser `app_security.safe_uuid(text)`.
  - Comprehensive PGlite test suite (`scripts/test-pglite-rls.js`) passed with 12/12 suites green.
  - Remote verification (`scripts/check-rls-deny.js`) verified: all 20 tables strictly enforce default-deny across SELECT, INSERT, UPDATE, and DELETE for anon.

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
4. ⚪ **Step 4**: Real authentication & account provisioning Edge Function.
5. ⚪ **Step 5**: Parent screens on real data.
6. ⚪ **Step 6**: Manager screens on real data (including location history deletion & audit log).
7. ⚪ **Step 7**: Trips with database-enforced state transitions.
8. ⚪ **Step 8**: Ingest location function, live map, and stale handling.
9. ⚪ **Step 9**: Alert triggers, deduplication, in-app feed, and push notifications.
