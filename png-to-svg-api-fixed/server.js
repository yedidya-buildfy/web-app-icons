import express from "express";
import cors from "cors";
import axios from "axios";
import sharp from "sharp";
import potrace from "potrace";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.set("trust proxy", true);

// serve static files (simple web UI)
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB cap

app.get("/health", (req, res) => res.json({ ok: true }));

function potraceTrace(buffer, opts) {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, opts, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

app.get("/vectorize", async (req, res) => {
  try {
    const { url, color = "#000000", threshold = 128, turdSize = 2, invert = "false" } = req.query;
    if (!url) return res.status(400).json({ error: "Missing ?url" });

    // Validate URL
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error("invalid protocol");
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const resp = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      headers: { "User-Agent": "png-to-svg-api/1.2 (+https://local)", "Accept": "image/*,*/*" },
      validateStatus: s => s >= 200 && s < 400
    });

    const buf = Buffer.from(resp.data);
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: "Image too large" });

    // Normalize to paletted PNG (Potrace prefers bitmap)
    const png = await sharp(buf).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png({ palette: true }).toBuffer();

    const svg = await potraceTrace(png, {
      color: String(color),
      threshold: Number(threshold),
      turdSize: Number(turdSize),
      invert: String(invert).toLowerCase() === "true",
      optTolerance: 0.2
    });

    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.send(svg);
  } catch (err) {
    console.error("vectorize error:", err);
    const msg = (err && err.response && err.response.status) ? `Upstream HTTP ${err.response.status}` : String(err && err.code ? err.code : err);
    res.status(500).json({ error: "Vectorization failed", details: msg });
  }
});

app.listen(PORT, () => {
  console.log(`PNG→SVG API listening on http://localhost:${PORT}`);
});
