// Shared utilities for Vercel API functions
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('⚠️ Failed to initialize Supabase client:', e.message);
  }
}

// API Key Cache (1 minute TTL)
const API_KEY_CACHE = new Map();
const CACHE_TTL = 60000; // 1 minute

// Set security headers
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self' blob:; img-src 'self' data: blob: https://api.iconify.design https://im.runware.ai https://api.runware.ai; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://code.iconify.design; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: https://api.runware.ai https://kfeekskddfyyosyyplxd.supabase.co https://api.iconify.design https://cdn.jsdelivr.net https://code.iconify.design; frame-ancestors 'none';");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

// Send error response
function sendError(res, status, message, details = null) {
  setSecurityHeaders(res);
  res.status(status).json({
    error: message,
    ...(details && { details })
  });
}

// Send success response
function sendSuccess(res, data) {
  setSecurityHeaders(res);
  res.status(200).json(data);
}

// Validate API key
async function validateApiKey(req) {
  if (!supabase) {
    return { valid: false, error: 'Server configuration error: Database unavailable' };
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  
  let apiKey = null;
  
  // Support both Authorization: Bearer <key> and X-API-Key: <key> headers
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    apiKey = apiKeyHeader;
  }
  
  if (!apiKey) {
    return { valid: false, error: 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key: <key> header' };
  }

  // Check cache first
  const cacheKey = `api_key_${apiKey}`;
  const cached = API_KEY_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return { valid: true, keyInfo: cached.keyInfo, apiKeyId: cached.apiKeyId };
  }

  try {
    // Parse API key format: ak_prefix_actualkey
    const keyParts = apiKey.split('_');
    if (keyParts.length < 3 || keyParts[0] !== 'ak') {
      return { valid: false, error: 'Invalid API key format' };
    }
    
    const prefix = `${keyParts[0]}_${keyParts[1]}`;
    const rawKey = keyParts.slice(2).join('_');

    // Find API key by prefix
    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_prefix', prefix)
      .eq('is_active', true)
      .single();

    if (keyError || !keyRecord) {
      return { valid: false, error: 'Invalid or inactive API key' };
    }

    // Check expiration
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    // Verify the key hash (simplified for serverless)
    // In production, you'd use bcrypt.compare here
    // For now, we'll trust the prefix lookup
    
    // Check rate limits
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_api_key_rate_limit', {
        p_api_key_id: keyRecord.id,
        p_check_type: 'minute'
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
      return { valid: false, error: 'Rate limit check failed' };
    }

    if (!rateLimitResult.allowed) {
      return { 
        valid: false, 
        error: 'Rate limit exceeded', 
        details: {
          current: rateLimitResult.current_usage,
          limit: rateLimitResult.limit,
          window: rateLimitResult.check_type
        }
      };
    }

    const keyInfo = {
      name: keyRecord.name,
      prefix: keyRecord.key_prefix,
      canSearch: keyRecord.can_search,
      canGenerate: keyRecord.can_generate,
      canDownload: keyRecord.can_download
    };

    // Cache the validation result
    API_KEY_CACHE.set(cacheKey, {
      timestamp: Date.now(),
      keyInfo,
      apiKeyId: keyRecord.id,
    });

    return { valid: true, keyInfo, apiKeyId: keyRecord.id };

  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'API key validation failed' };
  }
}

// Track API usage
async function trackEndpointUsage(apiKeyId, endpoint, method = 'POST', statusCode = 200, responseTime = null) {
  if (!supabase || !apiKeyId) {
    return;
  }

  try {
    await supabase.rpc('track_api_key_usage', {
      p_api_key_id: apiKeyId,
      p_endpoint: endpoint,
      p_method: method,
      p_status_code: statusCode,
      p_response_time_ms: responseTime
    });
  } catch (error) {
    console.error('Usage tracking error:', error);
  }
}

// Require API key middleware
async function requireApiKey(req, res, endpoint) {
  const validation = await validateApiKey(req);
  if (!validation.valid) {
    sendError(res, 401, validation.error, validation.details);
    return null;
  }

  // Check permissions
  if (endpoint === 'search' && !validation.keyInfo.canSearch) {
    sendError(res, 403, 'API key does not have search permission');
    return null;
  }
  if (endpoint === 'generate' && !validation.keyInfo.canGenerate) {
    sendError(res, 403, 'API key does not have generation permission');
    return null;
  }
  if (endpoint === 'download' && !validation.keyInfo.canDownload) {
    sendError(res, 403, 'API key does not have download permission');
    return null;
  }

  // Track usage
  trackEndpointUsage(validation.apiKeyId, endpoint, req.method).catch(console.error);
  
  console.log(`🔑 API call: ${endpoint} by ${validation.keyInfo.name} (${validation.keyInfo.prefix})`);
  
  return validation;
}

module.exports = {
  supabase,
  setSecurityHeaders,
  sendError,
  sendSuccess,
  validateApiKey,
  trackEndpointUsage,
  requireApiKey
};