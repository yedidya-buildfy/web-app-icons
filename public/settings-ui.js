// Settings UI handler - manages the settings modal and controls

class SettingsUI {
  constructor() {
    this.modal = null;
    this.settingsManager = null;
    this.initialized = false;
  }
  
  init() {
    if (this.initialized) return;
    
    this.settingsManager = window.Settings;
    if (!this.settingsManager) {
      console.error('Settings manager not available');
      return;
    }
    
    this.setupModal();
    this.setupEventListeners();
    this.loadCurrentSettings();
    this.initialized = true;
  }
  
  setupModal() {
    this.modal = document.getElementById('settingsModal');
    if (!this.modal) {
      console.error('Settings modal not found');
      return;
    }
    
    // Get all the form elements
    this.elements = {
      removeBackgroundToggle: document.getElementById('removeBackgroundToggle'),
      backgroundTolerance: document.getElementById('backgroundTolerance'),
      backgroundHardness: document.getElementById('backgroundHardness'),
      backgroundFeather: document.getElementById('backgroundFeather'),
      backgroundDespeckle: document.getElementById('backgroundDespeckle'),
      toleranceValue: document.getElementById('toleranceValue'),
      hardnessValue: document.getElementById('hardnessValue'),
      featherValue: document.getElementById('featherValue'),
      despeckleValue: document.getElementById('despeckleValue'),
      advancedSettings: document.getElementById('advancedSettings')
    };
  }
  
  setupEventListeners() {
    // Settings button - open modal
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.openModal());
    }
    
    // Close button and backdrop clicks
    const closeBtn = document.getElementById('settingsClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.closeModal();
        }
      });
    }
    
    // Save and reset buttons
    const saveBtn = document.getElementById('saveSettings');
    const resetBtn = document.getElementById('resetSettings');
    
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveSettings());
    }
    
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetSettings());
    }
    
    // Form controls
    if (this.elements.removeBackgroundToggle) {
      this.elements.removeBackgroundToggle.addEventListener('change', () => {
        this.toggleAdvancedSettings();
      });
    }
    
    // Range inputs with live value updates
    const rangeInputs = [
      { input: this.elements.backgroundTolerance, display: this.elements.toleranceValue },
      { input: this.elements.backgroundHardness, display: this.elements.hardnessValue },
      { input: this.elements.backgroundFeather, display: this.elements.featherValue },
      { input: this.elements.backgroundDespeckle, display: this.elements.despeckleValue }
    ];
    
    rangeInputs.forEach(({ input, display }) => {
      if (input && display) {
        input.addEventListener('input', () => {
          display.textContent = input.value;
        });
      }
    });
    
    // Listen for settings changes from other parts of the app
    window.addEventListener('settingsChanged', (e) => {
      this.loadCurrentSettings();
    });
  }
  
  openModal() {
    if (this.modal) {
      this.modal.style.display = 'flex';
      this.loadCurrentSettings(); // Refresh settings when opening
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
  }
  
  closeModal() {
    if (this.modal) {
      this.modal.style.display = 'none';
      document.body.style.overflow = 'auto'; // Restore scrolling
    }
  }
  
  loadCurrentSettings() {
    if (!this.settingsManager || !this.elements.removeBackgroundToggle) return;
    
    const settings = this.settingsManager.getAll();
    
    // Load checkbox
    this.elements.removeBackgroundToggle.checked = settings.removeBackground;
    
    // Load range values and update displays
    if (this.elements.backgroundTolerance) {
      this.elements.backgroundTolerance.value = settings.backgroundTolerance;
      this.elements.toleranceValue.textContent = settings.backgroundTolerance;
    }
    
    if (this.elements.backgroundHardness) {
      this.elements.backgroundHardness.value = settings.backgroundHardness;
      this.elements.hardnessValue.textContent = settings.backgroundHardness;
    }
    
    if (this.elements.backgroundFeather) {
      this.elements.backgroundFeather.value = settings.backgroundFeather;
      this.elements.featherValue.textContent = settings.backgroundFeather;
    }
    
    if (this.elements.backgroundDespeckle) {
      this.elements.backgroundDespeckle.value = settings.backgroundDespeckle;
      this.elements.despeckleValue.textContent = settings.backgroundDespeckle;
    }
    
    this.toggleAdvancedSettings();
  }
  
  toggleAdvancedSettings() {
    if (!this.elements.advancedSettings || !this.elements.removeBackgroundToggle) return;
    
    const showAdvanced = this.elements.removeBackgroundToggle.checked;
    this.elements.advancedSettings.style.display = showAdvanced ? 'block' : 'none';
  }
  
  saveSettings() {
    if (!this.settingsManager) return;
    
    const newSettings = {
      removeBackground: this.elements.removeBackgroundToggle?.checked ?? true,
      backgroundTolerance: parseFloat(this.elements.backgroundTolerance?.value ?? 35),
      backgroundHardness: parseFloat(this.elements.backgroundHardness?.value ?? 55),
      backgroundFeather: parseFloat(this.elements.backgroundFeather?.value ?? 2.5),
      backgroundDespeckle: parseInt(this.elements.backgroundDespeckle?.value ?? 1)
    };
    
    this.settingsManager.setMultiple(newSettings);
    
    // Show success feedback
    const saveBtn = document.getElementById('saveSettings');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      saveBtn.disabled = true;
      
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 1000);
    }
  }
  
  resetSettings() {
    if (!this.settingsManager) return;
    
    this.settingsManager.reset();
    this.loadCurrentSettings();
    
    // Show success feedback
    const resetBtn = document.getElementById('resetSettings');
    if (resetBtn) {
      const originalText = resetBtn.textContent;
      resetBtn.textContent = 'Reset!';
      resetBtn.disabled = true;
      
      setTimeout(() => {
        resetBtn.textContent = originalText;
        resetBtn.disabled = false;
      }, 1000);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const settingsUI = new SettingsUI();
  
  // Wait a bit for other scripts to load
  setTimeout(() => {
    settingsUI.init();
  }, 100);
  
  // Make available globally
  window.SettingsUI = settingsUI;
});