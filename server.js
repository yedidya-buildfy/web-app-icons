const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const potrace = require('potrace');

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

const MAX_BYTES = 12 * 1024 * 1024; // 12MB cap for PNG-to-SVG conversion

// Removed Aicon URL mapping/cache; we always use the original source URLs now

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Allow connections to Iconify API/CDN for free stock icon search and fetching
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://code.iconify.design https://cdn.jsdelivr.net/npm/@supabase/supabase-js; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.runware.ai https://kfeekskddfyyosyyplxd.supabase.co https://api.iconify.design https://cdn.jsdelivr.net https://code.iconify.design; frame-ancestors 'none';");
}

// Removed Aicon-specific headers

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

// Removed /aicon image serving; no longer proxied via custom IDs

// Removed URL cache helpers

// PNG-to-SVG conversion functionality
function potraceTrace(buffer, opts) {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, opts, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

async function handleVectorize(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const imageUrl = urlObj.searchParams.get('url');
    const color = urlObj.searchParams.get('color') || '#000000';
    const threshold = parseInt(urlObj.searchParams.get('threshold') || '128');
    const turdSize = parseInt(urlObj.searchParams.get('turdSize') || '2');
    const invert = urlObj.searchParams.get('invert') === 'true';
    
    if (!imageUrl) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    // Validate URL
    try {
      const u = new URL(imageUrl);
      if (!/^https?:$/.test(u.protocol)) throw new Error('invalid protocol');
    } catch {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }

    // Fetch the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      headers: { 
        'User-Agent': 'icon-search-app/1.0 (+https://local)', 
        'Accept': 'image/*,*/*' 
      },
      validateStatus: s => s >= 200 && s < 400
    });

    const buf = Buffer.from(response.data);
    if (buf.length > MAX_BYTES) {
      setSecurityHeaders(res);
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image too large' }));
      return;
    }

    // Normalize to paletted PNG (Potrace prefers bitmap)
    const png = await sharp(buf)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .png({ palette: true })
      .toBuffer();

    // Convert to SVG using potrace
    const svg = await potraceTrace(png, {
      color: String(color),
      threshold: Number(threshold),
      turdSize: Number(turdSize),
      invert: Boolean(invert),
      optTolerance: 0.2
    });

    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(svg);
  } catch (err) {
    console.error('vectorize error:', err);
    const msg = (err && err.response && err.response.status) 
      ? `Upstream HTTP ${err.response.status}` 
      : String(err && err.code ? err.code : err);
    setSecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Vectorization failed', details: msg }));
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

  // Lightweight proxy for Iconify search to improve reliability and avoid CORS/CSP issues
  if (req.method === 'GET' && pathname === '/api/iconify-search') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const query = (urlObj.searchParams.get('query') || '').trim();
      const limitRaw = urlObj.searchParams.get('limit') || '100';
      const limit = Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 100));

      if (!query) {
        setSecurityHeaders(res);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing query' }));
        return;
      }

      const upstreamUrl = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${limit}`;
      const upReq = https.get(upstreamUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'icon-search-app/1.0 (+local)'
        }
      }, (upRes) => {
        let data = '';
        upRes.on('data', (chunk) => { data += chunk; if (data.length > 5e6) upReq.destroy(); });
        upRes.on('end', () => {
          setSecurityHeaders(res);
          const status = upRes.statusCode || 502;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
          res.end(data);
        });
      });
      upReq.on('error', () => {
        setSecurityHeaders(res);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Iconify upstream error' }));
      });
    } catch (e) {
      setSecurityHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Iconify proxy error' }));
    }
    return;
  }

  if (pathname === '/api/generate') {
    if (req.method === 'OPTIONS') {
      setSecurityHeaders(res);
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'POST') return handleGenerate(req, res);
  }

  // Removed /api/cache-url endpoint

  // Removed /aicon/* route

  if (req.method === 'GET' && pathname === '/proxy-image') {
    return proxyImage(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/vectorize') {
    return handleVectorize(req, res);
  }

  if (req.method !== 'GET') {
    setSecurityHeaders(res);
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  serveStatic(req, res);
});

// Removed test exposure of URL cache

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Aicon URL route removed
});