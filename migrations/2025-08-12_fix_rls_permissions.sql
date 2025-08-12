-- Fix RLS permissions for generated_icons table
-- This migration allows anonymous users to insert and read icons

-- Disable RLS on generated_icons table
ALTER TABLE public.generated_icons DISABLE ROW LEVEL SECURITY;

-- Grant full permissions to anon role
GRANT ALL ON public.generated_icons TO anon;
GRANT ALL ON public.generated_icons TO authenticated;

-- Also grant permissions on the sequence (for auto-incrementing IDs)
GRANT USAGE, SELECT ON SEQUENCE public.generated_icons_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.generated_icons_id_seq TO authenticated;

-- Grant permissions on the view as well
GRANT SELECT ON public.generated_icons_view TO anon;
GRANT SELECT ON public.generated_icons_view TO authenticated;