-- Emergency Admin User Creation
-- This migration creates an initial admin user that can create API keys
-- Run this with service_role or as a database administrator

-- Create a function that can bypass RLS to create the initial admin user
CREATE OR REPLACE FUNCTION public.create_initial_admin_user(
  p_admin_email TEXT DEFAULT 'admin@iconapp.com',
  p_admin_name TEXT DEFAULT 'System Administrator'
)
RETURNS JSONB AS $$
DECLARE
  v_admin_id UUID;
  v_result JSONB;
BEGIN
  -- Generate a consistent UUID for the admin user
  v_admin_id := '00000000-0000-0000-0000-000000000001'::UUID;
  
  -- Insert or update the admin user (bypasses RLS due to SECURITY DEFINER)
  INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    is_super_admin, 
    provider, 
    created_at, 
    updated_at
  ) VALUES (
    v_admin_id, 
    p_admin_email, 
    p_admin_name, 
    true, 
    'system', 
    NOW(), 
    NOW()
  ) 
  ON CONFLICT (id) DO UPDATE SET
    is_super_admin = true,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    updated_at = NOW();
  
  -- Create a corresponding auth user record if it doesn't exist
  -- Note: This requires service_role privileges to insert into auth.users
  BEGIN
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      email_change_confirm_status
    ) VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000'::UUID,
      'authenticated',
      'authenticated',
      p_admin_email,
      crypt('admin_temp_password_change_immediately', gen_salt('bf')),
      NOW(),
      NOW(),
      NOW(),
      '',
      '',
      '',
      '',
      0
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      updated_at = NOW();
  EXCEPTION
    WHEN OTHERS THEN
      -- If auth.users insert fails (likely due to permissions), continue anyway
      -- The profile will still be created and can be used for admin functions
      NULL;
  END;
  
  -- Return success with user info
  SELECT jsonb_build_object(
    'success', true,
    'admin_id', v_admin_id,
    'email', p_admin_email,
    'message', 'Initial admin user created successfully'
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.create_initial_admin_user TO anon;
GRANT EXECUTE ON FUNCTION public.create_initial_admin_user TO authenticated;

-- Create a helper function to check admin status
CREATE OR REPLACE FUNCTION public.check_admin_status()
RETURNS JSONB AS $$
DECLARE
  v_admin_count INTEGER;
  v_total_profiles INTEGER;
  v_result JSONB;
BEGIN
  -- Count admin users
  SELECT COUNT(*) INTO v_admin_count
  FROM public.profiles
  WHERE is_super_admin = true;
  
  -- Count total profiles
  SELECT COUNT(*) INTO v_total_profiles
  FROM public.profiles;
  
  SELECT jsonb_build_object(
    'total_profiles', v_total_profiles,
    'admin_count', v_admin_count,
    'has_admin', v_admin_count > 0,
    'message', CASE 
      WHEN v_admin_count = 0 THEN 'No admin users found - API key creation will fail'
      ELSE v_admin_count || ' admin user(s) found - API key creation should work'
    END
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.check_admin_status TO anon;
GRANT EXECUTE ON FUNCTION public.check_admin_status TO authenticated;

-- Execute the admin creation immediately
SELECT public.create_initial_admin_user();

-- Display the current status
SELECT public.check_admin_status();