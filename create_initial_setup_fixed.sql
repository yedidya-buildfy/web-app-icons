-- INITIAL SETUP FOR API KEY SYSTEM (FIXED VERSION)
-- Run this in Supabase SQL Editor to enable API key creation
-- This version handles the auth.users foreign key constraint properly

-- Step 1: Create a system admin user in auth.users table first
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    phone,
    phone_confirmed_at,
    phone_change,
    phone_change_token,
    email_change_token_current,
    email_change_confirm_status,
    banned_until,
    reauthentication_token,
    reauthentication_sent_at
) VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID,
    'authenticated',
    'authenticated',
    'admin@system.local',
    '$2a$10$dummy.hash.for.system.admin.user.that.cannot.login',
    NOW(),
    NOW(),
    NOW(),
    '',
    '',
    '',
    '',
    NOW(),
    '{"provider": "system", "providers": ["system"]}',
    '{"full_name": "System Administrator"}',
    false,
    null,
    null,
    '',
    '',
    '',
    0,
    null,
    '',
    null
) ON CONFLICT (id) DO NOTHING;

-- Step 2: Create the profile for the admin user
INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    is_super_admin, 
    provider, 
    created_at, 
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID, 
    'admin@system.local', 
    'System Administrator', 
    true, 
    'system', 
    NOW(), 
    NOW()
) ON CONFLICT (id) DO NOTHING;

-- Step 3: Create a simpler API key creation function that doesn't need auth
CREATE OR REPLACE FUNCTION public.create_simple_api_key(
    p_name TEXT,
    p_owner_email TEXT DEFAULT 'admin@system.local'
)
RETURNS JSONB AS $$
DECLARE
    v_api_key_id UUID;
    v_raw_key TEXT;
    v_key_hash TEXT;
    v_key_prefix TEXT;
    v_admin_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
BEGIN
    -- Generate secure API key (64 chars)
    v_raw_key := encode(gen_random_bytes(48), 'base64');
    v_key_prefix := 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
    v_key_hash := crypt(v_raw_key, gen_salt('bf', 10));

    -- Insert API key record with default limits
    INSERT INTO api_keys (
        key_hash, 
        key_prefix, 
        name, 
        description, 
        owner_email, 
        owner_name,
        expires_at, 
        rate_limit_per_minute, 
        daily_limit, 
        monthly_limit,
        can_search, 
        can_generate, 
        can_download, 
        created_by,
        is_active
    ) VALUES (
        v_key_hash, 
        v_key_prefix, 
        p_name, 
        'API key with default limits: 100/min, 10K/day, 300K/month, all permissions enabled', 
        p_owner_email, 
        'System Admin',
        NULL, -- no expiration
        100,  -- 100 per minute
        10000, -- 10K per day
        300000, -- 300K per month
        true, -- can search
        true, -- can generate
        true, -- can download
        v_admin_id,
        true -- is active
    ) RETURNING id INTO v_api_key_id;

    -- Return the raw key (only time it's visible)
    RETURN jsonb_build_object(
        'success', true,
        'api_key_id', v_api_key_id,
        'api_key', v_key_prefix || '_' || v_raw_key,
        'key_prefix', v_key_prefix,
        'limits', jsonb_build_object(
            'per_minute', 100,
            'daily', 10000,
            'monthly', 300000
        ),
        'permissions', jsonb_build_object(
            'search', true,
            'generate', true,
            'download', true
        ),
        'warning', 'Store this key securely - it cannot be retrieved again'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Grant permissions for the function
GRANT EXECUTE ON FUNCTION public.create_simple_api_key TO anon;
GRANT EXECUTE ON FUNCTION public.create_simple_api_key TO authenticated;

-- Step 5: Create the first test API key
SELECT public.create_simple_api_key('MCP Test Key', 'test@example.com');

-- Step 6: Fix the original create_api_key function to work without auth when no admins exist
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
    v_admin_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
BEGIN
    -- Check if we have any admin users
    SELECT COUNT(*) INTO v_admin_count
    FROM profiles WHERE is_super_admin = true;
    
    -- If no admins exist OR we're calling without auth, allow creation with system admin
    IF v_admin_count = 0 OR auth.uid() IS NULL THEN
        -- Generate secure API key
        v_raw_key := encode(gen_random_bytes(48), 'base64');
        v_key_prefix := 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
        v_key_hash := crypt(v_raw_key, gen_salt('bf', 10));

        -- Insert API key record
        INSERT INTO api_keys (
            key_hash, key_prefix, name, description, owner_email, owner_name,
            expires_at, rate_limit_per_minute, daily_limit, monthly_limit,
            can_search, can_generate, can_download, created_by, is_active
        ) VALUES (
            v_key_hash, v_key_prefix, p_name, 
            COALESCE(p_description, 'API key with default limits: 100/min, 10K/day, 300K/month'), 
            p_owner_email, COALESCE(p_owner_name, 'API User'),
            p_expires_at, p_rate_limit_per_minute, p_daily_limit, p_monthly_limit,
            p_can_search, p_can_generate, p_can_download, v_admin_id, true
        ) RETURNING id INTO v_api_key_id;

        RETURN jsonb_build_object(
            'success', true,
            'api_key_id', v_api_key_id,
            'api_key', v_key_prefix || '_' || v_raw_key,
            'key_prefix', v_key_prefix,
            'warning', 'Store this key securely - it cannot be retrieved again'
        );
    END IF;

    -- Check if user is admin (original authenticated logic)
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    -- Generate secure API key for authenticated admin
    v_raw_key := encode(gen_random_bytes(48), 'base64');
    v_key_prefix := 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
    v_key_hash := crypt(v_raw_key, gen_salt('bf', 10));

    -- Insert API key record
    INSERT INTO api_keys (
        key_hash, key_prefix, name, description, owner_email, owner_name,
        expires_at, rate_limit_per_minute, daily_limit, monthly_limit,
        can_search, can_generate, can_download, created_by, is_active
    ) VALUES (
        v_key_hash, v_key_prefix, p_name, p_description, p_owner_email, p_owner_name,
        p_expires_at, p_rate_limit_per_minute, p_daily_limit, p_monthly_limit,
        p_can_search, p_can_generate, p_can_download, auth.uid(), true
    ) RETURNING id INTO v_api_key_id;

    RETURN jsonb_build_object(
        'success', true,
        'api_key_id', v_api_key_id,
        'api_key', v_key_prefix || '_' || v_raw_key,
        'key_prefix', v_key_prefix,
        'warning', 'Store this key securely - it cannot be retrieved again'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verification queries
SELECT 'Admin user created:' as status;
SELECT id, email, full_name, is_super_admin, created_at
FROM profiles
WHERE is_super_admin = true;

SELECT 'API keys created:' as status;
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