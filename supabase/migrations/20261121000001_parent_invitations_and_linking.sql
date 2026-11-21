-- ==============================================================================
-- SchoolBus Connect - Phase 3: Parent Invitation & Secure Child-Linking System
-- Migration: 20261121000001_parent_invitations_and_linking.sql
--
-- Features:
-- 1. Adds parent_phone to students table so managers record contact numbers
--    without generating manual parent accounts or passwords.
-- 2. parent_invites: Stores cryptographic SHA-256 token hashes, expiration,
--    usage, and revocation tracking. Tokens are single-use and time-bound.
-- 3. parent_student: Explicit relationship mapping table between auth.users
--    (parent_id) and students (student_id) with status and multi-child support.
-- 4. app_security.claim_parent_invitation: Atomic server-side procedure executing
--    validation (FOR UPDATE), phone number verification, parent_student linking,
--    guardians sync (for backward compatibility), and single-use invalidation.
-- 5. Full RLS policies for parent_invites and parent_student.
-- ==============================================================================

BEGIN;

-- 1. Add parent_phone column to students if not exists
ALTER TABLE public.students 
    ADD COLUMN IF NOT EXISTS parent_phone text;

-- 2. Create parent_invites table
CREATE TABLE IF NOT EXISTS public.parent_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    phone_number text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
    used_at timestamptz,
    revoked_at timestamptz,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parent_invites_school_id UNIQUE (school_id, id)
);

CREATE INDEX IF NOT EXISTS idx_parent_invites_token_hash 
    ON public.parent_invites(token_hash);

CREATE INDEX IF NOT EXISTS idx_parent_invites_student_id 
    ON public.parent_invites(student_id);

CREATE INDEX IF NOT EXISTS idx_parent_invites_school_id 
    ON public.parent_invites(school_id);

CREATE INDEX IF NOT EXISTS idx_parent_invites_phone 
    ON public.parent_invites(phone_number);

-- 3. Create parent_student table
CREATE TABLE IF NOT EXISTS public.parent_student (
    parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_student_parent_id 
    ON public.parent_student(parent_id);

CREATE INDEX IF NOT EXISTS idx_parent_student_student_id 
    ON public.parent_student(student_id);

CREATE INDEX IF NOT EXISTS idx_parent_student_school_id 
    ON public.parent_student(school_id);

-- 4. Enable RLS
ALTER TABLE public.parent_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for parent_invites
-- Only managers of the school can view invites
DROP POLICY IF EXISTS parent_invites_manager_select ON public.parent_invites;
CREATE POLICY parent_invites_manager_select ON public.parent_invites
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- Only managers can insert invites for their school
DROP POLICY IF EXISTS parent_invites_manager_insert ON public.parent_invites;
CREATE POLICY parent_invites_manager_insert ON public.parent_invites
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- Only managers can update (revoke) invites in their school
DROP POLICY IF EXISTS parent_invites_manager_update ON public.parent_invites;
CREATE POLICY parent_invites_manager_update ON public.parent_invites
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (
        school_id = (SELECT app_security.current_user_school_id())
    );

-- 6. RLS Policies for parent_student
-- Managers can view links in their school
DROP POLICY IF EXISTS parent_student_manager_select ON public.parent_student;
CREATE POLICY parent_student_manager_select ON public.parent_student
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- Parents can view only their own linked students
DROP POLICY IF EXISTS parent_student_parent_select ON public.parent_student;
CREATE POLICY parent_student_parent_select ON public.parent_student
    FOR SELECT TO authenticated
    USING (
        parent_id = (SELECT auth.uid())
    );

-- 7. Atomic Server-Side Claim Function
CREATE OR REPLACE FUNCTION app_security.claim_parent_invitation(
    p_token_hash text,
    p_parent_id uuid,
    p_phone text,
    p_full_name text DEFAULT 'Parent Guardian'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite public.parent_invites%ROWTYPE;
    v_student public.students%ROWTYPE;
    v_normalized_invite_phone text;
    v_normalized_input_phone text;
BEGIN
    -- 1. Fetch and row-lock invitation to prevent race conditions or double claims
    SELECT * INTO v_invite
    FROM public.parent_invites
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid invitation link.');
    END IF;

    -- 2. State & expiration checks
    IF v_invite.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This invitation has been revoked by the school.');
    END IF;

    IF v_invite.used_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This invitation has already been used.');
    END IF;

    IF v_invite.expires_at <= now() THEN
        RETURN jsonb_build_object('success', false, 'error', 'This invitation has expired.');
    END IF;

    -- 3. Verify phone number match (compare clean digit string)
    v_normalized_invite_phone := regexp_replace(v_invite.phone_number, '\D', '', 'g');
    v_normalized_input_phone := regexp_replace(p_phone, '\D', '', 'g');

    IF right(v_normalized_invite_phone, 9) <> right(v_normalized_input_phone, 9) THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'The phone number does not match the invitation phone number registered by the school.'
        );
    END IF;

    -- 4. Verify student exists in same school
    SELECT * INTO v_student
    FROM public.students
    WHERE id = v_invite.student_id AND school_id = v_invite.school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Associated student could not be found.');
    END IF;

    -- 5. Insert/upsert into parent_student
    INSERT INTO public.parent_student (parent_id, student_id, school_id, status)
    VALUES (p_parent_id, v_invite.student_id, v_invite.school_id, 'active')
    ON CONFLICT (parent_id, student_id) DO UPDATE SET status = 'active';

    -- 6. Insert into guardians table (preserves backward compatibility with parent portal, live bus tracking, and absences)
    INSERT INTO public.guardians (school_id, student_id, profile_id, relationship, is_primary, alert_radius_m)
    VALUES (v_invite.school_id, v_invite.student_id, p_parent_id, 'parent', true, 500)
    ON CONFLICT (student_id, profile_id) DO NOTHING;

    -- 7. Ensure profile exists and has role 'parent'
    INSERT INTO public.profiles (id, school_id, role, full_name, phone, language_pref)
    VALUES (
        p_parent_id, 
        v_invite.school_id, 
        'parent', 
        COALESCE(NULLIF(trim(p_full_name), ''), 'Parent Guardian'), 
        v_invite.phone_number, 
        'en'
    )
    ON CONFLICT (id) DO UPDATE SET 
        school_id = v_invite.school_id,
        role = CASE WHEN public.profiles.role = 'parent' THEN 'parent' ELSE public.profiles.role END,
        phone = COALESCE(public.profiles.phone, v_invite.phone_number);

    -- 8. Mark invitation as used
    UPDATE public.parent_invites
    SET used_at = now()
    WHERE id = v_invite.id;

    RETURN jsonb_build_object(
        'success', true,
        'student_id', v_invite.student_id,
        'student_name', v_student.full_name,
        'school_id', v_invite.school_id
    );
END;
$$;

-- Grant execution to authenticated users and service_role
GRANT USAGE ON SCHEMA app_security TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.claim_parent_invitation TO authenticated, service_role;

COMMIT;
