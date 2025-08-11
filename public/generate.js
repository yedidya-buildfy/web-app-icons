// Image generation script using Runware.ai API (REST)
// Uses HTTP POST per docs: https://runware.ai/docs/en/getting-started/how-to-connect

document.addEventListener('DOMContentLoaded', () => {
  const promptInput = document.getElementById('promptInput');
  const generateBtn = document.getElementById('generateBtn');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const resultSection = document.getElementById('resultSection');
  const imageResult = document.getElementById('imageResult');
  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');
  const downloadBtn = document.getElementById('downloadBtn');
  const regenerateBtn = document.getElementById('regenerateBtn');

  // New prompt builder fields
  const iconSubjectInput = document.getElementById('iconSubjectInput');
  const styleSelect = document.getElementById('styleSelect');
  const colorsInput = document.getElementById('colorsInput');
  const backgroundInput = document.getElementById('backgroundInput');
  const promptPreview = document.getElementById('promptPreview');

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
    const style = (styleSelect?.value || 'outline').trim();
    const colors = (colorsInput?.value || 'black and white').trim();
    const background = (backgroundInput?.value || 'white').trim();

    const prompt = `Design a simple, flat, minimalist icon of a ${subject} ${style} style, ${colors} colors, ${background} background, evenly spaced elements. Maintain geometric balance and consistent stroke width.`;

    if (promptPreview) promptPreview.textContent = prompt;
    if (promptInput) promptInput.value = prompt; // keep hidden textarea in sync
    return prompt;
  }

  // Initialize preview
  buildPrompt();

  // Update preview on change
  [iconSubjectInput, styleSelect, colorsInput, backgroundInput].forEach((el) => {
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
    if (!prompt) {
      showError('Please enter a description for the image.');
      return;
    }

    setLoadingState(true);
    hideError();
    hideResult();

    const model = 'google:2@3'; // Imagen 4.0 Fast only
    console.log(`🎯 Using Imagen 4.0 Fast model: ${model}`);
    console.log(`📝 Prompt: "${prompt}"`);

    try {
      const result = await tryGenerateWithModel(prompt, model);
      if (result) {
        console.log('✅ Image generation successful!');
        displayGeneratedImage(result.imageURL);
      }
    } catch (err) {
      console.error('❌ Imagen 4.0 Fast failed with detailed error:');
      console.error('Error name:', err.name);
      console.error('Error message:', err.message);
      console.error('Full error object:', err);
      
      if (err.name === 'AbortError') {
        showError('Request timed out. Please try again.');
      } else {
        showError(`Imagen 4.0 Fast failed: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setLoadingState(false);
    }
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

  // Display generated image
  function displayGeneratedImage(imageURL) {
    imageResult.innerHTML = `<img src="${imageURL}" alt="Generated image" />`;
    resultSection.classList.remove('hidden');

    downloadBtn.onclick = () => downloadImage(imageURL);
    regenerateBtn.onclick = () => {
      hideResult();
      iconSubjectInput?.focus();
    };
  }

  // Download image
  function downloadImage(imageURL) {
    const link = document.createElement('a');
    link.href = imageURL;
    link.download = `generated-image-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Generate UUID for task identification
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // UI helpers
  function setLoadingState(loading) {
    if (loading) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';
      loadingSpinner.classList.remove('hidden');
    } else {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Image';
      loadingSpinner.classList.add('hidden');
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
  }

  function hideError() {
    errorSection.classList.add('hidden');
  }

  function hideResult() {
    resultSection.classList.add('hidden');
  }

  // Events
  generateBtn.addEventListener('click', generateImage);
  
  // Add search models button
  const searchModelsBtn = document.getElementById('searchModelsBtn');
  if (searchModelsBtn) {
    searchModelsBtn.addEventListener('click', async () => {
      if (!checkAPIKey()) return;
      console.log('Searching for available models...');
      await searchModels();
    });
  }
});
