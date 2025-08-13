-- API Key Management System
-- This migration creates tables for managing API keys with proper security and tracking

-- API Keys table for managing access to the service
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash TEXT NOT NULL UNIQUE, -- bcrypt hash of the API key
    key_prefix TEXT NOT NULL, -- first 8 chars for identification (e.g., "ak_12345...")
    name TEXT NOT NULL, -- human-readable name for the key
    description TEXT, -- optional description
    owner_email TEXT NOT NULL, -- contact email for the key owner
    owner_name TEXT, -- optional name of key owner
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- optional expiration date
    last_used_at TIMESTAMPTZ, -- track when key was last used
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Usage limits
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 100,
    daily_limit INTEGER DEFAULT 10000,
    monthly_limit INTEGER DEFAULT 300000,
    
    -- Permissions
    can_search BOOLEAN NOT NULL DEFAULT true,
    can_generate BOOLEAN NOT NULL DEFAULT true,
    can_download BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id),
    notes TEXT, -- internal notes
    
    -- Indexes for performance
    CONSTRAINT valid_email CHECK (owner_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- API Key Usage Tracking table
CREATE TABLE IF NOT EXISTS api_key_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL, -- which endpoint was called
    method TEXT NOT NULL, -- HTTP method
    status_code INTEGER, -- response status
    request_count INTEGER NOT NULL DEFAULT 1,
    total_response_time_ms INTEGER, -- for performance tracking
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_hour TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('hour', NOW()), -- for aggregation
    
    -- For efficient querying
    UNIQUE(api_key_id, endpoint, date_hour)
);

-- Daily usage summary for quick lookups
CREATE TABLE IF NOT EXISTS api_key_daily_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_requests INTEGER NOT NULL DEFAULT 0,
    search_requests INTEGER NOT NULL DEFAULT 0,
    generate_requests INTEGER NOT NULL DEFAULT 0,
    download_requests INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(api_key_id, usage_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner_email ON api_keys(owner_email);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id ON api_key_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_date_hour ON api_key_usage(date_hour);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON api_key_daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_key_id ON api_key_daily_usage(api_key_id);

-- RLS (Row Level Security) policies
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_daily_usage ENABLE ROW LEVEL SECURITY;

-- Admin users can see all keys
CREATE POLICY api_keys_admin_all ON api_keys
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

-- Users can see their own keys (if we add user-owned keys later)
CREATE POLICY api_keys_owner_read ON api_keys
    FOR SELECT USING (created_by = auth.uid());

-- Admin access for usage tables
CREATE POLICY api_key_usage_admin_read ON api_key_usage
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

CREATE POLICY api_key_daily_usage_admin_read ON api_key_daily_usage
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

-- Functions for API key management
CREATE OR REPLACE FUNCTION generate_api_key_prefix()
RETURNS TEXT AS $$
BEGIN
    RETURN 'ak_' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12);
END;
$$ LANGUAGE plpgsql;

