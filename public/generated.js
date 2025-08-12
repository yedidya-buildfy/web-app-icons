// Generated Icons page: lists icons saved to Supabase with filters

document.addEventListener('DOMContentLoaded', () => {
  const resultsDiv = document.getElementById('results');
  const subjectInput = document.getElementById('filterSubject');
  const styleInput = document.getElementById('filterStyle');
  const colorsInput = document.getElementById('filterColors');
  const backgroundInput = document.getElementById('filterBackground');

  const client = window.supabaseAuthClient || (typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null);

  function normalize(str) { return (str || '').toString().trim(); }

  // Utility functions for clean logging (hide sensitive data)
  function logInfo(message) { console.log(`ℹ️ ${message}`); }
  function logSuccess(message) { console.log(`✅ ${message}`); }
  function logWarning(message) { console.warn(`⚠️ ${message}`); }
  function logError(message) { console.error(`❌ ${message}`); }

  async function fetchIcons() {
    if (!client) {
      logError('Database not available');
      resultsDiv.textContent = 'Database is not configured.';
      return [];
    }

    try {
      logInfo('Loading icons...');
      const { data, error } = await client
        .from('generated_icons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
        
      if (error) {
        logError('Failed to load icons');
        resultsDiv.textContent = `Failed to load icons: ${error.message}`;
        return [];
      }
      
      logSuccess(`Loaded ${data?.length || 0} icons`);
      return data || [];
    } catch (err) {
      logError('Network error occurred');
      resultsDiv.textContent = 'Failed to load icons due to network error.';
      return [];
    }
  }

  function render(icons) {
    resultsDiv.innerHTML = '';
    if (!icons.length) { resultsDiv.textContent = 'No icons found.'; return; }
    icons.forEach((row) => {
      const card = document.createElement('div'); card.className = 'icon-card';
      const img = document.createElement('img');
      
      // Use custom Aicon URL if available, otherwise fallback to proxy
      const imageUrl = row.custom_id ? `/aicon/${row.custom_id}.jpg` : `/proxy-image?url=${encodeURIComponent(row.image_url)}`;
      img.src = imageUrl; 
      img.alt = row.icon_name;
      img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.aspectRatio = '1'; img.style.objectFit = 'contain';
      
      const nameEl = document.createElement('div'); nameEl.className = 'icon-name'; nameEl.textContent = row.icon_name;
      const info = document.createElement('div'); info.style.fontSize = '12px'; info.style.color = '#666'; info.textContent = `${row.subject} | ${row.style} | ${row.colors} | ${row.background}`;
      const actions = document.createElement('div'); actions.className = 'icon-actions';
      
      // Use custom URL for download as well
      const downloadUrl = row.custom_id ? `/aicon/${row.custom_id}.jpg` : row.image_url;
      const downloadLink = document.createElement('a'); 
      downloadLink.className = 'download-link'; 
      downloadLink.textContent = 'Download'; 
      downloadLink.href = downloadUrl; 
      downloadLink.setAttribute('download', `${row.icon_name}.jpg`); 
      downloadLink.target = '_blank'; 
      actions.appendChild(downloadLink);
      
      card.appendChild(img); card.appendChild(nameEl); card.appendChild(info); card.appendChild(actions); resultsDiv.appendChild(card);
    });
  }

  async function applyFilters() {
    let icons = await fetchIcons();
    const subject = normalize(subjectInput.value); const style = normalize(styleInput.value); const colors = normalize(colorsInput.value); const background = normalize(backgroundInput.value);
    if (subject) icons = icons.filter((r) => r.subject?.toLowerCase().includes(subject.toLowerCase()));
    if (style) icons = icons.filter((r) => r.style?.toLowerCase().includes(style.toLowerCase()));
    if (colors) icons = icons.filter((r) => r.colors?.toLowerCase().includes(colors.toLowerCase()));
    if (background) icons = icons.filter((r) => r.background?.toLowerCase().includes(background.toLowerCase()));
    render(icons);
  }

  [subjectInput, styleInput, colorsInput, backgroundInput].forEach((el) => { el.addEventListener('input', () => { clearTimeout(el._t); el._t = setTimeout(applyFilters, 250); }); });

  applyFilters();
});


