let customers = [];
let customersWithTodo = []; // Add this variable for to-do list
let deleteModal;
let customerToDelete = null;
let chatTemplates = []; // Keep this for the templates
let autoRefreshInterval;
let currentSort = { field: 'created_at', direction: 'desc' }; // Default sort by date descending
let notifications = [];
let notificationEventSource;
let pushSubscription = null;

// API endpoints - using secure backend routes
const BASE_URL = window.location.origin;  // Menggunakan origin dari URL saat ini
const API_BASE = `${BASE_URL}/api/customers`;  // Menambah kembali /api/ prefix
const API_NOTIFICATIONS = `${BASE_URL}/api/notifications`;  // Menambah kembali /api/ prefix
const API_PUSH = `${BASE_URL}/api/push`;  // Menambah kembali /api/ prefix
const API_CHAT_TEMPLATES = `${BASE_URL}/api/chat-templates`; // Add this line

document.addEventListener('DOMContentLoaded', function() {
    deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
    
    loadCustomers();
    loadChatTemplates(); // Keep this to load templates
    loadNotifications();
    setupEventListeners();
    startAutoRefresh();
    startNotificationStream();
    initializePushNotifications();
    
    // Initialize theme
    initializeTheme();
});

// Add this function to load chat templates
async function loadChatTemplates() {
    try {
        const response = await fetch(API_CHAT_TEMPLATES);
        if (!response.ok) throw new Error('Failed to fetch chat templates');
        
        chatTemplates = await response.json();
        
        // After loading templates, re-render the customer list to show action buttons
        if (customers.length > 0) {
            renderCustomers(customers);
        }
    } catch (error) {
        console.error('Error loading chat templates:', error);
        showAlert('Error loading chat templates: ' + error.message, 'danger');
    }
}

// Add this function to send follow-up message directly
async function sendDirectFollowUp(customerId, templateId, buttonElement) {
    console.log('sendDirectFollowUp called with:', { customerId, templateId });
    
    // Convert IDs to strings for consistent comparison
    const customerIdStr = String(customerId);
    
    // Debug the customers array to see what's available
    console.log('Available customers:', customers.map(c => ({ id: c.id, name: c.name })));
    
    const customer = customers.find(c => String(c.id) === customerIdStr);
    if (!customer) {
        console.error('Customer not found:', customerId);
        return;
    }
    
    const template = chatTemplates.find(t => String(t.id) === String(templateId));
    if (!template) {
        console.error('Template not found:', templateId);
        return;
    }
    
    console.log('Sending message to:', customer.no_hp, 'Template:', template.message);
    
    try {
        // Show loading state on button
        const originalHtml = buttonElement.innerHTML;
        buttonElement.disabled = true;
        buttonElement.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        
        // Send message via API - using correct endpoint path
        console.log('Sending request to:', '/send-text');
        const response = await fetch('/send-text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                number: customer.no_hp,
                message: template.message,
                is_ai_reply: false
            })
        });
        
        console.log('Response status:', response.status);
        if (!response.ok) throw new Error('Failed to send message');
        
        const result = await response.json();
        console.log('Response data:', result);
        
        // Show success message
        showAlert(`"${template.action}" message sent to ${customer.name}`, 'success');
    } catch (error) {
        console.error('Error sending follow-up message:', error);
        showAlert('Error sending message: ' + error.message, 'danger');
    } finally {
        // Restore button state
        setTimeout(() => {
            buttonElement.disabled = false;
            buttonElement.innerHTML = `<i class="fas fa-comment-dots me-1"></i>${template.action}`;
        }, 500);
    }
}

function setupEventListeners() {
    // Event listeners with debouncing for better performance
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(filterCustomers, 300);
    });
    
    document.getElementById('statusFilter').addEventListener('change', filterCustomers);
    document.getElementById('dateFilter').addEventListener('change', handleDateFilterChange);
    
    // Add event delegation for action buttons
    document.addEventListener('click', function(event) {
        // Check if the clicked element is an action button
        if (event.target.closest('.action-btn')) {
            const button = event.target.closest('.action-btn');
            const customerId = button.dataset.customerId;
            const templateId = button.dataset.templateId;
            
            if (customerId && templateId) {
                sendDirectFollowUp(customerId, templateId, button);
            }
        }
    });
}

function startAutoRefresh() {
    // Auto refresh data every 1 minute
    autoRefreshInterval = setInterval(() => {
        loadCustomers();
    }, 60000); // 1 minute
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
}

function sortBy(field) {
    if (currentSort.field === field) {
        // Toggle direction if same field
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // New field, default to desc for dates, asc for others
        currentSort.field = field;
        currentSort.direction = field === 'created_at' ? 'desc' : 'asc';
    }
    
    // Sort the customers array
    customers.sort((a, b) => {
        let aValue = a[field];
        let bValue = b[field];
        
        // Handle date sorting
        if (field === 'created_at') {
            aValue = new Date(aValue || 0); // Handle null/undefined dates
            bValue = new Date(bValue || 0);
        } else {
            // Handle string sorting (case insensitive)
            if (typeof aValue === 'string') {
                aValue = aValue.toLowerCase();
            }
            if (typeof bValue === 'string') {
                bValue = bValue.toLowerCase();
            }
            // Handle null/undefined values
            aValue = aValue || '';
            bValue = bValue || '';
        }
        
        // Sort direction
        if (currentSort.direction === 'asc') {
            if (field === 'created_at') {
                return aValue - bValue;
            }
            return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        } else {
            if (field === 'created_at') {
                return bValue - aValue;
            }
            return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
        }
    });
    
    // Update sort indicators
    updateSortIndicators();
    
    // Re-render the table
    renderCustomers(customers);
}

