# OAuth Setup Instructions

This document explains how to set up Google and GitHub OAuth authentication for your icon search application using Supabase.

## Prerequisites

- Supabase project created and configured
- Domain where your application will be hosted (for production)
- Google Cloud Platform account
- GitHub account

## Database Setup

1. **Run the database migration:**
   ```sql
   -- Execute this in your Supabase SQL editor
   -- File: migrations/2025-08-12_add_oauth_support.sql
   ```
   Or manually run the updated schema.sql file in your Supabase project.

2. **Verify the tables are created:**
   - `public.profiles` - stores user profile information from OAuth providers
   - Updated `public.searches` - now includes user_id reference
   - Updated `public.generated_icons` - now includes user_id reference

## Google OAuth Setup

### 1. Google Cloud Console Configuration

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**
2. **Create or select a project**
3. **Enable Google+ API** (if required)
4. **Configure OAuth Consent Screen:**
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" user type (for general use)
   - Fill in required fields:
     - App name: "Icon Search App"
     - User support email: your email
     - Developer contact: your email
   - Add your domain to "Authorized domains"
   - Add these scopes:
     - `userinfo.email`
     - `userinfo.profile`
     - `openid`

5. **Create OAuth 2.0 Client ID:**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client ID"
   - Choose "Web application"
   - Add these to "Authorized JavaScript origins":
     - `http://localhost:3000` (for development)
     - `https://yourdomain.com` (for production)
   - Add these to "Authorized redirect URIs":
     - `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`
     - `http://localhost:3000/auth/callback` (for development)

### 2. Supabase Configuration

1. **Go to your Supabase Dashboard**
2. **Navigate to Authentication > Providers**
3. **Enable Google provider:**
   - Toggle "Enable sign in with Google"
   - Enter your Google Client ID
   - Enter your Google Client Secret
   - Click "Save"

## GitHub OAuth Setup

### 1. GitHub Application Configuration

1. **Go to [GitHub Developer Settings](https://github.com/settings/developers)**
2. **Click "New OAuth App"**
3. **Fill in the application details:**
   - Application name: "Icon Search App"
   - Homepage URL: `https://yourdomain.com` (or `http://localhost:3000` for development)
   - Authorization callback URL: `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`
4. **Click "Register application"**
5. **Note down your Client ID and generate a Client Secret**

### 2. Supabase Configuration

1. **Go to your Supabase Dashboard**
2. **Navigate to Authentication > Providers**
3. **Enable GitHub provider:**
   - Toggle "Enable sign in with GitHub"
   - Enter your GitHub Client ID
   - Enter your GitHub Client Secret
   - Click "Save"

## Application Configuration

### Environment Variables

Your application should already have these in `public/env.js`:
```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

### Redirect URLs

The application is configured to redirect OAuth callbacks to:
- `/auth/callback.html` - handles the OAuth callback and redirects users appropriately

## Testing the Setup

1. **Start your development server:**
   ```bash
   npm start
   ```

2. **Navigate to `/login.html`**

3. **Test OAuth providers:**
   - Click "Continue with Google" - should redirect to Google OAuth
   - Click "Continue with GitHub" - should redirect to GitHub OAuth
   - Complete authentication flow
   - Should redirect back to your application with user logged in

4. **Verify database:**
   - Check that user profiles are created in `public.profiles` table
   - Verify that user metadata (name, avatar) is populated correctly

## Troubleshooting

### Common Issues

1. **"redirect_uri_mismatch" error:**
   - Ensure redirect URIs in Google/GitHub match exactly what's configured in Supabase
   - Check for trailing slashes, http vs https

2. **"Invalid client" error:**
   - Verify Client ID and Client Secret are correct in Supabase
   - Ensure the OAuth application is active (not in development mode for Google)

3. **User not redirected after OAuth:**
   - Check browser network tab for errors
   - Verify `/auth/callback.html` exists and is accessible
   - Check Supabase logs for authentication errors

4. **Profile not created:**
   - Check if database triggers are properly set up
   - Verify RLS policies allow profile creation
   - Check Supabase logs for database errors

### Development vs Production

**Development (localhost:3000):**
- Add `http://localhost:3000` to authorized origins
- Use `http://localhost:3000/auth/callback` for testing

**Production:**
- Use your actual domain (`https://yourdomain.com`)
- Ensure SSL is enabled
- Update all redirect URIs to use HTTPS

## Security Notes

- Never commit OAuth client secrets to version control
- Use environment variables for sensitive configuration
- Regularly rotate OAuth credentials
- Monitor OAuth application usage in respective consoles
- Ensure your domain is properly secured with HTTPS in production

## Next Steps

After setup is complete, users can:
1. Sign in with Google or GitHub OAuth
2. Have their profile automatically created in your database
3. Access all application features with their authenticated account
4. See their name displayed in the navigation bar

The authentication state is managed automatically by Supabase and the application will redirect users appropriately based on their login status.