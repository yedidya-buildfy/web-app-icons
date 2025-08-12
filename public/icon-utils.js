// Unified icon utilities for consistent download and conversion across the app

class IconUtils {
  
  // Helper: Apply background removal to image URL
  static async applyBackgroundRemoval(imageUrl) {
    console.log('Applying background removal to:', imageUrl.substring(0, 50) + '...');
    
    // If it's already a blob URL, it means it's already processed - skip
    if (imageUrl.startsWith('blob:')) {
      console.log('URL is already a blob (processed), skipping background removal');
      return imageUrl;
    }
    
    if (!window.Settings || !window.Settings.get('removeBackground')) {
      console.log('Background removal disabled, using original image');
      return imageUrl;
    }
    
    try {
      const bgParams = window.Settings.getBackgroundRemovalParams();
      const params = new URLSearchParams({
        url: imageUrl,
        ...bgParams
      });
      
      console.log('Calling background removal API...');
      const response = await fetch(`/api/remove-bg?${params.toString()}`);
      if (!response.ok) {
        console.warn('Background removal failed, using original image');
        return imageUrl;
      }
      
      const blob = await response.blob();
      const processedUrl = URL.createObjectURL(blob);
      console.log('Background removal completed, created blob URL');
      return processedUrl;
    } catch (error) {
      console.warn('Background removal failed:', error);
      return imageUrl;
    }
  }

