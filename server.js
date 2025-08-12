const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env (lightweight parser, no external deps)
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) return;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      });
    }
  } catch { /* ignore */ }
})();

const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY || '';
const PORT = process.env.PORT || 3000;

const ALLOWED_IMAGE_HOSTS = new Set([
  'im.runware.ai',
  'api.runware.ai',
]);

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' https://cdn.jsdelivr.net https://code.iconify.design https://cdn.jsdelivr.net/npm/@supabase/supabase-js; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.runware.ai https://kfeekskddfyyosyyplxd.supabase.co; frame-ancestors 'none';");
}

const publicDir = path.join(__dirname, 'public');

function serveStatic(req, res) {
  let pathname = req.url.split('?')[0];
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = path.join(publicDir, pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      setSecurityHeaders(res);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1') return true;
  if (ALLOWED_IMAGE_HOSTS.has(lower)) return false;
  return true; // default deny unless allowed list
}

function proxyImage(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const target = urlObj.searchParams.get('url');
    if (!target) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return;
    }
    const parsed = new URL(target);
    if (!/^https?:$/i.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Blocked host');
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const upstream = client.get(parsed.toString(), { headers: { 'Accept': 'image/*' } }, (upstreamRes) => {
      if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
        setSecurityHeaders(res);
        res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'text/plain' });
        upstreamRes.pipe(res);
        return;
      }
      const contentType = upstreamRes.headers['content-type'] || 'application/octet-stream';
      if (!/^image\//i.test(contentType)) {
        setSecurityHeaders(res);
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('Unsupported media type');
        return;
      }
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      setSecurityHeaders(res);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Upstream error');
    });
  } catch (e) {
    setSecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxy error');
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '[]')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleGenerate(req, res) {
  if (!RUNWARE_API_KEY) {
    setSecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server not configured: RUNWARE_API_KEY missing' }));
    return;
  }
  try {
    const tasks = await readJson(req);
    const safeTasks = tasks.filter(t => t && t.taskType === 'imageInference');
    if (safeTasks.length === 0) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No imageInference task provided' }));
      return;
    }

    const payload = JSON.stringify(safeTasks);

    const upReq = https.request('https://api.runware.ai/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNWARE_API_KEY}`
      }
    }, (upRes) => {
      let data = '';
      upRes.on('data', (d) => { data += d; if (data.length > 5e6) upReq.destroy(); });
      upRes.on('end', () => {
        setSecurityHeaders(res);
        res.writeHead(upRes.statusCode || 200, { 'Content-Type': upRes.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    upReq.on('error', () => {
      setSecurityHeaders(res);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream error' }));
    });
    upReq.write(payload);
    upReq.end();
  } catch (e) {
    setSecurityHeaders(res);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/generate') {
    if (req.method === 'OPTIONS') {
      setSecurityHeaders(res);
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'POST') return handleGenerate(req, res);
  }

  if (req.method === 'GET' && pathname === '/proxy-image') {
    return proxyImage(req, res);
  }

  if (req.method !== 'GET') {
    setSecurityHeaders(res);
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});