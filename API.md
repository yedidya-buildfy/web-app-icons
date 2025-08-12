# Icon Search App MCP API Documentation

The Icon Search App provides a secure, MCP-ready REST API for AI coders to search and generate icons programmatically. All endpoints require API key authentication and return single icons with SVG content.

## Base URL
```
http://localhost:3000
```

## Authentication
🔑 **All MCP endpoints require API key authentication**

### API Key Setup
```bash
# Set API keys in environment variable (comma-separated)
export API_KEYS="your-api-key-1,your-api-key-2"

# Or for development, a default key is provided
export NODE_ENV=development
```

### Authentication Headers
Include one of these headers in all requests:

```bash
# Option 1: Authorization Bearer
Authorization: Bearer your-api-key

# Option 2: X-API-Key header  
X-API-Key: your-api-key
```

### Rate Limiting
- **100 requests per minute** per API key
- Rate limit resets every 60 seconds
- Exceeding the limit returns `429 Too Many Requests`

## Endpoints

### 1. Search Icons 🔍

Search for icons from Iconify's library and get the **best match with SVG content**.

**Endpoint:** `POST /api/icons/search`

**Headers:**
```
Authorization: Bearer your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "query": "home",
  "library": "all",
  "style": "outline"
}
```

**Parameters:**
- `query` (required): Search term for icons
- `library` (optional): Icon library filter - `all`, `tabler`, `lucide`, `ph`, `iconoir`, `heroicons-outline`, `heroicons-solid`
- `subLibrary` (optional): Sub-library filter (specific prefix)
- `style` (optional): Style filter - `all`, `filled`, `outline`, `line`, `solid`

**Response:** (Returns the **best matching icon** with SVG content)
```json
{
  "success": true,
  "query": "home",
  "icon": {
    "id": "material-symbols:home",
    "name": "home",
    "prefix": "material-symbols",
    "library": "material-symbols", 
    "url": "https://api.iconify.design/material-symbols:home.svg",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">...</svg>",
    "metadata": {
      "totalFound": 32,
      "filtered": 8,
      "filters": {"library": "all", "style": "outline"}
    }
  }
}
```

**Progress Logs:** Console output shows search progress:
```
🔍 Starting icon search...
🔍 Searching for: "home" (library: all, style: outline)
📊 Found 32 icons, applying filters...
✅ Selected best match: material-symbols:home
📥 Fetching SVG content...
✅ Successfully fetched SVG content (1245 bytes)
```

### 2. Generate Icon 🎨

Generate custom icons using AI and get **SVG content** ready for use.

**Endpoint:** `POST /api/icons/generate`

**Headers:**
```
Authorization: Bearer your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "subject": "dumbbell",
  "context": "fitness app",
  "style": "outline",
  "colors": "black and white", 
  "background": "white"
}
```

**Parameters:**
- `subject` (required): Main subject of the icon
- `context` (optional): Context or use case
- `style` (optional): Icon style - `outline`, `filled`, `solid`, `duotone`, `rounded` (default: `outline`)
- `colors` (optional): Color specification (default: `black and white`)
- `background` (optional): Background color (default: `white`)

**Response:**
```json
{
  "success": true,
  "prompt": "Design a simple, flat, minimalist icon of a dumbbell for fitness app outline style...",
  "parameters": {
    "subject": "dumbbell",
    "context": "fitness app",
    "style": "outline",
    "colors": "black and white",
    "background": "white"
  },
  "icon": {
    "id": "generated-abc-123-def",
    "name": "Generated dumbbell icon",
    "type": "generated",
    "imageUrl": "https://im.runware.ai/image/ws/2/ii/abc123.jpg",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\">...</svg>",
    "width": 1024,
    "height": 1024,
    "format": "svg"
  },
  "taskUUID": "abc-123-def"
}
```

**Progress Logs:** Detailed console output for AI understanding:
```
🎨 Starting icon generation...
📝 Generated prompt: "Design a simple, flat, minimalist icon of a dumbbell..."
🆔 Task UUID: abc-123-def
🚀 Sending generation request to Runware API...
📡 Received response from Runware API (status: 200)
✅ Image generated successfully: https://im.runware.ai/image/...
🔄 Converting to SVG format...
✅ Successfully vectorized to SVG
✅ Successfully converted to SVG (3456 bytes)
🎉 Icon generation completed successfully!
```

### 3. Icon Details ℹ️

Get specific icon information **with SVG content**.

**Endpoint:** `GET /api/icons/{type}/{id}`

**Headers:**
```
Authorization: Bearer your-api-key
```

**Parameters:**
- `type`: `iconify` or `generated`
- `id`: Icon identifier (for iconify: `prefix:name`, for generated: image URL)

**Examples:**
- `GET /api/icons/iconify/material-symbols:home`
- `GET /api/icons/generated/https%3A%2F%2Fim.runware.ai%2Fimage.jpg`

**Response:**
```json
{
  "success": true,
  "icon": {
    "type": "iconify",
    "id": "material-symbols:home",
    "name": "home",
    "prefix": "material-symbols",
    "library": "material-symbols",
    "url": "https://api.iconify.design/material-symbols:home.svg",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\">...</svg>",
    "formats": ["svg", "png"]
  }
}
```

