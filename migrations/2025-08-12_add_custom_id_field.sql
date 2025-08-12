-- Add custom_id field for Aicon branded URLs
-- This allows us to serve images with custom URLs instead of exposing Runware.ai

-- Add custom_id field to generated_icons table
ALTER TABLE public.generated_icons 
ADD COLUMN IF NOT EXISTS custom_id text;

-- Create unique index for custom_id
CREATE UNIQUE INDEX IF NOT EXISTS generated_icons_custom_id_idx 
ON public.generated_icons (custom_id);

-- Update the view to include custom_id
DROP VIEW IF EXISTS public.generated_icons_view;
CREATE VIEW public.generated_icons_view AS
SELECT id, deterministic_id, icon_name, subject, style, colors, background, image_url, custom_id, created_at, context
FROM public.generated_icons;