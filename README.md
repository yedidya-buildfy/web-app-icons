# Icon Search & AI Image Generator App

A web application that combines icon search functionality with AI-powered image generation using Runware.ai's API.

## Features

- **Icon Search**: Search and browse icons from multiple icon libraries (Tabler, Lucide, Phosphor, Iconoir, Heroicons)
- **AI Image Generation**: Generate images using Runware.ai's Imagen 4.0 Fast model
- **Simple Interface**: Clean, responsive design with easy navigation between features
- **Download & Copy**: Download generated images and copy icon code snippets

## Setup

### 1. Clone the repository
```bash
git clone <repository-url>
cd icon_search_app
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure API keys
1. Copy `public/env.example.js` to `public/env.js`
2. Add your Runware.ai API key:
   ```javascript
   const RUNWARE_API_KEY = 'your-actual-api-key';
   ```
3. (Optional) Add Supabase credentials for search logging:
   ```javascript
   const SUPABASE_URL = 'https://your-project-id.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-public-key';
   ```

### 4. Get a Runware.ai API key
1. Sign up at [Runware.ai](https://runware.ai)
2. Visit the "API Keys" page
3. Create a new API key
4. Copy the key to your `env.js` file

### 5. Start the server
```bash
npm start
```

The app will be available at `http://localhost:3000`

## Usage

### Icon Search
1. Navigate to the Icon Search page (default)
2. Select your preferred icon library
3. Use filters to narrow down results
4. Search for specific icons
5. Copy code or download SVG files

### Image Generation
1. Click on "Image Generator" in the navigation
2. Enter a detailed description of the image you want to generate
3. Click "Generate Image"
4. Wait for the AI to create your image
5. Download the generated image or generate another one

## API Integration

The app uses Runware.ai's WebSocket API for efficient image generation:

- **WebSocket Connection**: Maintains persistent connection to Runware.ai
- **Authentication**: Uses API key for secure access
- **Model**: Imagen 4.0 Fast for high-quality image generation
- **Auto-reconnection**: Handles connection drops automatically
- **Keep-alive**: Sends periodic ping messages to maintain connection

## Technical Details

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Node.js HTTP server
- **API**: Runware.ai WebSocket API
- **Icons**: Iconify API for icon search
- **Database**: Optional Supabase integration for logging

## File Structure

```
icon_search_app/
├── public/
│   ├── index.html          # Icon search page
│   ├── generate.html       # Image generation page
│   ├── main.js            # Icon search functionality
│   ├── generate.js        # Image generation functionality
│   ├── styles.css         # Main styles
│   ├── generate.css       # Image generation styles
│   ├── env.example.js     # Environment configuration template
│   └── env.js             # Your API keys (create this)
├── server.js              # HTTP server
└── README.md              # This file
```

## Troubleshooting

### Image generation not working
- Check that your Runware.ai API key is correct in `env.js`
- Ensure the API key has sufficient credits
- Check browser console for WebSocket connection errors

### Icons not loading
- Verify internet connection
- Check browser console for API errors
- Iconify API is free and doesn't require authentication

### Server won't start
- Ensure Node.js is installed
- Check that port 3000 is available
- Verify all files are in the correct locations

## License

This project is open source and available under the MIT License.
