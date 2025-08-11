// Main script for the icon search app
// This script handles searching icons via the Iconify API, filtering by the
// selected library, rendering results, and copying/downloading icons. It also
// logs searches to Supabase if credentials are provided.

document.addEventListener('DOMContentLoaded', () => {
  const librarySelect = document.getElementById('librarySelect');
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

  let debounceTimer;

  async function searchIcons(query) {
    const selectedLib = librarySelect.value;
    if (!query) {
      resultsDiv.innerHTML = '';
      return;
    }
    try {
      const limit = 100;
      const url = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url);
      const data = await response.json();
      // data.icons is an array of IDs like 'tabler:home', 'lucide:search'
      const icons = (data.icons || []).filter((id) => selectedLib === 'all' || id.startsWith(selectedLib + ':'));
      renderResults(icons);
      // log search to supabase
      if (supabaseClient) {
        supabaseClient.from('searches').insert([
          { query: query, library: selectedLib }
        ]).then(() => {}).catch(() => {});
      }
    } catch (err) {
      console.error('Search error:', err);
    }
  }

  function renderResults(iconIds) {
    resultsDiv.innerHTML = '';
    if (!iconIds.length) {
      resultsDiv.textContent = 'No results found.';
      return;
    }

    const selectedLib = librarySelect.value;

    if (selectedLib === 'all') {
      const mainLibraries = Array.from(librarySelect.options)
        .map(option => option.value)
        .filter(value => value !== 'all');

      const groupedIcons = iconIds.reduce((acc, id) => {
        const mainLib = mainLibraries.find(lib => id.startsWith(lib + ':'));
        const key = mainLib || 'other';

        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(id);
        return acc;
      }, {});

      const libraryOrder = [...mainLibraries, 'other'];

      libraryOrder.forEach(prefix => {
        if (!groupedIcons[prefix]) {
            return;
        }
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
          // actions container
          const actions = document.createElement('div');
          actions.className = 'icon-actions';
          // copy button
          const copyBtn = document.createElement('button');
          copyBtn.className = 'copy-btn';
          copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', () => {
            const code = `<iconify-icon icon="${id}"></iconify-icon>`;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
              }).catch((err) => {
                console.error('Clipboard error:', err);
              });
            } else {
              // fallback: create temp textarea
              const textarea = document.createElement('textarea');
              textarea.value = code;
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              document.body.removeChild(textarea);
            }
          });
          // download link
          const downloadLink = document.createElement('a');
          downloadLink.className = 'download-link';
          downloadLink.textContent = 'Download';
          downloadLink.href = `https://api.iconify.design/${id}.svg?download=1`;
          downloadLink.setAttribute('download', `${name}.svg`);
          downloadLink.target = '_blank';
          actions.appendChild(copyBtn);
          actions.appendChild(downloadLink);

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
            // actions container
            const actions = document.createElement('div');
            actions.className = 'icon-actions';
            // copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                const code = `<iconify-icon icon="${id}"></iconify-icon>`;
                if (navigator.clipboard) {
                navigator.clipboard.writeText(code).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
                }).catch((err) => {
                    console.error('Clipboard error:', err);
                });
                } else {
                // fallback: create temp textarea
                const textarea = document.createElement('textarea');
                textarea.value = code;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                }
            });
            // download link
            const downloadLink = document.createElement('a');
            downloadLink.className = 'download-link';
            downloadLink.textContent = 'Download';
            downloadLink.href = `https://api.iconify.design/${id}.svg?download=1`;
            downloadLink.setAttribute('download', `${name}.svg`);
            downloadLink.target = '_blank';
            actions.appendChild(copyBtn);
            actions.appendChild(downloadLink);

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

  librarySelect.addEventListener('change', () => {
    const q = searchInput.value.trim();
    if (q) {
      searchIcons(q);
    }
  });
});