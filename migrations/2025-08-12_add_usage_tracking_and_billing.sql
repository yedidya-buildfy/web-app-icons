-- Migration: Add comprehensive usage tracking and billing system
-- Date: 2025-08-12
-- Description: Implements usage tracking for icons searches, downloads, generation, and payment plans

-- Create subscription plans table
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id TEXT PRIMARY KEY, -- e.g., 'free', 'pro', 'enterprise'
  name TEXT NOT NULL,
  description TEXT,
  price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  price_yearly DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  
  -- Monthly limits for different actions
  monthly_icon_searches INTEGER NOT NULL DEFAULT 100, -- API icon searches/pulls
  monthly_icon_downloads INTEGER NOT NULL DEFAULT 50, -- PNG/SVG downloads
  monthly_icon_generation INTEGER NOT NULL DEFAULT 10, -- AI generation
  monthly_generated_usage INTEGER NOT NULL DEFAULT 25, -- Using app-generated icons
  
  -- Feature flags
  unlimited_searches BOOLEAN DEFAULT FALSE,
  unlimited_downloads BOOLEAN DEFAULT FALSE,
  unlimited_generation BOOLEAN DEFAULT FALSE,
  unlimited_generated_usage BOOLEAN DEFAULT FALSE,
  
  -- Plan metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert basic free plan only
INSERT INTO public.subscription_plans (id, name, description) VALUES
('free', 'Free', 'Basic plan for all users')
ON CONFLICT (id) DO NOTHING;

-- Create user subscriptions table
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan_id TEXT REFERENCES public.subscription_plans(id) NOT NULL,
  
  -- Billing information
  status TEXT NOT NULL DEFAULT 'active', -- active, canceled, expired, suspended
  billing_cycle TEXT NOT NULL DEFAULT 'monthly', -- monthly, yearly
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 month'),
  
  -- Payment tracking
  stripe_subscription_id TEXT, -- For Stripe integration
  stripe_customer_id TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one active subscription per user
  CONSTRAINT unique_active_subscription EXCLUDE (user_id WITH =) WHERE (status = 'active')
);

