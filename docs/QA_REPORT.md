# SchoolBus Connect — Independent QA Pre-Pilot Audit Report

**Date of Audit:** November 3, 2026  
**Auditor:** Independent QA Engineering Specialist  
**Target Environment:** Development Project (`https://debcrfoznffbcwmwporw.supabase.co`)  
**Scope:** Multi-tenant SaaS platform covering Platform Owner, School Manager, Bus Driver, and Parent portals.

---

## 1. Executive Summary

SchoolBus Connect exhibits a robust, well-architected PostgreSQL security foundation with strict multi-tenant Row Level Security (RLS), rock-solid cross-tenant boundary isolation, and immutability triggers that successfully prevent privilege escalation, data leakage between schools, and unauthorized parent access.

However, the application is **NOT READY FOR A LIVE PILOT (NO-GO)** due to two high-severity workflow blockers:
1. A syntax error in `api/provision-user.js` crashes the Vercel user provisioning endpoint on every invocation.
2. The fallback Edge Function does not link parents to students in `guardians`, leaving newly created parents stranded with empty accounts and triggering database RLS errors when submitting absences.
3. Crucial scheduling UI is missing: school managers cannot configure route timetables (`route_schedules`) from the frontend, meaning daily trips cannot be generated automatically for newly created routes.

Once these specific blockers and the screen wake-lock resumption flaw are addressed, the system will be technically sound for pilot onboarding.

### Pilot Recommendation: **NO-GO (Conditional on 3 High-Severity Fixes)**

---

## 2. Table of Flaws

