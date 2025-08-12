// Settings management for user preferences
// Handles local storage with optional Supabase sync

class SettingsManager {
  constructor() {
    this.LOCAL_STORAGE_KEY = 'icon_app_settings';
    this.supabaseClient = null;
    this.userId = null;
    
    // Default settings - conservative to avoid eating into the icon
    this.defaults = {
      removeBackground: true,
      backgroundTolerance: 20,
      backgroundHardness: 40,
      backgroundFeather: 1.5,
      backgroundDespeckle: 0
    };
    
    // Load settings on initialization
    this.settings = this.loadSettings();
  }
  
  // Initialize with Supabase client and user ID
  init(supabaseClient = null, userId = null) {
    this.supabaseClient = supabaseClient;
    this.userId = userId;
  }
  
  // Load settings from local storage
  loadSettings() {
    try {
      const stored = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...this.defaults, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e);
    }
    return { ...this.defaults };
  }
  
  // Save settings to local storage
  saveSettings() {
    try {
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }
  
  // Get a setting value
  get(key) {
    return this.settings[key] !== undefined ? this.settings[key] : this.defaults[key];
  }
  
  // Set a setting value
  set(key, value) {
    this.settings[key] = value;
    this.saveSettings();
    
    // Optionally sync to database
    if (this.supabaseClient && this.userId) {
      this.syncToDatabase().catch(e => {
        console.warn('Failed to sync settings to database:', e);
      });
    }
    
    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('settingsChanged', { 
      detail: { key, value, settings: this.settings } 
    }));
  }
  
  // Set multiple settings at once
  setMultiple(updates) {
    Object.assign(this.settings, updates);
    this.saveSettings();
    
    // Optionally sync to database
    if (this.supabaseClient && this.userId) {
      this.syncToDatabase().catch(e => {
        console.warn('Failed to sync settings to database:', e);
      });
    }
    
    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('settingsChanged', { 
      detail: { settings: this.settings } 
    }));
  }
  
  // Get all settings
  getAll() {
    return { ...this.settings };
  }
  
  // Reset to defaults
  reset() {
    this.settings = { ...this.defaults };
    this.saveSettings();
    
    // Optionally sync to database
    if (this.supabaseClient && this.userId) {
      this.syncToDatabase().catch(e => {
        console.warn('Failed to sync settings to database:', e);
      });
    }
    
    window.dispatchEvent(new CustomEvent('settingsChanged', { 
      detail: { settings: this.settings } 
    }));
  }
  
  // Sync settings to Supabase (if available)
  async syncToDatabase() {
    if (!this.supabaseClient || !this.userId) return;
    
    try {
      const { error } = await this.supabaseClient
        .from('user_settings')
        .upsert({
          user_id: this.userId,
          settings: this.settings,
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
    } catch (e) {
      console.warn('Failed to sync settings to database:', e);
      throw e;
    }
  }
  
  // Load settings from database (if available)
  async loadFromDatabase() {
    if (!this.supabaseClient || !this.userId) return;
    
    try {
      const { data, error } = await this.supabaseClient
        .from('user_settings')
        .select('settings')
        .eq('user_id', this.userId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
      
      if (data && data.settings) {
        this.settings = { ...this.defaults, ...data.settings };
        this.saveSettings(); // Also save locally
        window.dispatchEvent(new CustomEvent('settingsChanged', { 
          detail: { settings: this.settings } 
        }));
      }
    } catch (e) {
      console.warn('Failed to load settings from database:', e);
    }
  }
  
  // Get background removal parameters for API calls
  getBackgroundRemovalParams() {
    return {
      tol: this.get('backgroundTolerance'),
      hard: this.get('backgroundHardness'),
      feather: this.get('backgroundFeather'),
      despeckle: this.get('backgroundDespeckle')
    };
  }
}

// Create global settings manager
const Settings = new SettingsManager();

// Make available globally
window.Settings = Settings;