# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm start` or `npm run dev`: Start the HTTP server on port 3000
- No build step required - app serves static files directly
- No test framework configured

### Running the Server
The server requires a RUNWARE_API_KEY environment variable for AI image generation:
- Set via `.env` file in root directory
- Format: `RUNWARE_API_KEY=your_key_here`
- Server loads environment variables automatically on startup

## Architecture

This is a **vanilla JavaScript web application** with a Node.js HTTP server backend. The architecture consists of:

### Backend (server.js)
- **HTTP Server**: Serves static files from `/public` directory
- **API Proxy**: `/api/generate` endpoint proxies requests to Runware.ai API
- **Image Proxy**: `/proxy-image` endpoint for secure image loading from allowed hosts
- **Security**: Implements CSP headers, host allowlisting, and request validation

### Frontend Structure
- **Icon Search** (index.html + main.js): Search icons via Iconify API with library filtering
- **AI Image Generation** (generate.html + generate.js): Generate images using Runware.ai through server proxy
- **Shared Auth** (auth.js): Optional Supabase authentication for logging searches

### Key Technical Details

#### API Integration Pattern
- **Client-side**: JavaScript makes requests to server endpoints
- **Server-side**: Node.js proxies to external APIs with secure API keys
- **Image Handling**: Server validates and proxies images from trusted hosts only

#### Data Flow
1. Frontend sends requests to `/api/generate` with image generation tasks
2. Server validates requests and forwards to Runware.ai with API key
3. Server returns results to frontend, which displays images via proxy URLs

#### Security Model
- API keys stored server-side only (never exposed to client)
- Host allowlisting prevents SSRF attacks
- CSP headers restrict resource loading
- Request size limits prevent DoS

### Database Schema (Optional)
If Supabase is configured, the app logs searches and generated icons:
- `searches`: Query logging with timestamp
- `generated_icons`: AI-generated image metadata with deduplication
- Uses deterministic IDs to prevent duplicate storage

### Configuration
- `public/env.js`: Client-side configuration (Supabase URL/key)
- `.env`: Server-side secrets (RUNWARE_API_KEY)
- Environment variables override file-based config

### File Organization
- `/public/`: All frontend assets (HTML, CSS, JS)
- `/server.js`: Single-file backend server
- `/schema.sql`: Database schema for optional Supabase integration
- `/migrations/`: Database migration files