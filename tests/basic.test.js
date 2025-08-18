const request = require('supertest');

describe('Basic Server Test', () => {
  let app;

  beforeAll(async () => {
    // Import server after setting environment
    process.env.NODE_ENV = 'test';
    process.env.RUNWARE_API_KEY = 'test_key';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test_key';
    
    app = require('../server.js');
  });

  it('should respond to health check', async () => {
    const response = await request(app)
      .get('/');
    
    expect(response.status).toBe(200);
  });

  it('should serve static files', async () => {
    const response = await request(app)
      .get('/index.html');
    
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('should return 404 for non-existent endpoints', async () => {
    const response = await request(app)
      .get('/nonexistent');
    
    expect(response.status).toBe(404);
  });
});