function updateSortIndicators() {
    // Remove all sort indicators
    document.querySelectorAll('.fa-sort, .fa-sort-up, .fa-sort-down').forEach(icon => {
        icon.className = 'fas fa-sort';
    });
    
    // Add sort indicator to current sort field
    const sortField = currentSort.field;
    const sortDirection = currentSort.direction;
    
    if (sortField === 'customerstatus') {
        const icon = document.querySelector('a[onclick="sortBy(\'customerstatus\')"] i');
        if (icon) {
            icon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'}`;
        }
    } else if (sortField === 'created_at') {
        const icon = document.querySelector('a[onclick="sortBy(\'created_at\')"] i');
        if (icon) {
            icon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'}`;
        }
    }
}

function getStatusLabel(status) {
    const statusLabels = {
        null: 'New Customer',
        'new_customer': 'New Customer',
        'awaiting_data': 'Awaiting Data',
        'awaiting_foto': 'Awaiting Foto',
        'awaiting_payment': 'Awaiting Payment',
        'progress': 'Progress',
        'done': 'Done'
    };
    return statusLabels[status] || status || 'New Customer';
}

function getStatusClass(status) {
    const statusClasses = {
        null: 'status-new',
        'new_customer': 'status-new',
        'awaiting_data': 'status-awaiting',
        'awaiting_foto': 'status-awaiting',
        'awaiting_payment': 'status-awaiting',
        'progress': 'status-progress',
        'done': 'status-done'
    };
    return statusClasses[status] || 'status-new';
}

function getStatusButtonClass(status) {
    const statusClasses = {
        null: 'btn-outline-primary',
        'new_customer': 'btn-outline-primary',
        'awaiting_data': 'btn-outline-warning',
        'awaiting_foto': 'btn-outline-info',
        'awaiting_payment': 'btn-outline-danger',
        'progress': 'btn-warning',
        'done': 'btn-success'
    };
    return statusClasses[status] || 'btn-outline-primary';
}

function getStatusIcon(status) {
    const statusIcons = {
        null: 'fa-user-plus',
        'new_customer': 'fa-user-plus',
        'awaiting_data': 'fa-file-alt',
        'awaiting_foto': 'fa-camera',
        'awaiting_payment': 'fa-credit-card',
        'progress': 'fa-spinner',
        'done': 'fa-check-circle'
    };
    return statusIcons[status] || 'fa-user-plus';
}

function getStatusOptions(customerId, currentStatus) {
    const statusOptions = [
        { value: 'new_customer', label: 'New Customer', class: 'customer-status-new' },
        { value: 'awaiting_data', label: 'Awaiting Data', class: 'customer-status-awaiting_data' },
        { value: 'awaiting_foto', label: 'Awaiting Foto', class: 'customer-status-awaiting_foto' },
        { value: 'awaiting_payment', label: 'Awaiting Payment', class: 'customer-status-awaiting_payment' },
        { value: 'progress', label: 'In Progress', class: 'customer-status-progress' },
        { value: 'done', label: 'Completed', class: 'customer-status-done' }
    ];
    
    return statusOptions.map(option => `
        <div class="customer-status-dropdown-item ${option.class}" 
             onclick="updateStatus('${customerId}', '${option.value}')">
            ${option.label}
        </div>
    `).join('');
}

function updateStats(customers) {
    const total = customers.length;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Calculate current stats
    const newToday = customers.filter(c => c.created_at && c.created_at.startsWith(today)).length;
    const inProgress = customers.filter(c => ['awaiting_data', 'awaiting_foto', 'awaiting_payment', 'progress'].includes(c.customerstatus)).length;
    const completed = customers.filter(c => c.customerstatus === 'done').length;
    
    // Calculate previous period stats
    const newYesterday = customers.filter(c => c.created_at && c.created_at.startsWith(yesterday)).length;
    const inProgressYesterday = customers.filter(c => {
        const createdDate = c.created_at ? c.created_at.split('T')[0] : '';
        return createdDate <= yesterday && ['awaiting_data', 'awaiting_foto', 'awaiting_payment', 'progress'].includes(c.customerstatus);
    }).length;
    const completedLastWeek = customers.filter(c => {
        const createdDate = c.created_at ? c.created_at.split('T')[0] : '';
        return createdDate >= lastWeek && c.customerstatus === 'done';
    }).length;
    const totalLastMonth = customers.filter(c => {
        const createdDate = c.created_at ? c.created_at.split('T')[0] : '';
        return createdDate >= lastMonth;
    }).length;
    
    // Calculate percentages
    const totalChange = totalLastMonth > 0 ? Math.round(((total - totalLastMonth) / totalLastMonth) * 100) : 0;
    const todayChange = newYesterday > 0 ? Math.round(((newToday - newYesterday) / newYesterday) * 100) : (newToday > 0 ? 100 : 0);
    const progressChange = inProgressYesterday > 0 ? Math.round(((inProgress - inProgressYesterday) / inProgressYesterday) * 100) : (inProgress > 0 ? 100 : 0);
    const completedChange = completedLastWeek > 0 ? Math.round((completed / completedLastWeek) * 100) : (completed > 0 ? 100 : 0);
    
    // Update DOM
    document.getElementById('totalCustomers').textContent = total;
    document.getElementById('newCustomers').textContent = newToday;
    document.getElementById('inProgress').textContent = inProgress;
    document.getElementById('completed').textContent = completed;
    
    // Update indicators
    updateStatIndicator('totalCustomers', totalChange, 'from last month');
    updateStatIndicator('newCustomers', todayChange, 'today');
    updateStatIndicator('inProgress', progressChange, 'from yesterday');
    updateStatIndicator('completed', completedChange, 'this week');
}

