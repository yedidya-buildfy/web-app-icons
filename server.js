const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const potrace = require('potrace');
const { createClient } = require('@supabase/supabase-js');

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
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Initialize Supabase client for server-side usage tracking
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized for usage tracking');
  } catch (e) {
    console.warn('⚠️ Failed to initialize Supabase client:', e.message);
  }
} else {
  console.warn('⚠️ Supabase configuration missing - usage tracking disabled');
}

const ALLOWED_IMAGE_HOSTS = new Set([
  'im.runware.ai',
  'api.runware.ai',
  'api.iconify.design',
]);

const MAX_BYTES = 12 * 1024 * 1024; // 12MB cap for PNG-to-SVG conversion
const MAX_EDGE_SAMPLES = 5000;      // border pixels to sample for bg estimate

// Removed Aicon URL mapping/cache; we always use the original source URLs now

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Allow connections to Iconify API/CDN for free stock icon search and fetching
  res.setHeader('Content-Security-Policy', "default-src 'self' blob:; img-src 'self' data: blob: https://api.iconify.design https://im.runware.ai https://api.runware.ai; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://code.iconify.design; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: https://api.runware.ai https://kfeekskddfyyosyyplxd.supabase.co https://api.iconify.design https://cdn.jsdelivr.net https://code.iconify.design; frame-ancestors 'none';");
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
  
  // Block localhost variants
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0') return true;
  
  // Block private IP ranges
  if (lower.match(/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./)) return true;
  
  // Block link-local addresses
  if (lower.match(/^169\.254\./)) return true;
  
  // Block loopback IPv6
  if (lower === '::1' || lower === 'localhost6') return true;
  
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

// Background removal utility functions
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function rgbDist2(r1,g1,b1, r2,g2,b2) {
  const dr=r1-r2, dg=g1-g2, db=b1-b2;
  return dr*dr + dg*dg + db*db;
}
function getBorderSamples(rgba, w, h, step=4) {
  const pts = [];
  const push = (x,y)=>{
    const i=(y*w+x)*4;
    pts.push([rgba[i], rgba[i+1], rgba[i+2]]);
  };
  // top & bottom rows
  for(let x=0;x<w;x+=step){ push(x,0); push(x,h-1); }
  // left & right cols
  for(let y=0;y<h;y+=step){ push(0,y); push(w-1,y); }
  return pts;
}
function meanColor(samples){
  let r=0,g=0,b=0;
  for(const s of samples){ r+=s[0]; g+=s[1]; b+=s[2]; }
  const n = Math.max(1, samples.length);
  return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
}
function medianColor(samples){
  const rs = samples.map(s=>s[0]).sort((a,b)=>a-b);
  const gs = samples.map(s=>s[1]).sort((a,b)=>a-b);
  const bs = samples.map(s=>s[2]).sort((a,b)=>a-b);
  const mid = Math.floor(samples.length/2);
  return [rs[mid], gs[mid], bs[mid]];
}

