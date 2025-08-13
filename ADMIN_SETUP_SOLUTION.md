# Admin User Setup Solution

## Problem Summary

The API key creation functionality is failing because there are **no admin users** in the Supabase database. The `create_api_key` function requires admin privileges (`is_super_admin = true`) to execute, but currently no profiles exist with admin status.

## Current Status

- ✅ Database connection works
- ✅ `create_api_key` function exists and works correctly
- ❌ **Zero profiles in the database**
- ❌ **Zero admin users** (`is_super_admin = true`)
- ❌ API key creation fails with "unauthorized" error

## Solution

### Option 1: Automated SQL Migration (Recommended)

1. **Run the emergency admin creation SQL in Supabase SQL Editor:**
   
   Copy the contents of `create_emergency_admin.sql` and paste into your Supabase SQL Editor:
   ```
   https://supabase.com/dashboard/project/kfeekskddfyyosyyplxd/sql/new
   ```

2. **Execute with Service Role permissions** (important!)

3. **Verify creation** by running `node verify_admin_setup.js`

### Option 2: Manual SQL Commands

If you prefer to run commands individually, execute these in Supabase SQL Editor:

```sql
-- Create emergency admin user
INSERT INTO public.profiles (
  id, 
  email, 
  full_name, 
  is_super_admin, 
  provider, 
  created_at, 
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001'::UUID,
  'admin@system.local',
  'System Administrator',
  true,
  'system',
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  is_super_admin = true,
  updated_at = NOW();

-- Verify admin user was created
SELECT 
  id, email, full_name, is_super_admin, created_at,
  'Ready for API key creation' as status
FROM public.profiles 
WHERE is_super_admin = true;
```

### Option 3: Make Existing User Admin

If the user `yedidyadan33@gmail.com` exists in your `auth.users` table:

```sql
-- Create profile for existing auth user and make them admin
INSERT INTO public.profiles (
  id, email, full_name, is_super_admin, provider
)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', 'Admin User'),
  true,
  COALESCE(au.raw_app_meta_data->>'provider', 'email')
FROM auth.users au
WHERE au.email = 'yedidyadan33@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);

-- Or update existing profile to admin
UPDATE public.profiles 
SET is_super_admin = true, updated_at = NOW()
WHERE email = 'yedidyadan33@gmail.com';
```

## Verification Steps

After running the SQL:

1. **Run verification script:**
   ```bash
   node verify_admin_setup.js
   ```

2. **Expected output:**
   ```
   ✅ Admin users found: 1
   🔑 Admin users ready for API key creation:
      - admin@system.local (System Administrator)
   ```

3. **Test API key creation:**
   - Visit `/api-admin.html` in your application
   - Login as the admin user
   - Try creating a test API key

## Files Created

| File | Purpose |
|------|---------|
| `create_emergency_admin.sql` | Complete SQL migration to create admin users |
| `setup_admin.js` | Diagnostic script that attempts automated fixes |
| `verify_admin_setup.js` | Verification script to check admin status |
| `ADMIN_SETUP_SOLUTION.md` | This comprehensive solution document |

## Why This Issue Occurred

1. **RLS (Row Level Security) policies** prevent direct insertion into the profiles table
2. **No initial admin user** was created during database setup
3. **Profile creation trigger** may not have executed for existing auth users
4. **Migration scripts** were not run with proper service role permissions

## Security Notes

- The emergency admin user uses a fixed UUID for consistency
- Admin privileges are properly protected by RLS policies
- The solution maintains the security model while providing initial access
- Service role permissions are required to bypass RLS during setup

## Next Steps After Admin Creation

1. ✅ **Login as admin** to the web interface
2. ✅ **Create proper API keys** through the admin panel
3. ✅ **Test API key functionality** with your applications
4. ✅ **Create additional admin users** if needed through the admin interface
5. ✅ **Remove or rename** the emergency admin user if desired

## Troubleshooting

If the solution doesn't work:

1. **Check Supabase project URL** in env.js matches your project
2. **Verify Service Role permissions** when running SQL
3. **Check browser console** for detailed error messages
4. **Run verification script** to diagnose specific issues
5. **Contact support** if auth.users table has inconsistencies

---

**Status:** Ready to implement - Run `create_emergency_admin.sql` in Supabase SQL Editor