### 4. API Usage Tracking 📊

Track your API key usage and rate limits.

**Endpoint:** `GET /api/usage`

**Headers:**
```
Authorization: Bearer your-api-key
```

**Response:**
```json
{
  "success": true,
  "apiKey": "Development Key",
  "usage": {
    "totalRequests": 42,
    "firstUsed": "2025-08-12T20:30:00.000Z",
    "lastUsed": "2025-08-12T21:15:00.000Z",
    "endpoints": {
      "search": 25,
      "generate": 12,
      "details": 5
    },
    "rateLimit": {
      "current": 8,
      "max": 100,
      "windowMs": 60000,
      "resetsAt": "2025-08-12T21:16:00.000Z"
    }
  }
}
```

### 4. Download Icon

Download icons in various formats with optional processing.

**Endpoint:** `GET /api/icons/download`

**Parameters:**
- `type` (required): `iconify` or `generated`
- `id` (required for iconify): Icon ID (e.g., `material-symbols:home`)
- `url` (required for generated): Image URL
- `format` (optional): `svg` or `png` (default: `svg`)
- `removeBackground` (optional): `true` to remove background

**Examples:**
- `GET /api/icons/download?type=iconify&id=material-symbols:home&format=svg`
- `GET /api/icons/download?type=generated&url=https%3A%2F%2Fim.runware.ai%2Fimage.jpg&format=png`
- `GET /api/icons/download?type=iconify&id=tabler:home&removeBackground=true`

**Response:** Binary file download with appropriate headers.

### 5. Background Removal

Remove backgrounds from images with advanced options.

**Endpoint:** `GET /api/remove-bg`

**Parameters:**
- `url` (required): Image URL
- `maxSize` (optional): Maximum dimension in pixels (default: 1024)
- `tol` (optional): Background tolerance (1-200, default: 35)
- `hard` (optional): Hardness threshold (5-400, default: 55)
- `feather` (optional): Feather amount (0.5-10, default: 2.5)
- `despeckle` (optional): Despeckle rounds (0-3, default: 1)
- `matte` (optional): Hex color to replace transparency

**Response:** PNG image with background removed.

### 6. Vectorize Image

Convert raster images to SVG format.

**Endpoint:** `GET /api/vectorize`

**Parameters:**
- `url` (required): Image URL
- `color` (optional): SVG fill color (default: #000000)
- `threshold` (optional): Threshold value (default: 128)
- `turdSize` (optional): Noise reduction (default: 2)
- `invert` (optional): Invert colors (default: false)

**Response:** SVG vector image.

## Error Handling

All endpoints return standardized error responses:

```json
{
  "error": "Error message",
  "details": "Additional details (optional)"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation errors)
- `405` - Method Not Allowed
- `500` - Internal Server Error
- `502` - Upstream Service Error

## Rate Limiting

No explicit rate limiting is implemented, but the server has built-in protections:
- Request size limits (1MB for JSON, 12MB for images)
- Response size limits (5MB)
- Request timeouts (10-30 seconds)

## Backwards Compatibility

Existing endpoints remain available:
- `GET /api/iconify-search` - Original Iconify search proxy
- `POST /api/generate` - Original generation endpoint
- `GET /proxy-image` - Image proxy endpoint

## MCP Usage Examples 🤖

### Search for icons (returns SVG)
```bash
curl -X POST http://localhost:3000/api/icons/search \
  -H "Authorization: Bearer dev-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"query": "home", "library": "tabler", "style": "outline"}'
```

### Generate custom icon (returns SVG) 
```bash
curl -X POST http://localhost:3000/api/icons/generate \
  -H "Authorization: Bearer dev-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"subject": "shopping cart", "style": "outline", "colors": "blue and white"}'
```

### Get icon details with SVG
```bash
curl -X GET "http://localhost:3000/api/icons/iconify/tabler:home" \
  -H "Authorization: Bearer dev-key-12345"
```

### Check API usage
```bash
curl -X GET "http://localhost:3000/api/usage" \
  -H "Authorization: Bearer dev-key-12345"
```

## MCP Server Integration 🔌

This API is designed for **Model Context Protocol (MCP)** integration with AI coding assistants:

### Key Features for AI Coders
- **Single Icon Response**: Always returns exactly one icon (best match)
- **SVG Content**: Direct SVG code for immediate use in projects
- **Progress Logging**: Detailed console output for AI understanding
- **Secure Authentication**: API key tracking per integration
- **Rate Limited**: Prevents abuse with 100 req/min limit

### AI Usage Pattern
1. **Search**: Find existing icons from 50,000+ Iconify collection
2. **Generate**: Create custom icons when existing ones don't fit
3. **Get SVG**: Both endpoints return ready-to-use SVG content
4. **Track Usage**: Monitor API consumption per integration

### Error Responses
```json
{
  "error": "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key: <key> header"
}
```

**HTTP Status Codes:**
- `401` - Missing/invalid API key
- `429` - Rate limit exceeded  
- `404` - No icons found matching criteria
- `400` - Validation errors
- `500` - Server/generation errors