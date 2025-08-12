// Generated Icons page: lists icons saved to Supabase with filters and provides Copy SVG

document.addEventListener('DOMContentLoaded', () => {
  const resultsDiv = document.getElementById('results');
  const subjectInput = document.getElementById('filterSubject');
  const styleInput = document.getElementById('filterStyle');
  const colorsInput = document.getElementById('filterColors');
  const backgroundInput = document.getElementById('filterBackground');

  const client = window.supabaseAuthClient || (typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null);

  function normalize(str) { return (str || '').toString().trim(); }
  function logInfo(msg){ console.log(`ℹ️ ${msg}`);} function logSuccess(msg){ console.log(`✅ ${msg}`);} function logWarning(msg){ console.warn(`⚠️ ${msg}`);} function logError(msg){ console.error(`❌ ${msg}`);} 

  async function fetchIcons() {
    if (!client) { logError('Database not available'); resultsDiv.textContent = 'Database is not configured.'; return []; }
    try {
      logInfo('Loading icons...');
      const { data, error } = await client
        .from('generated_icons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) { logError('Failed to load icons'); resultsDiv.textContent = `Failed to load icons: ${error.message}`; return []; }
      logSuccess(`Loaded ${data?.length || 0} icons`);
      return data || [];
    } catch (err) { logError('Network error occurred'); resultsDiv.textContent = 'Failed to load icons due to network error.'; return []; }
  }

  // Local vectorization using ImageTracer (client-side, fast for icons)
  async function localVectorize(imageUrl){
    return new Promise(async (resolve, reject) => {
      try {
        const proxied = `/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        const resp = await fetch(proxied, { cache: 'no-store' });
        if (!resp.ok) return reject(new Error(`HTTP ${resp.status}`));
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        const options = { ltres: 1, qtres: 1, pathomit: 8, colorsampling: 0, numberofcolors: 2, strokewidth: 2, roundcoords: 1 };
        const svgString = ImageTracer.imagedataToSVG(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
        resolve(svgString);
      } catch (e) { reject(e); }
    });
  }

  // Server vectorization fallback (if you later add /api/vectorize)
  async function serverVectorize(imageUrl){
    const params = new URLSearchParams({ url: imageUrl, color: '#000000', threshold: '128', turdSize: '2', invert: 'false' });
    const response = await fetch(`/api/vectorize?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }

  async function vectorizeToSVG(imageUrl){
    try { return await localVectorize(imageUrl); }
    catch (e) { logWarning(`Local vectorize failed: ${e.message}`); try { return await serverVectorize(imageUrl); } catch (ee) { throw ee; } }
  }

  async function copySVG(imageUrl, buttonElement) {
    const originalText = buttonElement.textContent; const originalClass = buttonElement.className;
    try {
      buttonElement.disabled = true; buttonElement.textContent = 'Converting…';
      const svgText = await vectorizeToSVG(imageUrl);
      await navigator.clipboard.writeText(svgText);
      buttonElement.textContent = 'Copied!'; buttonElement.className = 'download-btn';
      setTimeout(() => { buttonElement.textContent = originalText; buttonElement.className = originalClass; buttonElement.disabled = false; }, 1500);
    } catch (err) {
      logError(`Copy SVG failed: ${err.message}`);
      buttonElement.textContent = 'Error'; buttonElement.className = 'regenerate-btn';
      setTimeout(() => { buttonElement.textContent = originalText; buttonElement.className = originalClass; buttonElement.disabled = false; }, 1800);
    }
  }

  function render(icons) {
    resultsDiv.innerHTML = '';
    if (!icons.length) { resultsDiv.textContent = 'No icons found.'; return; }
    icons.forEach((row) => {
      const card = document.createElement('div'); card.className = 'icon-card';

      // Always use the original Runware URL (proxied) for display
      const displayUrl = `/proxy-image?url=${encodeURIComponent(row.image_url)}`;

      const img = document.createElement('img'); img.src = displayUrl; img.alt = row.icon_name; img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.aspectRatio = '1'; img.style.objectFit = 'contain';

      const nameEl = document.createElement('div'); nameEl.className = 'icon-name'; nameEl.textContent = row.icon_name;
      const info = document.createElement('div'); info.style.fontSize = '12px'; info.style.color = '#666'; info.textContent = `${row.subject} | ${row.style} | ${row.colors} | ${row.background}`;

      const actions = document.createElement('div'); actions.className = 'icon-actions';
      const downloadUrl = row.image_url;

      const downloadLink = document.createElement('a'); downloadLink.className = 'download-link'; downloadLink.textContent = 'Download'; downloadLink.href = downloadUrl; downloadLink.setAttribute('download', `${row.icon_name}.jpg`); downloadLink.target = '_blank'; actions.appendChild(downloadLink);

      const copySvgBtn = document.createElement('button'); copySvgBtn.className = 'copy-btn'; copySvgBtn.textContent = 'Copy SVG'; copySvgBtn.style.marginLeft = '8px';
      copySvgBtn.addEventListener('click', () => copySVG(row.image_url, copySvgBtn));
      actions.appendChild(copySvgBtn);

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


