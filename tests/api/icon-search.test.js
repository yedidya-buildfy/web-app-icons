const request = require('supertest');
const nock = require('nock');

// We'll import the server after setting up mocks
let app;

describe('POST /api/icons/search', () => {
  beforeAll(async () => {
    // Mock Supabase for API key validation
    nock('https://test.supabase.co')
      .persist()
      .post('/rest/v1/rpc/check_api_key_rate_limit')
      .reply(200, { allowed: true, remaining: 100 });
    
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
    it('should reject requests without API key', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .send({ query: 'home' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing API key');
    });

    it('should accept Bearer token authentication', async () => {
      // Mock Iconify API response
      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, {
          icons: ['tabler:home', 'heroicons:home']
        });

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(200, '<svg>home icon</svg>');

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', 'Bearer ak_test_validkey')
        .send({ query: 'home' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should accept X-API-Key header authentication', async () => {
      // Mock Iconify API response
      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, {
          icons: ['tabler:home']
        });

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(200, '<svg>home icon</svg>');

      const response = await request(app)
        .post('/api/icons/search')
        .set('X-API-Key', 'ak_test_validkey')
        .send({ query: 'home' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid API key format', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', 'Bearer invalid_key_format')
        .send({ query: 'home' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid API key format');
    });
  });

  describe('Request Validation', () => {
    const validApiKey = 'ak_test_validkey';

    it('should require query parameter', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors).toContain('query is required and must be a non-empty string');
    });

    it('should reject empty query', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject non-string query', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should validate library parameter', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          query: 'home',
          library: 'invalid-library'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('library must be one of');
    });

    it('should validate style parameter', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          query: 'home',
          style: 'invalid-style'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('style must be one of');
    });

    it('should validate limit parameter', async () => {
      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          query: 'home',
          limit: 0
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('limit must be an integer between 1 and 200');
    });
  });

  describe('Icon Search Functionality', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      nock.cleanAll();
      // Re-setup persistent mocks
      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, { allowed: true, remaining: 100 });
      
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
    });

    it('should search icons successfully', async () => {
      const mockIcons = ['tabler:home', 'heroicons:home-outline'];
      const mockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M12 3l8 8H4l8-8z"/></svg>';

      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, { icons: mockIcons });

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(200, mockSvg);

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.query).toBe('home');
      expect(response.body.icon).toBeDefined();
      expect(response.body.icon.id).toBe('tabler:home');
      expect(response.body.icon.svg).toBe(mockSvg);
      expect(response.body.icon.metadata.totalFound).toBe(2);
    });

    it('should apply library filter', async () => {
      const mockIcons = ['tabler:home', 'heroicons:home', 'lucide:home'];
      const mockSvg = '<svg>heroicons home</svg>';

      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, { icons: mockIcons });

      nock('https://api.iconify.design')
        .get('/heroicons:home.svg')
        .reply(200, mockSvg);

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          query: 'home',
          library: 'heroicons'
        });

      expect(response.status).toBe(200);
      expect(response.body.icon.id).toBe('heroicons:home');
      expect(response.body.icon.library).toBe('heroicons');
    });

    it('should apply style filter', async () => {
      const mockIcons = ['tabler:home', 'tabler:home-filled', 'tabler:home-outline'];
      const mockSvg = '<svg>filled home</svg>';

      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, { icons: mockIcons });

      nock('https://api.iconify.design')
        .get('/tabler:home-filled.svg')
        .reply(200, mockSvg);

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          query: 'home',
          style: 'filled'
        });

      expect(response.status).toBe(200);
      expect(response.body.icon.id).toBe('tabler:home-filled');
    });

    it('should handle no results found', async () => {
      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'nonexistent', limit: 50 })
        .reply(200, { icons: [] });

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No icons found matching your criteria');
    });

    it('should handle Iconify API errors', async () => {
      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(500, 'Internal Server Error');

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search temporarily unavailable');
    });

    it('should handle SVG fetch errors', async () => {
      const mockIcons = ['tabler:home'];

      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, { icons: mockIcons });

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(404, 'Not Found');

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Failed to fetch icon SVG content');
    });

    it('should handle timeout errors', async () => {
      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .delay(15000) // Simulate timeout
        .reply(200, { icons: [] });

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search service timeout');
    }, 20000);
  });

  describe('Rate Limiting', () => {
    const validApiKey = 'ak_test_validkey';

    it('should respect rate limits', async () => {
      nock('https://test.supabase.co')
        .post('/rest/v1/rpc/check_api_key_rate_limit')
        .reply(200, { 
          allowed: false, 
          remaining: 0,
          check_type: 'minute'
        });

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Rate limit exceeded');
    });

    it('should track API usage', async () => {
      const trackingScope = nock('https://test.supabase.co')
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });

      nock('https://api.iconify.design')
        .get('/search')
        .query({ query: 'home', limit: 50 })
        .reply(200, { icons: ['tabler:home'] });

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(200, '<svg>home</svg>');

      const response = await request(app)
        .post('/api/icons/search')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ query: 'home' });

      expect(response.status).toBe(200);
      expect(trackingScope.isDone()).toBe(true);
    });
  });
});