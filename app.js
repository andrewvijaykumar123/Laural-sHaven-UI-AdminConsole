const ADMIN_PASSWORD = 'MyLove4Jesu$';
const ASSET_VERSION = '20261027-integrated-hosts';
const API_BASE = (window.LH_API_BASE || (
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3001'
    : 'https://laurals-haven-api.onrender.com'
)).replace(/\/$/, '');
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
  sessionStorage.removeItem('lauralsHavenAdminPassword');
  sessionStorage.removeItem('lauralsHavenAdminPasswordExpiresAt');
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
  elements.deliveredOrders.textContent = String(summary.deliveredOrders || 0);

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

  const options = ['all', 'pending', 'accepted', 'ready', 'delivered'];
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
  if (state.filterStatus === 'all') return state.orders;
  return state.orders.filter((order) => (order.status || 'pending') === state.filterStatus);
}

function renderOrders(orders) {
  const visibleOrders = getVisibleOrders();

  if (!Array.isArray(visibleOrders) || !visibleOrders.length) {
    elements.ordersTable.innerHTML = '<div class="empty-state">No orders match this view.</div>';
    return;
  }

  elements.ordersTable.innerHTML = visibleOrders
    .map((order) => {
      const status = order.status || 'pending';
      const itemList = Array.isArray(order.items) ? order.items.map((item) => `${item.name} × ${item.qty}`).join(', ') : 'No items';

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
            <div class="action-group" style="margin-top: 10px;">
              ${status === 'pending' ? '<button class="accept" data-order-id="' + order.id + '" data-status="accepted">Accept</button>' : ''}
              ${status === 'accepted' ? '<button class="ready" data-order-id="' + order.id + '" data-status="ready">Ready</button>' : ''}
              ${status === 'ready' ? '<button class="deliver" data-order-id="' + order.id + '" data-status="delivered">Deliver</button>' : ''}
            </div>
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
    state.orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];

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
