-- Debug admin status for yedidyadan33@gmail.com
-- Run this in Supabase SQL editor to check current state

-- 1. Check if user exists and their admin status
SELECT 
  id,
  email,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com';

-- 2. Check if is_super_admin column exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND table_schema = 'public'
  AND column_name IN ('is_admin', 'is_super_admin');

-- 3. Set admin status if user exists but isn't admin
UPDATE public.profiles 
SET is_super_admin = TRUE 
WHERE email = 'yedidyadan33@gmail.com' 
  AND (is_super_admin IS NULL OR is_super_admin = FALSE);

-- 4. Verify the update worked
SELECT 
  id,
  email,
  is_super_admin,
  updated_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com';