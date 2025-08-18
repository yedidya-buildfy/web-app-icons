# 🌐 Aicon Backend API

> **Production-ready REST API** for icon search, AI generation, and management.

## 🚀 Quick Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# Configure environment variables in Vercel dashboard
```

**Required Environment Variables:**
- `RUNWARE_API_KEY` - Your Runware AI API key  
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anon key

## 📡 API Endpoints

```bash
POST /api/icons/search      # Search existing icons
POST /api/icons/generate    # Generate AI icons  
GET  /api/usage            # Check usage stats
GET  /api/icons/download   # Download icons
```

## 🔑 Authentication

All endpoints require API key:
```bash
curl -H "X-API-Key: your_api_key" https://your-api.vercel.app/api/usage
```

## 🛠️ Local Development

```bash
npm install
npm start          # http://localhost:3000
npm test           # Run API tests
```

## 📚 Full Documentation

See `../.md/MCP_API_GUIDE.md` for complete API documentation.