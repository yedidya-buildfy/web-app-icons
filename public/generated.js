// Generated Icons page: lists icons saved to Supabase with filters

document.addEventListener('DOMContentLoaded', () => {
  const resultsDiv = document.getElementById('results');
  const subjectInput = document.getElementById('filterSubject');
  const styleInput = document.getElementById('filterStyle');
  const colorsInput = document.getElementById('filterColors');
  const backgroundInput = document.getElementById('filterBackground');

  let supabaseClient = null;
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Failed to initialize Supabase:', e);
      supabaseClient = null;
    }
  }

  function normalize(str) {
    return (str || '').toString().trim();
  }

  async function fetchIcons() {
    if (!supabaseClient) {
      resultsDiv.textContent = 'Supabase is not configured.';
      return [];
    }
    const { data, error } = await supabaseClient
      .from('generated_icons_view')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('Fetch error:', error);
      resultsDiv.textContent = 'Failed to load icons.';
      return [];
    }
    return data || [];
  }

  function render(icons) {
    resultsDiv.innerHTML = '';
    if (!icons.length) {
      resultsDiv.textContent = 'No icons found.';
      return;
    }
    icons.forEach((row) => {
      const card = document.createElement('div');
      card.className = 'icon-card';

      const img = document.createElement('img');
      img.src = row.image_url;
      img.alt = row.icon_name;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';

      const nameEl = document.createElement('div');
      nameEl.className = 'icon-name';
      nameEl.textContent = row.icon_name;

      const info = document.createElement('div');
      info.style.fontSize = '12px';
      info.style.color = '#666';
      info.textContent = `${row.subject} | ${row.style} | ${row.colors} | ${row.background}`;

      const actions = document.createElement('div');
      actions.className = 'icon-actions';
      const downloadLink = document.createElement('a');
      downloadLink.className = 'download-link';
      downloadLink.textContent = 'Download';
      downloadLink.href = row.image_url;
      downloadLink.setAttribute('download', `${row.icon_name}.jpg`);
      downloadLink.target = '_blank';
      actions.appendChild(downloadLink);

      card.appendChild(img);
      card.appendChild(nameEl);
      card.appendChild(info);
      card.appendChild(actions);
      resultsDiv.appendChild(card);
    });
  }

  async function applyFilters() {
    const subject = normalize(subjectInput.value);
    const style = normalize(styleInput.value);
    const colors = normalize(colorsInput.value);
    const background = normalize(backgroundInput.value);

    let icons = await fetchIcons();
    if (subject) icons = icons.filter((r) => r.subject?.toLowerCase().includes(subject.toLowerCase()));
    if (style) icons = icons.filter((r) => r.style?.toLowerCase().includes(style.toLowerCase()));
    if (colors) icons = icons.filter((r) => r.colors?.toLowerCase().includes(colors.toLowerCase()));
    if (background) icons = icons.filter((r) => r.background?.toLowerCase().includes(background.toLowerCase()));
    render(icons);
  }

  [subjectInput, styleInput, colorsInput, backgroundInput].forEach((el) => {
    el.addEventListener('input', () => {
      clearTimeout(el._t);
      el._t = setTimeout(applyFilters, 250);
    });
  });

  applyFilters();
});