function updateStatIndicator(statId, change, period) {
    const statCard = document.getElementById(statId).closest('.stat-card');
    const changeElement = statCard.querySelector('.stat-change');
    
    if (change > 0) {
        changeElement.className = 'stat-change positive';
        changeElement.innerHTML = `<i class="fas fa-arrow-up"></i><span>+${change}% ${period}</span>`;
    } else if (change < 0) {
        changeElement.className = 'stat-change negative';
        changeElement.innerHTML = `<i class="fas fa-arrow-down"></i><span>${change}% ${period}</span>`;
    } else {
        changeElement.className = 'stat-change';
        changeElement.innerHTML = `<i class="fas fa-minus"></i><span>0% ${period}</span>`;
    }
}

function getInitials(name) {
    if (!name) return '?';
    
    const words = name.trim().split(' ');
    if (words.length === 1) {
        return words[0].charAt(0).toUpperCase();
    } else {
        return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }
}

function getAvatarColor(name) {
    if (!name) return '#2563eb'; // default blue
    
    // Simple hash function based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Use hash to generate consistent dark color
    const hue = Math.abs(hash) % 360;
    const saturation = 70 + (Math.abs(hash) % 20); // 70-90%
    const lightness = 25 + (Math.abs(hash) % 15); // 25-40% (dark)
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

async function loadCustomers() {
    try {
        showLoading(true);
        
        const response = await fetch(API_BASE);
        if (!response.ok) throw new Error('Failed to fetch customers');
        
        customers = await response.json();
        console.log('Loaded customers:', customers.length, 'Sample:', customers.slice(0, 2));
        
        // Filter customers with to_do
        customersWithTodo = customers.filter(customer => customer.to_do && customer.to_do.trim() !== '');
        
        // Always sort by date first
        customers.sort((a, b) => {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA; // Descending order (newest first)
        });
        
        // Sort to-do list by date too
        customersWithTodo.sort((a, b) => {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA; // Descending order (newest first)
        });
        
        // Then apply any other sort if needed
        if (currentSort.field && currentSort.field !== 'created_at') {
            sortBy(currentSort.field);
        } else {
            renderCustomers(customers);
            renderTodoList(customersWithTodo);
        }
        
        // Show/hide to-do list container based on whether there are tasks
        const todoContainer = document.querySelector('.todo-list-container');
        if (todoContainer) {
            todoContainer.classList.toggle('empty', customersWithTodo.length === 0);
        }
        
        updateStats(customers);
    } catch (error) {
        console.error('Error loading customers:', error);
        showAlert('Error loading customers: ' + error.message, 'danger');
    } finally {
        showLoading(false);
    }
}

function renderCustomers(customersToRender = customers) {
    const tableBody = document.getElementById('customerTableBody');
    
    if (customersToRender.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4">
                    <div class="text-muted">No customers found</div>
                </td>
            </tr>
        `;
        return;
    }
    
    tableBody.innerHTML = customersToRender.map(customer => `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-3">
                    <div class="avatar-circle" style="background: ${getAvatarColor(customer.name)};">
                        ${getInitials(customer.name)}
                    </div>
                    <div>
                        <div class="fw-medium">${customer.name}</div>
                        <div class="customer-note-container mt-1">
                            <div class="customer-note-display ${!customer.note ? 'empty' : ''}" 
                                 onclick="showNoteEditor('${customer.id}', this)" 
                                 data-customer-id="${customer.id}">
                                ${customer.note || '<i class="fas fa-plus-circle"></i> Add note'}
                            </div>
                            <div class="customer-note-editor" style="display:none;">
                                <textarea class="form-control form-control-sm note-textarea" 
                                          placeholder="Add a note..."
                                          data-customer-id="${customer.id}"
                                          onblur="saveCustomerNoteOnBlur(this)"
                                          rows="2">${customer.note || ''}</textarea>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <div class="fw-medium">
                        <a href="/chat.html?number=${customer.no_hp}" style="color: inherit; text-decoration: none; cursor: pointer;" title="Chat on WhatsApp">
                            ${customer.no_hp}
                        </a>
                    </div>
                    <div class="text-muted small">
                        <i class="fas fa-phone me-1"></i>Phone
                    </div>
                </div>
            </td>
            <td class="text-center">
                <span class="status-badge ${!customer.ai_disabled ? 'status-done' : 'status-awaiting'}" 
                      style="cursor: pointer;" 
                      onclick="toggleAIStatus('${customer.id}', ${customer.ai_disabled})" 
                      title="Click to toggle AI status">
                    <i class="fas fa-${!customer.ai_disabled ? 'robot' : 'times-circle'} me-1"></i>
                    ${!customer.ai_disabled ? 'ENABLED' : 'DISABLED'}
                </span>
            </td>
            <td class="text-center">
                <div class="position-relative" style="display: inline-block;">
                    <span class="customer-status customer-status-${customer.customerstatus || 'new_customer'}" 
                          onclick="toggleCustomerStatusDropdown(this, '${customer.id}')" 
                          title="Click to change status">
                        <i class="fas fa-${getStatusIcon(customer.customerstatus)} me-1"></i>
                        ${getStatusLabel(customer.customerstatus)}
                    </span>
                    <div class="customer-status-dropdown" id="dropdown-${customer.id}">
                        ${getStatusOptions(customer.id, customer.customerstatus)}
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <div class="fw-medium">${formatDate(customer.created_at)}</div>
                    <div class="text-muted small">
                        <i class="fas fa-calendar me-1"></i>Created
                    </div>
                </div>
            </td>
            <td>
                <div class="d-flex gap-2 flex-wrap">
                    ${chatTemplates.map(template => `
                        <button class="btn btn-sm btn-outline-success action-btn" 
                                onclick="sendDirectFollowUp('${customer.id}', '${template.id}', this)" 
                                data-customer-id="${customer.id}"
                                data-template-id="${template.id}"
                                title="${template.action}">
                            <i class="fas fa-comment-dots me-1"></i>${template.action}
                        </button>
                    `).join('')}
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomer('${customer.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function filterCustomers() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const dateFilter = document.getElementById('dateFilter').value;

    const filtered = customers.filter(customer => {
        const matchesSearch = customer.name.toLowerCase().includes(searchTerm) || 
                            customer.no_hp.includes(searchTerm);
        
        let matchesStatus = true;
        if (statusFilter) {
            if (statusFilter === 'new_customer') {
                // Filter untuk New Customer (status null, undefined, atau 'new_customer')
                matchesStatus = !customer.customerstatus || customer.customerstatus === null || customer.customerstatus === 'new_customer';
            } else {
                // Filter untuk status lainnya
                matchesStatus = customer.customerstatus === statusFilter;
            }
        }

        const matchesDate = !dateFilter || matchesDateFilter(customer.created_at, dateFilter);

        return matchesSearch && matchesStatus && matchesDate;
    });

    renderCustomers(filtered);
    updateStats(filtered); // Update stats based on filtered results
}

function handleDateFilterChange() {
    const dateFilter = document.getElementById('dateFilter').value;
    const customDateRange = document.getElementById('customDateRange');
    
    if (dateFilter === 'custom') {
        customDateRange.style.display = 'flex';
        // Set default dates (last 30 days)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        
        document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
        document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
    } else {
        customDateRange.style.display = 'none';
        filterCustomers();
    }
}

function applyCustomDateRange() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) {
        showAlert('Please select both start and end dates', 'warning');
        return;
    }
    
    if (startDate > endDate) {
        showAlert('Start date cannot be after end date', 'warning');
        return;
    }
    
    filterCustomers();
}

function matchesDateFilter(createdAt, filterType) {
    if (!createdAt) return false;
    
    const createdDate = new Date(createdAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    
    switch (filterType) {
        case 'today':
            return createdDate >= today;
        case 'yesterday':
            return createdDate >= yesterday && createdDate < today;
        case 'this_week':
            return createdDate >= thisWeekStart;
        case 'last_week':
            return createdDate >= lastWeekStart && createdDate < thisWeekStart;
        case 'this_month':
            return createdDate >= thisMonthStart;
        case 'last_month':
            return createdDate >= lastMonthStart && createdDate <= lastMonthEnd;
        case 'custom':
            const startDate = new Date(document.getElementById('startDate').value);
            const endDate = new Date(document.getElementById('endDate').value);
            endDate.setHours(23, 59, 59, 999); // Include the entire end date
            return createdDate >= startDate && createdDate <= endDate;
        default:
            return true;
    }
}

async function toggleAIStatus(customerId, currentStatus) {
    try {
        const newStatus = !currentStatus;
        
        const response = await fetch(`${API_BASE}/${customerId}/ai-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ai_disabled: newStatus })
        });

        if (!response.ok) throw new Error('Failed to update AI status');

        // Get customer name for alert
        const customer = customers.find(c => c.id === customerId);
        const customerName = customer ? customer.name : 'Customer';
        
        // Show success message
        showAlert(`AI is now ${newStatus ? 'disabled' : 'enabled'} for ${customerName}`, 'success');
        
        // Reload data
        await loadCustomers();
    } catch (error) {
        console.error('Error updating AI status:', error);
        showAlert('Error updating AI status: ' + error.message, 'danger');
    }
}

// Fungsi untuk toggle dropdown status customer
function toggleCustomerStatusDropdown(element, customerId) {
    const dropdown = document.getElementById(`dropdown-${customerId}`);
    
    // Tutup semua dropdown yang terbuka
    document.querySelectorAll('.customer-status-dropdown.show').forEach(el => {
        if (el.id !== `dropdown-${customerId}`) {
            el.classList.remove('show');
            // Reset style untuk dropdown lain
            const otherStatusElement = el.previousElementSibling;
            if (otherStatusElement) {
                otherStatusElement.style.transform = '';
                otherStatusElement.style.boxShadow = '';
            }
        }
    });
    
    // Toggle dropdown saat ini
    dropdown.classList.toggle('show');
    
    // Efek visual saat dropdown terbuka
    if (dropdown.classList.contains('show')) {
        element.style.transform = 'translateY(-2px)';
        element.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
    } else {
        element.style.transform = '';
        element.style.boxShadow = '';
    }
    
    // Tambahkan event listener untuk menutup dropdown saat klik di luar
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(event) {
            if (!element.contains(event.target) && !dropdown.contains(event.target)) {
                dropdown.classList.remove('show');
                element.style.transform = '';
                element.style.boxShadow = '';
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 0);
}

async function updateStatus(customerId, newStatus) {
    try {
        // Close any open dropdowns
        document.querySelectorAll('.customer-status-dropdown.show').forEach(dropdown => {
            dropdown.classList.remove('show');
        });

        const response = await fetch(`${API_BASE}/${customerId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ customerstatus: newStatus })
        });

        if (!response.ok) throw new Error('Failed to update status');

        // Get customer name for alert
        const customer = customers.find(c => c.id === customerId);
        const customerName = customer ? customer.name : 'Customer';
        
        // Show success message
        showAlert(`Status updated to "${getStatusLabel(newStatus)}" for ${customerName}`, 'success');
        
        // Reload data
        await loadCustomers();
    } catch (error) {
        console.error('Error updating status:', error);
        showAlert('Error updating status: ' + error.message, 'danger');
    }
}