-- Function to track API key usage (called from server)
CREATE OR REPLACE FUNCTION track_api_key_usage(
    p_api_key_id UUID,
    p_endpoint TEXT,
    p_method TEXT DEFAULT 'GET',
    p_status_code INTEGER DEFAULT 200,
    p_response_time_ms INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Update hourly usage
    INSERT INTO api_key_usage (
        api_key_id, endpoint, method, status_code, 
        total_response_time_ms, date_hour
    ) VALUES (
        p_api_key_id, p_endpoint, p_method, p_status_code,
        p_response_time_ms, DATE_TRUNC('hour', NOW())
    )
    ON CONFLICT (api_key_id, endpoint, date_hour) 
    DO UPDATE SET
        request_count = api_key_usage.request_count + 1,
        total_response_time_ms = COALESCE(api_key_usage.total_response_time_ms, 0) + COALESCE(p_response_time_ms, 0);

    -- Update daily summary
    INSERT INTO api_key_daily_usage (api_key_id, usage_date, total_requests)
    VALUES (p_api_key_id, CURRENT_DATE, 1)
    ON CONFLICT (api_key_id, usage_date)
    DO UPDATE SET
        total_requests = api_key_daily_usage.total_requests + 1,
        search_requests = CASE WHEN p_endpoint LIKE '%search%' THEN api_key_daily_usage.search_requests + 1 ELSE api_key_daily_usage.search_requests END,
        generate_requests = CASE WHEN p_endpoint LIKE '%generate%' THEN api_key_daily_usage.generate_requests + 1 ELSE api_key_daily_usage.generate_requests END,
        download_requests = CASE WHEN p_endpoint LIKE '%download%' THEN api_key_daily_usage.download_requests + 1 ELSE api_key_daily_usage.download_requests END,
        error_count = CASE WHEN p_status_code >= 400 THEN api_key_daily_usage.error_count + 1 ELSE api_key_daily_usage.error_count END,
        updated_at = NOW();

    -- Update last_used_at on the API key
    UPDATE api_keys 
    SET last_used_at = NOW() 
    WHERE id = p_api_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check API key rate limits
CREATE OR REPLACE FUNCTION check_api_key_rate_limit(
    p_api_key_id UUID,
    p_check_type TEXT DEFAULT 'minute' -- 'minute', 'daily', 'monthly'
)
RETURNS JSONB AS $$
DECLARE
    v_key_record RECORD;
    v_current_usage INTEGER := 0;
    v_limit INTEGER := 0;
    v_window_start TIMESTAMPTZ;
BEGIN
    -- Get API key info
    SELECT rate_limit_per_minute, daily_limit, monthly_limit, is_active
    INTO v_key_record
    FROM api_keys
    WHERE id = p_api_key_id;

    IF NOT FOUND OR NOT v_key_record.is_active THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_or_inactive_key');
    END IF;

    -- Check based on type
    IF p_check_type = 'minute' THEN
        v_limit := v_key_record.rate_limit_per_minute;
        v_window_start := NOW() - INTERVAL '1 minute';
        
        SELECT COALESCE(SUM(request_count), 0)
        INTO v_current_usage
        FROM api_key_usage
        WHERE api_key_id = p_api_key_id
        AND created_at >= v_window_start;
        
    ELSIF p_check_type = 'daily' THEN
        v_limit := v_key_record.daily_limit;
        
        SELECT COALESCE(total_requests, 0)
        INTO v_current_usage
        FROM api_key_daily_usage
        WHERE api_key_id = p_api_key_id
        AND usage_date = CURRENT_DATE;
        
    ELSIF p_check_type = 'monthly' THEN
        v_limit := v_key_record.monthly_limit;
        
        SELECT COALESCE(SUM(total_requests), 0)
        INTO v_current_usage
        FROM api_key_daily_usage
        WHERE api_key_id = p_api_key_id
        AND usage_date >= DATE_TRUNC('month', CURRENT_DATE);
    END IF;

    -- Return result
    RETURN jsonb_build_object(
        'allowed', v_current_usage < v_limit,
        'current_usage', v_current_usage,
        'limit', v_limit,
        'remaining', GREATEST(0, v_limit - v_current_usage),
        'check_type', p_check_type
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for admin to create new API keys
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
BEGIN
    -- Check if user is admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    -- Generate secure API key (64 chars)
    v_raw_key := encode(gen_random_bytes(48), 'base64');
    v_key_prefix := generate_api_key_prefix();
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

-- Function to revoke/deactivate API key
CREATE OR REPLACE FUNCTION revoke_api_key(p_api_key_id UUID)
RETURNS JSONB AS $$
BEGIN
    -- Check if user is admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    UPDATE api_keys 
    SET is_active = false, updated_at = NOW()
    WHERE id = p_api_key_id;

    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'message', 'API key revoked');
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'api_key_not_found');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add updated_at column to api_keys if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'api_keys' AND column_name = 'updated_at') THEN
        ALTER TABLE api_keys ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();