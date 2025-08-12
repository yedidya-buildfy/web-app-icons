// Unified icon utilities for consistent download and conversion across the app

class IconUtils {
  
  // Download icon as PNG
  static async downloadPNG(iconData, filename = 'icon') {
    try {
      let canvas;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG and convert to PNG
        const svgText = await this.fetchIconifySVG(iconData.id);
        canvas = await this.svgToCanvas(svgText);
      } else if (iconData.type === 'generated') {
        // Handle generated images - load image and convert to PNG
        canvas = await this.imageUrlToCanvas(iconData.imageUrl);
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
      }, 'image/png');
      
    } catch (error) {
      console.error('PNG download failed:', error);
      throw new Error(`PNG download failed: ${error.message}`);
    }
  }
  
  // Download icon as SVG
  static async downloadSVG(iconData, filename = 'icon') {
    try {
      let svgText;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG directly
        svgText = await this.fetchIconifySVG(iconData.id);
      } else if (iconData.type === 'generated') {
        // Handle generated images - vectorize to SVG
        svgText = await this.vectorizeImage(iconData.imageUrl);
      } else if (iconData.type === 'svg') {
        // Handle direct SVG text
        svgText = iconData.svgText;
      }
      
      if (!svgText) throw new Error('Failed to get SVG content');
      
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
      
    } catch (error) {
      console.error('SVG download failed:', error);
      throw new Error(`SVG download failed: ${error.message}`);
    }
  }
  
  // Copy SVG code to clipboard
  static async copySVGCode(iconData) {
    try {
      let svgText;
      
      if (iconData.type === 'iconify') {
        // Handle Iconify icons - fetch SVG directly
        svgText = await this.fetchIconifySVG(iconData.id);
      } else if (iconData.type === 'generated') {
        // Handle generated images - vectorize to SVG
        svgText = await this.vectorizeImage(iconData.imageUrl);
      } else if (iconData.type === 'svg') {
        // Handle direct SVG text
        svgText = iconData.svgText;
      }
      
      if (!svgText) throw new Error('Failed to get SVG content');
      
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
    try {
      // Try local vectorization first (if ImageTracer is available)
      if (typeof ImageTracer !== 'undefined') {
        return await this.localVectorize(imageUrl);
      } else {
        // Fall back to server vectorization
        return await this.serverVectorize(imageUrl);
      }
    } catch (error) {
      // If local fails, try server
      if (typeof ImageTracer !== 'undefined') {
        try {
          return await this.serverVectorize(imageUrl);
        } catch (serverError) {
          throw new Error(`Vectorization failed: ${serverError.message}`);
        }
      }
      throw error;
    }
  }
  
  // Helper: Local vectorization using ImageTracer
  static async localVectorize(imageUrl) {
    return new Promise(async (resolve, reject) => {
      try {
        const proxied = `/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        const resp = await fetch(proxied, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const blob = await resp.blob();
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
        
        const svgString = ImageTracer.imagedataToSVG(
          ctx.getImageData(0, 0, canvas.width, canvas.height), 
          options
        );
        
        resolve(svgString);
      } catch (e) {
        reject(e);
      }
    });
  }
  
  // Helper: Server vectorization
  static async serverVectorize(imageUrl) {
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