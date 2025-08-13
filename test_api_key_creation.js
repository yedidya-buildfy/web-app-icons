#!/usr/bin/env node

// Test API key creation after setup
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kfeekskddfyyosyyplxd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZWVrc2tkZGZ5eW9zeXlwbHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkwOTAsImV4cCI6MjA3MDUxNTA5MH0.rgGBDVUIDEi31pZhXbzJAJCu7cmebMWEfEdvDnE-tCU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testApiKeyCreation() {
    console.log('🧪 Testing API Key Creation System\n');

    try {
        // Check current state
        console.log('📊 Checking current database state...');
        
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('*');
        
        console.log(`👥 Profiles found: ${profiles?.length || 0}`);
        
        const { data: apiKeys, error: keysError } = await supabase
            .from('api_keys')
            .select('*');
            
        console.log(`🔑 API Keys found: ${apiKeys?.length || 0}`);
        
        if (apiKeys && apiKeys.length > 0) {
            console.log('\n🔑 Existing API Keys:');
            apiKeys.forEach(key => {
                console.log(`   • ${key.name} (${key.key_prefix}) - ${key.is_active ? 'Active' : 'Inactive'}`);
                console.log(`     Limits: ${key.rate_limit_per_minute}/min, ${key.daily_limit}/day, ${key.monthly_limit}/month`);
                console.log(`     Permissions: Search=${key.can_search}, Generate=${key.can_generate}, Download=${key.can_download}\n`);
            });
            
            // Test the first API key
            const testKey = apiKeys[0];
            const fullKey = `${testKey.key_prefix}_testkey`; // We can't get the real key, so we'll test validation
            
            console.log('🧪 Testing API key validation...');
            console.log(`Using key prefix: ${testKey.key_prefix}`);
            
            // Note: We can't test the actual validation because we don't have the real key
            // But we can test if the server accepts the format
            return;
        }
        
        // Try to create a new API key using the bypass function
        console.log('\n🔧 Creating new API key with default settings...');
        
        const { data: newKeyResult, error: createError } = await supabase.rpc('create_api_key_with_bypass', {
            p_name: 'MCP Development Key',
            p_owner_email: 'dev@example.com',
            p_owner_name: 'Developer',
            p_description: 'Development API key for MCP testing'
        });
        
        if (createError) {
            console.log('❌ Failed to create API key:', createError.message);
            console.log('\n💡 You need to run the SQL setup first:');
            console.log('   1. Open your Supabase dashboard');
            console.log('   2. Go to SQL Editor');
            console.log('   3. Run the contents of: create_initial_setup.sql');
            return;
        }
        
        console.log('✅ API Key created successfully!');
        console.log(`🔑 API Key: ${newKeyResult.api_key}`);
        console.log(`🆔 Key ID: ${newKeyResult.api_key_id}`);
        console.log(`⚠️  ${newKeyResult.warning}`);
        
        // Save the key for testing
        const fs = require('fs');
        const configPath = '../.aiconrc';
        const config = {
            apiKey: newKeyResult.api_key,
            outputDir: './Aicon'
        };
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`💾 API key saved to ${configPath}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testApiKeyCreation();