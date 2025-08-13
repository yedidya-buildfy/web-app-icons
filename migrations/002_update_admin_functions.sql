-- Migration: Update Admin Functions for New Usage Metrics
-- Date: 2025-08-13

-- =============================================================================
-- UPDATED ADMIN CUSTOMERS OVERVIEW FUNCTION
-- =============================================================================

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
  icons_generated INTEGER,        -- NEW: Count of unique icons this user generated
  unique_icons_used INTEGER,      -- NEW: Count of unique existing icons user downloaded
  download_png_count INTEGER,     -- Keep for backwards compatibility
  download_svg_count INTEGER,     -- Keep for backwards compatibility
  copy_svg_count INTEGER,         -- Keep for backwards compatibility
  total_searches INTEGER,         -- NEW: Total search count
  total_usage_count INTEGER,      -- Keep total for overall activity
  estimated_total_spend DECIMAL(10,2),
  full_name TEXT,
  is_super_admin BOOLEAN
) AS $$
DECLARE
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Check if user is admin
  SELECT COALESCE(p.is_super_admin, FALSE) INTO is_admin
  FROM public.profiles p
  WHERE p.id = p_admin_user_id;
  
  IF NOT COALESCE(is_admin, FALSE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

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
  ), 
  generated_icons_stats AS (
    -- Count actual generated icons from generated_icons table
    SELECT 
      gi.user_id,
      COUNT(DISTINCT gi.id)::integer as icons_generated_count
    FROM public.generated_icons gi
    WHERE gi.user_id IS NOT NULL
    GROUP BY gi.user_id
  ),
  usage_summary_stats AS (
    -- Get current month usage from summary table
    SELECT
      mus.user_id,
      COALESCE(mus.icons_generated, 0)::integer as summary_generated,
      COALESCE(mus.unique_icons_used, 0)::integer as summary_used,
      COALESCE(mus.icon_searches, 0)::integer as summary_searches
    FROM public.monthly_usage_summary mus
    WHERE mus.billing_period_start = public.get_billing_period_start()
  ),
  usage_events_stats AS (
    -- Calculate from events table for detailed breakdown
    SELECT
      ue.user_id,
      COUNT(CASE WHEN ue.event_type = 'generate' THEN 1 END)::integer AS events_generated,
      COUNT(DISTINCT CASE 
        WHEN ue.event_type IN ('download', 'use_generated') AND ue.icon_identifier IS NOT NULL 
        THEN ue.icon_identifier 
      END)::integer AS events_unique_used,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'png' THEN 1 ELSE 0 END)::integer AS download_png_count,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'svg' THEN 1 ELSE 0 END)::integer AS download_svg_count,
      SUM(CASE WHEN ue.event_type = 'download' AND ue.event_subtype = 'copy_svg' THEN 1 ELSE 0 END)::integer AS copy_svg_count,
      COUNT(CASE WHEN ue.event_type = 'search' THEN 1 END)::integer AS search_count,
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
    
    -- NEW METRICS: Use the highest count between different sources
    GREATEST(
      COALESCE(gis.icons_generated_count, 0),
      COALESCE(uss.summary_generated, 0),
      COALESCE(ues.events_generated, 0)
    ) AS icons_generated,
    
    GREATEST(
      COALESCE(uss.summary_used, 0),
      COALESCE(ues.events_unique_used, 0)
    ) AS unique_icons_used,
    
    -- Keep existing metrics for backwards compatibility
    COALESCE(ues.download_png_count, 0) AS download_png_count,
    COALESCE(ues.download_svg_count, 0) AS download_svg_count,
    COALESCE(ues.copy_svg_count, 0) AS copy_svg_count,
    
    GREATEST(
      COALESCE(uss.summary_searches, 0),
      COALESCE(ues.search_count, 0)
    ) AS total_searches,
    
    COALESCE(ues.total_usage_count, 0) AS total_usage_count,
    
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
  LEFT JOIN generated_icons_stats gis ON gis.user_id = au.id
  LEFT JOIN usage_summary_stats uss ON uss.user_id = au.id
  LEFT JOIN usage_events_stats ues ON ues.user_id = au.id
  ORDER BY COALESCE(sp.price_monthly, 0) DESC, au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- HELPER FUNCTION TO SYNC GENERATED ICONS WITH USAGE TRACKING
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_generated_icons_tracking()
RETURNS INTEGER AS $$
DECLARE
  synced_count INTEGER := 0;
  icon_record RECORD;
BEGIN
  -- Create usage events for generated icons that don't have tracking yet
  FOR icon_record IN 
    SELECT 
      gi.id,
      gi.user_id,
      gi.icon_name,
      gi.deterministic_id,
      gi.created_at
    FROM public.generated_icons gi
    LEFT JOIN public.usage_events ue ON (
      ue.event_type = 'generate' 
      AND ue.resource_id = gi.id::text 
      AND ue.user_id = gi.user_id
    )
    WHERE gi.user_id IS NOT NULL 
      AND ue.id IS NULL -- No existing tracking event
  LOOP
    INSERT INTO public.usage_events (
      user_id,
      event_type,
      event_subtype,
      resource_id,
      resource_metadata,
      icon_identifier,
      icon_source,
      billing_period_start,
      created_at
    ) VALUES (
      icon_record.user_id,
      'generate',
      'ai_generation',
      icon_record.id::text,
      jsonb_build_object(
        'icon_name', icon_record.icon_name,
        'deterministic_id', icon_record.deterministic_id
      ),
      icon_record.deterministic_id, -- Use deterministic_id as unique identifier
      'generated',
      public.get_billing_period_start(icon_record.created_at::date),
      icon_record.created_at
    );
    
    synced_count := synced_count + 1;
  END LOOP;
  
  -- Update monthly summaries
  INSERT INTO public.monthly_usage_summary (
    user_id, 
    billing_period_start, 
    icons_generated,
    unique_icons_used,
    icon_searches
  )
  SELECT 
    ue.user_id,
    ue.billing_period_start,
    COUNT(CASE WHEN ue.event_type = 'generate' THEN 1 END)::integer,
    COUNT(DISTINCT CASE 
      WHEN ue.event_type IN ('download', 'use_generated') AND ue.icon_identifier IS NOT NULL 
      THEN ue.icon_identifier 
    END)::integer,
    COUNT(CASE WHEN ue.event_type = 'search' THEN 1 END)::integer
  FROM public.usage_events ue
  WHERE ue.user_id IS NOT NULL
  GROUP BY ue.user_id, ue.billing_period_start
  ON CONFLICT (user_id, billing_period_start) DO UPDATE SET
    icons_generated = GREATEST(monthly_usage_summary.icons_generated, EXCLUDED.icons_generated),
    unique_icons_used = GREATEST(monthly_usage_summary.unique_icons_used, EXCLUDED.unique_icons_used),
    icon_searches = GREATEST(monthly_usage_summary.icon_searches, EXCLUDED.icon_searches),
    last_updated = NOW();
  
  RETURN synced_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;