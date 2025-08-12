-- Migration: Harden admin privilege elevation
-- Date: 2025-08-12
-- Goal: Prevent arbitrary admin self-escalation from the client

-- 1) Ensure admin column exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;

-- 2) Tighten RLS on profiles to prevent users from inserting/updating admin flag
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id AND COALESCE(is_super_admin, FALSE) = FALSE);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND (is_super_admin IS NOT DISTINCT FROM (SELECT is_super_admin FROM public.profiles p WHERE p.id = auth.uid())));

-- 3) Add a trigger to forbid client-side changes to is_super_admin except by privileged role
CREATE OR REPLACE FUNCTION public.prevent_client_admin_escalation()
RETURNS TRIGGER AS $$
DECLARE
  jwt_claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  is_service_role boolean := (jwt_claims ->> 'role') = 'service_role';
  is_requester_admin boolean := EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE
  );
BEGIN
  -- Allow if called with service_role or by a currently authenticated super admin
  IF is_service_role OR is_requester_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_super_admin IS TRUE THEN
      RAISE EXCEPTION 'Forbidden: cannot set is_super_admin on INSERT';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.is_super_admin, FALSE) IS DISTINCT FROM COALESCE(NEW.is_super_admin, FALSE) THEN
      RAISE EXCEPTION 'Forbidden: cannot modify is_super_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if present to avoid duplicates
DROP TRIGGER IF EXISTS prevent_client_admin_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_client_admin_escalation_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.prevent_client_admin_escalation();

-- 4) Provide an admin-only function to grant/revoke admin
CREATE OR REPLACE FUNCTION public.set_user_admin(
  p_requester UUID,
  p_target_user UUID,
  p_is_admin BOOLEAN
) RETURNS VOID AS $$
BEGIN
  -- Only an existing super admin can change another user's admin status
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requester AND is_super_admin = TRUE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  UPDATE public.profiles
  SET is_super_admin = p_is_admin, updated_at = NOW()
  WHERE id = p_target_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5) Optional: index for quick checks
CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin ON public.profiles(is_super_admin);


