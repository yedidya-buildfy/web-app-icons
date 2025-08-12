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
const MAX_EDGE_SAMPLES = 5000;      // border pixels to sample for bg estimate

// Removed Aicon URL mapping/cache; we always use the original source URLs now

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Allow connections to Iconify API/CDN for free stock icon search and fetching
  res.setHeader('Content-Security-Policy', "default-src 'self' blob:; img-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://code.iconify.design https://cdn.jsdelivr.net/npm/@supabase/supabase-js; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: https://api.runware.ai https://kfeekskddfyyosyyplxd.supabase.co https://api.iconify.design https://cdn.jsdelivr.net https://code.iconify.design; frame-ancestors 'none';");
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

    // 3) Estimate background color from border samples (median is robust to outliers)
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

  if (req.method === 'GET' && pathname === '/api/remove-bg') {
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