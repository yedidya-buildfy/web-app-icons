// Main script for the icon search app
// This script handles searching icons via the Iconify API, filtering by the
// selected library, rendering results, and copying/downloading icons. It also
// logs searches to Supabase if credentials are provided.

document.addEventListener('DOMContentLoaded', () => {
  const librarySelect = document.getElementById('librarySelect');
  const subLibrarySelect = document.getElementById('subLibrarySelect');
  const fillOutlineSelect = document.getElementById('fillOutlineSelect');
  const lineSolidSelect = document.getElementById('lineSolidSelect');
  const searchInput = document.getElementById('searchInput');
  const resultsDiv = document.getElementById('results');

  // Initialize Supabase if env variables exist
  let supabaseClient = null;
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Failed to initialize Supabase:', e);
      supabaseClient = null;
    }
  }

  // Initialize Settings with Supabase client (if available)
  if (window.Settings && supabaseClient) {
    // Get current user and initialize settings
    supabaseClient.auth.getUser().then(({ data }) => {
      if (data.user) {
        window.Settings.init(supabaseClient, data.user.id);
        // Load settings from database
        window.Settings.loadFromDatabase().catch(e => {
          console.warn('Failed to load settings from database:', e);
        });
      } else {
        // User not logged in, use local storage only
        window.Settings.init(null, null);
      }
    });
  } else if (window.Settings) {
    // No Supabase, use local storage only
    window.Settings.init(null, null);
  }

  let debounceTimer;
  let lastData = null; // cache last search results

  async function searchIcons(query) {
    if (!query) {
      resultsDiv.innerHTML = '';
      lastData = null;
      return;
    }
    try {
      const limit = 100;
      // Use local proxy for Iconify search to avoid CSP/CORS issues and improve reliability
      const url = `/api/iconify-search?query=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      lastData = data; // cache results
      
      // Populate sub-library dropdown
      if (data.icons) {
        const allPrefixes = new Set(data.icons.map(id => id.split(':')[0]));
        
        // Clear previous options except "All"
        while (subLibrarySelect.options.length > 1) {
            subLibrarySelect.remove(1);
        }

        const existingSubLibs = new Set(Array.from(subLibrarySelect.options).map(opt => opt.value));
        allPrefixes.forEach(prefix => {
          if (!existingSubLibs.has(prefix)) {
            const option = document.createElement('option');
            option.value = prefix;
            option.textContent = prefix.replace(/-/g, ' ');
            subLibrarySelect.appendChild(option);
          }
        });
      }

      applyFiltersAndRender();

      // log search to supabase
      if (supabaseClient) {
        supabaseClient.from('searches').insert([
          { query: query, library: librarySelect.value }
        ]).then(() => {}).catch(() => {});
      }
    } catch (err) {
      console.error('Search error:', err);
      lastData = null;
      resultsDiv.textContent = 'Search temporarily unavailable. Please try again in a moment.';
    }
  }

  function applyFiltersAndRender() {
    if (!lastData || !lastData.icons) {
        renderResults([]);
        return;
    }

    const selectedLib = librarySelect.value;
    const selectedSubLib = subLibrarySelect.value;
    const selectedFillOutline = fillOutlineSelect.value;
    const selectedLineSolid = lineSolidSelect.value;

    let filteredIcons = lastData.icons;

    // Library filter
    if (selectedLib !== 'all') {
        filteredIcons = filteredIcons.filter(id => id.startsWith(selectedLib + ':'));
    }

    // Sub-library filter
    if (selectedSubLib !== 'all') {
        filteredIcons = filteredIcons.filter(id => id.startsWith(selectedSubLib + ':'));
    }

    // Fill/Outline filter
    if (selectedFillOutline !== 'all') {
        filteredIcons = filteredIcons.filter(id => {
            const name = id.split(':')[1];
            if (selectedFillOutline === 'filled') {
                return name.includes('fill') || id.includes('filled') || name.includes('solid') || id.includes('solid');
            }
            if (selectedFillOutline === 'outline') {
                return name.includes('outline') || id.includes('outline') || name.includes('line') || id.includes('line');
            }
            return true;
        });
    }

    // Line/Solid filter
    if (selectedLineSolid !== 'all') {
        filteredIcons = filteredIcons.filter(id => {
            const name = id.split(':')[1];
            if (selectedLineSolid === 'line') {
                return name.includes('line') || id.includes('line') || name.includes('outline') || id.includes('outline');
            }
            if (selectedLineSolid === 'solid') {
                return name.includes('solid') || id.includes('solid') || name.includes('filled') || id.includes('fill');
            }
            return true;
        });
    }
    
    renderResults(filteredIcons);
  }

  function renderResults(iconIds) {
    resultsDiv.innerHTML = '';
    if (!iconIds.length) {
      resultsDiv.textContent = 'No results found.';
      return;
    }

    const selectedLib = librarySelect.value;

    if (selectedLib === 'all') {
      const groupedIcons = iconIds.reduce((acc, id) => {
        const [prefix] = id.split(':');
        if (!acc[prefix]) {
          acc[prefix] = [];
        }
        acc[prefix].push(id);
        return acc;
      }, {});

      Object.keys(groupedIcons).sort().forEach(prefix => {
        const libraryName = prefix.replace(/-/g, ' ');
        const separator = document.createElement('h2');
        separator.className = 'library-separator';
        separator.textContent = libraryName;
        resultsDiv.appendChild(separator);

        const iconContainer = document.createElement('div');
        iconContainer.className = 'icon-container';
        resultsDiv.appendChild(iconContainer);

        groupedIcons[prefix].forEach(id => {
          const [, name] = id.split(':');
          const card = document.createElement('div');
          card.className = 'icon-card';
          // icon display
          const iconEl = document.createElement('iconify-icon');
          iconEl.setAttribute('icon', id);
          iconEl.setAttribute('height', '32');
          // label
          const nameEl = document.createElement('div');
          nameEl.className = 'icon-name';
          nameEl.textContent = name.replace(/-/g, ' ');
          // unified actions using IconUtils
          const iconData = { type: 'iconify', id: id };
          const filename = name.replace(/\s+/g, '-');
          const actions = IconUtils.createActionButtons(iconData, filename);

          card.appendChild(iconEl);
          card.appendChild(nameEl);
          card.appendChild(actions);
          iconContainer.appendChild(card);
        });
      });
    } else {
        iconIds.forEach((id) => {
            const [prefix, name] = id.split(':');
            const card = document.createElement('div');
            card.className = 'icon-card';
            // icon display
            const iconEl = document.createElement('iconify-icon');
            iconEl.setAttribute('icon', id);
            iconEl.setAttribute('height', '32');
            // label
            const nameEl = document.createElement('div');
            nameEl.className = 'icon-name';
            nameEl.textContent = name.replace(/-/g, ' ');
            // unified actions using IconUtils
            const iconData = { type: 'iconify', id: id };
            const filename = name.replace(/\s+/g, '-');
            const actions = IconUtils.createActionButtons(iconData, filename);

            card.appendChild(iconEl);
            card.appendChild(nameEl);
            card.appendChild(actions);
            resultsDiv.appendChild(card);
        });
    }
  }

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchIcons(q);
    }, 300);
  });

  librarySelect.addEventListener('change', applyFiltersAndRender);
  subLibrarySelect.addEventListener('change', applyFiltersAndRender);
  fillOutlineSelect.addEventListener('change', applyFiltersAndRender);
  lineSolidSelect.addEventListener('change', applyFiltersAndRender);
});