async function handleRemoveBackground(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const {
      url,
      maxSize = "1024",
      tol = "35",         // lower threshold (pixels this close to bg => transparent)
      hard = "55",        // upper threshold (further than this => opaque)
      feather = "2.5",    // feather width multiplier
      despeckle = "1",    // 0..3 rounds of blur-threshold cleanup
      matte = ""          // optional hex to replace transparency with a solid color
    } = Object.fromEntries(urlObj.searchParams);

    if (!url) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    // Validate URL
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('invalid protocol');
    } catch {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }

    const maxDim = clamp(parseInt(maxSize)||1024, 128, 4096);
    const tolVal = clamp(parseFloat(tol)||35, 1, 200);
    const hardVal = Math.max(tolVal+1, clamp(parseFloat(hard)||55, 5, 400));
    const featherMul = clamp(parseFloat(feather)||2.5, 0.5, 10);
    const despeckleRounds = clamp(parseInt(despeckle)||1, 0, 3);

    // 1) Download
    const response = await axios.get(url, {
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

    // 2) Normalize to RGBA on a capped canvas
    const { data, info } = await sharp(buf)
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .toColorspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = new Uint8ClampedArray(data);
    const w = info.width, h = info.height;

    // 3) Estimate background color from border samples using median (classic approach)
    const step = Math.max(1, Math.floor(Math.max(w,h) / 256)); // sample roughly every couple px
    let samples = getBorderSamples(rgba, w, h, step);
    if (samples.length > MAX_EDGE_SAMPLES) samples = samples.filter((_,i)=> i % Math.ceil(samples.length/MAX_EDGE_SAMPLES) === 0);
    const [br, bg, bb] = medianColor(samples);

    // 4) Build alpha via smoothstep between tol and hard (RGB distance)
    const tol2 = tolVal*tolVal;
    const hard2 = hardVal*hardVal;
    const soft2 = lerp(tol2, hard2, 0.5) * featherMul;

    const alpha = new Uint8ClampedArray(w*h);
    for (let y=0; y<h; y++){
      for (let x=0; x<w; x++){
        const i = (y*w + x)*4;
        const d2 = rgbDist2(rgba[i], rgba[i+1], rgba[i+2], br, bg, bb);
        // 0 near bg, 1 near subject
        const a = smoothstep(tol2, soft2, d2);
        alpha[y*w+x] = Math.round(a*255);
      }
    }

    // 5) Despeckle: blur alpha a bit and harden
    const blur = (src, radius=1)=>{
      const dst = new Uint8ClampedArray(src.length);
      const r = Math.max(1, radius|0);
      for (let y=0;y<h;y++){
        for (let x=0;x<w;x++){
          let sum=0, cnt=0;
          for (let dy=-r; dy<=r; dy++){
            const yy = y+dy; if (yy<0||yy>=h) continue;
            for (let dx=-r; dx<=r; dx++){
              const xx = x+dx; if (xx<0||xx>=w) continue;
              sum += src[yy*w+xx]; cnt++;
            }
          }
          dst[y*w+x] = Math.round(sum/cnt);
        }
      }
      return dst;
    };
    let aWork = alpha;
    for (let t=0; t<despeckleRounds; t++){
      aWork = blur(aWork, 1);
      // re-threshold softly around 0.5
      for (let i=0;i<aWork.length;i++){
        const v=aWork[i]/255;
        aWork[i] = Math.round(smoothstep(0.35, 0.65, v)*255);
      }
    }

    // 6) Compose output
    const out = Buffer.alloc(w*h*4);
    for (let i=0, p=0; i<alpha.length; i++, p+=4){
      out[p]   = rgba[p];
      out[p+1] = rgba[p+1];
      out[p+2] = rgba[p+2];
      out[p+3] = aWork[i];
    }

    let img = sharp(out, { raw: { width:w, height:h, channels:4 } });
    if (matte) { // replace transparency with solid color if requested
      const hex = String(matte).replace("#","");
      if (hex.length===6){
        const r = parseInt(hex.slice(0,2),16);
        const g = parseInt(hex.slice(2,4),16);
        const b = parseInt(hex.slice(4,6),16);
        img = img.flatten({ background: { r, g, b } });
      }
    }
    const png = await img.png().toBuffer();

    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  } catch (err) {
    console.error('remove-bg error:', err);
    const msg = (err && err.response && err.response.status) ? `Upstream HTTP ${err.response.status}` : String(err && err.code ? err.code : err);
    setSecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Background removal failed', details: msg }));
  }
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
    const maxSize = 1e5; // 100KB limit for JSON requests
    req.on('data', (chunk) => { 
      body += chunk; 
      if (body.length > maxSize) {
        req.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '[]')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Usage tracking functions
async function trackUsage(userId, eventType, eventSubtype = null, resourceId = null, resourceMetadata = null, ipAddress = null, userAgent = null) {
  if (!supabase) {
    console.log('Usage tracking skipped - Supabase not configured');
    return null;
  }
  
  try {
    // Only track usage for authenticated users with valid profiles
    if (!userId) {
      console.log('📊 Usage tracking skipped - no authenticated user');
      return null;
    }

    // Verify user exists in profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();
    
    if (profileError || !profile) {
      console.log(`⚠️ User profile not found for ${userId}, skipping usage tracking`);
      return null;
    }

    // Call the database function to track usage for authenticated users only
    const { data, error } = await supabase.rpc('track_usage_event', {
      p_user_id: userId,
      p_event_type: eventType,
      p_event_subtype: eventSubtype,
      p_resource_id: resourceId,
      p_resource_metadata: resourceMetadata,
      p_ip_address: ipAddress,
      p_user_agent: userAgent
    });

    if (error) {
      console.error('❌ Usage tracking failed:', error.message);
      return null;
    }
    
    console.log(`📊 Tracked usage: ${eventType}${eventSubtype ? `(${eventSubtype})` : ''} for user ${userId}`);
    return data;
  } catch (e) {
    console.error('❌ Usage tracking exception:', e.message);
    return null;
  }
}

function extractUserFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  try {
    // Extract JWT payload (simple base64 decode - for logging purposes only)
    const token = authHeader.substring(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.sub || null; // 'sub' is the user ID in JWT
  } catch (e) {
    return null;
  }
}

function getClientInfo(req) {
  return {
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null
  };
}

function requireAuthentication(req, res) {
  const userId = extractUserFromAuthHeader(req);
  if (!userId) {
    setSecurityHeaders(res);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Authentication required', 
      message: 'Please log in to use this feature',
      redirect: '/login.html'
    }));
    return false;
  }
  return userId;
}

