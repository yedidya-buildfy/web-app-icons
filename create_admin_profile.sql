-- Create missing profile and set admin status
-- Run this in Supabase SQL editor

-- 1. Check if user exists in auth.users table
SELECT 
  id,
  email,
  created_at,
  raw_user_meta_data,
  raw_app_meta_data
FROM auth.users 
WHERE email = 'yedidyadan33@gmail.com';

-- 2. Check if profile exists in profiles table
SELECT 
  id,
  email,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com';

-- 3. Create the profile manually if it doesn't exist
INSERT INTO public.profiles (
  id,
  email,
  full_name,
  is_super_admin,
  provider
)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', 'Admin User'),
  TRUE, -- Set as super admin
  COALESCE(au.raw_app_meta_data->>'provider', 'email')
FROM auth.users au
WHERE au.email = 'yedidyadan33@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
  );

-- 4. If profile exists but is not admin, update it
UPDATE public.profiles 
SET is_super_admin = TRUE
WHERE email = 'yedidyadan33@gmail.com'
  AND (is_super_admin IS NULL OR is_super_admin = FALSE);

-- 5. Verify the profile was created/updated correctly
SELECT 
  p.id,
  p.email,
  p.full_name,
  p.is_super_admin,
  p.provider,
  p.created_at,
  'Profile exists and admin set' as status
FROM public.profiles p
WHERE p.email = 'yedidyadan33@gmail.com';

-- 6. Also check by user ID to make sure everything matches
SELECT 
  au.id as auth_user_id,
  au.email as auth_email,
  p.id as profile_user_id,
  p.email as profile_email,
  p.is_super_admin,
  CASE 
    WHEN au.id = p.id THEN 'IDs Match ✓'
    ELSE 'IDs DO NOT MATCH ✗'
  END as id_check
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE au.email = 'yedidyadan33@gmail.com';

-- 7. Check if the profile creation trigger is working
-- (This will show you if the trigger exists and is enabled)
SELECT 
  trigger_name,
  event_manipulation,
  action_statement,
  action_timing,
  trigger_schema,
  trigger_catalog
FROM information_schema.triggers 
WHERE event_object_table = 'users' 
  AND event_object_schema = 'auth'
  AND trigger_name LIKE '%profile%';

-- 8. Final verification - this should return exactly one row with is_super_admin = true
SELECT 
  'SUCCESS: Admin profile ready' as message,
  id,
  email,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com'
  AND is_super_admin = TRUE;