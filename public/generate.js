// Image generation script using a server-side proxy for Runware.ai API (REST)
// The browser calls /api/generate; the server uses RUNWARE_API_KEY securely.

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

  let lastImageURL = null;
  let lastSVGText = null;
  let supabaseClient = null;

  function buildPrompt() {
    const subject = (iconSubjectInput?.value || '').trim() || 'generic icon';
    const context = (contextInput?.value || '').trim();
    const style = (styleSelect?.value || 'outline').trim();
    const colors = (colorsInput?.value || 'black and white').trim();
    const background = (backgroundInput?.value || 'white').trim();
    const contextPart = context ? ` for ${context}` : '';
    const prompt = `Design a simple, flat, minimalist icon of a ${subject}${contextPart} ${style} style, ${colors} colors, ${background} background, evenly spaced elements. Maintain geometric balance and consistent stroke width, no text, only icon.`;
    if (promptInput) promptInput.value = prompt;
    return prompt;
  }

  buildPrompt();

  const sharedAuthClient = window.supabaseAuthClient;
  if (sharedAuthClient) supabaseClient = sharedAuthClient;
  else if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' && typeof supabase !== 'undefined') {
    try { 
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); 
      console.log('🔗 Supabase client initialized:', SUPABASE_URL);
      
      // Test connection
      supabaseClient.from('generated_icons').select('count').limit(1).then(result => {
        console.log('🧪 DB connection test:', result.error ? 'FAILED' : 'SUCCESS');
        if (result.error) console.error('Connection error:', result.error);
      });
    } catch (e) { 
      console.error('❌ Failed to create Supabase client:', e);
      supabaseClient = null; 
    }
  } else {
    console.warn('❌ Missing Supabase environment variables');
    console.log('SUPABASE_URL defined:', typeof SUPABASE_URL !== 'undefined');
    console.log('SUPABASE_ANON_KEY defined:', typeof SUPABASE_ANON_KEY !== 'undefined');
    console.log('supabase library loaded:', typeof supabase !== 'undefined');
  }

  function normalize(str) { return (str || '').toString().trim(); }
  function buildIconName({ subject, context, style, colors, background }) { return `${normalize(subject)} ${normalize(context)} ${normalize(style)} ${normalize(colors)} ${normalize(background)}`.replace(/\s+/g, ' ').trim(); }
  async function computeStableHash(input) { const enc = new TextEncoder(); const data = enc.encode(input); const d = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

  let isFlushingQueue = false;

  async function saveGeneratedIcon({ imageURL, promptParts }) {
    console.log('=== SAVE ICON DEBUG ===');
    console.log('imageURL:', imageURL);
    console.log('promptParts:', promptParts);
    console.log('supabaseClient exists:', !!supabaseClient);
    
    const payload = { subject: normalize(promptParts.subject), context: normalize(promptParts.context), style: normalize(promptParts.style), colors: normalize(promptParts.colors), background: normalize(promptParts.background), icon_name: buildIconName(promptParts), image_url: imageURL };
    const deterministic_id = await computeStableHash(`${payload.icon_name}|${payload.image_url}`);
    const record = { ...payload, deterministic_id };
    
    console.log('Generated record:', record);

    // Try to save directly first (RLS policies allow anonymous inserts)
    if (supabaseClient) {
      try {
        console.log('Attempting direct save to Supabase...');
        const { error, data } = await supabaseClient.from('generated_icons').upsert(record, { onConflict: 'deterministic_id', ignoreDuplicates: false });
        if (error) {
          console.error('Supabase upsert error:', error);
          throw error;
        }
        console.log('✅ Successfully saved icon to DB:', data);
        return;
      } catch (e) {
        console.error('❌ Direct save failed:', e);
        console.error('Error details:', e?.message, e?.code, e?.hint);
      }
    } else {
      console.warn('❌ No Supabase client available');
    }
    
    // Queue as fallback
    console.log('📝 Queuing icon for later save...');
    const queue = JSON.parse(localStorage.getItem('iconSaveQueue') || '[]'); 
    queue.push(record); 
    localStorage.setItem('iconSaveQueue', JSON.stringify(queue));
    console.log('Current queue length:', queue.length);
    flushSaveQueue();
  }

  async function flushSaveQueue() {
    if (!supabaseClient || isFlushingQueue) return;

    isFlushingQueue = true;
    try {
      let queue = JSON.parse(localStorage.getItem('iconSaveQueue') || '[]');
      while (queue.length) {
        const next = queue[0];
        const { error } = await supabaseClient.from('generated_icons').upsert(next, { onConflict: 'deterministic_id', ignoreDuplicates: false });
        if (error) {
          console.warn('Failed to flush queue item:', error);
          // If it's a permission error, stop trying for now
          if (error.code === 'PGRST301' || error.message?.includes('permission')) {
            setTimeout(() => { isFlushingQueue = false; }, 5000);
            return;
          }
          throw error;
        }
        queue.shift();
        localStorage.setItem('iconSaveQueue', JSON.stringify(queue));
      }
      if (queue.length === 0) console.log('Flushed all queued icons');
    } catch (e) {
      console.warn('Flush failed; will retry later:', e?.message || e);
      setTimeout(() => { isFlushingQueue = false; }, 2000);
      return;
    }
    isFlushingQueue = false;
  }

  if (supabaseClient && supabaseClient.auth && supabaseClient.auth.onAuthStateChange) {
    supabaseClient.auth.onAuthStateChange((_event, session) => { if (session) flushSaveQueue(); });
  }
  window.addEventListener('online', () => { flushSaveQueue(); });
  flushSaveQueue();

  [iconSubjectInput, contextInput, styleSelect, colorsInput, backgroundInput].forEach((el) => { if (el) el.addEventListener('input', buildPrompt); if (el && el.tagName==='SELECT') el.addEventListener('change', buildPrompt); });

  async function generateImage() {
    const prompt = buildPrompt().trim(); if (!prompt) { errorMessage.textContent='Please enter a description for the image.'; errorSection.classList.remove('hidden'); return; }
    setLoadingState(true); errorSection.classList.add('hidden'); resultSection.classList.add('hidden');
    const model = 'google:2@3';
    try {
      const result = await tryGenerateWithModel(prompt, model);
      if (result) {
        lastImageURL = result.imageURL; displayGeneratedImage(result.imageURL);
        svgSection.classList.add('hidden'); svgResult.innerHTML=''; lastSVGText=null; downloadSvgBtn.classList.add('hidden');
        const promptParts = { subject: iconSubjectInput?.value || '', context: contextInput?.value || '', style: styleSelect?.value || '', colors: colorsInput?.value || '', background: backgroundInput?.value || '' };
        saveGeneratedIcon({ imageURL: result.imageURL, promptParts }).catch(()=>{});
      }
    } catch (err) {
      errorMessage.textContent = `Generation failed: ${err.message || 'Unknown error'}`; errorSection.classList.remove('hidden');
    } finally { setLoadingState(false); }
  }

  async function tryGenerateWithModel(prompt, model) {
    const taskUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8); return v.toString(16); });
    const payload = [{ taskType:'imageInference', taskUUID, positivePrompt: prompt, width:1024, height:1024, model, numberResults:1 }];
    const response = await fetch('/api/generate', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const text = await response.text(); let json; try { json = JSON.parse(text || '{}'); } catch { throw new Error(`Bad response (${response.status})`); }
    if (!response.ok || json.error || json.errors) { const msg = (Array.isArray(json?.error) && json.error[0]?.message) || (Array.isArray(json?.errors) && json.errors[0]?.message) || json?.message || 'Request failed'; throw new Error(msg); }
    const result = Array.isArray(json?.data) ? json.data.find(d => d.taskType === 'imageInference') : null; if (!result || !result.imageURL) throw new Error('No image URL returned by the API.'); return result;
  }

  async function convertToSVG() { /* unchanged here */ }

  function displayGeneratedImage(imageURL) { imageResult.innerHTML = `<img src="${imageURL}" alt="Generated image" />`; resultSection.classList.remove('hidden'); downloadBtn.onclick = () => downloadImage(imageURL); convertSvgBtn.onclick = convertToSVG; downloadSvgBtn.onclick = downloadSVG; regenerateBtn.onclick = () => { resultSection.classList.add('hidden'); svgSection.classList.add('hidden'); svgResult.innerHTML=''; lastSVGText=null; downloadSvgBtn.classList.add('hidden'); iconSubjectInput?.focus(); }; }
  function downloadImage(imageURL) { const link = document.createElement('a'); link.href = imageURL; link.download = `generated-image-${Date.now()}.jpg`; document.body.appendChild(link); link.click(); document.body.removeChild(link); }
  function setLoadingState(loading){ if(loading){ generateBtn.disabled=true; generateBtn.textContent='Generating...'; loadingSpinner.classList.remove('hidden'); } else { generateBtn.disabled=false; generateBtn.textContent='Generate Image'; loadingSpinner.classList.add('hidden'); } }
  function downloadSVG(){ if(!lastSVGText) return; const blob=new Blob([lastSVGText],{type:'image/svg+xml'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`vectorized-${Date.now()}.svg`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
  function showError(message){ errorMessage.textContent=message; errorSection.classList.remove('hidden'); }

  // Add test function for debugging (remove later)
  window.clearQueue = function() {
    localStorage.removeItem('iconSaveQueue');
    console.log('🧹 Cleared local storage queue');
  };

  window.testDatabaseSave = async function() {
    if (!supabaseClient) {
      console.error('No Supabase client');
      return;
    }
    
    const testRecord = {
      deterministic_id: 'test-' + Date.now(),
      icon_name: 'test icon',
      subject: 'test',
      context: 'test context',
      style: 'outline',
      colors: 'black and white', 
      background: 'white',
      image_url: 'https://example.com/test.jpg'
    };
    
    console.log('🧪 Testing database save with:', testRecord);
    
    try {
      const { data, error } = await supabaseClient
        .from('generated_icons')
        .insert(testRecord);
        
      if (error) {
        console.error('❌ Test save failed:', error);
      } else {
        console.log('✅ Test save successful:', data);
      }
    } catch (e) {
      console.error('❌ Test save exception:', e);
    }
  };

  generateBtn.addEventListener('click', generateImage);
});
