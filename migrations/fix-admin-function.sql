-- Fix the admin function to match exact return type expected by admin.js
-- Run this in your Supabase SQL Editor

-- Drop and recreate with correct types
DROP FUNCTION IF EXISTS public.admin_get_customers_overview(UUID);

CREATE OR REPLACE FUNCTION public.admin_get_customers_overview(
  p_admin_user_id UUID
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  profile_created_at TIMESTAMPTZ,
  current_plan_id TEXT,
  current_plan_name TEXT,
  billing_cycle TEXT,
  estimated_monthly_revenue DECIMAL(10,2),
  generation_count INTEGER,
  download_png_count INTEGER,
  download_svg_count INTEGER,
  copy_svg_count INTEGER,
  total_usage_count INTEGER,
  estimated_total_spend DECIMAL(10,2),
  full_name TEXT,
  is_super_admin BOOLEAN
) AS $$
DECLARE
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Check if user is admin with proper error handling
  SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
  FROM public.profiles p
  WHERE p.id = p_admin_user_id;
  
  IF NOT COALESCE(is_admin, FALSE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- Return customer data from ALL users in auth.users (SECURITY DEFINER bypasses RLS)
  RETURN QUERY
  WITH latest_sub AS (
    SELECT DISTINCT ON (us.user_id)
      us.user_id,
      us.plan_id,
      us.billing_cycle,
      us.status
    FROM public.user_subscriptions us
    WHERE us.status = 'active'
    ORDER BY us.user_id, us.updated_at DESC
  ), usage_agg AS (
    SELECT
      ue.user_id,
      SUM(CASE WHEN ue.event_type = 'generate' THEN 1 ELSE 0 END)::integer AS generation_count,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'png' THEN 1 ELSE 0 END)::integer AS download_png_count,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'svg' THEN 1 ELSE 0 END)::integer AS download_svg_count,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'copy_svg' THEN 1 ELSE 0 END)::integer AS copy_svg_count,
      COUNT(*)::integer AS total_usage_count
    FROM public.usage_events ue
    GROUP BY ue.user_id
  )
  SELECT
    au.id AS user_id,
    au.email::TEXT AS email,
    COALESCE(p.created_at, au.created_at) AS profile_created_at,
    ls.plan_id::TEXT AS current_plan_id,
    sp.name::TEXT AS current_plan_name,
    ls.billing_cycle::TEXT AS billing_cycle,
    (
      CASE WHEN ls.plan_id IS NOT NULL AND (ls.billing_cycle = 'monthly' OR ls.billing_cycle IS NULL)
           THEN COALESCE(sp.price_monthly, 0)
           WHEN ls.plan_id IS NOT NULL AND ls.billing_cycle = 'yearly'
           THEN COALESCE(sp.price_yearly, 0)::numeric / 12
           ELSE 0 END
    )::numeric(10,2) AS estimated_monthly_revenue,
    COALESCE(ua.generation_count, 0) AS generation_count,
    COALESCE(ua.download_png_count, 0) AS download_png_count,
    COALESCE(ua.download_svg_count, 0) AS download_svg_count,
    COALESCE(ua.copy_svg_count, 0) AS copy_svg_count,
    COALESCE(ua.total_usage_count, 0) AS total_usage_count,
    (
      CASE WHEN ls.plan_id IS NOT NULL THEN
        (CASE WHEN ls.billing_cycle = 'yearly' THEN COALESCE(sp.price_yearly, 0)::numeric / 12 ELSE COALESCE(sp.price_monthly, 0) END)
      ELSE 0 END
    )::numeric(10,2) AS estimated_total_spend,
    p.full_name::TEXT AS full_name,
    COALESCE(p.is_super_admin, FALSE) AS is_super_admin
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  LEFT JOIN latest_sub ls ON ls.user_id = au.id
  LEFT JOIN public.subscription_plans sp ON sp.id = ls.plan_id
  LEFT JOIN usage_agg ua ON ua.user_id = au.id
  ORDER BY COALESCE(sp.price_monthly, 0) DESC, au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create missing profiles for any users that don't have them
INSERT INTO public.profiles (id, email, full_name, provider, is_super_admin)
SELECT 
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name'
  ),
  COALESCE(au.raw_user_meta_data->>'provider', 'email'),
  FALSE
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;