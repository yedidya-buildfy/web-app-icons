// GET /api/usage - Check API key usage and limits
const { supabase, requireApiKey, sendError, sendSuccess } = require('./_utils');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'Method not allowed');
  }

  // Require API key authentication
  const auth = await requireApiKey(req, res, 'usage');
  if (!auth) return; // Error already sent

  if (!supabase) {
    return sendError(res, 500, 'Database not configured');
  }

  try {
    // Get daily usage
    const { data: dailyUsage, error: dailyError } = await supabase
      .from('api_key_daily_usage')
      .select('*')
      .eq('api_key_id', auth.apiKeyId)
      .eq('usage_date', new Date().toISOString().split('T')[0])
      .single();

    // Get total usage
    const { data: totalUsage, error: totalError } = await supabase
      .from('api_key_usage')
      .select('*')
      .eq('api_key_id', auth.apiKeyId)
      .order('created_at', { ascending: false })
      .limit(1);

    // Get current rate limit status
    const { data: minuteLimit, error: minuteError } = await supabase
      .rpc('check_api_key_rate_limit', {
        p_api_key_id: auth.apiKeyId,
        p_check_type: 'minute'
      });

    const { data: dailyLimit, error: dailyLimitError } = await supabase
      .rpc('check_api_key_rate_limit', {
        p_api_key_id: auth.apiKeyId,
        p_check_type: 'daily'
      });

    const response = {
      success: true,
      apiKey: {
        name: auth.keyInfo.name,
        prefix: auth.keyInfo.prefix
      },
      usage: {
        totalRequests: dailyUsage?.total_requests || 0,
        firstUsed: totalUsage?.[0]?.created_at || null,
        lastUsed: totalUsage?.[0]?.created_at || null,
        endpoints: {
          search: dailyUsage?.search_requests || 0,
          generate: dailyUsage?.generate_requests || 0,
          details: dailyUsage?.download_requests || 0
        },
        rateLimit: {
          current: minuteLimit?.current_usage || 0,
          max: minuteLimit?.limit || 100,
          windowMs: 60000,
          resetsAt: new Date(Date.now() + 60000).toISOString()
        },
        daily: {
          current: dailyLimit?.current_usage || 0,
          max: dailyLimit?.limit || 10000,
          date: new Date().toISOString().split('T')[0]
        }
      }
    };

    sendSuccess(res, response);

  } catch (error) {
    console.error('Usage endpoint error:', error);
    sendError(res, 500, 'Failed to retrieve usage data');
  }
}