function deleteCustomer(id) {
    const customer = customers.find(c => c.id === id);
    if (!customer) return;

    customerToDelete = customer;
    document.getElementById('deleteCustomerInfo').textContent = 
        `${customer.name} (${customer.no_hp})`;
    deleteModal.show();
}

async function confirmDelete() {
    if (!customerToDelete) return;

    try {
        showLoading(true);
        
        const response = await fetch(`${API_BASE}/${customerToDelete.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete customer');

        showAlert('Customer deleted successfully!', 'success');
        deleteModal.hide();
        loadCustomers();
    } catch (error) {
        console.error('Error deleting customer:', error);
        showAlert('Error deleting customer: ' + error.message, 'danger');
    } finally {
        showLoading(false);
        customerToDelete = null;
    }
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showLoading(show) {
    const tableContainer = document.querySelector('.table-container');
    
    if (show) {
        // Remove existing overlay if any
        const existingOverlay = tableContainer.querySelector('.loading-overlay');
        if (existingOverlay) existingOverlay.remove();
        
        // Create new overlay
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="text-center">
                <div class="spinner mb-3"></div>
                <div class="text-muted">Loading customers...</div>
            </div>
        `;
        tableContainer.style.position = 'relative';
        tableContainer.appendChild(overlay);
    } else {
        const overlay = tableContainer.querySelector('.loading-overlay');
        if (overlay) overlay.remove();
    }
}

function showAlert(message, type, duration = 5000) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-dismissible fade show position-fixed`;
    
    // Custom styling based on type
    let backgroundColor = '#059669'; // Default success color
    let textColor = '#ffffff';
    let icon = 'check-circle';
    
    switch(type) {
        case 'danger':
            backgroundColor = '#dc2626';
            icon = 'exclamation-circle';
            break;
        case 'warning':
            backgroundColor = '#d97706';
            icon = 'exclamation-triangle';
            break;
        case 'info':
            backgroundColor = '#2563eb';
            icon = 'info-circle';
            break;
    }
    
    // Make it more subtle if duration is short
    const opacity = duration <= 1500 ? '0.8' : '1';
    const minWidth = duration <= 1500 ? '200px' : '300px';
    
    alertDiv.style.cssText = `
        bottom: 20px; 
        right: 20px; 
        z-index: 9999; 
        min-width: ${minWidth};
        padding: ${duration <= 1500 ? '0.75rem 1rem' : '1rem 1.25rem'};
        background: ${backgroundColor};
        color: ${textColor};
        font-size: ${duration <= 1500 ? '14px' : '16px'};
        border-radius: 0.5rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        border: none;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        opacity: ${opacity};
    `;
    
    alertDiv.innerHTML = `
        <i class="fas fa-${icon}" style="font-size: 1.25rem;"></i>
        <span style="flex: 1;">${message}</span>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert" style="opacity: 0.75;"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    // Add slide-in animation
    alertDiv.animate([
        { transform: 'translateX(100%)', opacity: 0 },
        { transform: 'translateX(0)', opacity: opacity }
    ], {
        duration: 300,
        easing: 'ease-out'
    });
    
    // Remove with slide-out animation
    setTimeout(() => {
        const animation = alertDiv.animate([
            { transform: 'translateX(0)', opacity: opacity },
            { transform: 'translateX(100%)', opacity: 0 }
        ], {
            duration: 300,
            easing: 'ease-in'
        });
        
        animation.onfinish = () => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        };
    }, duration - 300); // Start animation slightly before duration to complete by duration
}