// API response helpers
function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, details = null) {
  const error = { error: message };
  if (details) error.details = details;
  sendJson(res, statusCode, error);
}

// Request validation helpers
function validateSearchRequest(body) {
  const errors = [];
  
  if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
    errors.push('query is required and must be a non-empty string');
  }
  
  const validLibraries = ['all', 'tabler', 'lucide', 'ph', 'iconoir', 'heroicons-outline', 'heroicons-solid'];
  if (body.library && !validLibraries.includes(body.library)) {
    errors.push(`library must be one of: ${validLibraries.join(', ')}`);
  }
  
  const validStyles = ['all', 'filled', 'outline', 'line', 'solid'];
  if (body.style && !validStyles.includes(body.style)) {
    errors.push(`style must be one of: ${validStyles.join(', ')}`);
  }
  
  if (body.limit && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 200)) {
    errors.push('limit must be an integer between 1 and 200');
  }
  
  return errors;
}

function validateGenerateRequest(body) {
  const errors = [];
  
  if (!body.subject || typeof body.subject !== 'string' || body.subject.trim().length === 0) {
    errors.push('subject is required and must be a non-empty string');
  }
  
  const validStyles = ['outline', 'filled', 'solid', 'duotone', 'rounded'];
  if (body.style && !validStyles.includes(body.style)) {
    errors.push(`style must be one of: ${validStyles.join(', ')}`);
  }
  
  return errors;
}

// API Key Authentication System
const API_KEYS = new Map();
const API_USAGE = new Map();
const API_RATE_LIMITS = new Map();

// Load API keys from environment or config
function loadApiKeys() {
  // For development, load from environment variables
  const keysString = process.env.API_KEYS || '';
  if (keysString) {
    keysString.split(',').forEach(key => {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        API_KEYS.set(trimmedKey, {
          name: `key-${trimmedKey.slice(0, 8)}`,
          created: new Date(),
          active: true
        });
      }
    });
  }
  
  // Default development key if none configured
  if (API_KEYS.size === 0 && process.env.NODE_ENV !== 'production') {
    const devKey = 'dev-key-12345';
    API_KEYS.set(devKey, {
      name: 'Development Key',
      created: new Date(),
      active: true
    });
    console.log(`⚠️  Using development API key: ${devKey}`);
  }
  
  console.log(`🔑 Loaded ${API_KEYS.size} API key(s)`);
}

function validateApiKey(req) {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  
  let apiKey = null;
  
  // Support both Authorization: Bearer <key> and X-API-Key: <key> headers
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    apiKey = apiKeyHeader;
  }
  
  if (!apiKey) {
    return { valid: false, error: 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key: <key> header' };
  }
  
  const keyInfo = API_KEYS.get(apiKey);
  if (!keyInfo || !keyInfo.active) {
    return { valid: false, error: 'Invalid or inactive API key' };
  }
  
  // Rate limiting check
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 100; // 100 requests per minute
  
  if (!API_RATE_LIMITS.has(apiKey)) {
    API_RATE_LIMITS.set(apiKey, { count: 0, windowStart: now });
  }
  
  const rateLimitInfo = API_RATE_LIMITS.get(apiKey);
  
  // Reset window if expired
  if (now - rateLimitInfo.windowStart > windowMs) {
    rateLimitInfo.count = 0;
    rateLimitInfo.windowStart = now;
  }
  
  if (rateLimitInfo.count >= maxRequests) {
    return { valid: false, error: 'Rate limit exceeded. Maximum 100 requests per minute.' };
  }
  
  rateLimitInfo.count++;
  
  // Track usage
  if (!API_USAGE.has(apiKey)) {
    API_USAGE.set(apiKey, { 
      totalRequests: 0, 
      firstUsed: now, 
      lastUsed: now,
      endpoints: new Map()
    });
  }
  
  const usage = API_USAGE.get(apiKey);
  usage.totalRequests++;
  usage.lastUsed = now;
  
  return { valid: true, keyInfo, apiKey };
}

