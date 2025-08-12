-- Fix infinite recursion in RLS policies
-- The admin policy was causing recursion by checking profiles table within profiles table policy

-- Drop the problematic admin policy
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Create a simpler admin function that uses SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.admin_get_all_profiles()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  is_super_admin BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- This function runs with SECURITY DEFINER, bypassing RLS
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.is_super_admin, p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the customers overview function to use the simpler approach
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
  -- Simple admin check using SECURITY DEFINER to bypass RLS
  SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
  FROM public.profiles p
  WHERE p.id = p_admin_user_id;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- Return customer data (SECURITY DEFINER bypasses RLS)
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
    p.id AS user_id,
    p.email,
    p.created_at AS profile_created_at,
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
  FROM public.profiles p
  LEFT JOIN latest_sub ls ON ls.user_id = p.id
  LEFT JOIN public.subscription_plans sp ON sp.id = ls.plan_id
  LEFT JOIN usage_agg ua ON ua.user_id = p.id
  ORDER BY COALESCE(sp.price_monthly, 0) DESC, p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
