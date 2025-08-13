-- Diagnostic function to understand your user structure
-- Run this in Supabase SQL Editor to see what's happening

CREATE OR REPLACE FUNCTION public.diagnose_user_structure()
RETURNS TABLE (
  auth_user_count INTEGER,
  profiles_count INTEGER,
  subscriptions_count INTEGER,
  usage_events_count INTEGER,
  missing_profiles INTEGER,
  orphaned_profiles INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM auth.users) as auth_user_count,
    (SELECT COUNT(*)::INTEGER FROM public.profiles) as profiles_count,
    (SELECT COUNT(*)::INTEGER FROM public.user_subscriptions) as subscriptions_count,
    (SELECT COUNT(*)::INTEGER FROM public.usage_events) as usage_events_count,
    (SELECT COUNT(*)::INTEGER 
     FROM auth.users au 
     LEFT JOIN public.profiles p ON p.id = au.id 
     WHERE p.id IS NULL) as missing_profiles,
    (SELECT COUNT(*)::INTEGER 
     FROM public.profiles p 
     LEFT JOIN auth.users au ON au.id = p.id 
     WHERE au.id IS NULL) as orphaned_profiles;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to show detailed user breakdown
CREATE OR REPLACE FUNCTION public.show_user_breakdown()
RETURNS TABLE (
  source TEXT,
  user_id UUID,
  email TEXT,
  has_auth_record BOOLEAN,
  has_profile BOOLEAN,
  has_subscription BOOLEAN,
  has_usage BOOLEAN,
  is_admin BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  -- All users from auth.users
  SELECT 
    'auth.users'::TEXT as source,
    au.id as user_id,
    au.email,
    TRUE as has_auth_record,
    (p.id IS NOT NULL) as has_profile,
    (us.id IS NOT NULL) as has_subscription,
    (ue_count.count > 0) as has_usage,
    COALESCE(p.is_super_admin, FALSE) as is_admin
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  LEFT JOIN public.user_subscriptions us ON us.user_id = au.id AND us.status = 'active'
  LEFT JOIN (
    SELECT user_id, COUNT(*) as count 
    FROM public.usage_events 
    GROUP BY user_id
  ) ue_count ON ue_count.user_id = au.id
  
  UNION ALL
  
  -- Orphaned profiles (shouldn't exist but let's check)
  SELECT 
    'orphaned_profile'::TEXT as source,
    p.id as user_id,
    p.email,
    FALSE as has_auth_record,
    TRUE as has_profile,
    (us.id IS NOT NULL) as has_subscription,
    (ue_count.count > 0) as has_usage,
    COALESCE(p.is_super_admin, FALSE) as is_admin
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN public.user_subscriptions us ON us.user_id = p.id AND us.status = 'active'
  LEFT JOIN (
    SELECT user_id, COUNT(*) as count 
    FROM public.usage_events 
    GROUP BY user_id
  ) ue_count ON ue_count.user_id = p.id
  WHERE au.id IS NULL
  
  ORDER BY user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;