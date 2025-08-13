// POST /api/icons/search - Search for icons with SVG content
const axios = require('axios');
const { requireApiKey, sendError, sendSuccess } = require('../_utils');

// Icon search libraries and their mappings
const ICON_LIBRARIES = {
  'all': null,
  'tabler': 'tabler',
  'lucide': 'lucide',
  'ph': 'ph',
  'iconoir': 'iconoir',
  'heroicons-outline': 'heroicons-outline',
  'heroicons-solid': 'heroicons-solid',
  'material-symbols': 'material-symbols'
};

const ICON_STYLES = {
  'all': null,
  'filled': ['fill', 'solid', 'filled'],
  'outline': ['outline', 'line', 'stroke'],
  'line': ['line', 'outline', 'stroke'],
  'solid': ['solid', 'fill', 'filled']
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed');
  }

  // Require API key authentication
  const auth = await requireApiKey(req, res, 'search');
  if (!auth) return; // Error already sent

  try {
    const { query, library = 'all', style = 'all', subLibrary } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return sendError(res, 400, 'Query parameter is required and must be a non-empty string');
    }

    console.log(`🔍 Starting icon search...`);
    console.log(`🔍 Searching for: "${query}" (library: ${library}, style: ${style})`);

    // Search Iconify API
    const searchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(query.trim())}&limit=100`;
    const searchResponse = await axios.get(searchUrl, { timeout: 10000 });
    
    if (!searchResponse.data || !searchResponse.data.icons) {
      return sendError(res, 404, 'No icons found', { query, library, style });
    }

    let icons = searchResponse.data.icons;
    console.log(`📊 Found ${icons.length} icons, applying filters...`);

    // Filter by library if specified
    if (library && library !== 'all') {
      const libraryFilter = ICON_LIBRARIES[library];
      if (libraryFilter) {
        icons = icons.filter(icon => icon.startsWith(libraryFilter + ':'));
      } else if (subLibrary) {
        icons = icons.filter(icon => icon.startsWith(subLibrary + ':'));
      }
    }

    // Filter by style if specified  
    if (style && style !== 'all') {
      const styleKeywords = ICON_STYLES[style];
      if (styleKeywords) {
        icons = icons.filter(icon => {
          const iconName = icon.toLowerCase();
          return styleKeywords.some(keyword => iconName.includes(keyword));
        });
      }
    }

    console.log(`📊 After filtering: ${icons.length} icons`);

    if (icons.length === 0) {
      return sendError(res, 404, 'No icons found matching the criteria', { 
        query, 
        library, 
        style,
        originalCount: searchResponse.data.icons.length 
      });
    }

    // Select the best match (first result)
    const bestIcon = icons[0];
    const [prefix, name] = bestIcon.split(':');
    
    console.log(`✅ Selected best match: ${bestIcon}`);

    // Fetch SVG content
    console.log(`📥 Fetching SVG content...`);
    const svgUrl = `https://api.iconify.design/${bestIcon}.svg`;
    const svgResponse = await axios.get(svgUrl, { 
      timeout: 5000,
      responseType: 'text'
    });

    console.log(`✅ Successfully fetched SVG content (${svgResponse.data.length} bytes)`);

    const response = {
      success: true,
      query: query.trim(),
      icon: {
        id: bestIcon,
        name: name,
        prefix: prefix,
        library: prefix,
        url: svgUrl,
        svg: svgResponse.data,
        metadata: {
          totalFound: searchResponse.data.icons.length,
          filtered: icons.length,
          filters: { library, style, subLibrary }
        }
      }
    };

    sendSuccess(res, response);

  } catch (error) {
    console.error('Icon search error:', error);
    
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return sendError(res, 504, 'Search request timed out', { query: req.body?.query });
    }
    
    if (error.response) {
      return sendError(res, 502, 'External service error', {
        status: error.response.status,
        message: error.response.statusText
      });
    }
    
    return sendError(res, 500, 'Internal server error during icon search');
  }
}