// Cleanup auto-refresh when page is unloaded
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
    stopNotificationStream();
});

// Notification functions
async function loadNotifications() {
    try {
        const response = await fetch(API_NOTIFICATIONS);
        if (!response.ok) throw new Error('Failed to fetch notifications');
        
        notifications = await response.json();
        updateNotificationBadge();
        renderNotifications();
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function renderNotifications() {
    const notificationList = document.getElementById('notificationList');
    
    if (notifications.length === 0) {
        notificationList.innerHTML = '<div class="p-3 text-center text-muted">No notifications</div>';
        return;
    }
    
    notificationList.innerHTML = notifications.map(notification => `
        <div class="notification-item ${!notification.read ? 'unread' : ''} notification-type-${notification.type}" 
             onclick="markAsRead(${notification.id})">
            <div class="notification-title">${notification.title}</div>
            <div class="notification-message">${notification.message}</div>
            <div class="notification-time">${formatNotificationTime(notification.timestamp)}</div>
        </div>
    `).join('');
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    const unreadCount = notifications.filter(n => !n.read).length;
    
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

function formatNotificationTime(timestamp) {
    const now = new Date();
    const notificationTime = new Date(timestamp);
    const diffMs = now - notificationTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return notificationTime.toLocaleDateString();
}

function toggleNotifications() {
    const panel = document.getElementById('notificationPanel');
    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';
    
    // Add click outside to close functionality
    if (!isVisible) {
        setTimeout(() => {
            document.addEventListener('click', closeNotificationPanel);
        }, 100);
    }
}

function closeNotificationPanel(event) {
    const panel = document.getElementById('notificationPanel');
    const button = document.querySelector('[onclick="toggleNotifications()"]');
    
    // Close if clicked outside the panel and not on the toggle button
    if (!panel.contains(event.target) && !button.contains(event.target)) {
        panel.style.display = 'none';
        document.removeEventListener('click', closeNotificationPanel);
    }
}

async function markAsRead(notificationId) {
    try {
        const response = await fetch(`${API_NOTIFICATIONS}/${notificationId}/read`, {
            method: 'PUT'
        });
        
        if (response.ok) {
            const notification = notifications.find(n => n.id === notificationId);
            if (notification) {
                notification.read = true;
                updateNotificationBadge();
                renderNotifications();
            }
        }
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
}

async function markAllAsRead() {
    try {
        const response = await fetch(`${API_NOTIFICATIONS}/read-all`, {
            method: 'PUT'
        });
        
        if (response.ok) {
            notifications.forEach(n => n.read = true);
            updateNotificationBadge();
            renderNotifications();
        }
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
    }
}

function startNotificationStream() {
    try {
        notificationEventSource = new EventSource(`${API_NOTIFICATIONS}/stream`);
        
        notificationEventSource.onopen = function() {
            console.log('Notification stream connected');
        };
        
        notificationEventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleNotificationStream(data);
            } catch (error) {
                console.error('Error parsing notification stream:', error);
            }
        };
        
        notificationEventSource.onerror = function(error) {
            console.error('Notification stream error:', error);
            
            // Try to reconnect after 5 seconds
            setTimeout(() => {
                if (notificationEventSource.readyState === EventSource.CLOSED) {
                    startNotificationStream();
                }
            }, 5000);
        };
    } catch (error) {
        console.error('Failed to setup notification stream:', error);
    }
}

function stopNotificationStream() {
    if (notificationEventSource) {
        notificationEventSource.close();
    }
}

function handleNotificationStream(data) {
    switch(data.type) {
        case 'new_notification':
            // Add new notification to the list
            notifications.unshift(data.data);
            updateNotificationBadge();
            renderNotifications();
            showNotificationToast(data.data);
            break;
            
        case 'notification_updated':
            // Update existing notification
            const updateIndex = notifications.findIndex(n => n.id === data.data.id);
            if (updateIndex !== -1) {
                notifications[updateIndex] = data.data;
                updateNotificationBadge();
                renderNotifications();
            }
            break;
            
        case 'all_notifications_read':
            // Mark all notifications as read
            notifications.forEach(n => n.read = true);
            updateNotificationBadge();
            renderNotifications();
            break;
            
        case 'connected':
            console.log('Notification stream connected:', data.message);
            break;
            
        case 'heartbeat':
            // Just keep connection alive, no action needed
            console.log('Notification heartbeat received:', data.timestamp);
            break;
    }
}

// Push Notification Functions
async function initializePushNotifications() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            // Register service worker
            const registration = await navigator.serviceWorker.register('/sw.js');

            // Check if already subscribed
            const existingSubscription = await registration.pushManager.getSubscription();
            if (existingSubscription) {
                pushSubscription = existingSubscription;
                updatePushNotificationButton(true);
            }

            // Check notification permission
            if (Notification.permission === 'default') {
                showPushNotificationPrompt();
            }
        } catch (error) {
            console.error('Error initializing push notifications:', error);
        }
    }
}

