-- Migration: Fix Usage Tracking System
-- Split into two metrics: icons_generated vs unique_icons_used
-- Date: 2025-08-13

-- =============================================================================
-- 1. UPDATE USAGE EVENTS TABLE STRUCTURE
-- =============================================================================

-- Add new fields to track unique icon usage
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS icon_identifier TEXT;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS icon_source TEXT; -- 'generated' or 'search'

-- Create index for efficient unique counting
CREATE INDEX IF NOT EXISTS idx_usage_events_icon_identifier ON public.usage_events(user_id, icon_identifier);
CREATE INDEX IF NOT EXISTS idx_usage_events_icon_source ON public.usage_events(icon_source);

-- =============================================================================
-- 2. UPDATE MONTHLY USAGE SUMMARY TABLE
-- =============================================================================

-- Replace old counters with new split metrics
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS icon_downloads;
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS icon_generation;
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS generated_usage;

-- Add new split metrics
ALTER TABLE public.monthly_usage_summary ADD COLUMN IF NOT EXISTS icons_generated INTEGER DEFAULT 0;
ALTER TABLE public.monthly_usage_summary ADD COLUMN IF NOT EXISTS unique_icons_used INTEGER DEFAULT 0;

-- =============================================================================
-- 3. CREATE IMPROVED USAGE TRACKING FUNCTIONS
-- =============================================================================

-- Updated track_usage_event function with unique icon tracking
CREATE OR REPLACE FUNCTION public.track_usage_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_event_subtype TEXT DEFAULT NULL,
  p_resource_id TEXT DEFAULT NULL,
  p_resource_metadata JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_icon_identifier TEXT DEFAULT NULL, -- New: unique identifier for the icon
  p_icon_source TEXT DEFAULT NULL -- New: 'generated' or 'search'
)
RETURNS UUID AS $$
DECLARE
  event_id UUID;
  billing_period DATE;
  is_unique_usage BOOLEAN := FALSE;
  is_new_generation BOOLEAN := FALSE;
BEGIN
  billing_period := public.get_billing_period_start();
  
  -- Insert usage event
  INSERT INTO public.usage_events (
    user_id, event_type, event_subtype, resource_id, resource_metadata,
    ip_address, user_agent, billing_period_start, icon_identifier, icon_source
  ) VALUES (
    p_user_id, p_event_type, p_event_subtype, p_resource_id, p_resource_metadata,
    p_ip_address, p_user_agent, billing_period, p_icon_identifier, p_icon_source
  ) RETURNING id INTO event_id;
  
  -- Check if this is a unique icon usage (first time this user uses this icon)
  IF p_icon_identifier IS NOT NULL AND p_event_type IN ('download', 'use_generated') THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.usage_events 
      WHERE user_id = p_user_id 
        AND icon_identifier = p_icon_identifier 
        AND event_type IN ('download', 'use_generated')
        AND id != event_id
    ) INTO is_unique_usage;
  END IF;
  
  -- Check if this is a new generation
  IF p_event_type = 'generate' THEN
    is_new_generation := TRUE;
  END IF;
  
  -- Update monthly usage summary with new logic
  INSERT INTO public.monthly_usage_summary (
    user_id, billing_period_start, icon_searches, icons_generated, unique_icons_used
  ) VALUES (
    p_user_id, billing_period,
    CASE WHEN p_event_type = 'search' THEN 1 ELSE 0 END,
    CASE WHEN is_new_generation THEN 1 ELSE 0 END,
    CASE WHEN is_unique_usage THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, billing_period_start) DO UPDATE SET
    icon_searches = monthly_usage_summary.icon_searches + 
      CASE WHEN p_event_type = 'search' THEN 1 ELSE 0 END,
    icons_generated = monthly_usage_summary.icons_generated + 
      CASE WHEN is_new_generation THEN 1 ELSE 0 END,
    unique_icons_used = monthly_usage_summary.unique_icons_used + 
      CASE WHEN is_unique_usage THEN 1 ELSE 0 END,
    last_updated = NOW();
  
  RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 4. CREATE FUNCTION TO GET CURRENT USAGE STATS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_usage_stats(
  p_user_id UUID,
  p_billing_period_start DATE DEFAULT NULL
)
RETURNS TABLE (
  icons_generated_count INTEGER,
  unique_icons_used_count INTEGER,
  total_searches INTEGER,
  period_start DATE
) AS $$
DECLARE
  billing_period DATE;
BEGIN
  billing_period := COALESCE(p_billing_period_start, public.get_billing_period_start());
  
  RETURN QUERY
  WITH direct_stats AS (
    -- Get stats from monthly summary if available
    SELECT 
      COALESCE(mus.icons_generated, 0) as summary_generated,
      COALESCE(mus.unique_icons_used, 0) as summary_used,
      COALESCE(mus.icon_searches, 0) as summary_searches
    FROM public.monthly_usage_summary mus
    WHERE mus.user_id = p_user_id AND mus.billing_period_start = billing_period
  ), calculated_stats AS (
    -- Calculate from events as backup/verification
    SELECT 
      COUNT(CASE WHEN ue.event_type = 'generate' THEN 1 END)::integer as calc_generated,
      COUNT(DISTINCT CASE 
        WHEN ue.event_type IN ('download', 'use_generated') AND ue.icon_identifier IS NOT NULL 
        THEN ue.icon_identifier 
      END)::integer as calc_used,
      COUNT(CASE WHEN ue.event_type = 'search' THEN 1 END)::integer as calc_searches
    FROM public.usage_events ue
    WHERE ue.user_id = p_user_id AND ue.billing_period_start = billing_period
  )
  SELECT 
    GREATEST(COALESCE(ds.summary_generated, 0), COALESCE(cs.calc_generated, 0)) as icons_generated_count,
    GREATEST(COALESCE(ds.summary_used, 0), COALESCE(cs.calc_used, 0)) as unique_icons_used_count,
    GREATEST(COALESCE(ds.summary_searches, 0), COALESCE(cs.calc_searches, 0)) as total_searches,
    billing_period as period_start
  FROM direct_stats ds
  CROSS JOIN calculated_stats cs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;