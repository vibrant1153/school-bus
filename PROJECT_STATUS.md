# SchoolBus Connect - Project Status

## Current Phase
- **Phase 2/3: Supabase Foundation & Database Integration**
- **Current Task**: Step 3 - Row Level Security (RLS) Policy Design & Test Plan (Design phase; awaiting approval before writing migration).

---

## What Is Done
- **Phase 0: Planning & Product Architecture** (Approved).
- **Phase 1: UI & Prototype Screens** (Completed with mock/sample data):
  - Bilingual support (English & Amharic draft) with `I18nProvider` and language switcher.
  - Parent Home (`/home`): Status card (live, last seen, no trip), alert radius selection (200m/500m/1km), today's timeline, demo-state controls.
  - Parent Live Map (`/map`): Leaflet map, route polyline, stop markers, bus marker with stale status, alert radius circle.
  - Alerts Screen (`/alerts`): Sample alerts grouped by day, empty state toggle, bilingual alert text.
  - Driver Screen (`/driver`): Pre-trip readiness checklist (geolocation accuracy, screen wake lock, network status), Start/End trip flow, live elapsed timer, stale GPS warnings.
  - Manager Portal (`/manager`): Dashboard with trip monitoring, attention-needed alerts, setup health checklist, and prototype location history deletion card.
  - Manager Subpages (`/manager/students`, `/manager/buses`): Student search and filters, bus/route switching with morning/afternoon reversed stops.
  - PWA Configuration: `vite-plugin-pwa` manifest and service worker setup.
- **Phase 2 - Step 1: Supabase Setup & Client Connection** (Completed & Verified).
- **Phase 2 - Step 2: Core Schema, Review Fixes & Dev Seed** (Completed & Verified):
  - Core schema migration (`20261017000001_core_schema.sql`) applied to remote dev database (`debcrfoznffbcwmwporw`).
  - Schema review fixes (`20261018000001_schema_review_fixes.sql`) applied, confirming composite `ON DELETE SET NULL (column)` constraints, trigger function search path, phone regex, date handling, and filtering indexes.
  - Dev seed loaded (2 schools, 3 buses, 12 students) with environment safety guard restricting execution to dev only.
  - Hardened anon RLS verification (`scripts/check-rls-deny.js`) verified: all 18 tables return 0 rows on SELECT (with data present in DB), INSERT blocked with 42501, UPDATE affects 0 rows, and DELETE affects 0 rows.

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
3. 🟡 **Step 3 (Completed in PGlite & Awaiting Review)**:
   - Migration `20261019000001_rls_policies_and_security.sql` written with forward-only transactional DDL.
   - Sensitive columns relocated (`absence_reasons`, `bus_plates`) with zero data loss and clean seed execution.
   - Privilege hardening: default privileges altered, EXECUTE revoked from anon/PUBLIC across all functions.
   - Realtime broadcast policies secured with safe regex parsing for per-trip topics.
   - Comprehensive test suite (`scripts/test-pglite-rls.js`) passed with 12/12 suites green in PGlite.
   - Remote transaction verification suite (`scripts/remote-dev-transaction-suite.sql`) prepared with strict project ref guards.
   - Security function catalog (`docs/SECURITY_FUNCTIONS.md`) and matrix (`docs/SECURITY_MATRIX.md`) documented.
   - Awaiting user approval before remote `supabase db push`.
4. ⚪ **Step 4**: Real authentication & account provisioning Edge Function.
5. ⚪ **Step 5**: Parent screens on real data.
6. ⚪ **Step 6**: Manager screens on real data (including location history deletion & audit log).
7. ⚪ **Step 7**: Trips with database-enforced state transitions.
8. ⚪ **Step 8**: Ingest location function, live map, and stale handling.
9. ⚪ **Step 9**: Alert triggers, deduplication, in-app feed, and push notifications.