function trackEndpointUsage(apiKey, endpoint) {
  const usage = API_USAGE.get(apiKey);
  if (usage) {
    if (!usage.endpoints.has(endpoint)) {
      usage.endpoints.set(endpoint, 0);
    }
    usage.endpoints.set(endpoint, usage.endpoints.get(endpoint) + 1);
  }
}

function requireApiKey(req, res, endpoint) {
  const validation = validateApiKey(req);
  
  if (!validation.valid) {
    return sendError(res, 401, validation.error);
  }
  
  trackEndpointUsage(validation.apiKey, endpoint);
  console.log(`🔑 API call: ${endpoint} by ${validation.keyInfo.name}`);
  
  return validation;
}

// Initialize API keys
loadApiKeys();

// Helper function to fetch SVG content
async function fetchSvgContent(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'text',
      timeout: 10000,
      headers: { 
        'User-Agent': 'icon-search-app/1.0 (+https://local)', 
        'Accept': 'image/svg+xml,text/plain,*/*' 
      },
      validateStatus: s => s >= 200 && s < 400
    });
    
    return response.data;
  } catch (error) {
    console.error('Failed to fetch SVG:', error.message);
    return null;
  }
}

// Helper function to convert generated image to SVG
async function convertToSvg(imageUrl) {
  try {
    console.log(`🔄 Converting generated image to SVG: ${imageUrl}`);
    
    // First try to vectorize using potrace
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
      throw new Error('Image too large');
    }

    // Normalize to paletted PNG for potrace
    const png = await sharp(buf)
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png({ palette: true })
      .toBuffer();

    // Convert to SVG using potrace
    const svg = await potraceTrace(png, {
      color: '#000000',
      threshold: 128,
      turdSize: 2,
      invert: false,
      optTolerance: 0.2
    });
    
    console.log(`✅ Successfully vectorized to SVG`);
    return svg;
    
  } catch (error) {
    console.log(`⚠️  Vectorization failed (${error.message}), creating simple SVG wrapper`);
    // Fallback: create a simple SVG that embeds the image
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <image href="${imageUrl}" width="1024" height="1024"/>
</svg>`;
  }
}

// Icon filtering logic extracted from frontend
function applyIconFilters(icons, filters) {
  let filteredIcons = icons;
  
  // Library filter
  if (filters.library && filters.library !== 'all') {
    filteredIcons = filteredIcons.filter(id => id.startsWith(filters.library + ':'));
  }
  
  // Sub-library filter
  if (filters.subLibrary && filters.subLibrary !== 'all') {
    filteredIcons = filteredIcons.filter(id => id.startsWith(filters.subLibrary + ':'));
  }
  
  // Fill/Outline filter
  if (filters.style && filters.style !== 'all') {
    filteredIcons = filteredIcons.filter(id => {
      const name = id.split(':')[1];
      if (filters.style === 'filled') {
        return name.includes('fill') || id.includes('filled') || name.includes('solid') || id.includes('solid');
      }
      if (filters.style === 'outline') {
        return name.includes('outline') || id.includes('outline') || name.includes('line') || id.includes('line');
      }
      if (filters.style === 'line') {
        return name.includes('line') || id.includes('line') || name.includes('outline') || id.includes('outline');
      }
      if (filters.style === 'solid') {
        return name.includes('solid') || id.includes('solid') || name.includes('filled') || id.includes('fill');
      }
      return true;
    });
  }
  
  return filteredIcons;
}

async function handleIconSearch(req, res) {
  // Require API key for MCP usage
  const auth = requireApiKey(req, res, 'search');
  if (!auth) return; // Error already sent
  
  try {
    console.log(`🔍 Starting icon search...`);
    
    const body = await readJson(req);
    const validationErrors = validateSearchRequest(body);
    
    if (validationErrors.length > 0) {
      return sendError(res, 400, 'Validation failed', { errors: validationErrors });
    }
    
    const query = body.query.trim();
    const library = body.library || 'all';
    const subLibrary = body.subLibrary || 'all';
    const style = body.style || 'all';
    
    console.log(`🔍 Searching for: "${query}" (library: ${library}, style: ${style})`);
    
    // Search Iconify API with higher limit to filter down to best match
    const upstreamUrl = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=50`;
    
    const searchPromise = new Promise((resolve, reject) => {
      const upReq = https.get(upstreamUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'icon-search-app/1.0 (+local)'
        }
      }, (upRes) => {
        let data = '';
        upRes.on('data', (chunk) => { 
          data += chunk; 
          if (data.length > 5e6) {
            upReq.destroy();
            reject(new Error('Response too large'));
          }
        });
        upRes.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });
      upReq.on('error', reject);
      upReq.setTimeout(10000, () => {
        upReq.destroy();
        reject(new Error('Request timeout'));
      });
    });
    
    const searchResult = await searchPromise;
    
    if (!searchResult.icons || !Array.isArray(searchResult.icons)) {
      return sendError(res, 502, 'Invalid response from search service');
    }
    
    console.log(`📊 Found ${searchResult.icons.length} icons, applying filters...`);
    
    // Apply filters
    const filteredIcons = applyIconFilters(searchResult.icons, {
      library,
      subLibrary,
      style
    });
    
    if (filteredIcons.length === 0) {
      console.log(`❌ No icons found matching criteria`);
      return sendError(res, 404, 'No icons found matching your criteria');
    }
    
    // Return only the first (best match) icon for MCP usage
    const iconId = filteredIcons[0];
    const [prefix, name] = iconId.split(':');
    const iconUrl = `https://api.iconify.design/${iconId}.svg`;
    
    console.log(`✅ Selected best match: ${iconId}`);
    console.log(`📥 Fetching SVG content...`);
    
    // Fetch SVG content
    const svgContent = await fetchSvgContent(iconUrl);
    
    if (!svgContent) {
      return sendError(res, 502, 'Failed to fetch icon SVG content');
    }
    
    console.log(`✅ Successfully fetched SVG content (${svgContent.length} bytes)`);
    
    // Build response with single icon and SVG content
    const response = {
      success: true,
      query,
      icon: {
        id: iconId,
        name: name.replace(/-/g, ' '),
        prefix,
        library: prefix,
        url: iconUrl,
        svg: svgContent,
        metadata: {
          totalFound: searchResult.icons.length,
          filtered: filteredIcons.length,
          filters: { library, subLibrary, style }
        }
      }
    };
    
    sendJson(res, 200, response);
    
  } catch (error) {
    console.error('❌ Icon search error:', error);
    const message = error.message === 'Request timeout' 
      ? 'Search service timeout' 
      : 'Search temporarily unavailable';
    sendError(res, 500, message);
  }
}

