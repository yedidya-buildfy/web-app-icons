-- Migration: Add admin dashboard and discount code system
-- Date: 2025-08-12
-- Description: Adds admin role management and discount code functionality

-- Add admin role to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;

-- Create discount codes table
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, -- e.g., 'SAVE20', 'BLACKFRIDAY'
  
  -- Discount details
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')), -- percentage or fixed amount
  discount_amount DECIMAL(10,2) NOT NULL, -- 20.00 for 20% or $20 fixed
  
  -- Usage limits
  max_uses INTEGER DEFAULT NULL, -- NULL = unlimited
  used_count INTEGER DEFAULT 0,
  months_duration INTEGER DEFAULT 1, -- How many months the discount applies
  
  -- Validity period
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  
  -- Plan restrictions (NULL = applies to all plans)
  applicable_plans TEXT[], -- Array of plan IDs this discount applies to
  
  -- Metadata
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create discount code usage tracking
CREATE TABLE IF NOT EXISTS public.discount_code_usage (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  discount_code_id UUID REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Usage details
  original_price DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL,
  final_price DECIMAL(10,2) NOT NULL,
  
  -- When and where used
  used_at TIMESTAMPTZ DEFAULT NOW(),
  subscription_id UUID REFERENCES public.user_subscriptions(id),
  
  -- Ensure one use per user per discount code
  CONSTRAINT unique_user_discount_usage UNIQUE (discount_code_id, user_id)
);

-- Create function to validate and apply discount code
CREATE OR REPLACE FUNCTION public.apply_discount_code(
  p_code TEXT,
  p_user_id UUID,
  p_plan_id TEXT,
  p_billing_cycle TEXT DEFAULT 'monthly'
)
RETURNS TABLE (
  is_valid BOOLEAN,
  discount_amount DECIMAL(10,2),
  final_price DECIMAL(10,2),
  original_price DECIMAL(10,2),
  message TEXT
) AS $$
DECLARE
  discount_record RECORD;
  plan_record RECORD;
  usage_count INTEGER;
  calculated_discount DECIMAL(10,2);
  base_price DECIMAL(10,2);
BEGIN
  -- Get discount code details
  SELECT * INTO discount_record
  FROM public.discount_codes
  WHERE code = UPPER(p_code) AND is_active = TRUE
    AND valid_from <= NOW() AND valid_until >= NOW();
  
  IF discount_record IS NULL THEN
    RETURN QUERY SELECT FALSE, 0.00, 0.00, 0.00, 'Invalid or expired discount code';
    RETURN;
  END IF;
  
  -- Check if user already used this discount
  SELECT COUNT(*) INTO usage_count
  FROM public.discount_code_usage
  WHERE discount_code_id = discount_record.id AND user_id = p_user_id;
  
  IF usage_count > 0 THEN
    RETURN QUERY SELECT FALSE, 0.00, 0.00, 0.00, 'Discount code already used';
    RETURN;
  END IF;
  
  -- Check usage limits
  IF discount_record.max_uses IS NOT NULL AND discount_record.used_count >= discount_record.max_uses THEN
    RETURN QUERY SELECT FALSE, 0.00, 0.00, 0.00, 'Discount code usage limit reached';
    RETURN;
  END IF;
  
  -- Get plan details
  SELECT * INTO plan_record
  FROM public.subscription_plans
  WHERE id = p_plan_id AND is_active = TRUE;
  
  IF plan_record IS NULL THEN
    RETURN QUERY SELECT FALSE, 0.00, 0.00, 0.00, 'Invalid plan';
    RETURN;
  END IF;
  
  -- Check if discount applies to this plan
  IF discount_record.applicable_plans IS NOT NULL AND NOT (p_plan_id = ANY(discount_record.applicable_plans)) THEN
    RETURN QUERY SELECT FALSE, 0.00, 0.00, 0.00, 'Discount code not applicable to this plan';
    RETURN;
  END IF;
  
  -- Calculate base price
  IF p_billing_cycle = 'yearly' THEN
    base_price := plan_record.price_yearly;
  ELSE
    base_price := plan_record.price_monthly;
  END IF;
  
  -- Calculate discount
  IF discount_record.discount_type = 'percentage' THEN
    calculated_discount := ROUND((base_price * discount_record.discount_amount / 100), 2);
  ELSE
    calculated_discount := discount_record.discount_amount;
  END IF;
  
  -- Ensure discount doesn't exceed original price
  calculated_discount := LEAST(calculated_discount, base_price);
  
  RETURN QUERY SELECT 
    TRUE, 
    calculated_discount,
    (base_price - calculated_discount),
    base_price,
    'Discount applied successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to record discount usage
CREATE OR REPLACE FUNCTION public.record_discount_usage(
  p_code TEXT,
  p_user_id UUID,
  p_subscription_id UUID,
  p_original_price DECIMAL(10,2),
  p_discount_amount DECIMAL(10,2),
  p_final_price DECIMAL(10,2)
)
RETURNS UUID AS $$
DECLARE
  discount_record RECORD;
  usage_id UUID;
BEGIN
  -- Get discount code
  SELECT * INTO discount_record
  FROM public.discount_codes
  WHERE code = UPPER(p_code) AND is_active = TRUE;
  
  IF discount_record IS NULL THEN
    RAISE EXCEPTION 'Invalid discount code';
  END IF;
  
  -- Record usage
  INSERT INTO public.discount_code_usage (
    discount_code_id, user_id, subscription_id,
    original_price, discount_amount, final_price
  ) VALUES (
    discount_record.id, p_user_id, p_subscription_id,
    p_original_price, p_discount_amount, p_final_price
  ) RETURNING id INTO usage_id;
  
  -- Update usage count
  UPDATE public.discount_codes 
  SET used_count = used_count + 1, updated_at = NOW()
  WHERE id = discount_record.id;
  
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create admin-only functions for plan management
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON public.discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_valid_period ON public.discount_codes(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_user ON public.discount_code_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_code ON public.discount_code_usage(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin ON public.profiles(is_super_admin);

-- Enable RLS on new tables
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for discount_codes
CREATE POLICY "Admin can manage discount codes" ON public.discount_codes FOR ALL 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE));

CREATE POLICY "Users can view active discount codes" ON public.discount_codes FOR SELECT 
  USING (is_active = TRUE AND valid_from <= NOW() AND valid_until >= NOW());

-- RLS Policies for discount_code_usage
CREATE POLICY "Admin can view all discount usage" ON public.discount_code_usage FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE));

CREATE POLICY "Users can view own discount usage" ON public.discount_code_usage FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert discount usage" ON public.discount_code_usage FOR INSERT 
  WITH CHECK (true);