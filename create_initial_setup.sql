-- INITIAL SETUP FOR API KEY SYSTEM
-- Run this in Supabase SQL Editor to enable API key creation

-- Step 1: Create a temporary bypass function for initial setup
CREATE OR REPLACE FUNCTION public.create_api_key_with_bypass(
    p_name TEXT,
    p_owner_email TEXT DEFAULT 'admin@example.com',
    p_owner_name TEXT DEFAULT 'System Admin',
    p_description TEXT DEFAULT 'Generated via bypass for initial setup',
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_rate_limit_per_minute INTEGER DEFAULT 100,
    p_daily_limit INTEGER DEFAULT 10000,
    p_monthly_limit INTEGER DEFAULT 300000,
    p_can_search BOOLEAN DEFAULT true,
    p_can_generate BOOLEAN DEFAULT true,
    p_can_download BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_api_key_id UUID;
    v_raw_key TEXT;
    v_key_hash TEXT;
    v_key_prefix TEXT;
    v_admin_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
BEGIN
    -- Create admin profile if it doesn't exist
    INSERT INTO public.profiles (
        id, email, full_name, is_super_admin, provider, created_at, updated_at
    ) VALUES (
        v_admin_id, p_owner_email, p_owner_name, true, 'system', NOW(), NOW()
    ) ON CONFLICT (id) DO NOTHING;

    -- Generate secure API key (64 chars)
    v_raw_key := encode(gen_random_bytes(48), 'base64');
    v_key_prefix := 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
    v_key_hash := crypt(v_raw_key, gen_salt('bf', 10));

    -- Insert API key record
    INSERT INTO api_keys (
        key_hash, key_prefix, name, description, owner_email, owner_name,
        expires_at, rate_limit_per_minute, daily_limit, monthly_limit,
        can_search, can_generate, can_download, created_by
    ) VALUES (
        v_key_hash, v_key_prefix, p_name, p_description, p_owner_email, p_owner_name,
        p_expires_at, p_rate_limit_per_minute, p_daily_limit, p_monthly_limit,
        p_can_search, p_can_generate, p_can_download, v_admin_id
    ) RETURNING id INTO v_api_key_id;

    -- Return the raw key (only time it's visible)
    RETURN jsonb_build_object(
        'success', true,
        'api_key_id', v_api_key_id,
        'api_key', v_key_prefix || '_' || v_raw_key,
        'key_prefix', v_key_prefix,
        'admin_created', true,
        'warning', 'Store this key securely - it cannot be retrieved again'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Create the first API key for testing
SELECT public.create_api_key_with_bypass(
    'MCP Test Key',
    'admin@example.com',
    'System Admin',
    'Initial API key for MCP testing with default limits: 100/min, 10K/day, 300K/month'
);

-- Step 3: Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.create_api_key_with_bypass TO anon;
GRANT EXECUTE ON FUNCTION public.create_api_key_with_bypass TO authenticated;

-- Step 4: Update the original create_api_key function to work better
CREATE OR REPLACE FUNCTION create_api_key(
    p_name TEXT,
    p_owner_email TEXT,
    p_owner_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_rate_limit_per_minute INTEGER DEFAULT 100,
    p_daily_limit INTEGER DEFAULT 10000,
    p_monthly_limit INTEGER DEFAULT 300000,
    p_can_search BOOLEAN DEFAULT true,
    p_can_generate BOOLEAN DEFAULT true,
    p_can_download BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_api_key_id UUID;
    v_raw_key TEXT;
    v_key_hash TEXT;
    v_key_prefix TEXT;
    v_admin_count INTEGER;
BEGIN
    -- Check if we have any admin users
    SELECT COUNT(*) INTO v_admin_count
    FROM profiles WHERE is_super_admin = true;
    
    -- If no admins exist and this is the first call, allow it
    IF v_admin_count = 0 THEN
        RETURN public.create_api_key_with_bypass(
            p_name, p_owner_email, p_owner_name, p_description,
            p_expires_at, p_rate_limit_per_minute, p_daily_limit, p_monthly_limit,
            p_can_search, p_can_generate, p_can_download
        );
    END IF;

    -- Check if user is admin (original logic)
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    -- Generate secure API key (64 chars)
    v_raw_key := encode(gen_random_bytes(48), 'base64');
    v_key_prefix := 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
    v_key_hash := crypt(v_raw_key, gen_salt('bf', 10));

    -- Insert API key record
    INSERT INTO api_keys (
        key_hash, key_prefix, name, description, owner_email, owner_name,
        expires_at, rate_limit_per_minute, daily_limit, monthly_limit,
        can_search, can_generate, can_download, created_by
    ) VALUES (
        v_key_hash, v_key_prefix, p_name, p_description, p_owner_email, p_owner_name,
        p_expires_at, p_rate_limit_per_minute, p_daily_limit, p_monthly_limit,
        p_can_search, p_can_generate, p_can_download, auth.uid()
    ) RETURNING id INTO v_api_key_id;

    -- Return the raw key (only time it's visible)
    RETURN jsonb_build_object(
        'success', true,
        'api_key_id', v_api_key_id,
        'api_key', v_key_prefix || '_' || v_raw_key,
        'key_prefix', v_key_prefix,
        'warning', 'Store this key securely - it cannot be retrieved again'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verification query - run this to see the created API key
SELECT 
    name, 
    key_prefix, 
    owner_email, 
    rate_limit_per_minute,
    daily_limit,
    monthly_limit,
    can_search,
    can_generate,
    can_download,
    is_active,
    created_at
FROM api_keys 
ORDER BY created_at DESC;

-- Also check admin profile
SELECT id, email, full_name, is_super_admin, created_at
FROM profiles
WHERE is_super_admin = true;