async function handleIconGenerate(req, res) {
  // Require API key for MCP usage
  const auth = requireApiKey(req, res, 'generate');
  if (!auth) return; // Error already sent
  
  if (!RUNWARE_API_KEY) {
    return sendError(res, 500, 'Server not configured: RUNWARE_API_KEY missing');
  }
  
  try {
    console.log(`🎨 Starting icon generation...`);
    
    const body = await readJson(req);
    const validationErrors = validateGenerateRequest(body);
    
    if (validationErrors.length > 0) {
      return sendError(res, 400, 'Validation failed', { errors: validationErrors });
    }
    
    // Build prompt from structured inputs
    const subject = body.subject.trim();
    const context = (body.context || '').trim();
    const style = body.style || 'outline';
    const colors = body.colors || 'black and white';
    const background = body.background || 'white';
    
    const contextPart = context ? ` for ${context}` : '';
    const prompt = `Design a simple, flat, minimalist icon of a ${subject}${contextPart} ${style} style, ${colors} colors, ${background} background, evenly spaced elements. Maintain geometric balance and consistent stroke width, no text, only icon.`;
    
    console.log(`📝 Generated prompt: "${prompt}"`);
    
    // Generate UUID for the task
    const taskUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { 
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8); 
      return v.toString(16); 
    });
    
    console.log(`🆔 Task UUID: ${taskUUID}`);
    
    // Prepare Runware API request
    const tasks = [{
      taskType: 'imageInference',
      taskUUID,
      positivePrompt: prompt,
      width: 1024,
      height: 1024,
      model: 'google:2@3',
      numberResults: 1
    }];
    
    const payload = JSON.stringify(tasks);
    
    console.log(`🚀 Sending generation request to Runware API...`);
    
    // Call Runware API
    const generatePromise = new Promise((resolve, reject) => {
      const upReq = https.request('https://api.runware.ai/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RUNWARE_API_KEY}`
        }
      }, (upRes) => {
        console.log(`📡 Received response from Runware API (status: ${upRes.statusCode})`);
        
        let data = '';
        upRes.on('data', (d) => { 
          data += d; 
          if (data.length > 5e6) {
            upReq.destroy();
            reject(new Error('Response too large'));
          }
        });
        upRes.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({ statusCode: upRes.statusCode, data: result });
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });
      upReq.on('error', (err) => {
        console.error(`❌ Runware API request error:`, err);
        reject(err);
      });
      upReq.setTimeout(30000, () => {
        console.log(`⏰ Request timeout after 30 seconds`);
        upReq.destroy();
        reject(new Error('Request timeout'));
      });
      upReq.write(payload);
      upReq.end();
    });
    
    const { statusCode, data: result } = await generatePromise;
    
    if (statusCode >= 400 || result.error || result.errors) {
      console.error(`❌ Generation failed:`, result);
      const msg = (Array.isArray(result?.error) && result.error[0]?.message) || 
                  (Array.isArray(result?.errors) && result.errors[0]?.message) || 
                  result?.message || 'Generation failed';
      return sendError(res, statusCode >= 400 ? statusCode : 500, msg);
    }
    
    const imageResult = Array.isArray(result?.data) ? 
      result.data.find(d => d.taskType === 'imageInference') : null;
    
    if (!imageResult || !imageResult.imageURL) {
      console.error(`❌ No image URL in response:`, result);
      return sendError(res, 500, 'Image generation failed');
    }
    
    console.log(`✅ Image generated successfully: ${imageResult.imageURL}`);
    console.log(`🔄 Converting to SVG format...`);
    
    // Convert generated image to SVG
    const svgContent = await convertToSvg(imageResult.imageURL);
    
    if (!svgContent) {
      console.error(`❌ Failed to convert to SVG`);
      return sendError(res, 500, 'Failed to convert generated image to SVG');
    }
    
    console.log(`✅ Successfully converted to SVG (${svgContent.length} bytes)`);
    
    // Build response with SVG content for MCP usage
    const response = {
      success: true,
      prompt,
      parameters: {
        subject,
        context,
        style,
        colors,
        background
      },
      icon: {
        id: `generated-${taskUUID}`,
        name: `Generated ${subject} icon`,
        type: 'generated',
        imageUrl: imageResult.imageURL,
        svg: svgContent,
        width: 1024,
        height: 1024,
        format: 'svg'
      },
      taskUUID
    };
    
    console.log(`🎉 Icon generation completed successfully!`);
    sendJson(res, 200, response);
    
  } catch (error) {
    console.error('❌ Icon generation error:', error);
    const message = error.message === 'Request timeout' 
      ? 'Generation service timeout' 
      : 'Generation temporarily unavailable';
    sendError(res, 500, message);
  }
}

