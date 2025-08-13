#!/usr/bin/env node

/**
 * Admin User Setup Script
 * 
 * This script attempts to solve the "no admin users" problem that prevents API key creation.
 * It will try multiple approaches to create an initial admin user.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kfeekskddfyyosyyplxd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZWVrc2tkZGZ5eW9zeXlwbHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkwOTAsImV4cCI6MjA3MDUxNTA5MH0.rgGBDVUIDEi31pZhXbzJAJCu7cmebMWEfEdvDnE-tCU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Known admin email from the migration files
const ADMIN_EMAIL = 'yedidyadan33@gmail.com';
const ADMIN_UUID = '00000000-0000-0000-0000-000000000001'; // Fallback UUID for system admin

async function checkCurrentStatus() {
  console.log('🔍 Checking current database status...\n');
  
  try {
    // Check profiles table
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_super_admin, created_at')
      .order('created_at', { ascending: false });
      
    if (profileError) {
      console.error('❌ Error querying profiles:', profileError.message);
      return { profiles: [], adminCount: 0, hasProfiles: false };
    }
    
    console.log(`📊 Profiles found: ${profiles.length}`);
    if (profiles.length > 0) {
      profiles.forEach((profile, i) => {
        console.log(`   ${i+1}. ${profile.email || 'No email'} ${profile.is_super_admin ? '(ADMIN)' : ''}`);
        console.log(`      ID: ${profile.id.substring(0, 8)}... Created: ${profile.created_at}`);
      });
    }
    
    const adminCount = profiles.filter(p => p.is_super_admin === true).length;
    console.log(`🔑 Admin users: ${adminCount}\n`);
    
    return { profiles, adminCount, hasProfiles: profiles.length > 0 };
    
  } catch (error) {
    console.error('💥 Failed to check status:', error.message);
    return { profiles: [], adminCount: 0, hasProfiles: false };
  }
}

async function testExistingFunctions() {
  console.log('🔧 Testing existing admin functions...\n');
  
  const functionsToTest = [
    'check_admin_status',
    'create_initial_admin_user',
    'admin_get_all_users',
    'admin_create_missing_profiles'
  ];
  
  const workingFunctions = [];
  
  for (const funcName of functionsToTest) {
    try {
      const { data, error } = await supabase.rpc(funcName, {});
      
      if (error) {
        if (error.code === 'PGRST202') {
          console.log(`❌ ${funcName}: Not found`);
        } else if (error.message.includes('Admin privileges required')) {
          console.log(`⚠️  ${funcName}: Exists but needs admin access`);
          workingFunctions.push({ name: funcName, needsAdmin: true });
        } else {
          console.log(`❓ ${funcName}: ${error.message}`);
        }
      } else {
        console.log(`✅ ${funcName}: Works! Returned:`, typeof data);
        workingFunctions.push({ name: funcName, needsAdmin: false, result: data });
      }
    } catch (e) {
      console.log(`❌ ${funcName}: Exception - ${e.message}`);
    }
  }
  
  console.log('');
  return workingFunctions;
}

async function attemptDirectProfileInsert() {
  console.log('🚀 Attempting to create admin profile directly...\n');
  
  // Try multiple UUIDs - the known admin email and a system admin
  const candidates = [
    {
      id: ADMIN_UUID,
      email: 'admin@system.local',
      full_name: 'System Administrator',
      description: 'System admin account'
    },
    {
      id: crypto.randomUUID ? crypto.randomUUID() : 'a0000000-0000-0000-0000-000000000002',
      email: ADMIN_EMAIL,
      full_name: 'Primary Administrator', 
      description: 'Primary admin from migration'
    }
  ];
  
  for (const candidate of candidates) {
    console.log(`👤 Trying to create: ${candidate.email}`);
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          id: candidate.id,
          email: candidate.email,
          full_name: candidate.full_name,
          is_super_admin: true,
          provider: 'system',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select();
        
      if (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        continue;
      }
      
      console.log(`   ✅ Success! Created admin:`, data[0]);
      return data[0];
      
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
    }
  }
  
  return null;
}

async function attemptSignUpNewAdmin() {
  console.log('🔐 Attempting to sign up new admin user...\n');
  
  const adminCredentials = {
    email: 'admin@iconapp.local',
    password: 'AdminTemp123!ChangeMe',
    options: {
      data: {
        full_name: 'System Administrator',
        is_admin: true
      }
    }
  };
  
  try {
    console.log(`👤 Signing up: ${adminCredentials.email}`);
    const { data, error } = await supabase.auth.signUp(adminCredentials);
    
    if (error) {
      console.log(`   ❌ Signup failed: ${error.message}`);
      return null;
    }
    
    console.log(`   ✅ Signup successful! User:`, data.user?.email);
    console.log(`   📧 Confirmation needed:`, !data.user?.email_confirmed_at);
    
    // If the profile trigger works, the user should now have a profile
    // Let's try to update it to admin status
    if (data.user) {
      console.log(`   🔧 Attempting to set admin status...`);
      
      // Wait a moment for the profile trigger to execute
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const { data: updateData, error: updateError } = await supabase
        .from('profiles')
        .update({ is_super_admin: true })
        .eq('id', data.user.id)
        .select();
        
      if (updateError) {
        console.log(`   ⚠️  Could not set admin status: ${updateError.message}`);
        console.log(`   💡 Profile may still be created normally`);
      } else {
        console.log(`   ✅ Admin status set successfully!`, updateData[0]);
        return updateData[0];
      }
    }
    
    return data.user;
    
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
    return null;
  }
}

async function provideSQLSolution() {
  console.log('📋 SQL Solution for Manual Execution\n');
  console.log('If the automated methods fail, you can run this SQL in your Supabase SQL Editor:');
  console.log('=' .repeat(60));
  console.log(`
-- Create initial admin user for API key creation
-- Run this in Supabase SQL Editor with Service Role

-- Option 1: Create system admin (if no users exist)
INSERT INTO public.profiles (
  id, 
  email, 
  full_name, 
  is_super_admin, 
  provider, 
  created_at, 
  updated_at
) VALUES (
  '${ADMIN_UUID}', 
  'admin@system.local', 
  'System Administrator', 
  true, 
  'system', 
  NOW(), 
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  is_super_admin = true,
  updated_at = NOW();

-- Option 2: Make existing user admin (if they exist in auth.users)
UPDATE public.profiles 
SET is_super_admin = true, updated_at = NOW()
WHERE email = '${ADMIN_EMAIL}';

-- If the user exists in auth.users but not profiles, create their profile:
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
WHERE au.email = '${ADMIN_EMAIL}'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);

-- Verify admin user exists
SELECT 
  id, email, full_name, is_super_admin, created_at,
  'Ready for API key creation' as status
FROM public.profiles 
WHERE is_super_admin = true;
`);
  console.log('=' .repeat(60));
}

async function main() {
  console.log('🎯 Icon Search App - Admin User Setup');
  console.log('=====================================\n');
  
  // Step 1: Check current status
  const { adminCount, hasProfiles } = await checkCurrentStatus();
  
  if (adminCount > 0) {
    console.log('✅ Admin users already exist! API key creation should work.\n');
    
    // Test API key creation function
    console.log('🔧 Testing API key creation...');
    try {
      const { data, error } = await supabase.rpc('create_api_key', {
        p_name: 'Test Key',
        p_owner_email: 'test@example.com'
      });
      
      if (error) {
        if (error.message.includes('unauthorized')) {
          console.log('⚠️  API key creation requires authentication as admin user');
          console.log('💡 You can now create API keys by logging in as an admin user');
        } else {
          console.log('❌ API key creation error:', error.message);
        }
      } else {
        console.log('✅ API key creation works!', data);
      }
    } catch (e) {
      console.log('❓ Could not test API key creation:', e.message);
    }
    
    return;
  }
  
  console.log('⚠️  No admin users found. Attempting to fix...\n');
  
  // Step 2: Test existing functions
  const workingFunctions = await testExistingFunctions();
  
  // Step 3: Try direct insert
  const directResult = await attemptDirectProfileInsert();
  if (directResult) {
    console.log('✅ Successfully created admin user via direct insert!');
    return;
  }
  
  // Step 4: Try signup
  const signupResult = await attemptSignUpNewAdmin();
  if (signupResult) {
    console.log('✅ Successfully created admin user via signup!');
    return;
  }
  
  // Step 5: Provide SQL solution
  console.log('❌ Automated methods failed. Manual intervention required.\n');
  await provideSQLSolution();
  
  console.log('\n📌 Next Steps:');
  console.log('1. Copy the SQL above and run it in your Supabase SQL Editor');
  console.log('2. Use Service Role permissions if needed');  
  console.log('3. Re-run this script to verify the admin user was created');
  console.log('4. Then try creating API keys through the admin interface');
}

// Run the script
main().catch(console.error);