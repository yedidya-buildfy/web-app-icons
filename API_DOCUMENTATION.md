# Icon Search App API Documentation

## Overview

The Icon Search App provides a production-ready API for searching existing icons and generating new ones with AI. This API is specifically designed for MCP (Model Context Protocol) tools and AI coding assistants.

## Base URL

```
http://localhost:3000  # Development
https://your-domain.com  # Production
```

## Authentication

All API endpoints require authentication using API keys. Include your API key in requests using either:

### Option 1: Authorization Header (Recommended)
```bash
Authorization: Bearer ak_12345678_your-secret-key-here
```

### Option 2: API Key Header
```bash
X-API-Key: ak_12345678_your-secret-key-here
```

## API Key Format

API keys follow the format: `ak_{prefix}_{secret}`
- `ak`: API key identifier
- `{prefix}`: 12-character unique prefix for identification
- `{secret}`: Secure random secret (base64 encoded)

Example: `ak_a1b2c3d4e5f6_L3BlcmF0aW9uYWxfa2V5X2hlcmU=`

## Rate Limits

Default rate limits (configurable per API key):
- **Per Minute**: 100 requests
- **Daily**: 10,000 requests  
- **Monthly**: 300,000 requests

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1634567890
```

## Endpoints

### 1. Search Icons

Search for existing icons from various icon libraries.

**Endpoint**: `POST /api/icons/search`

**Request Body**:
```json
{
  "query": "home",
  "library": "all",        // Optional: "all", "tabler", "lucide", "ph", "iconoir", "heroicons-outline", "heroicons-solid"
  "style": "all",          // Optional: "all", "filled", "outline", "line", "solid"
  "limit": 50              // Optional: 1-200, defaults to implementation
}
```

**Response**:
```json
{
  "success": true,
  "query": "home",
  "icon": {
    "id": "tabler:home",
    "name": "home",
    "prefix": "tabler",
    "library": "tabler",
    "url": "https://api.iconify.design/tabler:home.svg",
    "svg": "<svg>...</svg>",
    "metadata": {
      "totalFound": 47,
      "filtered": 12,
      "filters": {
        "library": "all",
        "style": "all"
      }
    }
  }
}
```

**cURL Example**:
```bash
curl -X POST "http://localhost:3000/api/icons/search" \
  -H "Authorization: Bearer ak_12345678_your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "home",
    "library": "tabler",
    "style": "outline"
  }'
```

### 2. Generate Icons with AI

Generate new icons using AI based on text descriptions.

**Endpoint**: `POST /api/icons/generate`

**Request Body**:
```json
{
  "subject": "rocket ship",
  "context": "space exploration",  // Optional
  "style": "outline",              // Optional: "outline", "filled", "solid", "duotone", "rounded"
  "colors": "black and white",     // Optional
  "background": "white"            // Optional
}
```

**Response**:
```json
{
  "success": true,
  "prompt": "Design a simple, flat, minimalist icon of a rocket ship for space exploration outline style, black and white colors, white background, evenly spaced elements...",
  "parameters": {
    "subject": "rocket ship",
    "context": "space exploration",
    "style": "outline",
    "colors": "black and white",
    "background": "white"
  },
  "icon": {
    "id": "generated-uuid-here",
    "name": "Generated rocket ship icon",
    "type": "generated",
    "imageUrl": "https://im.runware.ai/image/uuid.png",
    "svg": "<svg>...</svg>",
    "width": 1024,
    "height": 1024,
    "format": "svg"
  },
  "taskUUID": "uuid-here"
}
```

**cURL Example**:
```bash
curl -X POST "http://localhost:3000/api/icons/generate" \
  -H "Authorization: Bearer ak_12345678_your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "rocket ship",
    "context": "space exploration",
    "style": "outline"
  }'
