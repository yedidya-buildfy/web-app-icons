// Environment configuration for client-side JavaScript
// These values are used by the app to connect to external services from the browser.

// Supabase configuration (client-side; anon key is public by design)
const SUPABASE_URL = 'https://kfeekskddfyyosyyplxd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZWVrc2tkZGZ5eW9zeXlwbHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkwOTAsImV4cCI6MjA3MDUxNTA5MH0.rgGBDVUIDEi31pZhXbzJAJCu7cmebMWEfEdvDnE-tCU';

// Export configuration for use by other scripts
window.ENV = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY
};

// Also make individual constants available for backward compatibility
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// Do NOT put the Runware API key in the client. It is now read on the server from process.env.RUNWARE_API_KEY.