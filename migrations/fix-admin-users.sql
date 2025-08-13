-- Fix admin panel to show ALL users from auth.users table
-- Run this in your Supabase SQL editor

CREATE OR REPLACE FUNCTION public.admin_get_all_users(
  p_admin_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  email_confirmed_at TIMESTAMPTZ,
  full_name TEXT,
  is_super_admin BOOLEAN,
  has_profile BOOLEAN,
  plan_id TEXT,
  plan_name TEXT,
  total_usage_count INTEGER
) AS $$
DECLARE
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Check if user is admin (skip check if called from server-side)
  IF p_admin_user_id IS NOT NULL THEN
    SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
    FROM public.profiles p
    WHERE p.id = p_admin_user_id;
    
    IF NOT is_admin THEN
      RAISE EXCEPTION 'Access denied: Admin privileges required';
    END IF;
  END IF;

  -- Return all users from auth.users with profile data if available
  RETURN QUERY
  SELECT
    au.id AS user_id,
    au.email,
    au.created_at,
    au.last_sign_in_at,
    au.email_confirmed_at,
    p.full_name,
    COALESCE(p.is_super_admin, FALSE) AS is_super_admin,
    (p.id IS NOT NULL) AS has_profile,
    us.plan_id,
    sp.name AS plan_name,
    COALESCE(
      (SELECT COUNT(*)::INTEGER FROM public.usage_events ue WHERE ue.user_id = au.id),
      0
    ) AS total_usage_count
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  LEFT JOIN public.user_subscriptions us ON us.user_id = au.id AND us.status = 'active'
  LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
  ORDER BY au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create a function to fix missing profiles
CREATE OR REPLACE FUNCTION public.admin_create_missing_profiles(
  p_admin_user_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  is_admin BOOLEAN := FALSE;
  profiles_created INTEGER := 0;
  user_record RECORD;
BEGIN
  -- Check if user is admin
  SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
  FROM public.profiles p
  WHERE p.id = p_admin_user_id;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- Create profiles for users who don't have them
  FOR user_record IN 
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE p.id IS NULL
  LOOP
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      avatar_url,
      provider,
      provider_id,
      is_super_admin
    ) VALUES (
      user_record.id,
      user_record.email,
      COALESCE(
        user_record.raw_user_meta_data->>'full_name',
        user_record.raw_user_meta_data->>'name'
      ),
      COALESCE(
        user_record.raw_user_meta_data->>'avatar_url',
        user_record.raw_user_meta_data->>'picture'
      ),
      COALESCE(
        user_record.raw_user_meta_data->>'provider',
        'email'
      ),
      user_record.raw_user_meta_data->>'provider_id',
      FALSE
    );
    
    profiles_created := profiles_created + 1;
  END LOOP;
  
  RETURN profiles_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the existing admin_get_customers_overview to use auth.users as well
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
  estimated_total_spend DECIMAL(10,2)
) AS $$
DECLARE
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Check if user is admin
  SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
  FROM public.profiles p
  WHERE p.id = p_admin_user_id;
  
  IF NOT is_admin THEN
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
    au.email,
    COALESCE(p.created_at, au.created_at) AS profile_created_at,
    ls.plan_id AS current_plan_id,
    sp.name AS current_plan_name,
    ls.billing_cycle,
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
    )::numeric(10,2) AS estimated_total_spend
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  LEFT JOIN latest_sub ls ON ls.user_id = au.id
  LEFT JOIN public.subscription_plans sp ON sp.id = ls.plan_id
  LEFT JOIN usage_agg ua ON ua.user_id = au.id
  ORDER BY COALESCE(sp.price_monthly, 0) DESC, au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;