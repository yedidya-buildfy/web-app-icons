// API Key Management Interface
let supabase;
let currentUser = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', async function() {
    try {
        console.log('Initializing API Admin page...');
        
        // Initialize Supabase client - try to reuse existing client from auth.js
        if (window.supabaseClient) {
            supabase = window.supabaseClient;
            console.log('✅ Using existing Supabase client from auth.js');
        } else if (window.supabaseAuthClient) {
            supabase = window.supabaseAuthClient;
            console.log('✅ Using existing Supabase auth client');
        } else if (typeof window.ENV !== 'undefined' && window.ENV.SUPABASE_URL && window.ENV.SUPABASE_ANON_KEY) {
            supabase = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);
            console.log('✅ Created new Supabase client');
        } else if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Created Supabase client using global constants');
        } else {
            console.error('❌ Supabase configuration missing', { ENV: window.ENV, SUPABASE_URL: typeof SUPABASE_URL, SUPABASE_ANON_KEY: typeof SUPABASE_ANON_KEY });
            showError('Supabase configuration missing. Please check env.js file.');
            return;
        }

        // Check authentication
        console.log('Checking authentication...');
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) {
            console.error('❌ Auth error:', authError);
            showLoginRequired();
            return;
        }
        
        if (!user) {
            console.log('❌ No authenticated user');
            showLoginRequired();
            return;
        }
        
        console.log('✅ User authenticated:', user.email);

        // Check if user is admin
        console.log('Checking admin privileges...');
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.error('❌ Profile error:', profileError);
            showError('Error loading user profile: ' + profileError.message);
            return;
        }

        if (!profile) {
            console.log('❌ No profile found');
            showLoginRequired();
            return;
        }
        
        console.log('Profile found:', profile);

        if (!profile.is_super_admin) {
            console.log('❌ User is not super admin');
            showLoginRequired();
            return;
        }

        console.log('✅ User is super admin');
        currentUser = user;
        document.getElementById('userDisplay').textContent = profile.full_name || profile.email || user.email;
        
        // Show the app
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('loginRequired').classList.add('hidden');

        // Load data and set up event listeners
        console.log('Loading dashboard...');
        await loadDashboard();
        setupEventListeners();
        console.log('✅ API Admin page loaded successfully');
        
    } catch (error) {
        console.error('❌ Error initializing page:', error);
        showError('Error initializing page: ' + error.message);
    }
});

function showLoginRequired() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('loginRequired').classList.remove('hidden');
}

function setupEventListeners() {
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'admin.html';
    });

    // Create API key button
    document.getElementById('createKeyBtn').addEventListener('click', () => {
        document.getElementById('createKeyModal').classList.add('show');
    });

    // Cancel create buttons
    document.getElementById('cancelCreateBtn').addEventListener('click', () => {
        document.getElementById('createKeyModal').classList.remove('show');
        resetCreateForm();
    });
    
    document.getElementById('cancelCreateBtn2').addEventListener('click', () => {
        document.getElementById('createKeyModal').classList.remove('show');
        resetCreateForm();
    });

    // Create form submission
    document.getElementById('createKeyForm').addEventListener('submit', handleCreateApiKey);

    // Close created modal buttons
    document.getElementById('closeKeyCreatedBtn').addEventListener('click', () => {
        document.getElementById('keyCreatedModal').classList.remove('show');
        document.getElementById('createKeyModal').classList.remove('show');
        resetCreateForm();
        loadDashboard(); // Refresh data
    });
    
    document.getElementById('closeKeyCreatedBtn2').addEventListener('click', () => {
        document.getElementById('keyCreatedModal').classList.remove('show');
        document.getElementById('createKeyModal').classList.remove('show');
        resetCreateForm();
        loadDashboard(); // Refresh data
    });

    // Copy API key
    document.getElementById('copyApiKey').addEventListener('click', async () => {
        const apiKey = document.getElementById('newApiKey').textContent;
        try {
            await navigator.clipboard.writeText(apiKey);
            // Show brief success feedback
            const btn = document.getElementById('copyApiKey');
            btn.innerHTML = '<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => {
                btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>';
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });

    // Close modals when clicking outside
    document.getElementById('createKeyModal').addEventListener('click', (e) => {
        if (e.target.id === 'createKeyModal') {
            document.getElementById('createKeyModal').classList.remove('show');
            resetCreateForm();
        }
    });

    document.getElementById('keyCreatedModal').addEventListener('click', (e) => {
        if (e.target.id === 'keyCreatedModal') {
            document.getElementById('keyCreatedModal').classList.remove('show');
        }
    });
}

