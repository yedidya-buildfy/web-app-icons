const request = require('supertest');
const nock = require('nock');

// We'll import the server after setting up mocks
let app;

describe('GET /api/usage', () => {
  beforeAll(async () => {
    // Mock bcrypt compare for API key validation
    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    
    // Import server after mocks are set up
    app = require('../../server.js');
  });

  afterAll(() => {
    nock.cleanAll();
    jest.restoreAllMocks();
  });

  describe('Authentication', () => {
    beforeEach(() => {
      nock.cleanAll();
    });

    it('should reject requests without API key', async () => {
      const response = await request(app)
        .get('/api/usage');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing API key');
    });

    it('should reject invalid API key format', async () => {
      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', 'Bearer invalid_format');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid API key format');
    });

    it('should reject inactive API key', async () => {
      nock('https://test.supabase.co')
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: false, // Inactive key
          expires_at: null
        }]);

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', 'Bearer ak_test_validkey');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid or inactive API key');
    });

    it('should reject expired API key', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      nock('https://test.supabase.co')
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          expires_at: yesterday.toISOString() // Expired
        }]);

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', 'Bearer ak_test_validkey');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('API key has expired');
    });
  });

  describe('Usage Statistics', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      nock.cleanAll();
      
      // Mock API key validation
      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          expires_at: null,
          name: 'Test API Key',
          can_search: true,
          can_generate: true,
          can_download: true,
          rate_limit_per_minute: 100,
          daily_limit: 1000,
          monthly_limit: 10000
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, { allowed: true, remaining: 100 });

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });
    });

    it('should return comprehensive usage statistics', async () => {
      const mockDailyUsage = [
        {
          usage_date: '2024-01-15',
          total_requests: 250,
          search_requests: 150,
          generate_requests: 85,
          download_requests: 15,
          error_count: 0
        },
        {
          usage_date: '2024-01-14',
          total_requests: 180,
          search_requests: 120,
          generate_requests: 50,
          download_requests: 10,
          error_count: 2
        }
      ];

      const mockHourlyUsage = [
        {
          date_hour: '2024-01-15T14:00:00Z',
          total_requests: 25,
          search_requests: 15,
          generate_requests: 8,
          download_requests: 2
        }
      ];

      const mockRateLimitMinute = {
        current_usage: 33,
        limit: 100,
        remaining: 67,
        allowed: true
      };

      const mockRateLimitDaily = {
        current_usage: 1247,
        limit: 1000,
        remaining: -247, // Over limit but still allowed for this endpoint
        allowed: true
      };

      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(200, mockDailyUsage);

      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_usage')
        .query(true)
        .reply(200, mockHourlyUsage);

      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, mockRateLimitMinute);

      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, mockRateLimitDaily);

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify API key info
      expect(response.body.apiKey).toEqual({
        name: 'Test API Key',
        prefix: 'ak_test',
        permissions: {
          canSearch: true,
          canGenerate: true,
          canDownload: true
        },
        limits: {
          perMinute: 100,
          daily: 1000,
          monthly: 10000
        }
      });

      // Verify usage statistics
      expect(response.body.usage).toBeDefined();
      expect(response.body.usage.today).toEqual({
        total: 250,
        search: 150,
        generate: 85,
        download: 15,
        errors: 0
      });
      expect(response.body.usage.last30Days).toEqual(mockDailyUsage);
      expect(response.body.usage.last24Hours).toEqual(mockHourlyUsage);

      // Verify rate limits
      expect(response.body.rateLimits.perMinute).toEqual(mockRateLimitMinute);
      expect(response.body.rateLimits.daily).toEqual(mockRateLimitDaily);
    });

    it('should handle missing usage data gracefully', async () => {
      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(200, []); // No data

      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_usage')
        .query(true)
        .reply(200, []); // No data

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.usage.today).toEqual({
        total: 0,
        search: 0,
        generate: 0,
        download: 0,
        errors: 0
      });
      expect(response.body.usage.last30Days).toEqual([]);
      expect(response.body.usage.last24Hours).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(500, 'Database error');

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve usage statistics');
    });

    it('should track the usage check request itself', async () => {
      const trackingScope = nock('https://test.supabase.co')
        .post('/rest/v1/rpc/track_api_key_usage', {
          p_api_key_id: 'test-key-id',
          p_endpoint: '/api/usage',
          p_method: 'GET',
          p_status_code: 200,
          p_response_time_ms: null
        })
        .reply(200, { success: true });

      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(200, []);

      nock('https://test.supabase.co')
        .get('/rest/v1/api_key_usage')
        .query(true)
        .reply(200, []);

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(trackingScope.isDone()).toBe(true);
    });
  });

  describe('Rate Limit Information', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      nock.cleanAll();
      
      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          expires_at: null,
          name: 'Test API Key',
          can_search: true,
          can_generate: true,
          can_download: true,
          rate_limit_per_minute: 60,
          daily_limit: 500,
          monthly_limit: 5000
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });

      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(200, []);

      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_key_usage')
        .query(true)
        .reply(200, []);
    });

    it('should show rate limit approaching warning', async () => {
      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, {
          current_usage: 55,
          limit: 60,
          remaining: 5,
          allowed: true
        });

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.rateLimits.perMinute.remaining).toBe(5);
      expect(response.body.rateLimits.perMinute.allowed).toBe(true);
    });

    it('should show daily limit exceeded', async () => {
      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, { allowed: true, remaining: 60 });

      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, {
          current_usage: 750,
          limit: 500,
          remaining: -250,
          allowed: false
        });

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.rateLimits.daily.remaining).toBe(-250);
      expect(response.body.rateLimits.daily.allowed).toBe(false);
    });

    it('should provide fallback rate limit info if database fails', async () => {
      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(500, 'Database error');

      const response = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.rateLimits.perMinute).toEqual({
        current_usage: 0,
        limit: 60,
        remaining: 60
      });
    });
  });

  describe('Caching', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      nock.cleanAll();
      
      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'cache-test-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          expires_at: null,
          name: 'Cached Test Key',
          can_search: true,
          can_generate: true,
          can_download: true,
          rate_limit_per_minute: 100,
          daily_limit: 1000,
          monthly_limit: 10000
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });

      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_key_daily_usage')
        .query(true)
        .reply(200, []);

      nock('https://test.supabase.co')
        .persist()
        .get('/rest/v1/api_key_usage')
        .query(true)
        .reply(200, []);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, { allowed: true, remaining: 100 });
    });

    it('should cache API key validation', async () => {
      // First request should hit database
      const firstRequest = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(firstRequest.status).toBe(200);

      // Second request should use cache (no additional database calls)
      const secondRequest = await request(app)
        .get('/api/usage')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(secondRequest.status).toBe(200);
      expect(secondRequest.body.apiKey.name).toBe('Cached Test Key');
    });
  });
});