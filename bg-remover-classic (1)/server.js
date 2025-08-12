import express from "express";
import cors from "cors";
import axios from "axios";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.set("trust proxy", true);

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3200;
const MAX_BYTES = 16 * 1024 * 1024; // 16MB
const MAX_EDGE_SAMPLES = 5000;      // border pixels to sample for bg estimate

app.get("/health", (req, res) => res.json({ ok: true }));

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

app.get("/remove-bg", async (req, res) => {
  try {
    const {
      url,
      maxSize = "1024",
      // distance thresholds in RGB space (squared)
      tol = "35",         // lower threshold (pixels this close to bg => transparent)
      hard = "55",        // upper threshold (further than this => opaque)
      feather = "2.5",    // feather width multiplier
      despeckle = "1",    // 0..3 rounds of blur-threshold cleanup
      matte = ""          // optional hex to replace transparency with a solid color
    } = req.query;

    if (!url) return res.status(400).json({ error: "Missing ?url" });
    let u;
    try { u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; }
    catch { return res.status(400).json({ error: "Invalid URL" }); }

    const maxDim = clamp(parseInt(maxSize)||1024, 128, 4096);
    const tolVal = clamp(parseFloat(tol)||35, 1, 200);
    const hardVal = Math.max(tolVal+1, clamp(parseFloat(hard)||55, 5, 400));
    const featherMul = clamp(parseFloat(feather)||2.5, 0.5, 10);
    const despeckleRounds = clamp(parseInt(despeckle)||1, 0, 3);

    // 1) Download
    const resp = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      headers: { "User-Agent": "bg-remover-classic/1.0 (+https://local)", "Accept": "image/*,*/*" },
      validateStatus: s => s >= 200 && s < 400
    });
    const buf = Buffer.from(resp.data);
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: "Image too large" });

    // 2) Normalize to RGBA on a capped canvas
    const { data, info } = await sharp(buf)
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .toColorspace("srgb")
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

    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    console.error("remove-bg error:", err);
    const msg = (err && err.response && err.response.status) ? `Upstream HTTP ${err.response.status}` : String(err && err.code ? err.code : err);
    res.status(500).json({ error: "Background removal failed", details: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Classic BG Remover listening on http://localhost:${PORT}`);
});