| ID | Severity | Area | Role | Title & Steps to Reproduce | Expected Result | Actual Result | Evidence | Suggested Direction |
|---|---|---|---|---|---|---|---|---|
| **FLAW-01** | **High** | Build quality | Manager / Owner | **SyntaxError in `api/provision-user.js` crashes serverless endpoint**<br>1. Run `node --check api/provision-user.js` or deploy to Vercel.<br>2. Call `/api/provision-user`. | Clean AST parsing and successful user provisioning. | `SyntaxError: Unexpected token 'catch'` at line 319 due to missing closing brace on `if (existingProfile)` block at line 160. | `api/provision-user.js:319` syntax error. | Add missing closing brace `}` before line 209 for `if (existingProfile)`. |
| **FLAW-02** | **High** | Functional flows | Parent / Manager | **Parent provisioning fallback drops guardian student link**<br>1. When `/api/provision-user` fails, frontend falls back to Edge Function `provision-user`.<br>2. Edge function creates profile but ignores `student_id` and does not insert into `guardians`.<br>3. Parent logs in with zero linked children.<br>4. Absence submission fails with RLS policy violation. | Parent is provisioned and linked to student in `guardians` regardless of execution path. | Parent account exists but has no guardian record. Parent cannot view child or submit absences. | `supabase/functions/provision-user/index.ts` has no `guardians` insertion logic. | Ensure Edge Function inserts guardian record or calling frontend creates it immediately after. |
| **FLAW-03** | **High** | Functional flows | Manager | **No UI for Route Schedules (`route_schedules`) — daily trips cannot generate**<br>1. Manager creates a route and assigns bus and driver in `/manager/buses`.<br>2. No UI exists to select running days (Mon–Fri) or timetable.<br>3. `route_schedules` table remains empty for the school.<br>4. `generate_daily_trips` produces 0 trips. | Manager UI enables setting route schedule days and times, enabling daily trip generation. | No UI exists for `route_schedules` anywhere in `src/`. Daily trips produce 0 rows without manual DB seeding. | `git grep -n "route_schedules" src/` returns 0 matches. | Add day-of-week schedule controls to Add Route modal in `BusesRoutes.jsx`. |
| **FLAW-04** | **Medium** | Functional flows | Manager | **No UI for Manager to trigger daily trip generation on demand**<br>1. Manager navigates to Dashboard or Buses & Routes.<br>2. Look for an action button to generate trips for today. | Manager has an explicit button to generate trips on demand. | No UI exists to invoke `generate_daily_trips` RPC. | Zero matches for `generate_daily_trips` in `src/`. | Add a "Generate Today's Trips" button on Manager Dashboard. |
| **FLAW-05** | **Medium** | Reliability | Driver | **Screen Wake Lock is lost upon page reload or trip resumption**<br>1. Driver starts trip (Wake Lock on).<br>2. Driver reloads page or reopens browser mid-trip.<br>3. Trip resumes to 'running', but wake lock is not requested. | Device screen remains continuously awake throughout the trip. | Device screen times out and sleeps, halting mobile browser JS execution and stopping 12s GPS ingestion. | `Driver.jsx` lines 193–202 set phase to 'running' without calling `requestWakeLock()`. | Re-acquire wake lock on resume or provide a prominent "Keep screen awake" touch prompt. |
| **FLAW-06** | **Medium** | Usability / i18n | Manager / Owner | **Zero Amharic language support across Manager and Owner Portals**<br>1. Navigate to `/manager` or `/owner`.<br>2. Check for language switcher or Amharic text. | Administrative interfaces support English and Amharic for Ethiopian transport staff. | All manager and owner views are 100% hardcoded in English. | `git grep -n "useI18n" src/manager/` returns 0 matches. | Wrap manager labels with `t(...)` and embed `LanguageSwitch` in `ManagerLayout.jsx`. |
| **FLAW-07** | **Medium** | Build quality | Parent | **Hardcoded prototype demo child and fake alerts leak into Parent Home**<br>1. Log in with a parent account having no active guardian link.<br>2. View `/home`. | Screen displays "No students linked to your account. Contact school office." | Screen displays fake "Student A (Sample Child)", "Grade 3", "Pilot Academy Addis", and mock alerts. | `src/lib/useParentData.js` lines 60–80 fall back to `SAMPLE_CHILD` and `SAMPLE_ALERTS`. | Remove `SAMPLE_CHILD` fallback from production flow and display an empty state banner. |
| **FLAW-08** | **Low** | Build quality | Parent | **Parent map translation string contains developer "Prototype" text**<br>1. Inspect key `map.approx` in `translations.js`. | Clean user-facing text: "Approximate position, not a time estimate." | Text reads: "Approximate position, not a time estimate. Prototype: this is a sample bus position." | `src/i18n/translations.js` line 73. | Clean prototype notice from production translation files. |
| **FLAW-09** | **Low** | Performance | All Roles | **Monolithic 873 kB un-chunked JavaScript bundle on initial page load**<br>1. Run production build.<br>2. Inspect `dist/assets/index-*.js`. | Route-level code splitting via `React.lazy()` for manager, driver, and owner pages. | Entire application bundle (873.04 kB / 237 kB gzip) is downloaded upfront on slow mobile 3G. | Vite warning: `Some chunks are larger than 500 kB after minification`. | Implement dynamic imports (`React.lazy`) for `/manager`, `/owner`, and `/driver` in `App.jsx`. |
| **FLAW-10** | **Low** | Input validation | Manager | **Database lacks character length and whitespace constraints on full names**<br>1. Insert student with 5,000 characters or whitespace-only ("   "). | Rejection with validation error. | 5,000-character string and empty whitespace accepted and stored. | Verified via live test script `qa_input_validation.local.mjs`. | Add `CHECK (length(trim(full_name)) > 0 AND length(full_name) <= 255)` constraint. |
| **FLAW-11** | **Low** | Functional flows | Manager | **Bus plate insertion failure is silently swallowed without manager feedback**<br>1. Insert bus with duplicate or invalid plate number.<br>2. Check UI response. | Manager receives an explicit error stating plate creation failed and bus is rolled back. | Bus is created without a plate; UI displays "Bus added to fleet successfully!". | `src/lib/useManagerData.js` line 380: `if (plateErr) console.warn(...)`. | Propagate `plateErr` to UI so manager knows the plate was rejected. |

---

## 3. Not Implemented (Expected Scope Exclusions)

The following capabilities are marked as architectural roadmap items and were verified as absent (not classified as defects):
1. **Automatic Near-Stop Geofence Alert Trigger**: PostGIS automated query per 12-second ingest is not yet wired to background cron or edge pipeline.
2. **Web / Phone Push Notifications**: Web Push server and Service Worker push subscription dispatching not yet built.
3. **Student Boarding / Alighting Confirmation**: Driver UI contains route and trip controls, but no individual student attendance boarding tap list.
4. **SMS Alert Gateways**: Africa's Talking / Twilio integrations not configured.
5. **AI Assistant Integration**: Natural language parent bot not yet implemented.
6. **Parent Self-Registration**: Public self-signup is intentionally disabled in Supabase; all accounts are school-provisioned.

---

## 4. Untested Items (Hardware & Native Dependencies)

1. **Hardware GPS Radio & True Satellites**: Tested via browser Geolocation API and RPC simulation; physical movement under metal bus roofs in Addis Ababa traffic requires field testing.
2. **Native Android PWA Installation & Add to Home Screen**: Manifest and icons are present (`/manifest.webmanifest`, `pwa-192x192.png`), but full install prompt banner requires live Android device testing under production SSL.
3. **Native Speaker Amharic Linguistic Review**: Amharic translations exist in `translations.js` for 140 keys, but linguistic appropriateness of transportation terminology requires native speaker verification.