async function subscribeToPushNotifications() {
    try {
        // Check if service worker is supported
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            throw new Error('Push notifications not supported in this browser');
        }
        
        // Request notification permission first
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('Notification permission denied');
            }
        } else if (Notification.permission === 'denied') {
            throw new Error('Notification permission denied. Please enable in browser settings.');
        }
        
        // Register service worker if not already registered
        let registration;
        try {
            registration = await navigator.serviceWorker.getRegistration();
            if (!registration) {
                registration = await navigator.serviceWorker.register('/sw.js');
            } else {
                // Force update service worker
                await registration.update();
            }
        } catch (swError) {
            console.error('Service Worker registration failed:', swError);
            throw new Error('Failed to register service worker');
        }
        
        // Wait for service worker to be ready
        registration = await navigator.serviceWorker.ready;
        
        // Get VAPID public key
        const response = await fetch(`${API_PUSH}/vapid-public-key`);
        if (!response.ok) {
            throw new Error('Failed to get VAPID public key');
        }
        const { vapidPublicKey } = await response.json();

        // Convert VAPID public key to Uint8Array
        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding)
                .replace(/-/g, '+')
                .replace(/_/g, '/');

            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);

            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        }

        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

        // Check if already subscribed
        const existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription) {
            await existingSubscription.unsubscribe();
        }

        // Subscribe to push notifications
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        // Send subscription to server
        const subscribeResponse = await fetch(`${API_PUSH}/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subscription })
        });

        if (subscribeResponse.ok) {
            const result = await subscribeResponse.json();
            pushSubscription = subscription;
            updatePushNotificationButton(true);
            showAlert('Push notifications enabled! You will receive notifications even when the browser is closed.', 'success');
        } else {
            const errorText = await subscribeResponse.text();
            throw new Error('Server error: ' + errorText);
        }
    } catch (error) {
        console.error('Error subscribing to push notifications:', error);
        showAlert('Failed to enable push notifications: ' + error.message, 'danger');
    }
}

async function unsubscribeFromPushNotifications() {
    try {
        if (pushSubscription) {
            // Unsubscribe from push manager
            await pushSubscription.unsubscribe();

            // Send unsubscribe to server
            await fetch(`${API_PUSH}/unsubscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subscription: pushSubscription })
            });

            pushSubscription = null;
            updatePushNotificationButton(false);
            showAlert('Push notifications disabled', 'info');
        }
    } catch (error) {
        console.error('Error unsubscribing from push notifications:', error);
        showAlert('Failed to disable push notifications', 'danger');
    }
}

