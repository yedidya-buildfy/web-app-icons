BEGIN;

-- 1) Add the new column (nullable for backfill), then enforce NOT NULL
ALTER TABLE public.generated_icons
  ADD COLUMN IF NOT EXISTS context text;

-- Backfill NULLs to empty string so we can enforce NOT NULL safely
UPDATE public.generated_icons
  SET context = COALESCE(context, '')
  WHERE context IS NULL;

ALTER TABLE public.generated_icons
  ALTER COLUMN context SET NOT NULL;

-- 2) Index for filtering by context
CREATE INDEX IF NOT EXISTS generated_icons_context_idx
  ON public.generated_icons (context);

-- 3) Keep the view in sync (append new column at the end to satisfy REPLACE rules)
CREATE OR REPLACE VIEW public.generated_icons_view AS
SELECT id, deterministic_id, icon_name, subject, style, colors, background, image_url, created_at, context
FROM public.generated_icons;

COMMIT;
