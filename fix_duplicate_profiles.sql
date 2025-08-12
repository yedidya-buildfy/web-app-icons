-- Fix duplicate profiles and set admin status
-- Run this in Supabase SQL editor

-- 1. Check current state - show all profiles for your email
SELECT 
  id,
  email,
  full_name,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com'
ORDER BY created_at;

-- 2. Set admin status for ALL profiles with your email
UPDATE public.profiles 
SET is_super_admin = TRUE 
WHERE email = 'yedidyadan33@gmail.com';

-- 3. Verify the update
SELECT 
  id,
  email,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com'
ORDER BY created_at;

-- 4. Optional: Clean up duplicate profiles (keep only the newest one)
-- UNCOMMENT THE LINES BELOW IF YOU WANT TO REMOVE DUPLICATES:

/*
-- Delete all but the most recent profile for your email
WITH ranked_profiles AS (
  SELECT 
    id,
    email,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) as rn
  FROM public.profiles 
  WHERE email = 'yedidyadan33@gmail.com'
)
DELETE FROM public.profiles 
WHERE id IN (
  SELECT id FROM ranked_profiles WHERE rn > 1
);

-- Verify cleanup
SELECT 
  id,
  email,
  is_super_admin,
  created_at
FROM public.profiles 
WHERE email = 'yedidyadan33@gmail.com';
*/