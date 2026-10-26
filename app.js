const ADMIN_PASSWORD = 'MyLove4Jesu$';
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

const state = {
  summary: null,
  orders: []
};

function getApiBase() {
  const configuredBase = (window.LH_API_BASE || '').trim().replace(/\/$/, '');
  return configuredBase || window.location.origin;
}

function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${normalizedPath}`;
}

const elements = {
  totalRevenue: document.getElementById('totalRevenue'),
  totalOrders: document.getElementById('totalOrders'),
  pendingOrders: document.getElementById('pendingOrders'),
  deliveredOrders: document.getElementById('deliveredOrders'),
  ordersTable: document.getElementById('ordersTable'),
  popularItems: document.getElementById('popularItems'),
  refreshButton: document.getElementById('refreshButton'),
  adminAuth: document.getElementById('adminAuth'),
  dashboardShell: document.getElementById('dashboardShell'),
  adminLoginForm: document.getElementById('adminLoginForm'),
  adminPassword: document.getElementById('adminPassword'),
  authError: document.getElementById('authError')
};

function isAuthorized() {
  return sessionStorage.getItem('lauralsHavenAdminPassword') === ADMIN_PASSWORD;
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

function renderOrders(orders) {
  if (!Array.isArray(orders) || !orders.length) {
    elements.ordersTable.innerHTML = '<div class="empty-state">No orders have been placed yet.</div>';
    return;
  }

  elements.ordersTable.innerHTML = orders
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
    const [summaryResponse, ordersResponse] = await Promise.all([
      fetch(apiUrl('/api/admin/summary'), { cache: 'no-store' }),
      fetch(apiUrl('/api/orders'), { cache: 'no-store' })
    ]);

    const summaryData = await summaryResponse.json();
    const ordersData = await ordersResponse.json();

    state.summary = summaryData.summary || {};
    state.orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];

    renderSummary(state.summary);
    renderOrders(state.orders);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    elements.ordersTable.innerHTML = '<div class="empty-state">The admin service is temporarily unavailable.</div>';
  }
}

async function updateStatus(orderId, status) {
  try {
    const response = await fetch(apiUrl(`/api/orders/${orderId}/status`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to update order status.');
    }

    await loadDashboard();
  } catch (error) {
    console.error(error);
    alert(error.message || 'Unable to update order status.');
  }
}

document.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-order-id]');
  if (!actionButton) return;

  const { orderId, status } = actionButton.dataset;
  if (orderId && status) {
    updateStatus(orderId, status);
  }
});

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

if (elements.refreshButton) {
  elements.refreshButton.addEventListener('click', loadDashboard);
}

if (!isAuthorized()) {
  showAuthScreen();
} else {
  unlockAdmin();
  loadDashboard();
}