-- Create usage events table for detailed tracking
CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Event details
  event_type TEXT NOT NULL, -- 'search', 'download', 'generate', 'use_generated'
  event_subtype TEXT, -- 'png', 'svg', 'copy_svg' for downloads; 'search_query' for searches
  
  -- Resource information
  resource_id TEXT, -- icon_id for searches, generated_icon_id for generations
  resource_metadata JSONB, -- Additional data like query, library, colors, etc.
  
  -- Usage context
  ip_address INET,
  user_agent TEXT,
  
  -- Billing period this event belongs to
  billing_period_start DATE NOT NULL, -- First day of the month this usage counts toward
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create monthly usage summary table for efficient billing queries
CREATE TABLE IF NOT EXISTS public.monthly_usage_summary (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  billing_period_start DATE NOT NULL, -- First day of the month
  
  -- Usage counters
  icon_searches INTEGER DEFAULT 0,
  icon_downloads INTEGER DEFAULT 0, 
  icon_generation INTEGER DEFAULT 0,
  generated_usage INTEGER DEFAULT 0,
  
  -- Plan limits at time of usage (for historical tracking)
  plan_id TEXT,
  plan_searches_limit INTEGER,
  plan_downloads_limit INTEGER,
  plan_generation_limit INTEGER,
  plan_generated_usage_limit INTEGER,
  
  -- Summary metadata
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint for user + billing period
  CONSTRAINT unique_user_billing_period UNIQUE (user_id, billing_period_start)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON public.user_subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON public.usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_type ON public.usage_events(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_billing_period ON public.usage_events(billing_period_start);
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON public.usage_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_id ON public.monthly_usage_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_billing_period ON public.monthly_usage_summary(billing_period_start);

-- Add default free subscription for existing users
INSERT INTO public.user_subscriptions (user_id, plan_id, status, billing_cycle)
SELECT id, 'free', 'active', 'monthly'
FROM public.profiles
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions 
  WHERE user_subscriptions.user_id = profiles.id 
  AND status = 'active'
);

-- Create function to get current billing period
CREATE OR REPLACE FUNCTION public.get_billing_period_start(target_date DATE DEFAULT CURRENT_DATE)
RETURNS DATE AS $$
BEGIN
  RETURN DATE_TRUNC('month', target_date)::DATE;
END;
$$ LANGUAGE plpgsql;

-- Create function to track usage event
CREATE OR REPLACE FUNCTION public.track_usage_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_event_subtype TEXT DEFAULT NULL,
  p_resource_id TEXT DEFAULT NULL,
  p_resource_metadata JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  event_id UUID;
  billing_period DATE;
BEGIN
  billing_period := public.get_billing_period_start();
  
  -- Insert usage event
  INSERT INTO public.usage_events (
    user_id, event_type, event_subtype, resource_id, resource_metadata,
    ip_address, user_agent, billing_period_start
  ) VALUES (
    p_user_id, p_event_type, p_event_subtype, p_resource_id, p_resource_metadata,
    p_ip_address, p_user_agent, billing_period
  ) RETURNING id INTO event_id;
  
  -- Update monthly usage summary
  INSERT INTO public.monthly_usage_summary (
    user_id, billing_period_start,
    icon_searches, icon_downloads, icon_generation, generated_usage
  ) VALUES (
    p_user_id, billing_period,
    CASE WHEN p_event_type = 'search' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'download' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'generate' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'use_generated' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, billing_period_start) DO UPDATE SET
    icon_searches = monthly_usage_summary.icon_searches + 
      CASE WHEN p_event_type = 'search' THEN 1 ELSE 0 END,
    icon_downloads = monthly_usage_summary.icon_downloads + 
      CASE WHEN p_event_type = 'download' THEN 1 ELSE 0 END,
    icon_generation = monthly_usage_summary.icon_generation + 
      CASE WHEN p_event_type = 'generate' THEN 1 ELSE 0 END,
    generated_usage = monthly_usage_summary.generated_usage + 
      CASE WHEN p_event_type = 'use_generated' THEN 1 ELSE 0 END,
    last_updated = NOW();
  
  RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check usage limits
CREATE OR REPLACE FUNCTION public.check_usage_limits(
  p_user_id UUID,
  p_event_type TEXT,
  p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  within_limits BOOLEAN,
  current_usage INTEGER,
  usage_limit INTEGER,
  plan_name TEXT
) AS $$
DECLARE
  billing_period DATE;
  user_plan RECORD;
  user_usage RECORD;
BEGIN
  billing_period := public.get_billing_period_start(p_target_date);
  
  -- Get user's current plan
  SELECT sp.*, us.status INTO user_plan
  FROM public.subscription_plans sp
  JOIN public.user_subscriptions us ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id AND us.status = 'active'
  LIMIT 1;
  
  -- Get user's current usage
  SELECT * INTO user_usage
  FROM public.monthly_usage_summary
  WHERE user_id = p_user_id AND billing_period_start = billing_period;
  
  -- If no usage record exists, create with zeros
  IF user_usage IS NULL THEN
    user_usage := ROW(NULL, p_user_id, billing_period, 0, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, NOW(), NOW())::public.monthly_usage_summary;
  END IF;
  
  -- Default to free plan if no subscription found
  IF user_plan IS NULL THEN
    SELECT * INTO user_plan FROM public.subscription_plans WHERE id = 'free';
  END IF;
  
  -- Check limits based on event type
  CASE p_event_type
    WHEN 'search' THEN
      RETURN QUERY SELECT 
        (user_plan.unlimited_searches OR user_usage.icon_searches < user_plan.monthly_icon_searches),
        user_usage.icon_searches,
        user_plan.monthly_icon_searches,
        user_plan.name;
    WHEN 'download' THEN
      RETURN QUERY SELECT 
        (user_plan.unlimited_downloads OR user_usage.icon_downloads < user_plan.monthly_icon_downloads),
        user_usage.icon_downloads,
        user_plan.monthly_icon_downloads,
        user_plan.name;
    WHEN 'generate' THEN
      RETURN QUERY SELECT 
        (user_plan.unlimited_generation OR user_usage.icon_generation < user_plan.monthly_icon_generation),
        user_usage.icon_generation,
        user_plan.monthly_icon_generation,
        user_plan.name;
    WHEN 'use_generated' THEN
      RETURN QUERY SELECT 
        (user_plan.unlimited_generated_usage OR user_usage.generated_usage < user_plan.monthly_generated_usage),
        user_usage.generated_usage,
        user_plan.monthly_generated_usage,
        user_plan.name;
    ELSE
      RETURN QUERY SELECT FALSE, 0, 0, user_plan.name;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on new tables
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_usage_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subscription_plans (read-only for all)
CREATE POLICY "Allow read subscription plans to all" ON public.subscription_plans FOR SELECT USING (is_active = true);

-- RLS Policies for user_subscriptions
CREATE POLICY "Users can view own subscription" ON public.user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own subscription" ON public.user_subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for usage_events
CREATE POLICY "Users can view own usage events" ON public.usage_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert usage events" ON public.usage_events FOR INSERT WITH CHECK (true);

-- RLS Policies for monthly_usage_summary
CREATE POLICY "Users can view own usage summary" ON public.monthly_usage_summary FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can manage usage summary" ON public.monthly_usage_summary FOR ALL USING (true);