# Vercel Deployment Guide for Icon Search App

## 🚀 **Files Created for Vercel Deployment**

### API Functions (Serverless)
- `/api/_utils.js` - Shared utilities (API key validation, Supabase, etc.)
- `/api/usage.js` - GET `/api/usage` endpoint
- `/api/icons/search.js` - POST `/api/icons/search` endpoint  
- `/api/icons/generate.js` - POST `/api/icons/generate` endpoint

### Configuration
- `vercel.json` - Vercel deployment configuration
- `package.json` - Updated with vercel-build script

## 📋 **Deployment Steps**

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Set Environment Variables
In your Vercel dashboard, add these environment variables:

**Required:**
- `SUPABASE_URL` = `https://kfeekskddfyyosyyplxd.supabase.co`
- `SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- `RUNWARE_API_KEY` = `your-runware-api-key`

### 3. Deploy to Vercel
```bash
cd /Users/yedidya/Desktop/aicon-mcp-zodfixed/icon_search_app
vercel --prod
```

### 4. Update MCP Configuration
After deployment, update your MCP config:
```json
{
  "apiBase": "https://your-app-name.vercel.app",
  "apiKey": "your-api-key",
  "outputDir": "./Aicon"
}
```

## 🔧 **Environment Variables Setup**

### Method 1: Vercel Dashboard
1. Go to your project in Vercel dashboard
2. Settings → Environment Variables
3. Add each variable with Production scope

### Method 2: Vercel CLI
```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add RUNWARE_API_KEY
```

## 🧪 **Testing Deployment**

### Test API Endpoints
```bash
# Test usage endpoint
curl -H "Authorization: Bearer your-api-key" https://your-app.vercel.app/api/usage

# Test search endpoint
curl -X POST https://your-app.vercel.app/api/icons/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "home", "library": "tabler"}'

# Test generate endpoint
curl -X POST https://your-app.vercel.app/api/icons/generate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"subject": "rocket", "style": "outline"}'
```

## 📁 **File Structure for Vercel**
```
icon_search_app/
├── api/
│   ├── _utils.js          # Shared utilities
│   ├── usage.js           # GET /api/usage
│   └── icons/
│       ├── search.js      # POST /api/icons/search
│       └── generate.js    # POST /api/icons/generate
├── public/                # Static files (HTML, CSS, JS)
├── vercel.json           # Vercel configuration
├── package.json          # Dependencies
└── server.js             # Original server (for local dev)
```

## ⚡ **Vercel Free Tier Limits**
- **Function Execution**: 10 seconds max
- **Memory**: 1024 MB
- **Bandwidth**: 100 GB/month
- **Edge Requests**: 1 million/month
- **Serverless Functions**: 12 per deployment

## 🔄 **Development Workflow**
1. **Local Development**: Use `npm start` (runs server.js)
2. **Testing**: Use `vercel dev` (runs serverless functions locally)
3. **Production**: Deploy with `vercel --prod`

## 🐛 **Troubleshooting**

### API Key Issues
- Ensure environment variables are set in Vercel dashboard
- Check API key format in database
- Verify Supabase connection

### Function Timeouts
- Reduce image processing complexity
- Optimize external API calls
- Consider using Vercel Edge Functions for faster response

### CORS Issues
- Headers are set in `_utils.js`
- Ensure origin is allowed in production

## 🎯 **Next Steps After Deployment**
1. Test all API endpoints
2. Update MCP server configuration
3. Create new API keys via admin interface
4. Monitor usage in Vercel dashboard