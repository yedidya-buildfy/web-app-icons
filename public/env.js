// Rename this file to env.js and fill in your API keys (client-safe only).
// These values are used by the app to connect to external services from the browser.

// Supabase configuration (client-side; anon key is public by design)
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-public-key-here';

// Do NOT put the Runware API key in the client. It is now read on the server from process.env.RUNWARE_API_KEY.