function updatePushNotificationButton(isSubscribed) {
    const button = document.getElementById('pushNotificationBtn');
    if (button) {
        if (isSubscribed) {
            button.innerHTML = '<i class="fas fa-bell"></i> Disable Push';
            button.className = 'btn btn-outline-danger btn-sm';
            button.onclick = unsubscribeFromPushNotifications;
        } else {
            button.innerHTML = '<i class="fas fa-bell-slash"></i> Enable Push';
            button.className = 'btn btn-outline-success btn-sm';
            button.onclick = subscribeToPushNotifications;
        }
    }
}

// Force update service worker
async function forceUpdateServiceWorker() {
    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
            await registration.update();
        }
    }
}

// Initialize button onclick on page load
document.addEventListener('DOMContentLoaded', function() {
    const button = document.getElementById('pushNotificationBtn');
    if (button) {
        button.onclick = subscribeToPushNotifications;
    }
    
    // Force update service worker on page load
    forceUpdateServiceWorker();
    
    // Initialize theme
    initializeTheme();
});

function showPushNotificationPrompt() {
    const modal = `
        <div class="modal fade" id="pushNotificationModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Enable Push Notifications</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Would you like to receive push notifications for new messages and updates?</p>
                        <p class="text-muted small">You'll receive notifications even when the browser is closed.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Not Now</button>
                        <button type="button" class="btn btn-primary" onclick="subscribeToPushNotifications()">Enable</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modal);
    const modalElement = new bootstrap.Modal(document.getElementById('pushNotificationModal'));
    modalElement.show();
    
    // Remove modal after it's hidden
    document.getElementById('pushNotificationModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

async function testPushNotification() {
    try {
        const response = await fetch(`${API_PUSH}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            showAlert('Test push notification sent!', 'success');
        } else {
            showAlert('Failed to send test push notification', 'danger');
        }
    } catch (error) {
        console.error('Error testing push notification:', error);
        showAlert('Error testing push notification', 'danger');
    }
}