async function loadDashboard() {
    try {
        console.log('📊 Loading API keys...');
        
        // Load API keys
        const { data: apiKeys, error: keysError } = await supabase
            .from('api_keys')
            .select('*')
            .order('created_at', { ascending: false });

        if (keysError) {
            console.error('❌ Error loading API keys:', keysError);
            throw keysError;
        }

        console.log('✅ Loaded', apiKeys?.length || 0, 'API keys');

        // Load usage stats for today
        const today = new Date().toISOString().split('T')[0];
        console.log('📈 Loading usage stats for', today);
        
        const { data: todayUsage, error: usageError } = await supabase
            .from('api_key_daily_usage')
            .select('*')
            .eq('usage_date', today);

        if (usageError) {
            console.error('❌ Error loading usage stats:', usageError);
            // Don't throw here, just log and continue with empty usage
            console.log('Continuing without usage stats...');
        }

        console.log('✅ Loaded', todayUsage?.length || 0, 'usage records');

        // Update stats
        updateDashboardStats(apiKeys || [], todayUsage || []);
        
        // Update table
        updateApiKeysTable(apiKeys || [], todayUsage || []);
        
        console.log('✅ Dashboard loaded successfully');

    } catch (error) {
        console.error('❌ Error loading dashboard:', error);
        showError('Failed to load dashboard data: ' + error.message);
    }
}

function updateDashboardStats(apiKeys, todayUsage) {
    const totalKeys = apiKeys.length;
    const activeKeys = apiKeys.filter(key => key.is_active).length;
    const todayRequests = todayUsage.reduce((sum, usage) => sum + usage.total_requests, 0);
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentlyUsed = apiKeys.filter(key => 
        key.last_used_at && new Date(key.last_used_at) > oneDayAgo
    ).length;

    document.getElementById('totalKeysCount').textContent = totalKeys;
    document.getElementById('activeKeysCount').textContent = activeKeys;
    document.getElementById('todayRequestsCount').textContent = todayRequests.toLocaleString();
    document.getElementById('recentlyUsedCount').textContent = recentlyUsed;
}