  // Download icon as PNG
  static async downloadPNG(iconData, filename = 'icon') {
    try {
      console.log('Starting PNG download for:', iconData);
      let canvas;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG and convert to PNG
        const svgText = await this.fetchIconifySVG(iconData.id);
        canvas = await this.svgToCanvas(svgText);
      } else if (iconData.type === 'generated') {
        // Step 1: Get original image URL
        console.log('Step 1: Using original image URL');
        let imageUrl = iconData.imageUrl;
        
        // Step 2: Apply background removal
        console.log('Step 2: Applying background removal...');
        imageUrl = await this.applyBackgroundRemoval(imageUrl);
        
        // Step 3: Convert to canvas for PNG
        console.log('Step 3: Converting to PNG...');
        canvas = await this.imageUrlToCanvas(imageUrl);
      } else if (iconData.type === 'svg') {
        // Handle direct SVG text
        canvas = await this.svgToCanvas(iconData.svgText);
      }
      
      if (!canvas) throw new Error('Failed to create canvas');
      
      // Convert canvas to PNG blob and download
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('PNG download completed');
      }, 'image/png');
      
    } catch (error) {
      console.error('PNG download failed:', error);
      throw new Error(`PNG download failed: ${error.message}`);
    }
  }
  
  // Download icon as SVG
  static async downloadSVG(iconData, filename = 'icon') {
    try {
      console.log('Starting SVG download for:', iconData);
      let svgText;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG directly
        console.log('Fetching Iconify SVG for:', iconData.id);
        svgText = await this.fetchIconifySVG(iconData.id);
      } else if (iconData.type === 'generated') {
        // Step 1: Get original image URL
        console.log('Step 1: Using original image URL');
        let imageUrl = iconData.imageUrl;
        
        // Step 2: Apply background removal
        console.log('Step 2: Applying background removal...');
        imageUrl = await this.applyBackgroundRemoval(imageUrl);
        
        // Step 3: Convert to SVG
        console.log('Step 3: Converting to SVG...');
        svgText = await this.vectorizeImage(imageUrl);
      } else if (iconData.type === 'svg') {
        // Handle direct SVG text
        console.log('Using direct SVG text');
        svgText = iconData.svgText;
      }
      
      if (!svgText) throw new Error('Failed to get SVG content');
      
      console.log('SVG content length:', svgText.length);
      
      // Download SVG
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      console.log('SVG download completed successfully');
      
    } catch (error) {
      console.error('SVG download failed:', error);
      throw new Error(`SVG download failed: ${error.message}`);
    }
  }
  
  // Copy SVG code to clipboard
  static async copySVGCode(iconData) {
    try {
      console.log('Starting SVG copy for:', iconData);
      let svgText;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG directly
        console.log('Fetching Iconify SVG for copy:', iconData.id);
        svgText = await this.fetchIconifySVG(iconData.id);
      } else if (iconData.type === 'generated') {
        // Step 1: Get original image URL
        console.log('Step 1: Using original image URL');
        let imageUrl = iconData.imageUrl;
        
        // Step 2: Apply background removal
        console.log('Step 2: Applying background removal...');
        imageUrl = await this.applyBackgroundRemoval(imageUrl);
        
        // Step 3: Convert to SVG
        console.log('Step 3: Converting to SVG...');
        svgText = await this.vectorizeImage(imageUrl);
      } else if (iconData.type === 'svg') {
        // Handle direct SVG text
        console.log('Using direct SVG text for copy');
        svgText = iconData.svgText;
      }
      
      if (!svgText) throw new Error('Failed to get SVG content');
      
      console.log('Copying SVG to clipboard, length:', svgText.length);
      
      // Copy to clipboard
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(svgText);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = svgText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      
      console.log('SVG copied to clipboard successfully');
      
    } catch (error) {
      console.error('Copy SVG failed:', error);
      throw new Error(`Copy SVG failed: ${error.message}`);
    }
  }
  
  // Helper: Fetch SVG from Iconify API
  static async fetchIconifySVG(iconId) {
    const response = await fetch(`https://api.iconify.design/${iconId}.svg`);
    if (!response.ok) throw new Error(`Failed to fetch icon: ${response.status}`);
    return await response.text();
  }
  

  // Helper: Vectorize image URL to SVG using local or server vectorization
  static async vectorizeImage(imageUrl) {
    console.log('Vectorizing image...');
    
    try {
      // For blob URLs (background-removed images), we must use local vectorization
      if (imageUrl.startsWith('blob:')) {
        if (typeof ImageTracer !== 'undefined') {
          return await this.localVectorize(imageUrl);
        } else {
          throw new Error('ImageTracer library not loaded. Please reload the page.');
        }
      }
      
      // For regular URLs, try local first, then server
      if (typeof ImageTracer !== 'undefined') {
        return await this.localVectorize(imageUrl);
      } else {
        return await this.serverVectorize(imageUrl);
      }
    } catch (error) {
      // If local fails and it's not a blob URL, try server
      if (!imageUrl.startsWith('blob:')) {
        try {
          return await this.serverVectorize(imageUrl);
        } catch (serverError) {
          throw new Error(`Vectorization failed: ${error.message}`);
        }
      }
      throw error;
    }
  }
  
  // Helper: Local vectorization using ImageTracer
  static async localVectorize(imageUrl) {
    return new Promise(async (resolve, reject) => {
      try {
        let blob;
        
        if (imageUrl.startsWith('blob:')) {
          // For blob URLs, fetch directly (no proxy needed)
          const resp = await fetch(imageUrl, { cache: 'no-store' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          blob = await resp.blob();
        } else {
          // For external URLs, use proxy
          const proxied = `/proxy-image?url=${encodeURIComponent(imageUrl)}`;
          const resp = await fetch(proxied, { cache: 'no-store' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          blob = await resp.blob();
        }
        
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        
        const options = { 
          ltres: 1, qtres: 1, pathomit: 8, colorsampling: 0, 
          numberofcolors: 2, strokewidth: 2, roundcoords: 1 
        };
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const svgString = ImageTracer.imagedataToSVG(imageData, options);
        
        resolve(svgString);
      } catch (e) {
        reject(e);
      }
    });
  }
  
  // Helper: Server vectorization
  static async serverVectorize(imageUrl) {
    // Server vectorization only works with regular URLs, not blob URLs
    if (imageUrl.startsWith('blob:')) {
      throw new Error('Server vectorization does not support blob URLs');
    }
    
    const params = new URLSearchParams({
      url: imageUrl,
      color: '#000000',
      threshold: '128',
      turdSize: '2',
      invert: 'false'
    });
    
    const response = await fetch(`/api/vectorize?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }
  
  // Helper: Convert SVG text to canvas
  static async svgToCanvas(svgText) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 512;
        canvas.height = img.height || 512;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('Failed to load SVG image'));
      
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      img.src = URL.createObjectURL(blob);
    });
  }
  
  // Helper: Convert image URL to canvas
  static async imageUrlToCanvas(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      
      // Use proxy for external images
      if (imageUrl.startsWith('http')) {
        img.src = `/proxy-image?url=${encodeURIComponent(imageUrl)}`;
      } else {
        img.src = imageUrl;
      }
    });
  }
  
  // Create unified action buttons for any icon
  static createActionButtons(iconData, filename) {
    const container = document.createElement('div');
    container.className = 'icon-actions';
    
    // Download PNG button
    const pngBtn = document.createElement('button');
    pngBtn.className = 'action-btn png-btn';
    pngBtn.textContent = 'PNG';
    pngBtn.addEventListener('click', async () => {
      const originalText = pngBtn.textContent;
      try {
        pngBtn.disabled = true;
        pngBtn.textContent = 'Downloading...';
        await IconUtils.downloadPNG(iconData, filename);
        pngBtn.textContent = 'Downloaded!';
        setTimeout(() => {
          pngBtn.textContent = originalText;
          pngBtn.disabled = false;
        }, 1500);
      } catch (error) {
        pngBtn.textContent = 'Error';
        setTimeout(() => {
          pngBtn.textContent = originalText;
          pngBtn.disabled = false;
        }, 1500);
      }
    });
    
    // Download SVG button
    const svgBtn = document.createElement('button');
    svgBtn.className = 'action-btn svg-btn';
    svgBtn.textContent = 'SVG';
    svgBtn.addEventListener('click', async () => {
      const originalText = svgBtn.textContent;
      try {
        svgBtn.disabled = true;
        svgBtn.textContent = 'Downloading...';
        await IconUtils.downloadSVG(iconData, filename);
        svgBtn.textContent = 'Downloaded!';
        setTimeout(() => {
          svgBtn.textContent = originalText;
          svgBtn.disabled = false;
        }, 1500);
      } catch (error) {
        svgBtn.textContent = 'Error';
        setTimeout(() => {
          svgBtn.textContent = originalText;
          svgBtn.disabled = false;
        }, 1500);
      }
    });
    
    // Copy SVG Code button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn copy-btn';
    copyBtn.textContent = 'Copy SVG';
    copyBtn.addEventListener('click', async () => {
      const originalText = copyBtn.textContent;
      try {
        copyBtn.disabled = true;
        copyBtn.textContent = 'Copying...';
        await IconUtils.copySVGCode(iconData);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.disabled = false;
        }, 1500);
      } catch (error) {
        copyBtn.textContent = 'Error';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.disabled = false;
        }, 1500);
      }
    });
    
    container.appendChild(pngBtn);
    container.appendChild(svgBtn);
    container.appendChild(copyBtn);
    
    return container;
  }
}

// Make available globally
window.IconUtils = IconUtils;