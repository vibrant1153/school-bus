import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function test() {
  const db = new PGlite()

  // Base schema mocks for migration prerequisites
  await db.exec(`
    DO $$ BEGIN
      CREATE ROLE authenticated;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE ROLE service_role;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS app_security;
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE schools (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      school_id uuid REFERENCES schools(id),
      role text,
      full_name text,
      phone text,
      language_pref text DEFAULT 'en'
    );
    CREATE TABLE students (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid REFERENCES schools(id),
      full_name text NOT NULL,
      grade integer,
      is_active boolean DEFAULT true
    );
    CREATE TABLE guardians (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid REFERENCES schools(id),
      student_id uuid REFERENCES students(id),
      profile_id uuid REFERENCES profiles(id),
      relationship text DEFAULT 'parent',
      is_primary boolean DEFAULT true,
      alert_radius_m integer DEFAULT 500,
      CONSTRAINT uq_guardians_s_p UNIQUE(student_id, profile_id)
    );

    CREATE OR REPLACE FUNCTION app_security.current_user_role() RETURNS text LANGUAGE sql AS $$ SELECT 'manager'::text $$;
    CREATE OR REPLACE FUNCTION app_security.current_user_school_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000002'::uuid $$;
  `)

  // Read and run the actual migration file
  const migrationPath = resolve(process.cwd(), 'supabase/migrations/20261121000001_parent_invitations_and_linking.sql')
  const migrationSql = readFileSync(migrationPath, 'utf8')
  await db.exec(migrationSql)

  console.log('✅ Full migration SQL executed cleanly in PGlite!')
}

test().catch((err) => {
  console.error('❌ Migration test failed:', err)
  process.exit(1)
})