function showNotificationToast(notification) {
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${notification.type} border-0 position-fixed`;
    toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <strong>${notification.title}</strong><br>
                ${notification.message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    // Remove toast after it's hidden
    toast.addEventListener('hidden.bs.toast', () => {
        document.body.removeChild(toast);
    });
}

// Dark Mode Toggle Function
function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark-theme');
    
    if (isDark) {
        html.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
        showAlert('Switched to Light Mode', 'info');
    } else {
        html.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
        showAlert('Switched to Dark Mode', 'info');
    }
}

// Initialize theme on page load
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark-theme');
    }
} 

// Functions for customer notes
function showNoteEditor(customerId, displayElement) {
    const container = displayElement.closest('.customer-note-container');
    const display = container.querySelector('.customer-note-display');
    const editor = container.querySelector('.customer-note-editor');
    
    // Hide display, show editor
    display.style.display = 'none';
    editor.style.display = 'block';
    
    // Focus on textarea
    const textarea = editor.querySelector('textarea');
    textarea.focus();
}

async function saveCustomerNoteOnBlur(textarea) {
    const customerId = textarea.dataset.customerId;
    const container = textarea.closest('.customer-note-container');
    const display = container.querySelector('.customer-note-display');
    const editor = container.querySelector('.customer-note-editor');
    const note = textarea.value.trim();
    
    try {
        // Send API request to update note
        const response = await fetch(`${API_BASE}/${customerId}/note`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ note })
        });
        
        if (!response.ok) throw new Error('Failed to update note');
        
        // Update local data
        const customer = customers.find(c => String(c.id) === String(customerId));
        if (customer) {
            customer.note = note;
        }
        
        // Update display
        if (!note) {
            display.innerHTML = '<i class="fas fa-plus-circle"></i> Add note';
            display.classList.add('empty');
        } else {
            display.textContent = note;
            display.classList.remove('empty');
        }
        
        // Hide editor, show display
        editor.style.display = 'none';
        display.style.display = 'block';
        
        // Show subtle notification
        showAlert('Note saved', 'success', 1000);
    } catch (error) {
        console.error('Error updating note:', error);
        showAlert('Error saving note', 'danger');
        
        // Still hide editor and show display
        editor.style.display = 'none';
        display.style.display = 'block';
    }
} 

function renderTodoList(todoCustomers = customersWithTodo) {
    const todoTableBody = document.getElementById('todoTableBody');
    
    if (todoCustomers.length === 0) {
        todoTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    <div class="text-muted">No to-do tasks found</div>
                </td>
            </tr>
        `;
        return;
    }
    
    todoTableBody.innerHTML = todoCustomers.map(customer => `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-3">
                    <div class="avatar-circle" style="background: ${getAvatarColor(customer.name)};">
                        ${getInitials(customer.name)}
                    </div>
                    <div>
                        <div class="fw-medium">${customer.name}</div>
                        <div class="customer-note-container mt-1">
                            <div class="customer-note-display ${!customer.note ? 'empty' : ''}" 
                                 onclick="showNoteEditor('${customer.id}', this)" 
                                 data-customer-id="${customer.id}">
                                ${customer.note || '<i class="fas fa-plus-circle"></i> Add note'}
                            </div>
                            <div class="customer-note-editor" style="display:none;">
                                <textarea class="form-control form-control-sm note-textarea" 
                                          placeholder="Add a note..."
                                          data-customer-id="${customer.id}"
                                          onblur="saveCustomerNoteOnBlur(this)"
                                          rows="2">${customer.note || ''}</textarea>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <div class="fw-medium">
                        <a href="whatsapp://send?phone=${customer.no_hp}" style="color: inherit; text-decoration: none; cursor: pointer;" title="Chat on WhatsApp">
                            ${customer.no_hp}
                        </a>
                    </div>
                    <div class="text-muted small">
                        <i class="fas fa-phone me-1"></i>Phone
                    </div>
                </div>
            </td>
            <td>
                <div class="todo-task-container">
                    <p class="todo-task">${customer.to_do}</p>
                    <button class="btn btn-sm btn-outline-success mt-2" onclick="completeTodoTask('${customer.id}')" title="Mark as Completed">
                        <i class="fas fa-check me-1"></i>Complete
                    </button>
                </div>
            </td>
            <td class="text-center">
                <span class="status-badge ${!customer.ai_disabled ? 'status-done' : 'status-awaiting'}" 
                      style="cursor: pointer;" 
                      onclick="toggleAIStatus('${customer.id}', ${customer.ai_disabled})" 
                      title="Click to toggle AI status">
                    <i class="fas fa-${!customer.ai_disabled ? 'robot' : 'times-circle'} me-1"></i>
                    ${!customer.ai_disabled ? 'ENABLED' : 'DISABLED'}
                </span>
            </td>
            <td class="text-center">
                <div class="position-relative" style="display: inline-block;">
                    <span class="customer-status customer-status-${customer.customerstatus || 'new_customer'}" 
                          onclick="toggleCustomerStatusDropdown(this, '${customer.id}')" 
                          title="Click to change status">
                        <i class="fas fa-${getStatusIcon(customer.customerstatus)} me-1"></i>
                        ${getStatusLabel(customer.customerstatus)}
                    </span>
                    <div class="customer-status-dropdown" id="dropdown-${customer.id}">
                        ${getStatusOptions(customer.id, customer.customerstatus)}
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <div class="fw-medium">${formatDate(customer.created_at)}</div>
                    <div class="text-muted small">
                        <i class="fas fa-calendar me-1"></i>Created
                    </div>
                </div>
            </td>
            <td>
                <div class="d-flex gap-2 flex-wrap">
                    ${chatTemplates.map(template => `
                        <button class="btn btn-sm btn-outline-success action-btn" 
                                onclick="sendDirectFollowUp('${customer.id}', '${template.id}', this)" 
                                data-customer-id="${customer.id}"
                                data-template-id="${template.id}"
                                title="${template.action}">
                            <i class="fas fa-comment-dots me-1"></i>${template.action}
                        </button>
                    `).join('')}
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomer('${customer.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
} 

// Function to complete a to-do task
async function completeTodoTask(customerId) {
    try {
        // Send API request to clear the to-do
        const response = await fetch(`${API_BASE}/${customerId}/todo`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to_do: '' })
        });
        
        if (!response.ok) throw new Error('Failed to complete task');
        
        // Update local data
        const customer = customers.find(c => String(c.id) === String(customerId));
        if (customer) {
            customer.to_do = '';
        }
        
        // Remove from to-do list
        customersWithTodo = customersWithTodo.filter(c => String(c.id) !== String(customerId));
        
        // Re-render todo list
        renderTodoList(customersWithTodo);
        
        // Show/hide to-do list container based on whether there are tasks
        const todoContainer = document.querySelector('.todo-list-container');
        if (todoContainer) {
            todoContainer.classList.toggle('empty', customersWithTodo.length === 0);
        }
        
        // Show success message
        showAlert('Task marked as completed', 'success');
    } catch (error) {
        console.error('Error completing task:', error);
        showAlert('Error completing task: ' + error.message, 'danger');
    }
} 