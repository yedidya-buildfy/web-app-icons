// Admin Dashboard JavaScript
let currentUser = null;
let supabaseClient = null; // Will be set when auth client is ready
let isEditingPlan = false;
let editingPlanId = null;
let isEditingDiscount = false;
let editingDiscountId = null;

// Helper: ensure we have a Supabase client
function ensureAuthClient() {
  if (!supabaseClient && (window.supabaseAuthClient || window.supabaseClient)) {
    supabaseClient = window.supabaseAuthClient || window.supabaseClient;
  }
  return supabaseClient;
}

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', async function() {
  try {
    // Wait for auth client to be available with retries
    await waitForAuthClient();
    
    // Check if user is authenticated and admin
    await checkAdminAccess();
    
    // Load initial data
    await loadPlans();
    await loadDiscountCodes();
    await loadAnalytics();
    
    // Set up form handlers
    setupFormHandlers();
    
    showAlert('Admin dashboard loaded successfully', 'success');
  } catch (error) {
    console.error('Failed to initialize admin dashboard:', error);
    showAlert('Failed to load admin dashboard: ' + error.message, 'danger');
    
    // Redirect to login if not authenticated
    if (error.message.includes('admin')) {
      window.location.href = '/';
    }
  }
});

// Wait for auth client to be available
async function waitForAuthClient() {
  const maxAttempts = 20; // 10 seconds total
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    if (window.supabaseAuthClient || window.supabaseClient) {
      // Set the global client for use throughout the admin panel
      supabaseClient = window.supabaseAuthClient || window.supabaseClient;
      console.log('Auth client found after', attempts * 500, 'ms');
      return;
    }
    
    console.log('Waiting for auth client... attempt', attempts + 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
  
  throw new Error('Authentication system not ready - client not found after 10 seconds');
}

// Check if current user has admin access
async function checkAdminAccess() {
  try {
    console.log('Checking admin access...');
    
    // Use the global client that was set in waitForAuthClient
    if (!ensureAuthClient()) {
      console.error('No Supabase client available');
      throw new Error('Authentication system not ready');
    }
    
    console.log('Auth client available, getting user...');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    
    if (userError) {
      console.error('User error:', userError);
      throw new Error('Authentication error: ' + userError.message);
    }
    
    if (!user) {
      console.error('No user found');
      throw new Error('Please log in to access admin dashboard');
    }
    
    console.log('User found:', user.email);
    
    // Check if user is admin in database
    console.log('Checking admin status in database...');
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id);
    
    if (error) {
      console.error('Profile query error:', error);
      throw error;
    }
    
    // Handle multiple profiles - get the first one with admin privileges, or just the first one
    const profile = profiles?.find(p => p.is_super_admin) || profiles?.[0];
    console.log('Profile data:', profile, 'from', profiles?.length, 'profiles');
    
    if (!profile?.is_super_admin) {
      throw new Error('Access denied: Admin privileges required');
    }
    
    console.log('Admin access granted!');
    currentUser = user;
    return true;
  } catch (error) {
    console.error('Admin access check failed:', error);
    throw error;
  }
}

// Show/hide sections
function showSection(sectionName) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Remove active class from all nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected section
  document.getElementById(sectionName).classList.add('active');
  
  // Add active class to clicked nav button
  event.target.classList.add('active');

  // Lazy-load data for certain sections when shown
  if (sectionName === 'customers') {
    loadCustomers();
  }
}

// Setup form handlers
function setupFormHandlers() {
  // Plan form handler
  document.getElementById('plan-form').addEventListener('submit', handlePlanSubmit);
  
  // Discount form handler
  document.getElementById('discount-form').addEventListener('submit', handleDiscountSubmit);
  
  // Navigation handlers
  document.querySelectorAll('.nav-btn[data-section]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const section = e.target.getAttribute('data-section');
      showSection(section);
    });
  });
  
  // Button action handlers
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.getAttribute('data-action');
      handleButtonAction(action, e);
    });
  });
  
  // Set default dates for discount form
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  document.getElementById('discount-valid-from').value = formatDateTimeLocal(now);
  document.getElementById('discount-valid-until').value = formatDateTimeLocal(tomorrow);
}

