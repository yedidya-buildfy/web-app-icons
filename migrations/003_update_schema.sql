-- Migration: Update main schema.sql with new usage tracking structure
-- This should be applied to the main schema.sql file
-- Date: 2025-08-13

-- =============================================================================
-- UPDATE USAGE EVENTS TABLE
-- =============================================================================

ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS icon_identifier TEXT;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS icon_source TEXT; -- 'generated' or 'search'

-- =============================================================================
-- UPDATE MONTHLY USAGE SUMMARY TABLE  
-- =============================================================================

-- Replace old counters with new split metrics
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS icon_downloads;
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS icon_generation;
ALTER TABLE public.monthly_usage_summary DROP COLUMN IF EXISTS generated_usage;

-- Add new split metrics
ALTER TABLE public.monthly_usage_summary ADD COLUMN IF NOT EXISTS icons_generated INTEGER DEFAULT 0;
ALTER TABLE public.monthly_usage_summary ADD COLUMN IF NOT EXISTS unique_icons_used INTEGER DEFAULT 0;

-- =============================================================================
-- RUN SYNC FUNCTION TO POPULATE DATA
-- =============================================================================

-- This will sync existing generated icons data
SELECT public.sync_generated_icons_tracking();