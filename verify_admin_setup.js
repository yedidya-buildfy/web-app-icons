#!/usr/bin/env node

/**
 * Admin Setup Verification Script
 * 
 * This script verifies if admin users have been created and tests API key creation functionality.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kfeekskddfyyosyyplxd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZWVrc2tkZGZ5eW9zeXlwbHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkwOTAsImV4cCI6MjA3MDUxNTA5MH0.rgGBDVUIDEi31pZhXbzJAJCu7cmebMWEfEdvDnE-tCU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDatabaseStatus() {
  console.log('🔍 Checking current database status...\n');
  
  try {
    // Check profiles table
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_super_admin, provider, created_at')
      .order('created_at', { ascending: false });
      
    if (profileError) {
      console.error('❌ Error querying profiles:', profileError.message);
      return false;
    }
    
    console.log(`📊 Total profiles: ${profiles.length}`);
    
    if (profiles.length === 0) {
      console.log('⚠️  No profiles found in database');
      return false;
    }
    
    // Show all profiles
    console.log('\n👥 All profiles:');
    profiles.forEach((profile, i) => {
      const adminBadge = profile.is_super_admin ? '🔑 ADMIN' : '👤 User';
      console.log(`   ${i+1}. ${adminBadge} ${profile.email || 'No email'}`);
      console.log(`      Name: ${profile.full_name || 'N/A'}`);
      console.log(`      ID: ${profile.id.substring(0,8)}...`);
      console.log(`      Provider: ${profile.provider || 'N/A'}`);
      console.log(`      Created: ${profile.created_at}`);
      console.log('');
    });
    
    // Count admin users
    const adminUsers = profiles.filter(p => p.is_super_admin === true);
    console.log(`🔑 Admin users found: ${adminUsers.length}`);
    
    if (adminUsers.length === 0) {
      console.log('❌ NO ADMIN USERS - API key creation will fail!\n');
      return false;
    } else {
      console.log('✅ Admin users ready for API key creation:');
      adminUsers.forEach(admin => {
        console.log(`   - ${admin.email} (${admin.full_name || 'No name'})`);
      });
      console.log('');
      return true;
    }
    
  } catch (error) {
    console.error('💥 Database check failed:', error.message);
    return false;
  }
}

async function testNewFunctions() {
  console.log('🔧 Testing new admin setup functions...\n');
  
  // Test the new functions created by the SQL migration
  const functionsToTest = [
    'check_admin_setup_status',
    'emergency_create_admin'
  ];
  
  for (const funcName of functionsToTest) {
    try {
      console.log(`🧪 Testing ${funcName}...`);
      const { data, error } = await supabase.rpc(funcName, {});
      
      if (error) {
        if (error.code === 'PGRST202') {
          console.log(`   ❌ Function not found - SQL migration not run yet`);
        } else {
          console.log(`   ❓ Error: ${error.message}`);
        }
      } else {
        console.log(`   ✅ Function works!`);
        console.log(`   📊 Result:`, JSON.stringify(data, null, 2));
      }
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
    }
    console.log('');
  }
}

async function testAPIKeyCreation() {
  console.log('🔐 Testing API key creation functionality...\n');
  
  try {
    // Test if the create_api_key function is available and what it returns
    console.log('🧪 Testing create_api_key function...');
    
    const { data, error } = await supabase.rpc('create_api_key', {
      p_name: 'Test API Key - Delete Me',
      p_owner_email: 'test@example.com',
      p_description: 'Test key to verify functionality'
    });
    
    if (error) {
      if (error.code === 'PGRST202') {
        console.log('   ❌ create_api_key function not found');
        console.log('   💡 Run the 004_api_key_management.sql migration first');
      } else if (error.message.includes('unauthorized')) {
        console.log('   ⚠️  Function requires admin authentication');
        console.log('   💡 This is expected - you need to login as admin first');
        console.log('   ✅ Function exists and admin check is working');
      } else if (error.message.includes('Admin privileges required')) {
        console.log('   ⚠️  Admin privileges required');
        console.log('   💡 This is expected behavior - admin check works');
        console.log('   ✅ Function exists and admin validation works');
      } else {
        console.log('   ❓ Unexpected error:', error.message);
      }
    } else {
      console.log('   🎉 API key created successfully!');
      console.log('   🔑 Result:', data);
      console.log('   ⚠️  This should not happen without authentication!');
    }
    
  } catch (e) {
    console.log('   ❌ Exception:', e.message);
  }
}

async function showNextSteps(hasAdmin) {
  console.log('\n📋 Next Steps:\n');
  
  if (!hasAdmin) {
    console.log('🚨 CRITICAL: No admin users found!');
    console.log('');
    console.log('To fix this issue:');
    console.log('1. 📄 Run the create_emergency_admin.sql file in your Supabase SQL Editor');
    console.log('2. 🔑 Use Service Role permissions (not anon key)');
    console.log('3. 🔍 Re-run this script to verify admin creation');
    console.log('');
    console.log('SQL file location: ./create_emergency_admin.sql');
    console.log('');
    console.log('Alternative: If you have Supabase CLI:');
    console.log('   supabase db reset');
    console.log('   # Then run your migrations');
    console.log('');
  } else {
    console.log('✅ Admin users exist - API key creation should work!');
    console.log('');
    console.log('To create API keys:');
    console.log('1. 🚀 Start your application server');
    console.log('2. 🌐 Visit the admin interface (usually /admin.html)');
    console.log('3. 🔐 Login with an admin user account');
    console.log('4. 🔑 Use the API key creation interface');
    console.log('');
    console.log('Admin interface files:');
    console.log('   - /public/api-admin.html (API key management)');
    console.log('   - /public/admin.html (general admin dashboard)');
    console.log('');
  }
  
  console.log('💡 Tips:');
  console.log('   - Admin users have is_super_admin = true in profiles table');
  console.log('   - API keys require admin authentication to create');
  console.log('   - Check browser console for detailed error messages');
  console.log('   - Verify your .env file has correct Supabase credentials');
}

async function main() {
  console.log('🎯 Icon Search App - Admin Setup Verification');
  console.log('=============================================\n');
  
  // Check database status
  const hasAdmin = await checkDatabaseStatus();
  
  // Test new functions
  await testNewFunctions();
  
  // Test API key creation
  await testAPIKeyCreation();
  
  // Show next steps
  await showNextSteps(hasAdmin);
  
  console.log('\n' + '='.repeat(50));
  console.log(`Status: ${hasAdmin ? '✅ READY' : '❌ NEEDS ADMIN'}`);
  console.log('='.repeat(50));
}

// Run the verification
main().catch(console.error);