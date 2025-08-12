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
  const promptPreview = document.getElementById('promptPreview');

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
    if (promptPreview) promptPreview.textContent = prompt;
    if (promptInput) promptInput.value = prompt;
    return prompt;
  }

  buildPrompt();

  // Reuse global auth client if present
  const sharedAuthClient = window.supabaseAuthClient;
  if (sharedAuthClient) {
    supabaseClient = sharedAuthClient;
  } else if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' && typeof supabase !== 'undefined') {
    try { supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch { supabaseClient = null; }
  }

  function normalize(str) { return (str || '').toString().trim(); }
  function buildIconName({ subject, context, style, colors, background }) { return `${normalize(subject)} ${normalize(context)} ${normalize(style)} ${normalize(colors)} ${normalize(background)}`.replace(/\s+/g, ' ').trim(); }
  async function computeStableHash(input) { const enc = new TextEncoder(); const data = enc.encode(input); const d = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

  let isFlushingQueue = false;

  async function userIsAuthenticated() {
    if (!supabaseClient) return false;
    try { const { data: { session } } = await supabaseClient.auth.getSession(); return !!session; } catch { return false; }
  }

  async function saveGeneratedIcon({ imageURL, promptParts }) {
    // Always queue locally first; will flush only when authenticated
    const payload = { subject: normalize(promptParts.subject), context: normalize(promptParts.context), style: normalize(promptParts.style), colors: normalize(promptParts.colors), background: normalize(promptParts.background), icon_name: buildIconName(promptParts), image_url: imageURL };
    const deterministic_id = await computeStableHash(`${payload.icon_name}|${payload.image_url}`);
    const record = { ...payload, deterministic_id };
    const queue = JSON.parse(localStorage.getItem('iconSaveQueue') || '[]'); queue.push(record); localStorage.setItem('iconSaveQueue', JSON.stringify(queue));
    flushSaveQueue();
  }

  async function flushSaveQueue() {
    if (!supabaseClient || isFlushingQueue) return;
    const authed = await userIsAuthenticated();
    if (!authed) return; // avoid 401s when user not logged in

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
    } catch {
      // back off; will retry on next auth change or online event
      setTimeout(() => { isFlushingQueue = false; }, 2000);
      return;
    }
    isFlushingQueue = false;
  }

  // Retry flush when user logs in
  if (supabaseClient && supabaseClient.auth && supabaseClient.auth.onAuthStateChange) {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session) flushSaveQueue();
    });
  }

  window.addEventListener('online', () => { flushSaveQueue(); });
  // initial attempt (returns immediately if not authed)
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
    const text = await response.text();
    let json; try { json = JSON.parse(text || '{}'); } catch { throw new Error(`Bad response (${response.status})`); }
    if (!response.ok || json.error || json.errors) {
      const msg = (Array.isArray(json?.error) && json.error[0]?.message) || (Array.isArray(json?.errors) && json.errors[0]?.message) || json?.message || 'Request failed';
      throw new Error(msg);
    }
    const result = Array.isArray(json?.data) ? json.data.find(d => d.taskType === 'imageInference') : null;
    if (!result || !result.imageURL) throw new Error('No image URL returned by the API.');
    return result;
  }

  async function convertToSVG() { /* unchanged; uses /proxy-image */ }

  function displayGeneratedImage(imageURL) { imageResult.innerHTML = `<img src="${imageURL}" alt="Generated image" />`; resultSection.classList.remove('hidden'); downloadBtn.onclick = () => downloadImage(imageURL); convertSvgBtn.onclick = convertToSVG; downloadSvgBtn.onclick = downloadSVG; regenerateBtn.onclick = () => { resultSection.classList.add('hidden'); svgSection.classList.add('hidden'); svgResult.innerHTML=''; lastSVGText=null; downloadSvgBtn.classList.add('hidden'); iconSubjectInput?.focus(); }; }
  function downloadImage(imageURL) { const link = document.createElement('a'); link.href = imageURL; link.download = `generated-image-${Date.now()}.jpg`; document.body.appendChild(link); link.click(); document.body.removeChild(link); }
  function setLoadingState(loading){ if(loading){ generateBtn.disabled=true; generateBtn.textContent='Generating...'; loadingSpinner.classList.remove('hidden'); } else { generateBtn.disabled=false; generateBtn.textContent='Generate Image'; loadingSpinner.classList.add('hidden'); } }
  function downloadSVG(){ if(!lastSVGText) return; const blob=new Blob([lastSVGText],{type:'image/svg+xml'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`vectorized-${Date.now()}.svg`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
  function showError(message){ errorMessage.textContent=message; errorSection.classList.remove('hidden'); }

  generateBtn.addEventListener('click', generateImage);
});