// Format date for datetime-local input
function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Handle button actions
function handleButtonAction(action, event) {
  event.preventDefault();
  
  switch(action) {
    case 'reset-plan-form':
      resetPlanForm();
      break;
    case 'reset-discount-form':
      resetDiscountForm();
      break;
    case 'load-customers':
      loadCustomers();
      break;
    default:
      console.warn('Unknown button action:', action);
  }
}

// Load subscription plans
async function loadPlans() {
  try {
    const { data: plans, error } = await supabaseClient
      .from('subscription_plans')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const tbody = document.getElementById('plans-tbody');
    tbody.innerHTML = '';
    
    plans.forEach(plan => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${plan.id}</td>
        <td>${plan.name}</td>
        <td>$${plan.price_monthly}</td>
        <td>$${plan.price_yearly}</td>
        <td>${plan.unlimited_searches ? 'Unlimited' : plan.monthly_icon_searches}</td>
        <td>${plan.unlimited_downloads ? 'Unlimited' : plan.monthly_icon_downloads}</td>
        <td>${plan.unlimited_generation ? 'Unlimited' : plan.monthly_icon_generation}</td>
        <td>
          <button class="btn btn-secondary" onclick="editPlan('${plan.id}')">Edit</button>
          ${plan.id !== 'free' ? `<button class="btn btn-danger" onclick="deletePlan('${plan.id}')">Delete</button>` : ''}
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load plans:', error);
    showAlert('Failed to load plans: ' + error.message, 'danger');
  }
}

// Handle plan form submission
async function handlePlanSubmit(event) {
  event.preventDefault();
  
  try {
    const formData = {
      id: document.getElementById('plan-id').value.toLowerCase().replace(/\s+/g, '-'),
      name: document.getElementById('plan-name').value,
      description: document.getElementById('plan-description').value,
      price_monthly: parseFloat(document.getElementById('plan-price-monthly').value) || 0,
      price_yearly: parseFloat(document.getElementById('plan-price-yearly').value) || 0,
      monthly_icon_searches: parseInt(document.getElementById('plan-searches').value) || 0,
      monthly_icon_downloads: parseInt(document.getElementById('plan-downloads').value) || 0,
      monthly_icon_generation: parseInt(document.getElementById('plan-generation').value) || 0,
      monthly_generated_usage: parseInt(document.getElementById('plan-generated-usage').value) || 0,
      unlimited_searches: document.getElementById('plan-unlimited-searches').checked,
      unlimited_downloads: document.getElementById('plan-unlimited-downloads').checked,
      unlimited_generation: document.getElementById('plan-unlimited-generation').checked,
      unlimited_generated_usage: document.getElementById('plan-unlimited-generated-usage').checked
    };
    
    if (isEditingPlan) {
      // Update existing plan
      const { error } = await supabaseClient.rpc('admin_update_plan', {
        p_admin_user_id: currentUser.id,
        p_id: editingPlanId,
        p_name: formData.name,
        p_description: formData.description,
        p_price_monthly: formData.price_monthly,
        p_price_yearly: formData.price_yearly,
        p_monthly_icon_searches: formData.monthly_icon_searches,
        p_monthly_icon_downloads: formData.monthly_icon_downloads,
        p_monthly_icon_generation: formData.monthly_icon_generation,
        p_monthly_generated_usage: formData.monthly_generated_usage,
        p_unlimited_searches: formData.unlimited_searches,
        p_unlimited_downloads: formData.unlimited_downloads,
        p_unlimited_generation: formData.unlimited_generation,
        p_unlimited_generated_usage: formData.unlimited_generated_usage
      });
      
      if (error) throw error;
      showAlert('Plan updated successfully', 'success');
    } else {
      // Create new plan
      const { error } = await supabaseClient.rpc('admin_create_plan', {
        p_admin_user_id: currentUser.id,
        p_id: formData.id,
        p_name: formData.name,
        p_description: formData.description,
        p_price_monthly: formData.price_monthly,
        p_price_yearly: formData.price_yearly,
        p_monthly_icon_searches: formData.monthly_icon_searches,
        p_monthly_icon_downloads: formData.monthly_icon_downloads,
        p_monthly_icon_generation: formData.monthly_icon_generation,
        p_monthly_generated_usage: formData.monthly_generated_usage,
        p_unlimited_searches: formData.unlimited_searches,
        p_unlimited_downloads: formData.unlimited_downloads,
        p_unlimited_generation: formData.unlimited_generation,
        p_unlimited_generated_usage: formData.unlimited_generated_usage
      });
      
      if (error) throw error;
      showAlert('Plan created successfully', 'success');
    }
    
    // Reset form and reload plans
    resetPlanForm();
    await loadPlans();
    
  } catch (error) {
    console.error('Failed to save plan:', error);
    showAlert('Failed to save plan: ' + error.message, 'danger');
  }
}

// Edit plan
async function editPlan(planId) {
  try {
    const { data: plan, error } = await supabaseClient
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single();
    
    if (error) throw error;
    
    // Populate form with plan data
    document.getElementById('plan-id').value = plan.id;
    document.getElementById('plan-id').disabled = true; // Can't change ID when editing
    document.getElementById('plan-name').value = plan.name;
    document.getElementById('plan-description').value = plan.description || '';
    document.getElementById('plan-price-monthly').value = plan.price_monthly;
    document.getElementById('plan-price-yearly').value = plan.price_yearly;
    document.getElementById('plan-searches').value = plan.monthly_icon_searches;
    document.getElementById('plan-downloads').value = plan.monthly_icon_downloads;
    document.getElementById('plan-generation').value = plan.monthly_icon_generation;
    document.getElementById('plan-generated-usage').value = plan.monthly_generated_usage;
    document.getElementById('plan-unlimited-searches').checked = plan.unlimited_searches;
    document.getElementById('plan-unlimited-downloads').checked = plan.unlimited_downloads;
    document.getElementById('plan-unlimited-generation').checked = plan.unlimited_generation;
    document.getElementById('plan-unlimited-generated-usage').checked = plan.unlimited_generated_usage;
    
    // Update form state
    isEditingPlan = true;
    editingPlanId = planId;
    document.getElementById('plan-form-title').textContent = `Edit Plan: ${plan.name}`;
    
  } catch (error) {
    console.error('Failed to load plan for editing:', error);
    showAlert('Failed to load plan: ' + error.message, 'danger');
  }
}

// Delete plan
async function deletePlan(planId) {
  if (!confirm(`Are you sure you want to delete the plan "${planId}"?`)) {
    return;
  }
  
  try {
    const { error } = await supabaseClient.rpc('admin_delete_plan', {
      p_admin_user_id: currentUser.id,
      p_id: planId
    });
    
    if (error) throw error;
    
    showAlert('Plan deleted successfully', 'success');
    await loadPlans();
    
  } catch (error) {
    console.error('Failed to delete plan:', error);
    showAlert('Failed to delete plan: ' + error.message, 'danger');
  }
}

// Reset plan form
function resetPlanForm() {
  document.getElementById('plan-form').reset();
  document.getElementById('plan-id').disabled = false;
  document.getElementById('plan-form-title').textContent = 'Create New Plan';
  
  // Reset default values
  document.getElementById('plan-price-monthly').value = '0';
  document.getElementById('plan-price-yearly').value = '0';
  document.getElementById('plan-searches').value = '100';
  document.getElementById('plan-downloads').value = '50';
  document.getElementById('plan-generation').value = '10';
  document.getElementById('plan-generated-usage').value = '25';
  
  isEditingPlan = false;
  editingPlanId = null;
}

// Load discount codes
async function loadDiscountCodes() {
  try {
    const { data: discounts, error } = await supabaseClient
      .from('discount_codes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const tbody = document.getElementById('discounts-tbody');
    tbody.innerHTML = '';
    
    discounts.forEach(discount => {
      const row = document.createElement('tr');
      const isExpired = new Date(discount.valid_until) < new Date();
      const isActive = discount.is_active && !isExpired;
      
      row.innerHTML = `
        <td><code>${discount.code}</code></td>
        <td>${discount.discount_type}</td>
        <td>${discount.discount_type === 'percentage' ? discount.discount_amount + '%' : '$' + discount.discount_amount}</td>
        <td>${new Date(discount.valid_until).toLocaleDateString()}</td>
        <td>${discount.used_count}${discount.max_uses ? '/' + discount.max_uses : '/∞'}</td>
        <td>
          <span style="color: ${isActive ? 'green' : 'red'}">
            ${isActive ? 'Active' : (isExpired ? 'Expired' : 'Inactive')}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary" onclick="editDiscount('${discount.id}')">Edit</button>
          <button class="btn btn-danger" onclick="deleteDiscount('${discount.id}')">Delete</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load discount codes:', error);
    showAlert('Failed to load discount codes: ' + error.message, 'danger');
  }
}

// Handle discount form submission
async function handleDiscountSubmit(event) {
  event.preventDefault();
  
  try {
    const formData = {
      code: document.getElementById('discount-code').value.toUpperCase(),
      discount_type: document.getElementById('discount-type').value,
      discount_amount: parseFloat(document.getElementById('discount-amount').value),
      months_duration: parseInt(document.getElementById('discount-months').value) || 1,
      valid_from: document.getElementById('discount-valid-from').value ? new Date(document.getElementById('discount-valid-from').value).toISOString() : new Date().toISOString(),
      valid_until: new Date(document.getElementById('discount-valid-until').value).toISOString(),
      max_uses: document.getElementById('discount-max-uses').value ? parseInt(document.getElementById('discount-max-uses').value) : null,
      description: document.getElementById('discount-description').value || null,
      created_by: currentUser.id
    };
    
    if (isEditingDiscount) {
      // Update existing discount
      const { error } = await supabaseClient
        .from('discount_codes')
        .update(formData)
        .eq('id', editingDiscountId);
      
      if (error) throw error;
      showAlert('Discount code updated successfully', 'success');
    } else {
      // Create new discount
      const { error } = await supabaseClient
        .from('discount_codes')
        .insert([formData]);
      
      if (error) throw error;
      showAlert('Discount code created successfully', 'success');
    }
    
    // Reset form and reload discounts
    resetDiscountForm();
    await loadDiscountCodes();
    
  } catch (error) {
    console.error('Failed to save discount code:', error);
    showAlert('Failed to save discount code: ' + error.message, 'danger');
  }
}

// Edit discount
async function editDiscount(discountId) {
  try {
    const { data: discount, error } = await supabaseClient
      .from('discount_codes')
      .select('*')
      .eq('id', discountId)
      .single();
    
    if (error) throw error;
    
    // Populate form with discount data
    document.getElementById('discount-code').value = discount.code;
    document.getElementById('discount-type').value = discount.discount_type;
    document.getElementById('discount-amount').value = discount.discount_amount;
    document.getElementById('discount-months').value = discount.months_duration;
    document.getElementById('discount-valid-from').value = formatDateTimeLocal(new Date(discount.valid_from));
    document.getElementById('discount-valid-until').value = formatDateTimeLocal(new Date(discount.valid_until));
    document.getElementById('discount-max-uses').value = discount.max_uses || '';
    document.getElementById('discount-description').value = discount.description || '';
    
    // Update form state
    isEditingDiscount = true;
    editingDiscountId = discountId;
    document.getElementById('discount-form-title').textContent = `Edit Discount Code: ${discount.code}`;
    
  } catch (error) {
    console.error('Failed to load discount for editing:', error);
    showAlert('Failed to load discount code: ' + error.message, 'danger');
  }
}

// Delete discount
async function deleteDiscount(discountId) {
  if (!confirm('Are you sure you want to delete this discount code?')) {
    return;
  }
  
  try {
    const { error } = await supabaseClient
      .from('discount_codes')
      .delete()
      .eq('id', discountId);
    
    if (error) throw error;
    
    showAlert('Discount code deleted successfully', 'success');
    await loadDiscountCodes();
    
  } catch (error) {
    console.error('Failed to delete discount code:', error);
    showAlert('Failed to delete discount code: ' + error.message, 'danger');
  }
}

// Reset discount form
function resetDiscountForm() {
  document.getElementById('discount-form').reset();
  document.getElementById('discount-form-title').textContent = 'Create New Discount Code';
  
  // Reset default values
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  document.getElementById('discount-valid-from').value = formatDateTimeLocal(now);
  document.getElementById('discount-valid-until').value = formatDateTimeLocal(tomorrow);
  document.getElementById('discount-months').value = '1';
  
  isEditingDiscount = false;
  editingDiscountId = null;
}

// Load analytics data
async function loadAnalytics() {
  try {
    // Get total users
    const { count: totalUsers } = await supabaseClient
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    
    // Get active subscriptions
    const { count: activeSubscriptions } = await supabaseClient
      .from('user_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    // Get monthly revenue (simplified calculation)
    const { data: subscriptions } = await supabaseClient
      .from('user_subscriptions')
      .select('plan_id, subscription_plans(price_monthly)')
      .eq('status', 'active')
      .eq('billing_cycle', 'monthly');
    
    let monthlyRevenue = 0;
    if (subscriptions) {
      monthlyRevenue = subscriptions.reduce((total, sub) => {
        return total + (sub.subscription_plans?.price_monthly || 0);
      }, 0);
    }
    
    // Get discount usage count
    const { count: discountUsage } = await supabaseClient
      .from('discount_code_usage')
      .select('*', { count: 'exact', head: true });
    
    // Update UI
    document.getElementById('total-users').textContent = totalUsers || 0;
    document.getElementById('active-subscriptions').textContent = activeSubscriptions || 0;
    document.getElementById('monthly-revenue').textContent = `$${monthlyRevenue.toFixed(2)}`;
    document.getElementById('discount-usage').textContent = discountUsage || 0;
    
  } catch (error) {
    console.error('Failed to load analytics:', error);
    showAlert('Failed to load analytics: ' + error.message, 'danger');
  }
}

// Load customers overview
async function loadCustomers() {
  try {
    const filter = (document.getElementById('customer-filter')?.value || '').trim().toLowerCase();

    // Ensure auth client and current user
    if (!ensureAuthClient()) {
      await waitForAuthClient();
      if (!ensureAuthClient()) throw new Error('Authentication system not ready');
    }
    if (!currentUser) {
      await checkAdminAccess();
    }
    if (!currentUser) throw new Error('Access denied: Admin privileges required');

    // Use secure admin RPC that aggregates per-user stats
    const { data: rows, error } = await supabaseClient.rpc('admin_get_customers_overview', {
      p_admin_user_id: currentUser.id
    });
    if (error) throw error;

    // Update summary statistics
    const totalCustomers = rows.length;
    const activeCustomers = rows.filter(r => r.total_usage_count > 0).length;
    const customersWithProfiles = rows.filter(r => r.full_name && r.full_name.trim() !== '').length;
    const adminUsers = rows.filter(r => r.is_super_admin === true).length;
    
    // Usage statistics
    const totalGenerations = rows.reduce((sum, r) => sum + (r.generation_count || 0), 0);
    const totalPngDownloads = rows.reduce((sum, r) => sum + (r.download_png_count || 0), 0);
    const totalSvgDownloads = rows.reduce((sum, r) => sum + (r.download_svg_count || 0), 0);
    const totalCopySvg = rows.reduce((sum, r) => sum + (r.copy_svg_count || 0), 0);
    const totalDownloads = totalPngDownloads + totalSvgDownloads + totalCopySvg;
    
    // Revenue statistics
    const estimatedMonthlyRevenue = rows.reduce((sum, r) => sum + (Number(r.estimated_monthly_revenue) || 0), 0);
    
    // Update DOM elements
    document.getElementById('total-customers').textContent = totalCustomers;
    document.getElementById('active-customers').textContent = activeCustomers;
    document.getElementById('customers-with-profiles').textContent = customersWithProfiles;
    document.getElementById('admin-users').textContent = adminUsers;
    document.getElementById('total-generations').textContent = totalGenerations.toLocaleString();
    document.getElementById('total-downloads').textContent = totalDownloads.toLocaleString();
    document.getElementById('png-downloads').textContent = totalPngDownloads.toLocaleString();
    document.getElementById('svg-downloads').textContent = totalSvgDownloads.toLocaleString();
    document.getElementById('copy-svg-actions').textContent = totalCopySvg.toLocaleString();
    document.getElementById('estimated-revenue').textContent = '$' + estimatedMonthlyRevenue.toFixed(2);
    
    // Populate table with improved layout
    const tbody = document.getElementById('customers-tbody');
    tbody.innerHTML = '';
    
    const filteredRows = rows.filter(r => !filter || (r.email || '').toLowerCase().includes(filter));
    
    filteredRows.forEach(r => {
      const tr = document.createElement('tr');
      const plan = r.current_plan_id ? r.current_plan_name || r.current_plan_id : 'Free';
      const planClass = plan.toLowerCase() === 'free' ? 'plan-free' : 
                       plan.toLowerCase().includes('pro') ? 'plan-pro' : 'plan-enterprise';
      const estMonthly = Number(r.estimated_monthly_revenue || 0);
      const estTotal = Number(r.estimated_total_spend || 0);
      const createdAt = r.profile_created_at ? new Date(r.profile_created_at).toLocaleDateString() : 'Unknown';
      
      // Create usage summary
      const usageParts = [];
      if (r.generation_count > 0) usageParts.push(`${r.generation_count} generations`);
      if ((r.download_png_count + r.download_svg_count + r.copy_svg_count) > 0) {
        usageParts.push(`${r.download_png_count + r.download_svg_count + r.copy_svg_count} downloads`);
      }
      const usageSummary = usageParts.length > 0 ? usageParts.join(', ') : 'No usage yet';
      
      tr.innerHTML = `
        <td>
          <div class="customer-info">
            <div class="customer-email">${r.email || 'No email'}</div>
            ${r.full_name ? `<div class="customer-name">${r.full_name}</div>` : ''}
          </div>
        </td>
        <td>${createdAt}</td>
        <td>
          <span class="plan-badge ${planClass}">${plan}</span>
          ${r.billing_cycle ? `<div style="font-size:0.8em;color:#666;margin-top:2px;">${r.billing_cycle}</div>` : ''}
        </td>
        <td>
          <div class="usage-summary">${usageSummary}</div>
          ${r.total_usage_count > 0 ? `<div style="font-size:0.8em;color:#999;">Total: ${r.total_usage_count} actions</div>` : ''}
        </td>
        <td>
          <div class="revenue-info">
            ${estMonthly > 0 ? `<div class="monthly-revenue">$${estMonthly.toFixed(2)}/mo</div>` : ''}
            ${estTotal > 0 ? `<div class="total-spend">$${estTotal.toFixed(2)} total</div>` : '<div class="total-spend">$0.00</div>'}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;padding:40px;">No customers found</td></tr>';
    }
  } catch (error) {
    console.error('Failed to load customers:', error);
    showAlert('Failed to load customers: ' + error.message, 'danger');
  }
}

// Show alert message
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alerts-container');
  
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  
  alertContainer.appendChild(alert);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (alert.parentNode) {
      alert.parentNode.removeChild(alert);
    }
  }, 5000);
}