```

### 3. Get Icon Details

Retrieve detailed information about a specific icon and convert it to SVG format.

**Endpoint**: `GET /api/icons/{type}/{id}`

**Parameters**:
- `{type}`: Either "iconify" or "generated"
- `{id}`: Icon identifier (e.g., "tabler:home" for iconify, or image URL for generated)

**Response**:
```json
{
  "success": true,
  "icon": {
    "type": "iconify",
    "id": "tabler:home",
    "name": "home",
    "prefix": "tabler", 
    "library": "tabler",
    "url": "https://api.iconify.design/tabler:home.svg",
    "svg": "<svg>...</svg>",
    "formats": ["svg", "png"]
  }
}
```

**cURL Examples**:
```bash
# Get iconify icon details
curl "http://localhost:3000/api/icons/iconify/tabler:home" \
  -H "Authorization: Bearer ak_12345678_your-key-here"

# Get generated icon details  
curl "http://localhost:3000/api/icons/generated/https%3A//im.runware.ai/image/uuid.png" \
  -H "Authorization: Bearer ak_12345678_your-key-here"
```

### 4. API Usage Statistics

Get usage statistics for your API key.

**Endpoint**: `GET /api/usage`

**Response**:
```json
{
  "success": true,
  "apiKey": {
    "name": "Production App Key",
    "prefix": "ak_12345678",
    "permissions": {
      "canSearch": true,
      "canGenerate": true,
      "canDownload": true
    },
    "limits": {
      "perMinute": 100,
      "daily": 10000,
      "monthly": 300000
    }
  },
  "usage": {
    "today": {
      "total": 45,
      "search": 30,
      "generate": 15,
      "download": 0,
      "errors": 2
    },
    "last30Days": [...],
    "last24Hours": [...]
  },
  "rateLimits": {
    "perMinute": {
      "current_usage": 5,
      "limit": 100,
      "remaining": 95
    },
    "daily": {
      "current_usage": 45,
      "limit": 10000,
      "remaining": 9955
    }
  }
}
```

**cURL Example**:
```bash
curl "http://localhost:3000/api/usage" \
  -H "Authorization: Bearer ak_12345678_your-key-here"
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

### Common Error Codes

- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Missing or invalid API key
- **403 Forbidden**: API key lacks required permissions
- **404 Not Found**: Resource not found
- **413 Payload Too Large**: Request body too large
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error
- **502 Bad Gateway**: Upstream service error

### Rate Limit Error

```json
{
  "error": "Rate limit exceeded. 0 requests remaining this minute.",
  "rateLimitInfo": {
    "allowed": false,
    "current_usage": 100,
    "limit": 100,
    "remaining": 0,
    "check_type": "minute"
  }
}
```

## MCP Integration

This API is optimized for MCP tools. Here's how to integrate:

### 1. Tool Configuration

```typescript
// MCP Tool Definition
{
  name: "search_icons",
  description: "Search for icons from various libraries",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query for icons" },
      library: { type: "string", enum: ["all", "tabler", "lucide", "ph"], default: "all" },
      style: { type: "string", enum: ["all", "filled", "outline"], default: "all" }
    },
    required: ["query"]
  }
}
```

### 2. Implementation Example

```typescript
async function searchIcons(query: string, library?: string, style?: string) {
  const response = await fetch('http://localhost:3000/api/icons/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, library, style })
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.icon;
}
```

## Getting API Keys

API keys are managed through the admin interface:

1. **Access Admin Panel**: Navigate to `/admin.html`
2. **Login**: Use admin credentials
3. **API Key Management**: Click "API Key Management"
4. **Create New Key**: Fill in the form with:
   - Key name (for identification)
   - Owner email and name
   - Rate limits (requests per minute/day/month)
   - Permissions (search, generate, download)
   - Optional expiration date

## Security Best Practices

1. **Store API Keys Securely**: Never commit API keys to version control
2. **Use Environment Variables**: Store keys in `.env` files or environment variables
3. **Rotate Keys Regularly**: Create new keys and revoke old ones periodically
4. **Monitor Usage**: Check API usage statistics regularly
5. **Set Appropriate Limits**: Configure rate limits based on your needs
6. **Use HTTPS**: Always use HTTPS in production

## Support

For issues or questions:
- Check the admin interface for API key status and usage
- Review error messages for specific issue details
- Monitor rate limits to avoid service disruption

## Changelog

### v1.0.0
- Initial release with icon search and generation
- Production API key management system
- Rate limiting and usage tracking
- MCP tool integration support