async function handleIconDetails(req, res) {
  // Require API key for MCP usage
  const auth = requireApiKey(req, res, 'details');
  if (!auth) return; // Error already sent
  
  try {
    console.log(`ℹ️  Fetching icon details...`);
    
    const pathname = req.url.split('?')[0];
    const pathParts = pathname.split('/');
    
    // Expected format: /api/icons/{type}/{id}
    if (pathParts.length < 5) {
      return sendError(res, 400, 'Invalid path format. Expected: /api/icons/{type}/{id}');
    }
    
    const type = pathParts[3]; // iconify or generated
    const id = decodeURIComponent(pathParts.slice(4).join('/')); // handle nested paths
    
    console.log(`🔍 Looking up ${type} icon: ${id}`);
    
    if (type === 'iconify') {
      // Validate iconify ID format (prefix:name)
      if (!id.includes(':')) {
        return sendError(res, 400, 'Invalid iconify icon ID format. Expected: prefix:name');
      }
      
      const [prefix, name] = id.split(':');
      const iconUrl = `https://api.iconify.design/${id}.svg`;
      
      console.log(`📥 Fetching SVG content for ${id}...`);
      
      // Fetch SVG content
      const svgContent = await fetchSvgContent(iconUrl);
      
      if (!svgContent) {
        return sendError(res, 502, 'Failed to fetch icon SVG content');
      }
      
      console.log(`✅ Successfully fetched SVG content (${svgContent.length} bytes)`);
      
      const response = {
        success: true,
        icon: {
          type: 'iconify',
          id,
          name: name.replace(/-/g, ' '),
          prefix,
          library: prefix,
          url: iconUrl,
          svg: svgContent,
          formats: ['svg', 'png']
        }
      };
      
      sendJson(res, 200, response);
      
    } else if (type === 'generated') {
      // For generated images, id should be a URL
      try {
        new URL(id); // validate URL format
      } catch {
        return sendError(res, 400, 'Invalid generated icon URL');
      }
      
      console.log(`🔄 Converting generated image to SVG...`);
      
      // Convert to SVG
      const svgContent = await convertToSvg(id);
      
      if (!svgContent) {
        return sendError(res, 502, 'Failed to convert generated image to SVG');
      }
      
      console.log(`✅ Successfully converted to SVG (${svgContent.length} bytes)`);
      
      const response = {
        success: true,
        icon: {
          type: 'generated',
          id,
          imageUrl: id,
          name: `Generated icon`,
          svg: svgContent,
          width: 1024,
          height: 1024,
          formats: ['png', 'svg']
        }
      };
      
      sendJson(res, 200, response);
      
    } else {
      return sendError(res, 400, 'Invalid icon type. Must be "iconify" or "generated"');
    }
    
  } catch (error) {
    console.error('❌ Icon details error:', error);
    sendError(res, 500, 'Failed to get icon details');
  }
}

