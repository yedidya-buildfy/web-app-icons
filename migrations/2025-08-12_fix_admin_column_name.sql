-- Migration: Fix admin column name from is_admin to is_super_admin
-- Date: 2025-08-12
-- Description: Handles the migration from is_admin to is_super_admin column and updates all references

-- Handle column migration safely
DO $$
BEGIN
  -- Check if is_admin column exists but is_super_admin doesn't
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'is_admin' AND table_schema = 'public')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name = 'profiles' AND column_name = 'is_super_admin' AND table_schema = 'public') THEN
    
    -- Rename is_admin to is_super_admin
    ALTER TABLE public.profiles RENAME COLUMN is_admin TO is_super_admin;
    RAISE NOTICE 'Renamed is_admin column to is_super_admin';
    
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'profiles' AND column_name = 'is_super_admin' AND table_schema = 'public') THEN
    
    -- Create is_super_admin column if it doesn't exist
    ALTER TABLE public.profiles ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Created is_super_admin column';
    
  ELSE
    RAISE NOTICE 'is_super_admin column already exists, skipping column creation';
  END IF;
  
  -- If both columns exist, copy data from is_admin to is_super_admin and drop is_admin
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'is_admin' AND table_schema = 'public')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'is_super_admin' AND table_schema = 'public') THEN
    
    -- Copy data from is_admin to is_super_admin where is_super_admin is false but is_admin is true
    UPDATE public.profiles 
    SET is_super_admin = is_admin 
    WHERE is_admin = TRUE AND is_super_admin = FALSE;
    
    -- Drop the old is_admin column
    ALTER TABLE public.profiles DROP COLUMN is_admin;
    RAISE NOTICE 'Copied data from is_admin to is_super_admin and dropped is_admin column';
  END IF;
END $$;

-- Update/recreate admin functions with correct column name
CREATE OR REPLACE FUNCTION public.admin_create_plan(
  p_admin_user_id UUID,
  p_id TEXT,
  p_name TEXT,
  p_description TEXT,
  p_price_monthly DECIMAL(10,2),
  p_price_yearly DECIMAL(10,2),
  p_monthly_icon_searches INTEGER,
  p_monthly_icon_downloads INTEGER,
  p_monthly_icon_generation INTEGER,
  p_monthly_generated_usage INTEGER,
  p_unlimited_searches BOOLEAN DEFAULT FALSE,
  p_unlimited_downloads BOOLEAN DEFAULT FALSE,
  p_unlimited_generation BOOLEAN DEFAULT FALSE,
  p_unlimited_generated_usage BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  plan_uuid UUID;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_user_id AND is_super_admin = TRUE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Create plan
  INSERT INTO public.subscription_plans (
    id, name, description, price_monthly, price_yearly,
    monthly_icon_searches, monthly_icon_downloads, monthly_icon_generation, monthly_generated_usage,
    unlimited_searches, unlimited_downloads, unlimited_generation, unlimited_generated_usage
  ) VALUES (
    p_id, p_name, p_description, p_price_monthly, p_price_yearly,
    p_monthly_icon_searches, p_monthly_icon_downloads, p_monthly_icon_generation, p_monthly_generated_usage,
    p_unlimited_searches, p_unlimited_downloads, p_unlimited_generation, p_unlimited_generated_usage
  );
  
  RETURN gen_random_uuid(); -- Return success indicator
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_admin_user_id UUID,
  p_id TEXT,
  p_name TEXT,
  p_description TEXT,
  p_price_monthly DECIMAL(10,2),
  p_price_yearly DECIMAL(10,2),
  p_monthly_icon_searches INTEGER,
  p_monthly_icon_downloads INTEGER,
  p_monthly_icon_generation INTEGER,
  p_monthly_generated_usage INTEGER,
  p_unlimited_searches BOOLEAN DEFAULT FALSE,
  p_unlimited_downloads BOOLEAN DEFAULT FALSE,
  p_unlimited_generation BOOLEAN DEFAULT FALSE,
  p_unlimited_generated_usage BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_user_id AND is_super_admin = TRUE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Update plan
  UPDATE public.subscription_plans SET
    name = p_name,
    description = p_description,
    price_monthly = p_price_monthly,
    price_yearly = p_price_yearly,
    monthly_icon_searches = p_monthly_icon_searches,
    monthly_icon_downloads = p_monthly_icon_downloads,
    monthly_icon_generation = p_monthly_icon_generation,
    monthly_generated_usage = p_monthly_generated_usage,
    unlimited_searches = p_unlimited_searches,
    unlimited_downloads = p_unlimited_downloads,
    unlimited_generation = p_unlimited_generation,
    unlimited_generated_usage = p_unlimited_generated_usage,
    updated_at = NOW()
  WHERE id = p_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_delete_plan(
  p_admin_user_id UUID,
  p_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_user_id AND is_super_admin = TRUE) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Prevent deletion of free plan
  IF p_id = 'free' THEN
    RAISE EXCEPTION 'Cannot delete the free plan';
  END IF;
  
  -- Check if plan is in use
  IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE plan_id = p_id AND status = 'active') THEN
    RAISE EXCEPTION 'Cannot delete plan with active subscriptions';
  END IF;
  
  -- Deactivate instead of delete to preserve history
  UPDATE public.subscription_plans SET is_active = FALSE, updated_at = NOW()
  WHERE id = p_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate/update indexes with correct column name
DROP INDEX IF EXISTS public.idx_profiles_is_admin;
CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin ON public.profiles(is_super_admin);

-- Update RLS policies with correct column references
DROP POLICY IF EXISTS "Admin can manage discount codes" ON public.discount_codes;
CREATE POLICY "Admin can manage discount codes" ON public.discount_codes FOR ALL 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE));

DROP POLICY IF EXISTS "Admin can view all discount usage" ON public.discount_code_usage;
CREATE POLICY "Admin can view all discount usage" ON public.discount_code_usage FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE));

-- Verify the migration completed successfully
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'is_super_admin' AND table_schema = 'public') THEN
    RAISE NOTICE 'SUCCESS: is_super_admin column exists and migration completed';
  ELSE
    RAISE EXCEPTION 'FAILED: is_super_admin column was not created properly';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'is_admin' AND table_schema = 'public') THEN
    RAISE WARNING 'WARNING: is_admin column still exists - manual cleanup may be needed';
  END IF;
END $$;