function updateApiKeysTable(apiKeys, todayUsage) {
    const tbody = document.getElementById('apiKeysTable');
    
    if (apiKeys.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No API keys found</td>
            </tr>
        `;
        return;
    }

    // Create a map of today's usage by API key ID
    const usageMap = {};
    todayUsage.forEach(usage => {
        usageMap[usage.api_key_id] = usage;
    });

    tbody.innerHTML = apiKeys.map(key => {
        const usage = usageMap[key.id] || { total_requests: 0 };
        const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
        const lastUsed = key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never';
        
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4">
                    <div>
                        <div class="text-sm font-medium text-gray-900">${escapeHtml(key.name)}</div>
                        <div class="text-sm text-gray-500">${key.key_prefix}</div>
                        <div class="text-xs text-gray-400">Created: ${new Date(key.created_at).toLocaleDateString()}</div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div>
                        <div class="text-sm text-gray-900">${escapeHtml(key.owner_name || 'N/A')}</div>
                        <div class="text-sm text-gray-500">${escapeHtml(key.owner_email)}</div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="flex flex-col space-y-1">
                        <span class="badge ${
                            key.is_active && !isExpired 
                                ? 'badge-active' 
                                : 'badge-inactive'
                        }">
                            ${key.is_active && !isExpired ? 'Active' : (isExpired ? 'Expired' : 'Inactive')}
                        </span>
                        <div class="text-xs text-gray-500">Last used: ${lastUsed}</div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm text-gray-900">${usage.total_requests} today</div>
                    <div class="text-xs text-gray-500">Search: ${usage.search_requests || 0} | Gen: ${usage.generate_requests || 0}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-xs space-y-1">
                        <div>${key.rate_limit_per_minute}/min</div>
                        <div>${(key.daily_limit || 0).toLocaleString()}/day</div>
                        <div>${(key.monthly_limit || 0).toLocaleString()}/month</div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div>
                        ${key.can_search ? '<span class="badge badge-permission">Search</span>' : ''}
                        ${key.can_generate ? '<span class="badge badge-permission">Generate</span>' : ''}
                        ${key.can_download ? '<span class="badge badge-permission">Download</span>' : ''}
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div>
                        <button onclick="viewApiKeyDetails('${key.id}')" class="btn-small btn-view">View</button>
                        ${key.is_active ? `
                            <button onclick="revokeApiKey('${key.id}')" class="btn-small btn-revoke">Revoke</button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function handleCreateApiKey(e) {
    e.preventDefault();
    
    const formData = {
        name: document.getElementById('keyName').value.trim(),
        ownerEmail: document.getElementById('ownerEmail').value.trim(),
        ownerName: document.getElementById('ownerName').value.trim() || null,
        description: document.getElementById('description').value.trim() || null,
        expiresAt: document.getElementById('expiresAt').value || null,
        rateLimitPerMinute: parseInt(document.getElementById('rateLimit').value),
        dailyLimit: parseInt(document.getElementById('dailyLimit').value),
        monthlyLimit: parseInt(document.getElementById('monthlyLimit').value),
        canSearch: document.getElementById('canSearch').checked,
        canGenerate: document.getElementById('canGenerate').checked,
        canDownload: document.getElementById('canDownload').checked
    };

    try {
        // Call the database function to create the API key
        const { data, error } = await supabase.rpc('create_api_key', {
            p_name: formData.name,
            p_owner_email: formData.ownerEmail,
            p_owner_name: formData.ownerName,
            p_description: formData.description,
            p_expires_at: formData.expiresAt,
            p_rate_limit_per_minute: formData.rateLimitPerMinute,
            p_daily_limit: formData.dailyLimit,
            p_monthly_limit: formData.monthlyLimit,
            p_can_search: formData.canSearch,
            p_can_generate: formData.canGenerate,
            p_can_download: formData.canDownload
        });

        if (error) throw error;

        if (data.success) {
            // Show the created API key
            document.getElementById('newApiKey').textContent = data.api_key;
            document.getElementById('keyCreatedModal').classList.add('show');
        } else {
            throw new Error(data.error || 'Failed to create API key');
        }

    } catch (error) {
        console.error('Error creating API key:', error);
        showError('Failed to create API key: ' + error.message);
    }
}

async function revokeApiKey(apiKeyId) {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
        return;
    }

    try {
        const { data, error } = await supabase.rpc('revoke_api_key', {
            p_api_key_id: apiKeyId
        });

        if (error) throw error;

        if (data.success) {
            showSuccess('API key revoked successfully');
            await loadDashboard(); // Refresh data
        } else {
            throw new Error(data.error || 'Failed to revoke API key');
        }

    } catch (error) {
        console.error('Error revoking API key:', error);
        showError('Failed to revoke API key: ' + error.message);
    }
}

async function viewApiKeyDetails(apiKeyId) {
    try {
        // Get detailed usage statistics
        const { data: keyData, error: keyError } = await supabase
            .from('api_keys')
            .select('*')
            .eq('id', apiKeyId)
            .single();

        if (keyError) throw keyError;

        const { data: dailyUsage, error: usageError } = await supabase
            .from('api_key_daily_usage')
            .select('*')
            .eq('api_key_id', apiKeyId)
            .order('usage_date', { ascending: false })
            .limit(30);

        if (usageError) throw usageError;

        // Create and show details modal
        showApiKeyDetailsModal(keyData, dailyUsage);

    } catch (error) {
        console.error('Error loading API key details:', error);
        showError('Failed to load API key details');
    }
}

function showApiKeyDetailsModal(keyData, dailyUsage) {
    const totalUsage = dailyUsage.reduce((sum, day) => sum + day.total_requests, 0);
    const lastUsed = keyData.last_used_at ? new Date(keyData.last_used_at).toLocaleString() : 'Never';
    
    const modalHtml = `
        <div id="detailsModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-20 mx-auto p-5 border w-full max-w-4xl shadow-lg rounded-md bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-medium text-gray-900">API Key Details</h3>
                    <button onclick="closeDetailsModal()" class="text-gray-400 hover:text-gray-600">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-4">
                        <h4 class="font-medium text-gray-900">Key Information</h4>
                        <dl class="space-y-2">
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Name</dt>
                                <dd class="text-sm text-gray-900">${escapeHtml(keyData.name)}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Prefix</dt>
                                <dd class="text-sm text-gray-900 font-mono">${keyData.key_prefix}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Owner</dt>
                                <dd class="text-sm text-gray-900">${escapeHtml(keyData.owner_name || 'N/A')} (${escapeHtml(keyData.owner_email)})</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Status</dt>
                                <dd class="text-sm">
                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                        keyData.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                    }">
                                        ${keyData.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </dd>
                            </div>
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Created</dt>
                                <dd class="text-sm text-gray-900">${new Date(keyData.created_at).toLocaleString()}</dd>
                            </div>
                            <div>
                                <dt class="text-sm font-medium text-gray-500">Last Used</dt>
                                <dd class="text-sm text-gray-900">${lastUsed}</dd>
                            </div>
                        </dl>
                    </div>
                    
                    <div class="space-y-4">
                        <h4 class="font-medium text-gray-900">Usage Statistics (Last 30 Days)</h4>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-gray-50 p-3 rounded">
                                <div class="text-lg font-medium text-gray-900">${totalUsage.toLocaleString()}</div>
                                <div class="text-sm text-gray-500">Total Requests</div>
                            </div>
                            <div class="bg-gray-50 p-3 rounded">
                                <div class="text-lg font-medium text-gray-900">${dailyUsage.reduce((sum, day) => sum + day.search_requests, 0).toLocaleString()}</div>
                                <div class="text-sm text-gray-500">Search Requests</div>
                            </div>
                            <div class="bg-gray-50 p-3 rounded">
                                <div class="text-lg font-medium text-gray-900">${dailyUsage.reduce((sum, day) => sum + day.generate_requests, 0).toLocaleString()}</div>
                                <div class="text-sm text-gray-500">Generate Requests</div>
                            </div>
                            <div class="bg-gray-50 p-3 rounded">
                                <div class="text-lg font-medium text-gray-900">${dailyUsage.reduce((sum, day) => sum + day.error_count, 0).toLocaleString()}</div>
                                <div class="text-sm text-gray-500">Errors</div>
                            </div>
                        </div>
                        
                        <h5 class="font-medium text-gray-900">Rate Limits</h5>
                        <dl class="space-y-1 text-sm">
                            <div class="flex justify-between">
                                <dt class="text-gray-500">Per Minute</dt>
                                <dd class="text-gray-900">${keyData.rate_limit_per_minute}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-gray-500">Daily</dt>
                                <dd class="text-gray-900">${(keyData.daily_limit || 0).toLocaleString()}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-gray-500">Monthly</dt>
                                <dd class="text-gray-900">${(keyData.monthly_limit || 0).toLocaleString()}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
                
                ${dailyUsage.length > 0 ? `
                    <div class="mt-6">
                        <h4 class="font-medium text-gray-900 mb-3">Daily Usage (Last 30 Days)</h4>
                        <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Search</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Generate</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Errors</th>
                                    </tr>
                                </thead>
                                <tbody class="bg-white divide-y divide-gray-200">
                                    ${dailyUsage.slice(0, 10).map(day => `
                                        <tr>
                                            <td class="px-3 py-2 text-sm text-gray-900">${new Date(day.usage_date).toLocaleDateString()}</td>
                                            <td class="px-3 py-2 text-sm text-gray-900">${day.total_requests}</td>
                                            <td class="px-3 py-2 text-sm text-gray-900">${day.search_requests}</td>
                                            <td class="px-3 py-2 text-sm text-gray-900">${day.generate_requests}</td>
                                            <td class="px-3 py-2 text-sm text-gray-900">${day.error_count}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeDetailsModal() {
    const modal = document.getElementById('detailsModal');
    if (modal) {
        modal.remove();
    }
}

function resetCreateForm() {
    document.getElementById('createKeyForm').reset();
    // Reset default values
    document.getElementById('rateLimit').value = '100';
    document.getElementById('dailyLimit').value = '10000';
    document.getElementById('monthlyLimit').value = '300000';
    document.getElementById('canSearch').checked = true;
    document.getElementById('canGenerate').checked = true;
    document.getElementById('canDownload').checked = true;
}

function showError(message) {
    // Create error display div if it doesn't exist
    let errorDiv = document.getElementById('errorDisplay');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'errorDisplay';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ffebee;
            color: #c62828;
            padding: 15px 20px;
            border-radius: 8px;
            border-left: 4px solid #f44336;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 10000;
            max-width: 400px;
            font-size: 14px;
        `;
        document.body.appendChild(errorDiv);
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 10000);
    
    console.error('Error:', message);
}

function showSuccess(message) {
    // Simple success display - you could make this more sophisticated
    alert('Success: ' + message);
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Make functions available globally for onclick handlers
window.viewApiKeyDetails = viewApiKeyDetails;
window.revokeApiKey = revokeApiKey;
window.closeDetailsModal = closeDetailsModal;