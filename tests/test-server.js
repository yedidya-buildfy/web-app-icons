// Test-specific server setup that doesn't auto-listen
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const potrace = require('potrace');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables for testing
process.env.NODE_ENV = 'test';
process.env.RUNWARE_API_KEY = process.env.RUNWARE_API_KEY || 'test_runware_key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test_supabase_key';
process.env.PORT = process.env.PORT || '3001';

// Import the server logic without the listen() call
// We'll create a modified version that returns the server instance
const originalServerCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract just the server creation part, excluding the listen() call
const serverCodeWithoutListen = originalServerCode.replace(
  /server\.listen\(PORT[^}]+\}\);?\s*$/m,
  '// Listen call removed for testing'
);

// Evaluate the server code in this context
let server;
try {
  // Use eval to execute the server code (normally not recommended, but for testing it's acceptable)
  eval(serverCodeWithoutListen);
} catch (error) {
  console.error('Failed to load server code:', error);
  throw error;
}

// Export the server instance for testing
module.exports = server;