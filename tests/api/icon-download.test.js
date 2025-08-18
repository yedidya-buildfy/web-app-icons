const request = require('supertest');
const nock = require('nock');

// We'll import the server after setting up mocks
let app;

describe('GET /api/icons/download', () => {
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

  describe('Parameter Validation', () => {
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

    it('should require type parameter', async () => {
      const response = await request(app)
        .get('/api/icons/download')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing or invalid type parameter');
    });

    it('should validate type parameter', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=invalid')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Must be "iconify" or "generated"');
    });

    it('should validate format parameter', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=test:icon&format=invalid')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Must be "svg" or "png"');
    });

    it('should require id for iconify type', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=iconify')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing or invalid id parameter');
    });

    it('should validate iconify id format', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=invalid-format')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing or invalid id parameter');
    });

    it('should require url for generated type', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=generated')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing url parameter');
    });

    it('should validate generated icon URL', async () => {
      const response = await request(app)
        .get('/api/icons/download?type=generated&url=invalid-url')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid URL parameter');
    });
  });

  describe('Iconify Icon Downloads', () => {
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
          can_download: true
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

    it('should download SVG format successfully', async () => {
      const mockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M12 2l8 8H4l8-8z"/></svg>';

      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(200, mockSvg, {
          'content-type': 'image/svg+xml'
        });

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=tabler:home&format=svg')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/svg+xml');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('home.svg');
      expect(response.text).toBe(mockSvg);
    });

    it('should download PNG format successfully', async () => {
      const mockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>';
      const mockPngBuffer = Buffer.from('fake-png-data');

      nock('https://api.iconify.design')
        .get('/tabler:circle.svg')
        .reply(200, mockSvg, {
          'content-type': 'image/svg+xml'
        });

      // Mock Sharp PNG conversion (this would normally be tested with actual Sharp)
      const sharp = require('sharp');
      if (sharp.mockImplementation) {
        sharp.mockImplementation(() => ({
          resize: jest.fn().mockReturnThis(),
          png: jest.fn().mockReturnThis(),
          toBuffer: jest.fn().mockResolvedValue(mockPngBuffer)
        }));
      }

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=tabler:circle&format=png')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toContain('circle.png');
    });

    it('should handle upstream icon not found', async () => {
      nock('https://api.iconify.design')
        .get('/nonexistent:icon.svg')
        .reply(404, 'Not Found');

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=nonexistent:icon&format=svg')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(404);
      expect(response.text).toBe('Not Found');
    });

    it('should handle upstream service errors', async () => {
      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .reply(500, 'Internal Server Error');

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=tabler:home&format=svg')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(500);
    });

    it('should handle network errors', async () => {
      nock('https://api.iconify.design')
        .get('/tabler:home.svg')
        .replyWithError('Network error');

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=tabler:home&format=svg')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Upstream error');
    });
  });

  describe('Generated Icon Downloads', () => {
    const validApiKey = 'ak_test_validkey';
    const testImageUrl = 'https://im.runware.ai/test/generated-icon.jpg';

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
          can_download: true
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

    it('should download generated icon as SVG', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data');

      nock('https://im.runware.ai')
        .get('/test/generated-icon.jpg')
        .reply(200, mockImageBuffer, {
          'content-type': 'image/jpeg'
        });

      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(testImageUrl)}&format=svg`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('.svg');
      expect(response.text).toContain('<svg');
    });

    it('should download generated icon as PNG', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data');
      const mockPngBuffer = Buffer.from('fake-png-data');

      nock('https://im.runware.ai')
        .get('/test/generated-icon.jpg')
        .reply(200, mockImageBuffer, {
          'content-type': 'image/jpeg'
        });

      // Mock Sharp PNG conversion
      const sharp = require('sharp');
      if (sharp.mockImplementation) {
        sharp.mockImplementation(() => ({
          resize: jest.fn().mockReturnThis(),
          png: jest.fn().mockReturnThis(),
          toBuffer: jest.fn().mockResolvedValue(mockPngBuffer)
        }));
      }

      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(testImageUrl)}&format=png`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toContain('.png');
    });

    it('should handle generated image not found', async () => {
      nock('https://im.runware.ai')
        .get('/test/nonexistent-icon.jpg')
        .reply(404, 'Image not found');

      const nonexistentUrl = 'https://im.runware.ai/test/nonexistent-icon.jpg';
      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(nonexistentUrl)}&format=svg`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Vectorization failed');
    });

    it('should handle image processing errors', async () => {
      const mockImageBuffer = Buffer.from('invalid-image-data');

      nock('https://im.runware.ai')
        .get('/test/broken-icon.jpg')
        .reply(200, mockImageBuffer);

      // Mock Sharp error
      const sharp = require('sharp');
      if (sharp.mockImplementation) {
        sharp.mockImplementation(() => {
          throw new Error('Invalid image format');
        });
      }

      const brokenUrl = 'https://im.runware.ai/test/broken-icon.jpg';
      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(brokenUrl)}&format=png`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to convert to PNG');
    });
  });

  describe('Background Removal', () => {
    const validApiKey = 'ak_test_validkey';
    const testImageUrl = 'https://im.runware.ai/test/bg-removal.jpg';

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
          can_download: true
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

    it('should apply background removal when requested', async () => {
      const mockImageBuffer = Buffer.from('fake-image-with-bg');

      nock('https://im.runware.ai')
        .get('/test/bg-removal.jpg')
        .reply(200, mockImageBuffer, {
          'content-type': 'image/jpeg'
        });

      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(testImageUrl)}&format=png&removeBackground=true`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    });

    it('should handle background removal errors gracefully', async () => {
      const mockImageBuffer = Buffer.from('problematic-image-data');

      nock('https://im.runware.ai')
        .get('/test/bg-removal.jpg')
        .reply(200, mockImageBuffer);

      // Mock background removal failure
      const sharp = require('sharp');
      if (sharp.mockImplementation) {
        sharp.mockImplementation(() => ({
          resize: jest.fn().mockReturnThis(),
          ensureAlpha: jest.fn().mockReturnThis(),
          toColorspace: jest.fn().mockReturnThis(),
          raw: jest.fn().mockReturnThis(),
          toBuffer: jest.fn().mockRejectedValue(new Error('Processing failed'))
        }));
      }

      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(testImageUrl)}&format=png&removeBackground=true`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Background removal failed');
    });
  });

  describe('Security', () => {
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
          can_download: true
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

    it('should block private/local URLs', async () => {
      const localUrl = 'http://localhost:8080/internal-file.svg';
      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(localUrl)}&format=svg`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Blocked host');
    });

    it('should block private IP ranges', async () => {
      const privateUrl = 'http://192.168.1.100/file.svg';
      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(privateUrl)}&format=svg`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Blocked host');
    });

    it('should only allow HTTPS/HTTP protocols', async () => {
      const ftpUrl = 'ftp://example.com/file.svg';
      const response = await request(app)
        .get(`/api/icons/download?type=generated&url=${encodeURIComponent(ftpUrl)}&format=svg`)
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Blocked host');
    });

    it('should require download permission', async () => {
      // Mock API key without download permission
      nock('https://test.supabase.co')
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          can_search: true,
          can_generate: true,
          can_download: false // No download permission
        }]);

      const response = await request(app)
        .get('/api/icons/download?type=iconify&id=tabler:home&format=svg')
        .set('Authorization', `Bearer ${validApiKey}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('API key does not have download permission');
    });
  });
});