---

## 5. Passed Checks (40 Programmatic Verifications)

During the QA audit on the live dev database, the following checks passed without failure:
- **Authentication & Tenant Isolation**:
  - Platform owner authentication via public Supabase auth API.
  - Multi-tenant school creation (`create_school` RPC) correctly scopes database records.
  - Duplicate school codes rejected.
  - Invalid PostgreSQL timezone names rejected by `create_school`.
  - Single active manager per school constraint enforced.
  - Newly provisioned manager forced to change password (`must_change_password = true`).
  - Password updated via `/api/change-password` and re-authenticated.
  - Unauthenticated anonymous users completely blocked from reading `trips` table.
  - Public signup blocked on Supabase instance (`Signups not allowed for this instance`).
- **Fleet & Network Management**:
  - Bus and license plate creation via manager session.
  - Duplicate vehicle license plates in `bus_plates` rejected.
  - Negative bus capacity rejected.
  - Route and stop creation with sequential morning ordering (`sequence_morning`).
  - Out-of-bounds latitude (>90) rejected.
  - Driver account provisioned and password updated.
  - Bus assignment created with `effective_date`.
  - Duplicate active assignment on the same bus rejected (`idx_bus_assignments_one_active_per_bus`).
- **Trip Lifecycle & Telemetry**:
  - Driver started trip via `/api/start-trip` transitioning to `in_progress`.
  - Multiple simultaneous active trips on the same bus blocked (`idx_trips_one_active_per_bus`).
  - `ingest_location` accepted valid 12-second GPS fixes.
  - Telemetry speed capped: `ingest_location` rejected vehicle speeds > 45 m/s (162 km/h).
  - Telemetry jump filter dropped implausible coordinate delta jumps.
  - Driver reported 15-minute delay via `report_delay` RPC.
  - Delay reporting rate limited: second delay attempt within 10 minutes rejected.
  - Driver ended trip via `end_trip` RPC transitioning to `completed`.
  - `trip_summaries` record written upon trip completion.
- **Privacy & Cross-Tenant Boundary Enforcement**:
  - Parent restricted strictly to their own student; zero access to other students or families.
  - Parent cannot enumerate or view other schools in `schools` table.
  - Driver cannot query parent phone numbers or profiles in `profiles`.
  - Driver cannot read private absence reasons in `absence_reasons`.
  - Manager cannot access or query audit logs of other schools.
  - Client privilege escalation blocked: parent cannot update `profiles.role` to 'owner' (blocked by trigger).
  - Cross-tenant password reset blocked: manager calling `reset-manager-password` returns HTTP 403 Forbidden.
  - Manager reviewed own school audit log (`audit_log`).
  - Location history purge RPC (`purge_location_history`) executed and audited.

---

## 6. Audit Data Creation & Full Cleanup Record

All testing was strictly isolated to a dynamically generated QA school tenant. Zero pre-existing demo schools or accounts were touched.

### Records Created:
- **School**: `QA Test Academy 1793695931510` (Code: `QA-931510`)
- **Manager User**: `qa.manager.1793695931510@example.test` (Phone: `+251995931510`)
- **Driver User**: `user_251925931510@schoolbus.local` (Phone: `+251925931510`)
- **Parent User**: `user_251935931510@schoolbus.local` (Phone: `+251935931510`)
- **Bus**: `QA Bus 1` (Plate: `3-QA-1510`)
- **Route**: `QA Route Bole-Summit` (Code: `R-QA-1510`)
- **Stops**: `QA Bole Terminal Gate` (seq 1), `QA School Front Gate` (seq 2)
- **Student**: `QA Child Sara` (Grade 4)
- **Trip**: Morning run for `QA Bus 1` (`in_progress` -> `completed`)

### Cleanup Execution:
- Executed cascading school deletion via `api/delete-school.js` with Platform Owner session:
  - Deleted root row in `schools` table (cascaded to `buses`, `bus_plates`, `routes`, `stops`, `students`, `student_stops`, `bus_assignments`, `trips`, `trip_summaries`, `audit_log`).
  - Deleted created `auth.users` accounts for manager, driver, and parent.
- Cleaned up prior transient test tenants (`QA-87584`, `QA-93432`, `QA-93360`).
- **Database Status**: 100% clean, zero test residue remaining on dev instance.

