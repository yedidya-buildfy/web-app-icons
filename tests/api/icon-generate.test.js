const request = require('supertest');
const nock = require('nock');

// We'll import the server after setting up mocks
let app;

describe('POST /api/icons/generate', () => {
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

    nock('https://test.supabase.co')
      .persist()
      .post('/rest/v1/generated_icons')
      .reply(200, [{ id: 'generated-id' }]);

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
        .post('/api/icons/generate')
        .send({ subject: 'cat' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing API key');
    });

    it('should require generation permission', async () => {
      // Mock API key without generation permission
      nock('https://test.supabase.co')
        .get('/rest/v1/api_keys')
        .query(true)
        .reply(200, [{
          id: 'test-key-id',
          key_prefix: 'ak_test',
          key_hash: '$2b$10$test.hash.here',
          is_active: true,
          expires_at: null,
          can_search: true,
          can_generate: false, // No generation permission
          can_download: true
        }]);

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', 'Bearer ak_test_validkey')
        .send({ subject: 'cat' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('API key does not have generation permission');
    });
  });

  describe('Request Validation', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      // Reset mocks for each test
      nock.cleanAll();
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
          can_generate: true
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });
    });

    it('should require subject parameter', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors).toContain('subject is required and must be a non-empty string');
    });

    it('should reject empty subject', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject non-string subject', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should validate style parameter', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'cat',
          style: 'invalid-style'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('style must be one of');
    });

    it('should validate removeBackground parameter', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'cat',
          removeBackground: 'not-boolean'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('removeBackground must be a boolean');
    });

    it('should validate backgroundTolerance parameter', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'cat',
          backgroundTolerance: 250 // Above maximum
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('backgroundTolerance must be a number between 1 and 200');
    });

    it('should validate backgroundFeather parameter', async () => {
      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'cat',
          backgroundFeather: 15 // Above maximum
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.errors[0]).toContain('backgroundFeather must be a number between 0.5 and 10');
    });
  });

  describe('Icon Generation Functionality', () => {
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
          can_generate: true
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/generated_icons')
        .reply(200, [{ id: 'generated-id' }]);
    });

    it('should generate icon successfully', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'test-uuid-123',
          imageURL: 'https://im.runware.ai/test/generated-cat.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      // Mock image download for SVG conversion
      nock('https://im.runware.ai')
        .get('/test/generated-cat.jpg')
        .reply(200, Buffer.from('fake-image-data'));

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'cute cat',
          style: 'outline',
          colors: 'black and white'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.icon).toBeDefined();
      expect(response.body.icon.id).toContain('generated-');
      expect(response.body.icon.type).toBe('generated');
      expect(response.body.icon.svg).toBeDefined();
      expect(response.body.prompt).toContain('cute cat');
      expect(response.body.taskUUID).toBe('test-uuid-123');
    }, 15000);

    it('should handle all generation parameters', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'test-uuid-456',
          imageURL: 'https://im.runware.ai/test/complex-icon.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      nock('https://im.runware.ai')
        .get('/test/complex-icon.jpg')
        .reply(200, Buffer.from('fake-complex-image-data'));

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'flying rocket',
          context: 'space app',
          style: 'filled',
          colors: 'blue gradient',
          background: 'transparent',
          removeBackground: true,
          backgroundTolerance: 45,
          backgroundFeather: 3.0
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.parameters).toEqual({
        subject: 'flying rocket',
        context: 'space app',
        style: 'filled',
        colors: 'blue gradient',
        background: 'transparent'
      });
      expect(response.body.prompt).toContain('flying rocket');
      expect(response.body.prompt).toContain('space app');
      expect(response.body.prompt).toContain('filled');
    }, 15000);

    it('should handle background removal disabled', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'test-uuid-789',
          imageURL: 'https://im.runware.ai/test/original-bg.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      nock('https://im.runware.ai')
        .get('/test/original-bg.jpg')
        .reply(200, Buffer.from('fake-original-image'));

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'logo design',
          removeBackground: false
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }, 15000);

    it('should handle Runware API errors', async () => {
      nock('https://api.runware.ai')
        .post('/v1')
        .reply(400, { 
          error: [{ message: 'Invalid prompt' }]
        });

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid prompt');
    }, 15000);

    it('should handle missing RUNWARE_API_KEY', async () => {
      // Mock missing API key scenario
      const originalEnv = process.env.RUNWARE_API_KEY;
      delete process.env.RUNWARE_API_KEY;

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Server not configured: RUNWARE_API_KEY missing');

      // Restore original env
      process.env.RUNWARE_API_KEY = originalEnv;
    });

    it('should handle Runware timeout', async () => {
      nock('https://api.runware.ai')
        .post('/v1')
        .delay(35000) // Simulate timeout beyond 30s
        .reply(200, {});

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Generation service timeout');
    }, 40000);

    it('should handle invalid Runware response', async () => {
      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, { data: [] }); // No image inference result

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Image generation failed');
    }, 15000);

    it('should handle SVG conversion failure', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'test-uuid-fail',
          imageURL: 'https://im.runware.ai/test/broken-image.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      // Mock broken image download
      nock('https://im.runware.ai')
        .get('/test/broken-image.jpg')
        .reply(404, 'Image not found');

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ subject: 'test' });

      expect(response.status).toBe(200); // Should still succeed with fallback SVG
      expect(response.body.success).toBe(true);
      expect(response.body.icon.svg).toContain('<svg'); // Fallback SVG wrapper
    }, 15000);
  });

  describe('Database Integration', () => {
    const validApiKey = 'ak_test_validkey';

    beforeEach(() => {
      nock.cleanAll();
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
          can_generate: true
        }]);

      nock('https://test.supabase.co')
        .persist()
        .post('/rest/v1/rpc/track_api_key_usage')
        .reply(200, { success: true });
    });

    it('should save generated icon to database', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'db-test-uuid',
          imageURL: 'https://im.runware.ai/test/db-save.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      nock('https://im.runware.ai')
        .get('/test/db-save.jpg')
        .reply(200, Buffer.from('fake-db-image'));

      const dbSaveScope = nock('https://test.supabase.co')
        .post('/rest/v1/generated_icons')
        .reply(200, [{ id: 'saved-icon-id' }]);

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'database test',
          style: 'outline'
        });

      expect(response.status).toBe(200);
      expect(dbSaveScope.isDone()).toBe(true);
    }, 15000);

    it('should handle database save failures gracefully', async () => {
      const mockRunwareResponse = {
        data: [{
          taskType: 'imageInference',
          taskUUID: 'db-fail-uuid',
          imageURL: 'https://im.runware.ai/test/db-fail.jpg'
        }]
      };

      nock('https://api.runware.ai')
        .post('/v1')
        .reply(200, mockRunwareResponse);

      nock('https://im.runware.ai')
        .get('/test/db-fail.jpg')
        .reply(200, Buffer.from('fake-db-fail-image'));

      nock('https://test.supabase.co')
        .post('/rest/v1/generated_icons')
        .reply(400, { error: 'Database error' });

      const response = await request(app)
        .post('/api/icons/generate')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ 
          subject: 'database fail test'
        });

      // Should still succeed even if database save fails
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }, 15000);
  });
});