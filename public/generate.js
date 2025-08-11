// Image generation script using Runware.ai API (REST)
// Uses HTTP POST per docs: https://runware.ai/docs/en/getting-started/how-to-connect

document.addEventListener('DOMContentLoaded', () => {
  const promptInput = document.getElementById('promptInput');
  const generateBtn = document.getElementById('generateBtn');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const resultSection = document.getElementById('resultSection');
  const imageResult = document.getElementById('imageResult');
  const svgSection = document.getElementById('svgSection');
  const svgResult = document.getElementById('svgResult');
  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadSvgBtn = document.getElementById('downloadSvgBtn');
  const convertSvgBtn = document.getElementById('convertSvgBtn');
  const regenerateBtn = document.getElementById('regenerateBtn');

  // New prompt builder fields
  const iconSubjectInput = document.getElementById('iconSubjectInput');
  const contextInput = document.getElementById('contextInput');
  const styleSelect = document.getElementById('styleSelect');
  const colorsInput = document.getElementById('colorsInput');
  const backgroundInput = document.getElementById('backgroundInput');
  const promptPreview = document.getElementById('promptPreview');

  let lastImageURL = null;
  let lastSVGText = null;
  let supabaseClient = null;

  // Check if API key is available
  function checkAPIKey() {
    if (typeof RUNWARE_API_KEY === 'undefined' || !RUNWARE_API_KEY) {
      showError('Please add your Runware.ai API key to env.js (copy public/env.example.js to public/env.js and fill RUNWARE_API_KEY).');
      return false;
    }
    return true;
  }

  // Build structured prompt
  function buildPrompt() {
    const subject = (iconSubjectInput?.value || '').trim() || 'generic icon';
    const context = (contextInput?.value || '').trim();
    const style = (styleSelect?.value || 'outline').trim();
    const colors = (colorsInput?.value || 'black and white').trim();
    const background = (backgroundInput?.value || 'white').trim();

    const contextPart = context ? ` for ${context}` : '';
    const prompt = `Design a simple, flat, minimalist icon of a ${subject}${contextPart} ${style} style, ${colors} colors, ${background} background, evenly spaced elements. Maintain geometric balance and consistent stroke width, no text, only icon.`;

    if (promptPreview) promptPreview.textContent = prompt;
    if (promptInput) promptInput.value = prompt; // keep hidden textarea in sync
    return prompt;
  }

  // Initialize preview
  buildPrompt();

  // Initialize Supabase if env variables exist
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Failed to initialize Supabase:', e);
      supabaseClient = null;
    }
  }

  function normalize(str) { return (str || '').toString().trim(); }

  function buildIconName({ subject, context, style, colors, background }) {
    return `${normalize(subject)} ${normalize(context)} ${normalize(style)} ${normalize(colors)} ${normalize(background)}`
      .replace(/\s+/g, ' ') 
      .trim();
  }

  async function computeStableHash(input) {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let isFlushingQueue = false;

  async function saveGeneratedIcon({ imageURL, promptParts }) {
    if (!supabaseClient) return;

    const payload = {
      subject: normalize(promptParts.subject),
      context: normalize(promptParts.context),
      style: normalize(promptParts.style),
      colors: normalize(promptParts.colors),
      background: normalize(promptParts.background),
      icon_name: buildIconName(promptParts),
      image_url: imageURL
    };

    // deterministic id for idempotency
    const idSource = `${payload.icon_name}|${payload.image_url}`;
    const deterministic_id = await computeStableHash(idSource);

    const record = { ...payload, deterministic_id };

    // queue for offline/retry
    const queue = JSON.parse(localStorage.getItem('iconSaveQueue') || '[]');
    queue.push(record);
    localStorage.setItem('iconSaveQueue', JSON.stringify(queue));

    // try to flush immediately
    flushSaveQueue();
  }

  async function flushSaveQueue() {
    if (!supabaseClient || isFlushingQueue) return;
    isFlushingQueue = true;
    try {
      let queue = JSON.parse(localStorage.getItem('iconSaveQueue') || '[]');
      while (queue.length) {
        const next = queue[0];
        const { error } = await supabaseClient
          .from('generated_icons')
          .upsert(next, { onConflict: 'deterministic_id', ignoreDuplicates: false });
        if (error) throw error;
        queue.shift();
        localStorage.setItem('iconSaveQueue', JSON.stringify(queue));
      }
    } catch (e) {
      setTimeout(() => { isFlushingQueue = false; flushSaveQueue(); }, 2000);
      return;
    }
    isFlushingQueue = false;
  }

  // retry when connectivity returns
  window.addEventListener('online', () => { flushSaveQueue(); });
  setTimeout(flushSaveQueue, 0);

  // Update preview on change
  [iconSubjectInput, contextInput, styleSelect, colorsInput, backgroundInput].forEach((el) => {
    if (el) el.addEventListener('input', buildPrompt);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', buildPrompt);
  });

  // Find available models (for debugging)
  async function searchModels() {
    try {
      const response = await fetch('https://api.runware.ai/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RUNWARE_API_KEY}`
        },
        body: JSON.stringify([
          {
            taskType: 'modelSearch',
            taskUUID: generateUUID()
          }
        ])
      });
      const json = await response.json();
      console.log('Available models:', json);
      
      // Show the actual model results
      if (json.data && json.data[0] && json.data[0].results) {
        console.log('Model results:', json.data[0].results);
        json.data[0].results.forEach((model, index) => {
          console.log(`Model ${index + 1}:`, {
            name: model.name,
            civitaiId: model.civitaiId,
            modelVersionId: model.modelVersionId,
            identifier: `civitai:${model.civitaiId}@${model.modelVersionId}`
          });
        });
      }
      return json;
    } catch (error) {
      console.error('Model search failed:', error);
      return null;
    }
  }

  // Generate image using only Imagen 4.0 Fast
  async function generateImage() {
    if (!checkAPIKey()) return;
    const prompt = buildPrompt().trim();
    if (!prompt) { showError('Please enter a description for the image.'); return; }
    setLoadingState(true); hideError(); hideResult();
    const model = 'google:2@3';
    try {
      const result = await tryGenerateWithModel(prompt, model);
      if (result) {
        lastImageURL = result.imageURL;
        displayGeneratedImage(result.imageURL);
        svgSection.classList.add('hidden'); svgResult.innerHTML=''; lastSVGText=null; downloadSvgBtn.classList.add('hidden');
        const promptParts = {
          subject: iconSubjectInput?.value || '',
          context: contextInput?.value || '',
          style: styleSelect?.value || '',
          colors: colorsInput?.value || '',
          background: backgroundInput?.value || ''
        };
        saveGeneratedIcon({ imageURL: result.imageURL, promptParts }).catch(() => {});
      }
    } catch (err) {
      if (err.name === 'AbortError') showError('Request timed out. Please try again.');
      else showError(`Imagen 4.0 Fast failed: ${err.message || 'Unknown error'}`);
    } finally { setLoadingState(false); }
  }

  // Try generating with a specific model
  async function tryGenerateWithModel(prompt, model) {
    const taskUUID = generateUUID();
    
    const payload = [
      {
        taskType: 'imageInference',
        taskUUID: taskUUID,
        positivePrompt: prompt,
        width: 1024,
        height: 1024,
        model: model,
        numberResults: 1
      }
    ];

    console.log('🚀 Sending request to Runware API:');
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));
    console.log('🔑 API Key (first 10 chars):', RUNWARE_API_KEY.substring(0, 10) + '...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch('https://api.runware.ai/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNWARE_API_KEY}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('📡 Raw response status:', response.status);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

    const json = await response.json().catch((parseError) => {
      console.error('❌ Failed to parse JSON response:', parseError);
      return {};
    });
    
    console.log('📄 Full API response:', JSON.stringify(json, null, 2));

    // Per docs: success => { data: [...] }; error => { error: ... } (string) or errors (array)
    if (!response.ok || json.error || json.errors) {
      let errMsg = 'Request failed';
      if (typeof json.error === 'string') errMsg = json.error;
      else if (Array.isArray(json.error) && json.error[0]?.message) errMsg = json.error[0].message;
      else if (Array.isArray(json.errors) && json.errors[0]?.message) errMsg = json.errors[0].message;
      else if (json.message) errMsg = json.message;
      
      console.error('❌ API returned error:');
      console.error('Status:', response.status);
      console.error('Error message:', errMsg);
      console.error('Full error response:', json);
      
      throw new Error(`${errMsg} (Status: ${response.status})`);
    }

    const result = Array.isArray(json?.data) ? json.data.find(d => d.taskType === 'imageInference') : null;
    if (!result || !result.imageURL) {
      console.error('❌ No image URL in successful response:');
      console.error('Data array:', json?.data);
      console.error('Image inference result:', result);
      throw new Error('No image URL returned by the API.');
    }

    console.log('✅ Found image URL:', result.imageURL);
    return result;
  }

  // Vectorize current image to SVG using ImageTracer
  async function convertToSVG() {
    try {
      if (!lastImageURL) { showError('No image to convert. Generate an image first.'); return; }
      const proxiedURL = `/proxy-image?url=${encodeURIComponent(lastImageURL)}`;
      const resp = await fetch(proxiedURL, { cache: 'no-store' });
      if (!resp.ok) { console.error('Proxy fetch failed with status:', resp.status); showError('Could not fetch image via proxy (did you restart the server?).'); return; }
      const imgBlob = await resp.blob();
      let bitmap = null;
      try { bitmap = await createImageBitmap(imgBlob); }
      catch (e) {
        const objectUrl = URL.createObjectURL(imgBlob);
        bitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => { try { const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(objectUrl); resolve({ width: img.width, height: img.height, _canvas: canvas, _ctx: ctx }); } catch (err) { reject(err); } };
          img.onerror = reject;
          img.src = objectUrl;
        });
      }
      let canvas, ctx;
      if (bitmap._canvas) { canvas = bitmap._canvas; ctx = bitmap._ctx; }
      else { canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); }
      const options = { ltres: 1, qtres: 1, pathomit: 8, colorsampling: 0, numberofcolors: 2, strokewidth: 2, roundcoords: 1 };
      const svgString = ImageTracer.imagedataToSVG(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
      lastSVGText = svgString;
      svgSection.classList.remove('hidden');
      svgResult.innerHTML = svgString;
      downloadSvgBtn.classList.remove('hidden');
    } catch (err) {
      console.error('SVG conversion failed:', err); showError('SVG conversion failed. If the server was updated, restart it and try again.');
    }
  }

  function downloadSVG() {
    if (!lastSVGText) return; const blob = new Blob([lastSVGText], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `vectorized-${Date.now()}.svg`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  }

  // Display generated image
  function displayGeneratedImage(imageURL) {
    imageResult.innerHTML = `<img src="${imageURL}" alt="Generated image" />`;
    resultSection.classList.remove('hidden');
    downloadBtn.onclick = () => downloadImage(imageURL); convertSvgBtn.onclick = convertToSVG; downloadSvgBtn.onclick = downloadSVG; regenerateBtn.onclick = () => { hideResult(); svgSection.classList.add('hidden'); svgResult.innerHTML=''; lastSVGText=null; downloadSvgBtn.classList.add('hidden'); iconSubjectInput?.focus(); };
  }

  function downloadImage(imageURL) { const link = document.createElement('a'); link.href = imageURL; link.download = `generated-image-${Date.now()}.jpg`; document.body.appendChild(link); link.click(); document.body.removeChild(link); }

  function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }

  function setLoadingState(loading) { if (loading) { generateBtn.disabled = true; generateBtn.textContent = 'Generating...'; loadingSpinner.classList.remove('hidden'); } else { generateBtn.disabled = false; generateBtn.textContent = 'Generate Image'; loadingSpinner.classList.add('hidden'); } }
  function showError(message) { errorMessage.textContent = message; errorSection.classList.remove('hidden'); }
  function hideError() { errorSection.classList.add('hidden'); }
  function hideResult() { resultSection.classList.add('hidden'); }

  generateBtn.addEventListener('click', generateImage);
  const searchModelsBtn = document.getElementById('searchModelsBtn'); if (searchModelsBtn) { searchModelsBtn.addEventListener('click', async () => { if (!checkAPIKey()) return; console.log('Searching for available models...'); await searchModels(); }); }
});
