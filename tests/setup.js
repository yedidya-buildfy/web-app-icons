// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.RUNWARE_API_KEY = 'test_runware_key';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test_supabase_key';
process.env.PORT = '3001'; // Use different port for tests

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn
};

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
});

afterEach(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  jest.clearAllMocks();
});