// API Usage tracking endpoint
async function handleApiUsage(req, res) {
  const auth = requireApiKey(req, res, 'usage');
  if (!auth) return;
  
  const usage = API_USAGE.get(auth.apiKey);
  const rateLimitInfo = API_RATE_LIMITS.get(auth.apiKey);
  
  const response = {
    success: true,
    apiKey: auth.keyInfo.name,
    usage: {
      totalRequests: usage?.totalRequests || 0,
      firstUsed: usage?.firstUsed || null,
      lastUsed: usage?.lastUsed || null,
      endpoints: usage?.endpoints ? Object.fromEntries(usage.endpoints) : {},
      rateLimit: {
        current: rateLimitInfo?.count || 0,
        max: 100,
        windowMs: 60000,
        resetsAt: rateLimitInfo ? new Date(rateLimitInfo.windowStart + 60000) : null
      }
    }
  };
  
  sendJson(res, 200, response);
}

async function handleIconDownload(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const type = urlObj.searchParams.get('type');
    const format = urlObj.searchParams.get('format') || 'svg';
    const removeBackground = urlObj.searchParams.get('removeBackground') === 'true';
    
    if (!type || !['iconify', 'generated'].includes(type)) {
      return sendError(res, 400, 'Missing or invalid type parameter. Must be "iconify" or "generated"');
    }
    
    if (!['svg', 'png'].includes(format)) {
      return sendError(res, 400, 'Invalid format parameter. Must be "svg" or "png"');
    }
    
    let sourceUrl;
    let filename;
    
    if (type === 'iconify') {
      const id = urlObj.searchParams.get('id');
      if (!id || !id.includes(':')) {
        return sendError(res, 400, 'Missing or invalid id parameter for iconify icon');
      }
      
      const [prefix, name] = id.split(':');
      sourceUrl = `https://api.iconify.design/${id}.svg`;
      filename = `${name.replace(/\s+/g, '-')}.${format}`;
      
    } else if (type === 'generated') {
      const url = urlObj.searchParams.get('url');
      if (!url) {
        return sendError(res, 400, 'Missing url parameter for generated icon');
      }
      
      try {
        new URL(url); // validate URL
        sourceUrl = url;
        filename = `generated-icon-${Date.now()}.${format}`;
      } catch {
        return sendError(res, 400, 'Invalid URL parameter');
      }
    }
    
    // If background removal is requested, route through that endpoint
    if (removeBackground) {
      return handleRemoveBackground(req, res);
    }
    
    // If format conversion is needed (PNG from SVG), handle that
    if (format === 'png') {
      try {
        // Fetch the source image
        const response = await axios.get(sourceUrl, {
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
        
        // Convert to PNG using Sharp
        const png = await sharp(buf)
          .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        
        setSecurityHeaders(res);
        res.writeHead(200, { 
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        res.end(png);
        
      } catch (error) {
        console.error('PNG conversion error:', error);
        sendError(res, 500, 'Failed to convert to PNG');
      }
      
    } else {
      // Direct SVG download - proxy the request
      try {
        const parsed = new URL(sourceUrl);
        if (!/^https?:$/i.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
          return sendError(res, 400, 'Blocked host');
        }

        const client = parsed.protocol === 'https:' ? https : http;
        const upstream = client.get(parsed.toString(), { 
          headers: { 'Accept': 'image/*' } 
        }, (upstreamRes) => {
          if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
            setSecurityHeaders(res);
            res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'text/plain' });
            upstreamRes.pipe(res);
            return;
          }
          
          const contentType = upstreamRes.headers['content-type'] || 'image/svg+xml';
          setSecurityHeaders(res);
          res.writeHead(200, { 
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`
          });
          upstreamRes.pipe(res);
        });
        
        upstream.on('error', () => {
          sendError(res, 502, 'Upstream error');
        });
        
      } catch (error) {
        console.error('Download proxy error:', error);
        sendError(res, 500, 'Download failed');
      }
    }
    
  } catch (error) {
    console.error('Icon download error:', error);
    sendError(res, 500, 'Download failed');
  }
}

async function handleGenerate(req, res) {
  if (!RUNWARE_API_KEY) {
    setSecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server not configured: RUNWARE_API_KEY missing' }));
    return;
  }

  // Require authentication for generation
  const userId = requireAuthentication(req, res);
  if (!userId) return;
  
  const { ipAddress, userAgent } = getClientInfo(req);
  
  try {
    const tasks = await readJson(req);
    const safeTasks = tasks.filter(t => t && t.taskType === 'imageInference');
    if (safeTasks.length === 0) {
      setSecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No imageInference task provided' }));
      return;
    }

    // Track the generation attempt
    const firstTask = safeTasks[0];
    const resourceMetadata = {
      prompt: firstTask.positivePrompt,
      model: firstTask.model,
      width: firstTask.width,
      height: firstTask.height,
      taskCount: safeTasks.length
    };

    const payload = JSON.stringify(safeTasks);

    const upReq = https.request('https://api.runware.ai/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNWARE_API_KEY}`
      }
    }, async (upRes) => {
      let data = '';
      upRes.on('data', (d) => { data += d; if (data.length > 5e6) upReq.destroy(); });
      upRes.on('end', async () => {
        setSecurityHeaders(res);
        res.writeHead(upRes.statusCode || 200, { 'Content-Type': upRes.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' });
        
        // Track successful generation
        if (upRes.statusCode && upRes.statusCode < 400) {
          await trackUsage(userId, 'generate', null, firstTask.taskUUID, resourceMetadata, ipAddress, userAgent);
        }
        
        res.end(data);
      });
    });
    upReq.on('error', async () => {
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

  // NEW UNIFIED API ENDPOINTS
  
  // Icon Search API - POST /api/icons/search
  if (pathname === '/api/icons/search') {
    if (req.method === 'OPTIONS') {
      setSecurityHeaders(res);
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'POST') return handleIconSearch(req, res);
    return sendError(res, 405, 'Method Not Allowed');
  }
  
  // Icon Generate API - POST /api/icons/generate  
  if (pathname === '/api/icons/generate') {
    if (req.method === 'OPTIONS') {
      setSecurityHeaders(res);
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'POST') return handleIconGenerate(req, res);
    return sendError(res, 405, 'Method Not Allowed');
  }
  
  // Icon Details API - GET /api/icons/{type}/{id}
  if (pathname.startsWith('/api/icons/') && pathname.split('/').length >= 5) {
    if (req.method === 'GET') return handleIconDetails(req, res);
    return sendError(res, 405, 'Method Not Allowed');
  }
  
  // Icon Download API - GET /api/icons/download
  if (pathname === '/api/icons/download') {
    if (req.method === 'GET') return handleIconDownload(req, res);
    return sendError(res, 405, 'Method Not Allowed');
  }
  
  // API Usage tracking - GET /api/usage
  if (pathname === '/api/usage') {
    if (req.method === 'GET') return handleApiUsage(req, res);
    return sendError(res, 405, 'Method Not Allowed');
  }

  // EXISTING ENDPOINTS FOR BACKWARDS COMPATIBILITY
  
  // Lightweight proxy for Iconify search to improve reliability and avoid CORS/CSP issues
  if (req.method === 'GET' && pathname === '/api/iconify-search') {
    // Require authentication for icon search
    const userId = requireAuthentication(req, res);
    if (!userId) return;
    
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

  if (req.method === 'GET' && pathname === '/proxy-image') {
    return proxyImage(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/vectorize') {
    const userId = requireAuthentication(req, res);
    if (!userId) return;
    return handleVectorize(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/remove-bg') {
    const userId = requireAuthentication(req, res);
    if (!userId) return;
    return handleRemoveBackground(req, res);
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