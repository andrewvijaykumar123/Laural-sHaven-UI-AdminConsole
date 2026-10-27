const ADMIN_PASSWORD = 'MyLove4Jesu$';
const ASSET_VERSION = '20261027-full-menu';
const DEFAULT_API_BASE = 'https://laurals-haven-api.onrender.com';
const HOSTNAME = (window.location && window.location.hostname) || '';
const API_BASE = HOSTNAME === 'localhost' || HOSTNAME === '127.0.0.1' || HOSTNAME === '' ? 'http://localhost:3000' : DEFAULT_API_BASE;
window.LH_API_BASE = API_BASE;
const ADMIN_SESSION_TTL_MS = 90 * 60 * 1000;

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

const state = {
  summary: null,
  orders: [],
  filterStatus: 'all'
};

function normalizeOrderStatus(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'ready') return 'cooking';
  if (normalized === 'delivered') return 'completed';
  return normalized;
}

async function fetchJsonWithRetry(path, options = {}, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(apiUrl(path), {
        cache: 'no-store',
        ...options
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedError = {};
        try {
          parsedError = JSON.parse(errorText);
        } catch (error) {
          parsedError = {};
        }
        throw new Error(parsedError.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('API request failed.');
}

function getApiBase() {
  return API_BASE;
}

function apiUrl(path, baseUrl = API_BASE) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl.replace(/\/$/, '')}${normalizedPath}`;
}

function hasConfiguredBackend() {
  return true;
}

const elements = {
  totalRevenue: document.getElementById('totalRevenue'),
  totalOrders: document.getElementById('totalOrders'),
  pendingOrders: document.getElementById('pendingOrders'),
  deliveredOrders: document.getElementById('deliveredOrders'),
  ordersTable: document.getElementById('ordersTable'),
  popularItems: document.getElementById('popularItems'),
  orderStatusFilters: document.getElementById('orderStatusFilters'),
  refreshButton: document.getElementById('refreshButton'),
  adminAuth: document.getElementById('adminAuth'),
  dashboardShell: document.getElementById('dashboardShell'),
  adminLoginForm: document.getElementById('adminLoginForm'),
  adminPassword: document.getElementById('adminPassword'),
  authError: document.getElementById('authError')
};

function clearAdminSession() {
  sessionStorage.clear();
  localStorage.removeItem('lauralsHavenAdminPassword');
  localStorage.removeItem('lauralsHavenAdminPasswordExpiresAt');
}

function isAuthorized() {
  const storedPassword = sessionStorage.getItem('lauralsHavenAdminPassword');
  const expiresAt = Number(sessionStorage.getItem('lauralsHavenAdminPasswordExpiresAt') || 0);

  if (storedPassword !== ADMIN_PASSWORD) {
    clearAdminSession();
    return false;
  }

  if (!expiresAt || Date.now() > expiresAt) {
    clearAdminSession();
    return false;
  }

  return true;
}

function showAuthScreen(message = '') {
  if (elements.authError) {
    elements.authError.textContent = message;
  }
  elements.dashboardShell.classList.add('hidden-shell');
  elements.adminAuth.classList.remove('hidden-shell');
}

function unlockAdmin() {
  sessionStorage.setItem('lauralsHavenAdminPassword', ADMIN_PASSWORD);
  sessionStorage.setItem('lauralsHavenAdminPasswordExpiresAt', String(Date.now() + ADMIN_SESSION_TTL_MS));
  elements.adminAuth.classList.add('hidden-shell');
  elements.dashboardShell.classList.remove('hidden-shell');
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch (error) {
    return '—';
  }
}

function renderSummary(summary) {
  if (!summary) return;

  elements.totalRevenue.textContent = formatCurrency(summary.totalRevenue || 0);
  elements.totalOrders.textContent = String(summary.totalOrders || 0);
  elements.pendingOrders.textContent = String(summary.pendingOrders || 0);
  elements.deliveredOrders.textContent = String(summary.completedOrders ?? summary.deliveredOrders ?? 0);

  const items = Array.isArray(summary.popularItems) ? summary.popularItems : [];
  if (!items.length) {
    elements.popularItems.innerHTML = '<li class="empty-state">No sales activity yet.</li>';
    return;
  }

  elements.popularItems.innerHTML = items
    .map(
      (item, index) => `
        <li>
          <div>
            <strong>${index + 1}. ${item.name}</strong>
          </div>
          <span class="count-badge">${item.quantity}</span>
        </li>
      `
    )
    .join('');
}

function renderStatusFilters() {
  if (!elements.orderStatusFilters) return;

  const options = ['all', 'pending', 'accepted', 'rejected', 'cooking', 'completed'];
  elements.orderStatusFilters.innerHTML = options
    .map((status) => {
      const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
      const active = state.filterStatus === status ? 'active' : '';
      return `<button type="button" class="filter-pill ${active}" data-status-filter="${status}">${label}</button>`;
    })
    .join('');
}

function getVisibleOrders() {
  if (!Array.isArray(state.orders)) return [];
  const normalizedOrders = state.orders.map((order) => ({ ...order, status: normalizeOrderStatus(order.status) }));
  if (state.filterStatus === 'all') return normalizedOrders;
  return normalizedOrders.filter((order) => (order.status || 'pending') === state.filterStatus);
}

function renderOrders(orders) {
  const visibleOrders = getVisibleOrders();

  if (!Array.isArray(visibleOrders) || !visibleOrders.length) {
    elements.ordersTable.innerHTML = '<div class="empty-state">No orders match this view.</div>';
    return;
  }

  elements.ordersTable.innerHTML = visibleOrders
    .map((order) => {
      const status = normalizeOrderStatus(order.status || 'pending');
      const itemList = Array.isArray(order.items) ? order.items.map((item) => `${item.name} × ${item.qty}`).join(', ') : 'No items';
      const actionButtons = [];

      if (status === 'pending') {
        actionButtons.push('<button class="accept" data-order-id="' + order.id + '" data-status="accepted">Accept</button>');
        actionButtons.push('<button class="reject" data-order-id="' + order.id + '" data-status="rejected">Reject</button>');
      } else if (status === 'accepted') {
        actionButtons.push('<button class="ready" data-order-id="' + order.id + '" data-status="cooking">Cooking</button>');
      } else if (status === 'cooking') {
        actionButtons.push('<button class="deliver" data-order-id="' + order.id + '" data-status="completed">Completed</button>');
      }

      return `
        <div class="order-row">
          <div>
            <div class="order-name">${order.customerName || 'Guest'}</div>
            <div class="secondary-text">${order.phone || 'No phone'} • ${order.paymentMethod || 'UPI'}</div>
          </div>
          <div>
            <div class="secondary-text">Order</div>
            <div class="order-name">${order.id}</div>
          </div>
          <div>
            <div class="secondary-text">Created</div>
            <div>${formatTime(order.createdAt)}</div>
          </div>
          <div>
            <div class="secondary-text">Items</div>
            <div>${itemList.slice(0, 40)}${itemList.length > 40 ? '…' : ''}</div>
          </div>
          <div>
            <div class="secondary-text">Total</div>
            <strong>${formatCurrency(order.total || 0)}</strong>
          </div>
          <div>
            <span class="status-pill ${status}">${status}</span>
            <div class="action-group" style="margin-top: 10px;">${actionButtons.join('')}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadDashboard() {
  try {
    const [summaryData, ordersData] = await Promise.all([
      fetchJsonWithRetry('/api/admin/summary'),
      fetchJsonWithRetry('/api/orders')
    ]);

    state.summary = summaryData.summary || {};
    state.orders = Array.isArray(ordersData.orders)
      ? ordersData.orders.map((order) => ({ ...order, status: normalizeOrderStatus(order.status) }))
      : [];

    renderSummary(state.summary);
    renderStatusFilters();
    renderOrders(state.orders);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    elements.ordersTable.innerHTML = '<div class="empty-state">The admin service is temporarily unavailable. Please try again shortly.</div>';
    elements.popularItems.innerHTML = '<li class="empty-state">Live data is currently unavailable.</li>';
  }
}

async function updateStatus(orderId, status) {
  try {
    await fetchJsonWithRetry(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    await loadDashboard();
  } catch (error) {
    console.error('Failed to update order status:', error);
    elements.ordersTable.innerHTML = '<div class="empty-state">The live order API is currently unavailable. Please retry in a moment.</div>';
  }
}

document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-status-filter]');
  if (filterButton) {
    state.filterStatus = filterButton.dataset.statusFilter || 'all';
    renderStatusFilters();
    renderOrders(state.orders);
    return;
  }

  const actionButton = event.target.closest('[data-order-id]');
  if (!actionButton) return;

  const { orderId, status } = actionButton.dataset;
  if (orderId && status) {
    updateStatus(orderId, status);
  }
});

function initializeAdminSession() {
  if (isAuthorized()) {
    unlockAdmin();
    loadDashboard();
    return;
  }

  clearAdminSession();
  showAuthScreen('Session expired. Please sign in again.');
}

if (elements.adminLoginForm) {
  elements.adminLoginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = elements.adminPassword.value.trim();

    if (password === ADMIN_PASSWORD) {
      unlockAdmin();
      loadDashboard();
      return;
    }

    showAuthScreen('Incorrect password. Please try again.');
    elements.adminPassword.value = '';
  });
}

initializeAdminSession();

if (elements.refreshButton) {
  elements.refreshButton.addEventListener('click', loadDashboard);
}
