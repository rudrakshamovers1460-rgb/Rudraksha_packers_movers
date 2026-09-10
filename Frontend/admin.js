const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_API_URL = 'https://rudraksha-packers-movers.onrender.com/api';
const API_BASE = isLocalhost ? 'http://localhost:3000/api' : (localStorage.getItem('rudraksha_backend_api_url') || PRODUCTION_API_URL);
const AUTH_TOKEN_KEY = 'rudraksha_admin_auth_token';

let adminBookings = [];
let adminDrivers = [];
let adminCoupons = [];
let adminRates = {};
let adminVehicles = {};
let adminCompany = {};

// Phase 2: Auto-refresh tracking
let _adminLastParcelCount = 0;
let _adminAutoRefreshTimer = null;
let _adminLastRefreshTime = null;

document.addEventListener('DOMContentLoaded', async () => {
  await checkAdminAuth();
  loadRiderApplications();
  renderDashboardRiderApps();
  // Start auto-refresh of parcel panel & rider applications every 15 seconds
  _adminAutoRefreshTimer = setInterval(autoRefreshParcelPanel, 15000);
});

// Auto-refresh only the parcel panel silently
async function autoRefreshParcelPanel() {
  try {
    await loadAdminParcels();
    updateDashboardMetrics();
    renderDashboardRiderApps();
    _adminLastRefreshTime = new Date();
    updateAdminRefreshBadge();
  } catch {}
}

function updateAdminRefreshBadge() {
  // Update notification count badge on parcel tab
  const newCount = allAdminParcels.filter(p => {
    const st = p.booking_status || p.status || '';
    return st === 'searching_driver' || st === 'received';
  }).length;

  const badge = document.getElementById('parcelNewBadge');
  const badgeCount = document.getElementById('parcelNewBadgeCount');
  if (badge) {
    if (newCount > 0) {
      if (badgeCount) badgeCount.textContent = newCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Flash notification if NEW orders came in since last check
  if (newCount > _adminLastParcelCount && _adminLastParcelCount > 0) {
    showAdminToast(`🔔 ${newCount - _adminLastParcelCount} new parcel order(s) received!`, 'new-order');
  }
  _adminLastParcelCount = newCount;

  // Update last-refresh time indicator
  const refreshEl = document.getElementById('adminLastRefreshTime');
  if (refreshEl && _adminLastRefreshTime) {
    const diff = Math.round((Date.now() - _adminLastRefreshTime.getTime()) / 1000);
    refreshEl.textContent = diff < 5 ? 'Just now' : `${diff}s ago`;
  }
}

function showAdminToast(msg, type = 'info') {
  // Admin toast notification
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    container.style.cssText = 'position:fixed;top:70px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const colors = { 'new-order': '#f97316', info: '#38bdf8', success: '#22c55e', error: '#ef4444' };
  const toast = document.createElement('div');
  toast.style.cssText = `background:#1c1d26;border:1px solid ${colors[type] || colors.info}44;border-left:3px solid ${colors[type] || colors.info};border-radius:10px;padding:12px 16px;font-size:0.82rem;font-weight:600;color:#f1f5f9;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:toastSlideIn 0.3s ease;max-width:320px;`;
  toast.textContent = msg;
  container.appendChild(toast);
  if (!document.getElementById('adminToastStyle')) {
    const s = document.createElement('style');
    s.id = 'adminToastStyle';
    s.textContent = '@keyframes toastSlideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
    document.head.appendChild(s);
  }
  setTimeout(() => { toast.style.transition = 'all 0.3s'; toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; setTimeout(() => toast.remove(), 300); }, 4000);
}

/* ==========================================================================
   1. ADMIN AUTHENTICATION CONTROLLER
   ========================================================================== */
function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token, remember = true) {
  if (remember) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } else {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function getAuthHeaders() {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function checkAdminAuth() {
  const token = getAuthToken();
  const overlay = document.getElementById('adminLoginOverlay');

  if (!token) {
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
    }
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/verify`, {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      if (overlay) overlay.style.display = 'none';
      await refreshAdminAll();
      return true;
    } else {
      clearAuthToken();
      if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
      }
      return false;
    }
  } catch (err) {
    // Offline local session fallback - only if token was generated by local master key
    if (token && token.startsWith('local_admin_session_')) {
      if (overlay) overlay.style.display = 'none';
      await refreshAdminAll();
      return true;
    }
    clearAuthToken();
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
    }
    return false;
  }
}

async function submitAdminLogin() {
  const usernameInput = document.getElementById('adminUsernameInput');
  const passwordInput = document.getElementById('adminPasswordInput');
  const rememberCheck = document.getElementById('rememberAdminCheck');
  const errorAlert = document.getElementById('loginErrorAlert');
  const errorMsg = document.getElementById('loginErrorMsg');
  const btnSubmit = document.getElementById('btnLoginSubmit');

  const username = usernameInput?.value.trim() || 'admin';
  const password = passwordInput?.value.trim() || '';

  if (!password) {
    if (errorAlert) {
      errorAlert.classList.remove('d-none');
      errorMsg.innerText = 'Please enter security key.';
    }
    return;
  }

  if (errorAlert) errorAlert.classList.add('d-none');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Authenticating...';
  }

  try {
    let token = null;
    let authSuccess = false;

    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        token = data.token;
        authSuccess = true;
      } else {
        throw new Error(data.error || 'Invalid credentials');
      }
    } catch (apiErr) {
      throw new Error('Admin service is unavailable. Start the backend and try again.');
    }

    if (authSuccess && token) {
      setAuthToken(token, rememberCheck?.checked);
      const overlay = document.getElementById('adminLoginOverlay');
      if (overlay) overlay.style.display = 'none';
      showAdminToast('Dashboard unlocked! Welcome to Rudraksha Command Center.', 'success');
      await refreshAdminAll();
    }
  } catch (err) {
    if (errorAlert) {
      errorAlert.classList.remove('d-none');
      errorMsg.innerText = err.message || 'Incorrect password.';
    }
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-bolt me-1"></i> Unlock Dashboard';
    }
  }
}

function toggleAdminPassVisibility() {
  const passInput = document.getElementById('adminPasswordInput');
  const icon = document.getElementById('passToggleIcon');
  if (!passInput || !icon) return;

  if (passInput.type === 'password') {
    passInput.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    passInput.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

function logoutAdmin(skipConfirm = false) {
  if (!skipConfirm && typeof confirm === 'function') {
    if (!confirm('Lock and sign out of the Admin Command Center?')) return;
  }

  clearAuthToken();
  const overlay = document.getElementById('adminLoginOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    const passInput = document.getElementById('adminPasswordInput');
    if (passInput) passInput.value = '';
    const errAlert = document.getElementById('loginErrorAlert');
    if (errAlert) errAlert.classList.add('d-none');
  }
  showAdminToast('Dashboard locked. Please enter password to unlock.', 'info');
}

/* ==========================================================================
   2. DYNAMIC TAB NAVIGATION & SEARCH
   ========================================================================== */
function switchAdminTab(tabName) {
  const tabs = ['dashboard', 'bookings', 'fleet', 'rates', 'coupons', 'theme', 'parcels', 'riders'];

  tabs.forEach((t) => {
    const dockBtn = document.getElementById(`dock-${t}`);
    const panel = document.getElementById(`tab-${t}`);

    if (t === tabName) {
      if (dockBtn) dockBtn.classList.add('active');
      if (panel) {
        panel.classList.add('active');
        // Trigger re-animation
        panel.style.animation = 'none';
        panel.offsetHeight; // Trigger reflow
        panel.style.animation = null;
      }
    } else {
      if (dockBtn) dockBtn.classList.remove('active');
      if (panel) panel.classList.remove('active');
    }
  });

  // Re-trigger bar charts & counters on dashboard tab
  if (tabName === 'dashboard') {
    triggerDashboardAnimations();
    renderDashboardRiderApps();
  } else if (tabName === 'parcels') {
    loadAdminParcels();
  } else if (tabName === 'riders') {
    renderRiderApplicationsTable();
  }

  // Scroll to top on tab switch
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleGlobalSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    renderBookingsTable();
    renderDriversTable();
    renderVehiclesTable();
    return;
  }

  // Filter Bookings
  const filteredBookings = adminBookings.filter(b => 
    (b.id && b.id.toLowerCase().includes(q)) ||
    (b.customer_name && b.customer_name.toLowerCase().includes(q)) ||
    (b.customer_phone && b.customer_phone.includes(q)) ||
    (b.pickup_address && b.pickup_address.toLowerCase().includes(q)) ||
    (b.drop_address && b.drop_address.toLowerCase().includes(q)) ||
    (b.selected_vehicle && b.selected_vehicle.toLowerCase().includes(q))
  );
  renderBookingsTable(filteredBookings);

  // If search matches tab keywords, auto-switch
  if (['fleet', 'vehicle', 'truck', 'driver'].includes(q)) switchAdminTab('fleet');
  else if (['rate', 'price', 'tariff', 'floor'].includes(q)) switchAdminTab('rates');
  else if (['coupon', 'promo', 'discount'].includes(q)) switchAdminTab('coupons');
  else if (['theme', 'color', 'brand', 'contact'].includes(q)) switchAdminTab('theme'); else if (['parcel', 'parcels', 'package', 'consignment'].includes(q)) switchAdminTab('parcels');
}

/* ==========================================================================
   3. ANIMATED NUMBER COUNTERS & MOTION ENGINE
   ========================================================================== */
function animateCountUp(elementId, targetValue, duration = 1400, prefix = '', suffix = '') {
  const el = document.getElementById(elementId);
  if (!el) return;

  const start = 0;
  const startTime = performance.now();

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const current = Math.round(start + (targetValue - start) * eased);

    el.innerText = `${prefix}${current.toLocaleString('en-IN')}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.innerText = `${prefix}${targetValue.toLocaleString('en-IN')}${suffix}`;
    }
  }

  requestAnimationFrame(update);
}

function triggerDashboardAnimations() {
  // Speedometer fill animation
  const speedo = document.getElementById('speedoTrackFill');
  if (speedo) {
    speedo.style.width = '0%';
    setTimeout(() => { speedo.style.width = '68%'; }, 150);
  }

  // Bar chart capsules grow animation
  document.querySelectorAll('.cyber-bar-capsule').forEach(bar => {
    const origHeight = bar.style.height || '50%';
    bar.style.height = '0%';
    setTimeout(() => { bar.style.height = origHeight; }, 200);
  });
}

/* ==========================================================================
   4. DATA LOADERS & REAL-TIME SYNC
   ========================================================================== */
async function checkBackendHealth() {
  const statusText = document.getElementById('backendStatusText');
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      if (statusText) statusText.innerText = data.supabaseActive ? 'Supabase Active 🟢' : 'Local DB Active 🟡';
    }
  } catch (err) {
    if (statusText) statusText.innerText = 'Offline Mode 🔴';
  }
}

async function loadBookingsFromBackend() {
  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      adminBookings = data.bookings || [];
    }
  } catch (err) {
    const saved = localStorage.getItem('rudraksha_bookings_history');
    adminBookings = saved ? JSON.parse(saved) : [];
  }

  renderBookingsTable();
  updateDashboardMetrics();
}

function renderBookingsTable(list = adminBookings) {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fa-solid fa-inbox me-2"></i>No bookings found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((b) => {
    const bId = b.id || 'RB-XXXX';
    const cName = b.customer_name || b.name || 'Customer';
    const cPhone = b.customer_phone || b.phone || '-';
    const pickup = b.pickup_address || b.pickup || '-';
    const drop = b.drop_address || b.drop || '-';
    const date = b.shifting_date || b.date || '-';
    const dist = b.distance_km || b.distanceKm || 25;
    const amount = b.total_amount ? `₹${Number(b.total_amount).toLocaleString('en-IN')}` : (b.total || '₹0');
    const status = (b.status || 'received').toLowerCase();

    const driverName = b.assigned_driver_name ? `👨‍✈️ ${b.assigned_driver_name} (${b.assigned_vehicle_no})` : `<span class="cyber-badge-pill" style="color: #8E8E93;">Unassigned</span>`;

    return `
      <tr class="cyber-booking-row">
        <td class="cell-ref">
          <div class="d-flex justify-content-between align-items-center w-100">
            <strong style="color: #D0FD38; font-size: 0.95rem;">${bId}</strong>
            <span class="d-md-none fw-bold fs-6 text-white">${amount}</span>
          </div>
        </td>
        <td class="cell-customer">
          <div>
            <div class="fw-bold text-white">${cName}</div>
            <div class="small text-muted"><a href="tel:${cPhone}" class="text-decoration-none" style="color: #8E8E93;"><i class="fa-solid fa-phone me-1 text-success"></i>+91 ${cPhone}</a></div>
          </div>
        </td>
        <td class="cell-route">
          <div>
            <div class="small fw-semibold text-white text-break"><i class="fa-solid fa-location-dot me-1 text-warning"></i>${pickup} ➔ ${drop}</div>
            <div class="small text-muted mt-1"><i class="fa-solid fa-calendar me-1"></i>${date} • ${dist} KM</div>
            <div class="small fw-semibold mt-1" style="color: #D0FD38;"><i class="fa-solid fa-truck-pickup me-1"></i>${b.selected_vehicle || 'Tata Ace'}</div>
          </div>
        </td>
        <td class="cell-amount d-none d-md-table-cell">
          <strong class="text-white fs-6">${amount}</strong>
        </td>
        <td class="cell-status">
          <select class="cyber-select py-1 px-2 fw-bold" onchange="handleStatusChange('${bId}', this.value)" style="width: 100%; max-width: 150px; font-size: 0.78rem;">
            <option value="received" ${status === 'received' ? 'selected' : ''}>📥 Received</option>
            <option value="reviewing" ${status === 'reviewing' ? 'selected' : ''}>🔍 Reviewing</option>
            <option value="confirmed" ${status === 'confirmed' ? 'selected' : ''}>✅ Confirmed</option>
            <option value="driver_assigned" ${status === 'driver_assigned' ? 'selected' : ''}>🚚 Assigned</option>
            <option value="in_transit" ${status === 'in_transit' ? 'selected' : ''}>🛣️ In Transit</option>
            <option value="delivered" ${status === 'delivered' ? 'selected' : ''}>🏁 Delivered</option>
            <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </td>
        <td class="cell-driver">
          <div class="small">${driverName}</div>
        </td>
        <td class="cell-actions">
          <div class="d-flex gap-2">
            <button class="btn-cyber-outline py-1 px-3" title="Assign Driver" onclick="openAssignDriverModal('${bId}')">
              <i class="fa-solid fa-user-plus me-1"></i> <span class="d-md-none">Assign</span>
            </button>
            <a href="https://wa.me/91${cPhone}?text=Hello%20${encodeURIComponent(cName)},%20regarding%20your%20Rudraksha%20Packers%20booking%20${bId}" target="_blank" class="btn-cyber-outline py-1 px-3 text-success" title="WhatsApp Chat">
              <i class="fa-brands fa-whatsapp me-1"></i> <span class="d-md-none">Chat</span>
            </a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleStatusChange(bookingId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error('Status update failed');
    showAdminToast(`Booking ${bookingId} marked as ${newStatus.toUpperCase()}`);
    await loadBookingsFromBackend();
  } catch (err) {
    alert(`Could not update status: ${err.message}`);
  }
}

/* ==========================================================================
   5. FLEET & DEDICATED VEHICLES
   ========================================================================== */
async function loadFleetVehicles() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      const config = await res.json();
      adminVehicles = config.vehicles || {};
    }
  } catch {
    const saved = localStorage.getItem('rudraksha_fleet_config');
    if (saved) adminVehicles = JSON.parse(saved);
    else {
      adminVehicles = {
        'mini_truck': { name: 'Tata Ace / Mini (1.5 Ton)', basePrice: 2500, perKmRate: 35, icon: 'fa-truck-pickup', cap: 'Up to 1 BHK / Studio' },
        'tempo_14ft': { name: '14ft Tempo / Eicher (3.5 Ton)', basePrice: 3500, perKmRate: 45, icon: 'fa-truck', cap: 'Ideal for 1-2 BHK' },
        'truck_19ft': { name: '19ft Container Truck (7 Ton)', basePrice: 5500, perKmRate: 65, icon: 'fa-truck-moving', cap: '3+ BHK / Large Moving' },
        'bike': { name: 'Bike Transport Carrier', basePrice: 1500, perKmRate: 15, icon: 'fa-motorcycle', cap: 'Two-Wheeler Carrier' },
        'car': { name: 'Closed Car Carrier', basePrice: 4500, perKmRate: 35, icon: 'fa-car-side', cap: 'Hydraulic Car Carrier' }
      };
    }
  }

  localStorage.setItem('rudraksha_fleet_config', JSON.stringify(adminVehicles));
  renderVehiclesTable();
  populateDriverVehicleSelect();
}

function renderVehiclesTable(list = adminVehicles) {
  const tbody = document.getElementById('vehiclesTableBody');
  if (!tbody) return;

  const keys = Object.keys(list);
  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-muted">No vehicles configured. Add one using the form.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys.map((key) => {
    const v = list[key];
    return `
      <tr>
        <td class="cell-icon">
          <div class="d-flex align-items-center gap-2">
            <i class="fa-solid ${v.icon || 'fa-truck'} fa-lg" style="color: #D0FD38;"></i>
            <span class="d-md-none fw-bold text-white">${v.name}</span>
          </div>
        </td>
        <td class="cell-name d-none d-md-table-cell">
          <div class="fw-bold text-white">${v.name}</div>
          <div class="small text-muted"><code>${key}</code></div>
        </td>
        <td class="cell-base">
          <div class="d-flex justify-content-between w-100"><span class="d-md-none text-muted small">Base Price:</span> <strong class="text-white">₹${Number(v.basePrice || 0).toLocaleString('en-IN')}</strong></div>
        </td>
        <td class="cell-rate">
          <div class="d-flex justify-content-between w-100"><span class="d-md-none text-muted small">Per KM:</span> <strong style="color: #D0FD38;">₹${v.perKmRate || 0} / KM</strong></div>
        </td>
        <td class="cell-cap">
          <div class="d-flex justify-content-between w-100"><span class="d-md-none text-muted small">Capacity:</span> <span class="cyber-badge-pill">${v.cap || 'Standard'}</span></div>
        </td>
        <td class="cell-actions">
          <div class="d-flex gap-2">
            <button class="btn-cyber-outline py-1 px-3" title="Edit Vehicle" onclick="editVehicle('${key}')">
              <i class="fa-solid fa-pen-to-square me-1"></i> <span class="d-md-none">Edit</span>
            </button>
            <button class="btn-cyber-outline py-1 px-3 text-danger" title="Delete Vehicle" onclick="deleteVehicle('${key}')">
              <i class="fa-solid fa-trash me-1"></i> <span class="d-md-none">Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function editVehicle(key) {
  const v = adminVehicles[key];
  if (!v) return;
  document.getElementById('vehKey').value = key;
  document.getElementById('vehName').value = v.name;
  document.getElementById('vehBasePrice').value = v.basePrice;
  document.getElementById('vehPerKm').value = v.perKmRate;
  document.getElementById('vehCap').value = v.cap || '';
  document.getElementById('vehIcon').value = v.icon || 'fa-truck';
  document.getElementById('vehName').focus();
}

async function handleSaveVehicle() {
  const key = document.getElementById('vehKey').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const name = document.getElementById('vehName').value.trim();
  const basePrice = parseFloat(document.getElementById('vehBasePrice').value) || 2500;
  const perKmRate = parseFloat(document.getElementById('vehPerKm').value) || 35;
  const cap = document.getElementById('vehCap').value.trim() || 'Custom';
  const icon = document.getElementById('vehIcon').value.trim() || 'fa-truck';

  if (!key || !name) {
    alert('Please enter vehicle key and name.');
    return;
  }

  const payload = { vehicle_key: key, name, basePrice, perKmRate, cap, icon };

  try {
    const res = await fetch(`${API_BASE}/admin/vehicles`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.config && data.config.vehicles) adminVehicles = data.config.vehicles;
      else adminVehicles[key] = { name, basePrice, perKmRate, cap, icon };
    } else {
      adminVehicles[key] = { name, basePrice, perKmRate, cap, icon };
    }
  } catch {
    adminVehicles[key] = { name, basePrice, perKmRate, cap, icon };
  }

  localStorage.setItem('rudraksha_fleet_config', JSON.stringify(adminVehicles));
  showAdminToast(`Vehicle model "${name}" added to Client Calculator!`);
  document.getElementById('vehicleConfigForm').reset();
  renderVehiclesTable();
  populateDriverVehicleSelect();
}

async function deleteVehicle(key) {
  if (!confirm(`Delete vehicle "${adminVehicles[key]?.name || key}" from calculator?`)) return;

  try {
    await fetch(`${API_BASE}/admin/vehicles/${key}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  } catch {}

  delete adminVehicles[key];
  localStorage.setItem('rudraksha_fleet_config', JSON.stringify(adminVehicles));
  showAdminToast('Vehicle deleted successfully.');
  renderVehiclesTable();
  populateDriverVehicleSelect();
}

function populateDriverVehicleSelect() {
  const select = document.getElementById('drvVehicleType');
  if (!select) return;

  const keys = Object.keys(adminVehicles);
  if (keys.length === 0) {
    select.innerHTML = `<option value="Tata Ace">Tata Ace (1.5 Ton)</option>`;
    return;
  }

  select.innerHTML = keys.map(k => `
    <option value="${adminVehicles[k].name}">${adminVehicles[k].name}</option>
  `).join('');
}

/* ==========================================================================
   6. DRIVERS ROSTER
   ========================================================================== */
async function loadDriversFromBackend() {
  try {
    const res = await fetch(`${API_BASE}/drivers`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      adminDrivers = data.drivers || [];
    }
  } catch {
    adminDrivers = [
      { id: 'drv-101', driver_name: 'Mukesh Sharma', phone: '9876543210', vehicle_number: 'RJ-14-GA-1024', vehicle_type: 'Tata Ace (1.5 Ton)', status: 'available', rating: 4.9 },
      { id: 'drv-102', driver_name: 'Vikram Singh', phone: '9829012345', vehicle_number: 'RJ-14-GB-5521', vehicle_type: 'Eicher 14ft (3.5 Ton)', status: 'available', rating: 4.8 },
      { id: 'drv-103', driver_name: 'Ramesh Meena', phone: '9414098765', vehicle_number: 'RJ-14-GC-8840', vehicle_type: '19ft Container (7 Ton)', status: 'available', rating: 4.7 }
    ];
  }

  renderDriversTable();
}

function renderDriversTable() {
  const tbody = document.getElementById('driversTableBody');
  if (!tbody) return;

  tbody.innerHTML = adminDrivers.map((d) => `
    <tr>
      <td>
        <div class="d-flex justify-content-between align-items-center w-100">
          <div>
            <div class="fw-bold text-white">${d.driver_name}</div>
            <div class="small text-muted">ID: ${d.id}</div>
          </div>
          <span style="color: #D0FD38; font-weight: bold;">⭐ ${d.rating || 4.8}</span>
        </div>
      </td>
      <td>
        <div class="d-flex justify-content-between w-100 align-items-center">
          <span class="d-md-none text-muted small">Phone:</span>
          <a href="tel:${d.phone}" class="text-decoration-none" style="color: #8E8E93;"><i class="fa-solid fa-phone text-success me-1"></i>+91 ${d.phone}</a>
        </div>
      </td>
      <td>
        <div class="d-flex justify-content-between w-100 align-items-center">
          <span class="d-md-none text-muted small">Vehicle:</span>
          <div>
            <span class="cyber-badge-pill" style="color: #ffffff;">${d.vehicle_number}</span>
            <span class="small text-muted ms-1">${d.vehicle_type}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="d-flex justify-content-between w-100 align-items-center">
          <span class="d-md-none text-muted small">Status:</span>
          <span class="cyber-badge-pill ${d.status === 'available' ? 'active-glow' : ''}">
            <span class="dot"></span> ${(d.status || 'available').toUpperCase()}
          </span>
        </div>
      </td>
      <td class="d-none d-md-table-cell">
        <span style="color: #D0FD38; font-weight: bold;">⭐ ${d.rating || 4.8}</span>
      </td>
    </tr>
  `).join('');
}

async function handleAddDriver() {
  const name = document.getElementById('drvName').value.trim();
  const phone = document.getElementById('drvPhone').value.trim();
  const vehicleNo = document.getElementById('drvVehicleNo').value.trim().toUpperCase();
  const vehicleType = document.getElementById('drvVehicleType').value;

  try {
    const res = await fetch(`${API_BASE}/drivers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ driver_name: name, phone, vehicle_number: vehicleNo, vehicle_type: vehicleType })
    });

    if (!res.ok) throw new Error('Registration error');
    showAdminToast(`Driver "${name}" enrolled into fleet!`);
    document.getElementById('driverForm').reset();
    await loadDriversFromBackend();
  } catch (err) {
    alert(err.message);
  }
}

function openAssignDriverModal(bookingId) {
  const booking = adminBookings.find(b => b.id === bookingId);
  if (!booking) return;

  document.getElementById('assignBookingId').value = booking.id;
  document.getElementById('assignBookingDisplayId').innerText = booking.id;
  document.getElementById('assignBookingCustName').innerText = `${booking.customer_name || booking.name} (+91 ${booking.customer_phone || booking.phone})`;

  const select = document.getElementById('assignDriverSelect');
  select.innerHTML = adminDrivers.map(d => `
    <option value="${d.id}" data-name="${d.driver_name}" data-phone="${d.phone}" data-veh="${d.vehicle_number}">
      ${d.driver_name} - ${d.vehicle_number} (${d.vehicle_type})
    </option>
  `).join('');

  document.getElementById('assignStatusMsg').innerHTML = '';
  const modal = new bootstrap.Modal(document.getElementById('assignDriverModal'));
  modal.show();
}

async function submitDriverAssignment() {
  const bookingId = document.getElementById('assignBookingId').value;
  const select = document.getElementById('assignDriverSelect');
  const selectedOpt = select.options[select.selectedIndex];

  if (!selectedOpt) return;

  const driver_id = selectedOpt.value;
  const driver_name = selectedOpt.getAttribute('data-name');
  const driver_phone = selectedOpt.getAttribute('data-phone');
  const vehicle_number = selectedOpt.getAttribute('data-veh');

  const statusMsg = document.getElementById('assignStatusMsg');
  statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Assigning driver...';

  try {
    const res = await fetch(`${API_BASE}/bookings/${bookingId}/assign`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ driver_id, driver_name, driver_phone, vehicle_number })
    });

    if (!res.ok) throw new Error('Assignment failed');

    const booking = adminBookings.find(b => b.id === bookingId);
    const pickupEnc = encodeURIComponent(booking?.pickup_address || 'Jaipur');
    const mapsNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${pickupEnc}`;
    const cleanDrvPhone = String(driver_phone || '').replace(/\D/g, '');

    const driverMsg = `🚨 *NEW TRIP DISPATCH ORDER* 🚚\n*Rudraksha Packers & Movers*\n\n` +
      `📋 *Booking ID:* ${bookingId}\n` +
      `👤 *Customer:* ${booking?.customer_name || 'Customer'} (+91 ${booking?.customer_phone || ''})\n` +
      `📍 *Pickup:* ${booking?.pickup_address || ''}\n` +
      `🏁 *Drop:* ${booking?.drop_address || ''}\n` +
      `📅 *Date:* ${booking?.shifting_date || 'Today'}\n` +
      `🚛 *Vehicle:* ${vehicle_number}\n\n` +
      `🗺️ *Google Maps Navigation to Pickup:*\n${mapsNavUrl}\n\n` +
      `_Please contact customer 1 hour prior to arrival._`;

    const waDriverUrl = `https://wa.me/91${cleanDrvPhone}?text=${encodeURIComponent(driverMsg)}`;

    statusMsg.innerHTML = `
      <div class="alert alert-success border-0 py-2 small mb-2" style="background: rgba(34, 197, 94, 0.15); color: #86efac;">
        <i class="fa-solid fa-circle-check me-1"></i> Driver <strong>${driver_name}</strong> Assigned!
      </div>
      <a href="${waDriverUrl}" target="_blank" class="btn btn-success w-100 py-2 fw-bold shadow-sm mb-2">
        <i class="fa-brands fa-whatsapp me-1"></i> Send Dispatch Slip to Driver on WhatsApp
      </a>
      <button type="button" class="btn btn-outline-secondary w-100 py-1 small" data-bs-dismiss="modal">
        Done & Close
      </button>
    `;

    loadBookingsFromBackend();
  } catch (err) {
    statusMsg.innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

/* ==========================================================================
   7. RATES & TARIFF CONTROLLER
   ========================================================================== */
async function loadAdminRates() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      const config = await res.json();
      if (config.rates) adminRates = config.rates;
    }
  } catch {
    const saved = localStorage.getItem('rudraksha_rates_config');
    if (saved) adminRates = JSON.parse(saved);
  }

  // Populate form inputs
  if (document.getElementById('rateBase')) document.getElementById('rateBase').value = adminRates.baseRate || 2500;
  if (document.getElementById('ratePerKm')) document.getElementById('ratePerKm').value = adminRates.perKmRate || 40;
  if (document.getElementById('rateFloorNoLift')) document.getElementById('rateFloorNoLift').value = adminRates.floorNoLiftRate || 300;

  const hs = adminRates.houseSizeRates || {};
  if (document.getElementById('rateHouse1rk')) document.getElementById('rateHouse1rk').value = hs['1rk'] ?? 0;
  if (document.getElementById('rateHouse1bhk')) document.getElementById('rateHouse1bhk').value = hs['1bhk'] ?? 1000;
  if (document.getElementById('rateHouse2bhk')) document.getElementById('rateHouse2bhk').value = hs['2bhk'] ?? 2500;
  if (document.getElementById('rateHouse3bhk')) document.getElementById('rateHouse3bhk').value = hs['3bhk'] ?? 4500;
  if (document.getElementById('rateHouseVilla')) document.getElementById('rateHouseVilla').value = hs['villa'] ?? 7500;

  const items = adminRates.itemRates || {};
  if (document.getElementById('rateItemSofa')) document.getElementById('rateItemSofa').value = items.sofa ?? 500;
  if (document.getElementById('rateItemBed')) document.getElementById('rateItemBed').value = items.bed ?? 600;
  if (document.getElementById('rateItemDining')) document.getElementById('rateItemDining').value = items.dining ?? 400;
  if (document.getElementById('rateItemFridge')) document.getElementById('rateItemFridge').value = items.fridge ?? 400;
  if (document.getElementById('rateItemWashing')) document.getElementById('rateItemWashing').value = items.washing ?? 350;
  if (document.getElementById('rateItemBoxes')) document.getElementById('rateItemBoxes').value = items.boxes ?? 80;

  const addons = adminRates.addonRates || {};
  if (document.getElementById('rateAddonBubble')) document.getElementById('rateAddonBubble').value = addons.bubblePacking ?? 1500;
  if (document.getElementById('rateAddonUnpacking')) document.getElementById('rateAddonUnpacking').value = addons.unpacking ?? 1200;
  if (document.getElementById('rateAddonInsurance')) document.getElementById('rateAddonInsurance').value = addons.insurance ?? 999;
  if (document.getElementById('rateAddonVehicleTransport')) document.getElementById('rateAddonVehicleTransport').value = addons.vehicleTransport ?? 2500;
}

async function saveAdminRates() {
  const baseRate = parseInt(document.getElementById('rateBase')?.value) || 2500;
  const perKmRate = parseInt(document.getElementById('ratePerKm')?.value) || 40;
  const floorNoLiftRate = parseInt(document.getElementById('rateFloorNoLift')?.value) || 300;

  const houseSizeRates = {
    '1rk': parseInt(document.getElementById('rateHouse1rk')?.value) || 0,
    '1bhk': parseInt(document.getElementById('rateHouse1bhk')?.value) || 1000,
    '2bhk': parseInt(document.getElementById('rateHouse2bhk')?.value) || 2500,
    '3bhk': parseInt(document.getElementById('rateHouse3bhk')?.value) || 4500,
    'villa': parseInt(document.getElementById('rateHouseVilla')?.value) || 7500
  };

  const itemRates = {
    sofa: parseInt(document.getElementById('rateItemSofa')?.value) || 500,
    bed: parseInt(document.getElementById('rateItemBed')?.value) || 600,
    dining: parseInt(document.getElementById('rateItemDining')?.value) || 400,
    fridge: parseInt(document.getElementById('rateItemFridge')?.value) || 400,
    washing: parseInt(document.getElementById('rateItemWashing')?.value) || 350,
    boxes: parseInt(document.getElementById('rateItemBoxes')?.value) || 80
  };

  const addonRates = {
    bubblePacking: parseInt(document.getElementById('rateAddonBubble')?.value) || 1500,
    unpacking: parseInt(document.getElementById('rateAddonUnpacking')?.value) || 1200,
    insurance: parseInt(document.getElementById('rateAddonInsurance')?.value) || 999,
    vehicleTransport: parseInt(document.getElementById('rateAddonVehicleTransport')?.value) || 2500
  };

  const newRates = { baseRate, perKmRate, floorNoLiftRate, houseSizeRates, itemRates, addonRates };
  adminRates = newRates;
  localStorage.setItem('rudraksha_rates_config', JSON.stringify(newRates));

  try {
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rates: newRates })
    });
  } catch {}

  showAdminToast('All live rates & tariffs updated on customer website!');
}

/* ==========================================================================
   8. COUPONS MANAGER
   ========================================================================== */
async function loadAdminCoupons() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      const config = await res.json();
      if (config.coupons) adminCoupons = config.coupons;
    }
  } catch {
    const saved = localStorage.getItem('rudraksha_coupons');
    if (saved) adminCoupons = JSON.parse(saved);
  }

  renderCouponsTable();
}

function renderCouponsTable() {
  const tbody = document.getElementById('couponsTableBody');
  if (!tbody) return;

  if (adminCoupons.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted">No active promo codes.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminCoupons.map((c) => `
    <tr>
      <td>
        <div class="d-flex justify-content-between align-items-center w-100">
          <span class="cyber-badge-pill active-glow font-monospace fs-6">${c.code}</span>
          <strong style="color: #D0FD38;" class="fs-6">${c.type === 'percent' ? `${c.value}% OFF` : `₹${c.value} OFF`}</strong>
        </div>
      </td>
      <td class="d-none d-md-table-cell">${c.type === 'percent' ? 'Percentage (%)' : 'Flat (₹)'}</td>
      <td class="d-none d-md-table-cell"><strong style="color: #D0FD38;">${c.type === 'percent' ? `${c.value}%` : `₹${c.value}`}</strong></td>
      <td>
        <div class="d-flex justify-content-between w-100 align-items-center">
          <span class="small text-muted">${c.description || 'Special Relocation Discount'}</span>
          <button class="btn-cyber-outline py-1 px-3 text-danger ms-2 d-md-none" onclick="deleteAdminCoupon('${c.code}')">
            <i class="fa-solid fa-trash me-1"></i> Delete
          </button>
        </div>
      </td>
      <td class="d-none d-md-table-cell">
        <button class="btn-cyber-outline py-1 px-2 text-danger" onclick="deleteAdminCoupon('${c.code}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

async function createAdminCoupon() {
  const code = document.getElementById('newCouponCode').value.trim().toUpperCase();
  const type = document.getElementById('newCouponType').value;
  const value = parseInt(document.getElementById('newCouponValue').value);
  const description = document.getElementById('newCouponDesc')?.value.trim() || '';

  if (!code || isNaN(value)) return;

  try {
    const res = await fetch(`${API_BASE}/admin/coupons`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ code, type, value, description })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.config && data.config.coupons) adminCoupons = data.config.coupons;
      else adminCoupons.push({ code, type, value, description });
    } else {
      adminCoupons.push({ code, type, value, description });
    }
  } catch {
    adminCoupons.push({ code, type, value, description });
  }

  localStorage.setItem('rudraksha_coupons', JSON.stringify(adminCoupons));
  document.getElementById('couponForm').reset();
  showAdminToast(`Promo code "${code}" active on website!`);
  renderCouponsTable();
}

async function deleteAdminCoupon(code) {
  if (!confirm(`Delete promo code "${code}"?`)) return;

  try {
    await fetch(`${API_BASE}/admin/coupons/${code}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  } catch {}

  adminCoupons = adminCoupons.filter(c => c.code !== code);
  localStorage.setItem('rudraksha_coupons', JSON.stringify(adminCoupons));
  showAdminToast(`Coupon "${code}" deleted.`);
  renderCouponsTable();
}

/* ==========================================================================
   9. BRANDING & THEME
   ========================================================================== */
async function loadCompanyBranding() {
  let comp = {
    name: 'Rudraksha Packers & Movers',
    phone: '7296831460',
    whatsapp: '7296831460',
    email: 'support@rudrakshapackers.com',
    address: 'Near SNM Hospital, Gandhipath (West), Jaipur, RJ',
    gstin: '08AAACR1234F1Z5'
  };

  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      const config = await res.json();
      if (config.company) comp = { ...comp, ...config.company };
    }
  } catch {
    const saved = localStorage.getItem('rudraksha_company_config');
    if (saved) comp = { ...comp, ...JSON.parse(saved) };
  }

  adminCompany = comp;
  if (document.getElementById('compName')) document.getElementById('compName').value = comp.name;
  if (document.getElementById('compPhone')) document.getElementById('compPhone').value = comp.phone;
  if (document.getElementById('compWhatsapp')) document.getElementById('compWhatsapp').value = comp.whatsapp;
  if (document.getElementById('compEmail')) document.getElementById('compEmail').value = comp.email;
  if (document.getElementById('compGstin')) document.getElementById('compGstin').value = comp.gstin;
  if (document.getElementById('compAddress')) document.getElementById('compAddress').value = comp.address;
}

async function saveCompanyBranding() {
  const company = {
    name: document.getElementById('compName')?.value.trim() || 'Rudraksha Packers & Movers',
    phone: document.getElementById('compPhone')?.value.trim() || '7296831460',
    whatsapp: document.getElementById('compWhatsapp')?.value.trim() || '7296831460',
    email: document.getElementById('compEmail')?.value.trim() || '',
    gstin: document.getElementById('compGstin')?.value.trim().toUpperCase() || '',
    address: document.getElementById('compAddress')?.value.trim() || ''
  };

  localStorage.setItem('rudraksha_company_config', JSON.stringify(company));

  try {
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ company })
    });
  } catch {}

  showAdminToast('Company details & Tax invoice headers updated!');
}

function loadAdminThemeSettings() {
  const saved = localStorage.getItem('rudraksha_theme_settings');
  if (saved) {
    const theme = JSON.parse(saved);
    if (theme.primaryColor && document.getElementById('primaryColorInput')) {
      document.getElementById('primaryColorInput').value = theme.primaryColor;
      document.getElementById('primaryColorText').value = theme.primaryColor;
    }
    if (theme.secondaryColor && document.getElementById('secondaryColorInput')) {
      document.getElementById('secondaryColorInput').value = theme.secondaryColor;
      document.getElementById('secondaryColorText').value = theme.secondaryColor;
    }
    if (theme.accentColor && document.getElementById('accentColorInput')) {
      document.getElementById('accentColorInput').value = theme.accentColor;
      document.getElementById('accentColorText').value = theme.accentColor;
    }
  }
}

function previewThemeColors() {
  const primary = document.getElementById('primaryColorInput')?.value || '#f97316';
  if (document.getElementById('primaryColorText')) document.getElementById('primaryColorText').value = primary;
}

async function saveAdminTheme() {
  const primaryColor = document.getElementById('primaryColorInput')?.value || '#f97316';
  const secondaryColor = document.getElementById('secondaryColorInput')?.value || '#1e293b';
  const accentColor = document.getElementById('accentColorInput')?.value || '#06b6d4';

  const theme = { primaryColor, secondaryColor, accentColor };
  localStorage.setItem('rudraksha_theme_settings', JSON.stringify(theme));

  try {
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ theme })
    });
  } catch {}

  showAdminToast('Brand theme palette updated across portal!');
}

/* ==========================================================================
   10. METRICS & RECENT HISTORY SYNCHRONIZATION
   ========================================================================== */
function updateDashboardMetrics() {
  // 1. Calculate Combined Revenue & Distance (Relocation + Parcels)
  const relocationRev = adminBookings.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0);
  const parcelRev = allAdminParcels.reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);
  const totalRevenue = (relocationRev > 0 ? relocationRev : 45250) + parcelRev;

  const relocationKm = adminBookings.reduce((acc, b) => acc + (Number(b.distance_km) || 25), 0);
  const parcelKm = allAdminParcels.reduce((acc, p) => acc + (Number(p.distance_km) || 0), 0);
  const totalKm = (relocationKm > 0 ? relocationKm : 1745) + Math.round(parcelKm);

  // Smooth Count-Up Animations
  animateCountUp('dashTotalRevenue', totalRevenue, 1500, '₹');
  animateCountUp('dashTotalKm', totalKm, 1400);

  // Revenue Breakdown Subtitle
  const breakdownEl = document.getElementById('dashRevenueBreakdown');
  if (breakdownEl) {
    const rDisp = (relocationRev > 0 ? relocationRev : 45250).toLocaleString('en-IN');
    const pDisp = parcelRev.toLocaleString('en-IN');
    breakdownEl.innerText = `Movers: ₹${rDisp} • Parcels: ₹${pDisp}`;
  }

  // 2. Next Dispatch Card (Picks latest active relocation OR parcel dispatch)
  const activeParcel = allAdminParcels.find(p => ['driver_assigned', 'reached_pickup', 'in_transit', 'out_for_delivery'].includes(p.booking_status || p.status));
  if (activeParcel) {
    const dName = activeParcel.assigned_driver_name || 'Rajesh Kumar (Express Rider)';
    const route = `📦 ${activeParcel.pickup_address?.split(',')[0] || 'Jaipur'} ➔ ${activeParcel.drop_address?.split(',')[0] || 'Destination'}`;
    if (document.getElementById('dashNextDriver')) document.getElementById('dashNextDriver').innerText = dName;
    if (document.getElementById('dashNextRoute')) document.getElementById('dashNextRoute').innerText = route;
  } else if (adminBookings.length > 0) {
    const latest = adminBookings[0];
    const dName = latest.assigned_driver_name || 'Mukesh Sharma (Fleet Captain)';
    const route = `🏠 ${latest.pickup_address?.split(',')[0] || 'Jaipur'} ➔ ${latest.drop_address?.split(',')[0] || 'Delhi'}`;
    if (document.getElementById('dashNextDriver')) document.getElementById('dashNextDriver').innerText = dName;
    if (document.getElementById('dashNextRoute')) document.getElementById('dashNextRoute').innerText = route;
  }

  // 3. Merged Recent History List Widget (Relocations + Parcels)
  const historyContainer = document.getElementById('dashRecentHistoryList');
  if (historyContainer) {
    const unifiedHistory = [
      ...adminBookings.map(b => ({
        type: 'relocation',
        title: `${b.pickup_address?.split(',')[0] || 'Jaipur'} ➔ ${b.drop_address?.split(',')[0] || 'Delhi'}`,
        subtitle: `${b.shifting_date || 'Today'} • ${b.customer_name || 'Customer'}`,
        amount: b.total_amount ? `₹${Number(b.total_amount).toLocaleString('en-IN')}` : '₹15,090',
        detail: b.selected_vehicle || 'Dedicated Truck',
        date: new Date(b.created_at || Date.now() - 40 * 60000)
      })),
      ...allAdminParcels.map(p => ({
        type: 'parcel',
        title: `📦 ${p.pickup_address?.split(',')[0] || 'Jaipur'} ➔ ${p.drop_address?.split(',')[0] || 'Drop'}`,
        subtitle: `${p.parcel_id} • ${p.sender_name || 'Sender'}`,
        amount: `₹${p.total_amount || 0}`,
        detail: `${(p.vehicle_type || 'bike').toUpperCase()} • ${p.parcel_type || 'Package'}`,
        date: new Date(p.created_at || Date.now() - 10 * 60000)
      }))
    ].sort((a, b) => b.date - a.date).slice(0, 3);

    const avatars = [
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=80&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80'
    ];

    historyContainer.innerHTML = unifiedHistory.map((item, idx) => {
      const av = avatars[idx % avatars.length];
      const typeBadge = item.type === 'parcel'
        ? `<span class="badge bg-warning text-dark py-0 px-1" style="font-size: 0.62rem;">PARCEL</span>`
        : `<span class="badge bg-primary text-white py-0 px-1" style="font-size: 0.62rem;">RELOCATION</span>`;

      return `
        <div class="cyber-history-item" onclick="switchAdminTab('${item.type === 'parcel' ? 'parcels' : 'bookings'}')">
          <div class="cyber-history-user">
            <img src="${av}" alt="User" class="cyber-history-avatar">
            <div>
              <div class="fw-bold text-white small d-flex align-items-center gap-1">${item.title} ${typeBadge}</div>
              <div class="text-muted" style="font-size: 0.7rem;">${item.subtitle}</div>
              <div style="color: var(--accent-neon); font-size: 0.72rem;">${item.detail} - ${item.amount}</div>
            </div>
          </div>
          <i class="fa-solid fa-chevron-right text-muted small"></i>
        </div>
      `;
    }).join('');
  }

  updateParcelMetrics();
  triggerDashboardAnimations();
}

async function refreshAdminAll() {
  await checkBackendHealth();
  await loadFleetVehicles();
  await loadAdminRates();
  await loadAdminCoupons();
  await loadCompanyBranding();
  await loadDriversFromBackend();
  await loadBookingsFromBackend();
  await loadAdminParcels();
  loadAdminThemeSettings();
  updateDashboardMetrics();
  _adminLastRefreshTime = new Date();
  updateAdminRefreshBadge();
}

/* ==========================================================================
   11. RUDRAKSHA PARCEL OPERATIONS & LOGISTICS HUB CONTROLLER
   ========================================================================== */
let allAdminParcels = [];
let allRiderApplications = [];
let currentParcelFilter = 'all';

async function loadAdminParcels() {
  try {
    const res = await fetch(`${API_BASE}/parcels`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      allAdminParcels = data.parcels || [];
    } else {
      throw new Error('API fetch failed');
    }
  } catch (err) {
    // Read and merge from localStorage keys
    let localList = [];
    try {
      const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
      const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
      const map = new Map();
      [...p1, ...p2].forEach(p => {
        const id = p.parcel_id || p.id;
        if (id && !map.has(id)) {
          map.set(id, p);
        }
      });
      localList = Array.from(map.values());
    } catch {}

    if (localList.length > 0) {
      allAdminParcels = localList;
    } else {
      // Seed rich demo parcel bookings if none exist
      allAdminParcels = [
        {
          parcel_id: 'RP-PCL-982104',
          sender_name: 'Rohit Verma',
          sender_phone: '9829012345',
          receiver_name: 'Pooja Agarwal',
          receiver_phone: '9829098765',
          pickup_address: 'Mansarovar Metro Station, Jaipur',
          drop_address: 'Vaishali Nagar Amrapali Circle, Jaipur',
          distance_km: 8.4,
          parcel_type: 'Documents',
          weight_category: '1_5kg',
          vehicle_type: 'bike',
          total_amount: 154,
          payment_method: 'UPI Direct',
          booking_status: 'driver_assigned',
          assigned_driver_name: 'Mukesh Sharma (Bike)',
          assigned_driver_phone: '7296831460',
          created_at: new Date(Date.now() - 35 * 60000).toISOString()
        },
        {
          parcel_id: 'RP-PCL-982105',
          sender_name: 'Anjali Singhal',
          sender_phone: '9414011223',
          receiver_name: 'Vikas Meena',
          receiver_phone: '9414099887',
          pickup_address: 'Raja Park, Jaipur',
          drop_address: 'Malviya Nagar, Jaipur',
          distance_km: 6.2,
          parcel_type: 'Small Package',
          weight_category: '5_10kg',
          vehicle_type: 'auto',
          total_amount: 202,
          payment_method: 'Cash',
          booking_status: 'searching_driver',
          assigned_driver_name: '',
          assigned_driver_phone: '',
          created_at: new Date(Date.now() - 10 * 60000).toISOString()
        },
        {
          parcel_id: 'RP-PCL-982102',
          sender_name: 'Sunil Mathur',
          sender_phone: '9828055443',
          receiver_name: 'Deepak Sharma',
          receiver_phone: '9828011223',
          pickup_address: 'C-Scheme, Jaipur',
          drop_address: 'Jagatpura, Jaipur',
          distance_km: 12.5,
          parcel_type: 'Electronics',
          weight_category: '10_20kg',
          vehicle_type: 'mini_truck',
          total_amount: 395,
          payment_method: 'Pay at Delivery',
          booking_status: 'delivered',
          assigned_driver_name: 'Rajesh Kumar (Tata Ace)',
          assigned_driver_phone: '7296831460',
          created_at: new Date(Date.now() - 180 * 60000).toISOString()
        }
      ];
      localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
      localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));
    }
  }

  // Load Rider Applications
  loadRiderApplications();
  loadAdminParcelRates();
  updateParcelMetrics();
  renderParcelsTable();
}

function switchParcelSubtab(subtabName, btnEl) {
  document.querySelectorAll('#parcelSubtabPills button').forEach(b => {
    b.classList.remove('active', 'btn-outline-warning');
    b.classList.add('btn-outline-light');
  });

  if (btnEl) {
    btnEl.classList.remove('btn-outline-light');
    btnEl.classList.add('active', 'btn-outline-warning');
  }

  document.querySelectorAll('.parcel-subtab-panel').forEach(p => p.classList.add('d-none'));
  const targetPanel = document.getElementById(`subtabPanel-${subtabName}`);
  if (targetPanel) {
    targetPanel.classList.remove('d-none');
  }

  if (subtabName === 'riders') {
    renderRiderApplicationsTable();
  }
}

async function loadRiderApplications() {
  try {
    const token = getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/rider-applications`, { headers });
    if (res.ok) {
      const data = await res.json();
      allRiderApplications = Array.isArray(data.applications) ? data.applications : [];
      localStorage.setItem('rudraksha_rider_applications', JSON.stringify(allRiderApplications));
      return;
    }
  } catch (err) {
    console.warn('Backend rider list unavailable, falling back to local cache.', err);
  }

  const saved = localStorage.getItem('rudraksha_rider_applications');
  if (saved) {
    allRiderApplications = JSON.parse(saved);
  } else {
    allRiderApplications = [
      {
        name: 'Mukesh Kumar Sharma',
        phone: '9829012345',
        city: 'Jaipur (Mansarovar / Vaishali)',
        shift: 'Full Time (8-10 Hours)',
        vehType: 'Bike / Scooter',
        vehNum: 'RJ14 AB 1234',
        dlNum: 'RJ14 20210012345',
        status: 'Approved',
        date: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        name: 'Dinesh Gurjar',
        phone: '9414077889',
        city: 'Jaipur (Malviya Nagar / Jagatpura)',
        shift: 'Full Time (8-10 Hours)',
        vehType: 'Tata Ace / Mini Truck',
        vehNum: 'RJ14 GA 5566',
        dlNum: 'RJ14 20190098765',
        status: 'Pending',
        date: new Date(Date.now() - 4 * 3600000).toISOString()
      }
    ];
    localStorage.setItem('rudraksha_rider_applications', JSON.stringify(allRiderApplications));
  }
}

let currentRiderFilter = 'all';

function filterRiderApps(filter) {
  currentRiderFilter = filter;
  ['All', 'Pending', 'Approved'].forEach(f => {
    const btn = document.getElementById(`btnFilterRider${f}`);
    if (btn) {
      if (f.toLowerCase() === filter.toLowerCase()) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  renderRiderApplicationsTable(filter);
}

function renderDashboardRiderApps() {
  loadRiderApplications();
  const tbody = document.getElementById('dashRiderApplicationsTableBody');
  const badge = document.getElementById('dashRiderBadge');
  const dockBadge = document.getElementById('dockRiderBadgeCount');

  const pendingCount = allRiderApplications.filter(a => (a.status || 'Pending') === 'Pending').length;

  if (badge) {
    badge.innerText = `${pendingCount} Pending`;
    badge.className = pendingCount > 0 ? 'badge bg-warning text-dark px-2 py-1 fw-bold' : 'badge bg-secondary text-white px-2 py-1';
  }

  if (dockBadge) {
    dockBadge.innerText = pendingCount;
    if (pendingCount > 0) {
      dockBadge.classList.remove('d-none');
    } else {
      dockBadge.classList.add('d-none');
    }
  }

  if (!tbody) return;

  if (allRiderApplications.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted"><i class="fa-solid fa-motorcycle me-2"></i>No driver applications received yet.</td></tr>`;
    return;
  }

  const recentApps = allRiderApplications.slice(0, 6);

  tbody.innerHTML = recentApps.map((app) => {
    const origIdx = allRiderApplications.findIndex(a => a.phone === app.phone);
    const idx = origIdx >= 0 ? origIdx : 0;
    const status = app.status || 'Pending';
    const statusBadge = {
      'Approved': 'bg-success text-white',
      'Pending': 'bg-warning text-dark',
      'Rejected': 'bg-danger text-white'
    }[status] || 'bg-secondary text-white';

    return `
      <tr class="border-bottom border-secondary border-opacity-10 align-middle">
        <td>
          <strong class="text-white small">${app.name}</strong>
          ${app.driverId ? `<div style="font-size:0.68rem;color:#f97316;font-family:monospace;font-weight:700;">ID: ${app.driverId}</div>` : ''}
        </td>
        <td>
          <div class="small"><a href="tel:${app.phone}" class="text-decoration-none text-muted"><i class="fa-solid fa-phone text-success me-1"></i>+91 ${app.phone}</a></div>
        </td>
        <td><span class="small text-white">${app.city || 'Jaipur'}</span></td>
        <td><strong class="text-warning small">${app.vehType}</strong></td>
        <td><code class="text-white small">${app.vehNum || '-'}</code></td>
        <td><span class="small text-muted font-monospace">${app.dlNum || '-'}</span></td>
        <td><span class="small text-muted" style="font-size: 0.72rem;">${app.date ? new Date(app.date).toLocaleDateString('en-IN') : 'Recent'}</span></td>
        <td>
          <span class="badge ${statusBadge} py-1 px-2 small">${status}</span>
        </td>
        <td class="text-end">
          <div class="d-inline-flex align-items-center gap-1">
            ${status === 'Pending' ? `
              <button class="btn btn-sm btn-outline-success py-1 px-2 fw-bold" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Approve and Send Password on WhatsApp">
                <i class="fa-solid fa-check me-1"></i> Approve & Send PIN
              </button>
              <button class="btn btn-sm btn-outline-danger py-1 px-2" style="font-size: 0.72rem;" onclick="rejectRiderPartner(${idx})" title="Reject Application">
                <i class="fa-solid fa-xmark"></i>
              </button>
            ` : ''}
            ${status === 'Approved' ? `
              <button class="btn btn-sm btn-outline-success py-1 px-2" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Resend WhatsApp Password">
                <i class="fa-brands fa-whatsapp me-1"></i> Resend PIN
              </button>
            ` : ''}
            ${status === 'Rejected' ? `
              <button class="btn btn-sm btn-outline-warning py-1 px-2" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Re-approve Rider">
                <i class="fa-solid fa-rotate-left me-1"></i> Re-approve
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderRiderApplicationsTable(filter = currentRiderFilter) {
  loadRiderApplications();
  const tbody = document.getElementById('riderApplicationsTableBody');

  // Update Stats in Dedicated Tab
  const total = allRiderApplications.length;
  const pending = allRiderApplications.filter(a => (a.status || 'Pending') === 'Pending').length;
  const approved = allRiderApplications.filter(a => a.status === 'Approved').length;
  const rejected = allRiderApplications.filter(a => a.status === 'Rejected').length;

  const stTotal = document.getElementById('statRiderTotal');
  const stPending = document.getElementById('statRiderPending');
  const stApproved = document.getElementById('statRiderApproved');
  const stRejected = document.getElementById('statRiderRejected');
  if (stTotal) stTotal.innerText = total;
  if (stPending) stPending.innerText = pending;
  if (stApproved) stApproved.innerText = approved;
  if (stRejected) stRejected.innerText = rejected;

  const cntAll = document.getElementById('countFilterAll');
  const cntPending = document.getElementById('countFilterPending');
  const cntApproved = document.getElementById('countFilterApproved');
  if (cntAll) cntAll.innerText = total;
  if (cntPending) cntPending.innerText = pending;
  if (cntApproved) cntApproved.innerText = approved;

  // Sync dashboard widget and dock badge
  renderDashboardRiderApps();

  if (!tbody) return;

  let displayApps = allRiderApplications;
  if (filter && filter !== 'all') {
    displayApps = allRiderApplications.filter(a => (a.status || 'Pending').toLowerCase() === filter.toLowerCase());
  }

  if (displayApps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted"><i class="fa-solid fa-motorcycle fa-2x mb-2 d-block text-secondary"></i>No applications found for filter "${filter}".</td></tr>`;
    return;
  }

  tbody.innerHTML = displayApps.map((app) => {
    const origIdx = allRiderApplications.findIndex(a => a.phone === app.phone);
    const idx = origIdx >= 0 ? origIdx : 0;
    const status = app.status || 'Pending';
    const statusBadge = {
      'Approved': 'bg-success text-white',
      'Pending': 'bg-warning text-dark',
      'Rejected': 'bg-danger text-white'
    }[status] || 'bg-secondary text-white';

    return `
      <tr class="border-bottom border-secondary border-opacity-10 align-middle">
        <td>
          <strong class="text-white small">${app.name}</strong>
          ${app.driverId ? `<div style="font-size:0.68rem;color:#f97316;font-family:monospace;font-weight:700;">ID: ${app.driverId}</div>` : ''}
        </td>
        <td>
          <div class="small text-muted"><a href="tel:${app.phone}" class="text-decoration-none text-muted"><i class="fa-solid fa-phone text-success me-1"></i>+91 ${app.phone}</a></div>
        </td>
        <td><span class="small text-white">${app.city || 'Jaipur'}</span></td>
        <td><span class="badge bg-dark border border-secondary text-white" style="font-size: 0.7rem;">${app.shift || 'Full Time'}</span></td>
        <td><strong class="text-warning small">${app.vehType}</strong></td>
        <td><code class="text-white small">${app.vehNum || '-'}</code></td>
        <td><span class="small text-muted font-monospace">${app.dlNum || '-'}</span></td>
        <td><span class="small text-muted" style="font-size: 0.72rem;">${app.date ? new Date(app.date).toLocaleDateString('en-IN') : 'Recent'}</span></td>
        <td>
          <span class="badge ${statusBadge} py-1 px-2 small">${status}</span>
        </td>
        <td class="text-end">
          <div class="d-inline-flex align-items-center gap-1 flex-wrap justify-content-end">
            ${status === 'Pending' ? `
              <button class="btn btn-sm btn-outline-success py-1 px-2 fw-bold" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Approve and Send Password on WhatsApp">
                <i class="fa-solid fa-check me-1"></i> Approve & Send PIN
              </button>
              <button class="btn btn-sm btn-outline-danger py-1 px-2" style="font-size: 0.72rem;" onclick="rejectRiderPartner(${idx})" title="Reject Application">
                <i class="fa-solid fa-xmark"></i>
              </button>
            ` : ''}
            ${status === 'Approved' ? `
              <button class="btn btn-sm btn-outline-success py-1 px-2" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Resend WhatsApp Password">
                <i class="fa-brands fa-whatsapp me-1"></i> Resend PIN
              </button>
              <button class="btn btn-sm btn-outline-secondary py-1 px-2" style="font-size: 0.72rem;" onclick="rejectRiderPartner(${idx})" title="Deactivate Rider">
                <i class="fa-solid fa-ban"></i>
              </button>
            ` : ''}
            ${status === 'Rejected' ? `
              <button class="btn btn-sm btn-outline-warning py-1 px-2" style="font-size: 0.72rem;" onclick="approveRiderPartner(${idx})" title="Re-approve Rider">
                <i class="fa-solid fa-rotate-left me-1"></i> Re-approve
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function approveRiderPartner(idx) {
  if (!allRiderApplications[idx]) return;
  const app = allRiderApplications[idx];

  try {
    const driverId = app.driverId || `RDR-${String(app.phone).slice(-4)}`;
    const driverPin = app.pin || String(Math.floor(1000 + Math.random() * 9000));

    const res = await fetch(`${API_BASE}/rider-applications/${app.id}/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ pin: driverPin })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Approval failed.');

    app.driverId = data.driver?.id || driverId;
    app.pin = data.driver?.pin || driverPin;
    app.status = 'Approved';
    app.approved_at = new Date().toISOString();

    const approvedDrivers = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
    const existingIdx = approvedDrivers.findIndex(d => (d.driver_phone || '').replace(/\D/g, '') === String(app.phone || '').replace(/\D/g, ''));
    const driverObj = {
      id: app.driverId,
      driver_name: app.name,
      driver_phone: app.phone,
      vehicle_number: app.vehNum,
      vehicle_type: app.vehType,
      pin: app.pin,
      status: 'Active',
      onDuty: true,
      approved_at: app.approved_at
    };

    if (existingIdx >= 0) approvedDrivers[existingIdx] = driverObj;
    else approvedDrivers.push(driverObj);
    localStorage.setItem('rudraksha_approved_drivers', JSON.stringify(approvedDrivers));
    localStorage.setItem('rudraksha_rider_applications', JSON.stringify(allRiderApplications));

    const portalUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}driver.html`;
    const waMsg = `🎉 *CONGRATULATIONS! RUDRAKSHA DELIVERY PARTNER APPROVED*\n━━━━━━━━━━━━━━━━━━━━\nNamaste *${app.name}*,\nAapka Rudraksha Express Delivery Partner account approve aur activate ho gaya hai!\n\n📲 *Aapke Login Credentials:*\n• Login Mobile Number: *${app.phone}*\n• Security PIN / Password: *${app.pin}*\n• Driver Partner ID: *${app.driverId}*\n• Registered Vehicle: *${app.vehType} (${app.vehNum})*\n\n👉 *Tap to Login to Your Driver Dashboard:*\n${portalUrl}\n━━━━━━━━━━━━━━━━━━━━\n_Login karke apni duty 'ON' karein aur city delivery orders accept karna shuru karein. Welcome to the fleet!_`;
    const waUrl = `https://wa.me/91${app.phone}?text=${encodeURIComponent(waMsg)}`;
    window.open(waUrl, '_blank');

    showAdminToast(`🎉 Driver "${app.name}" approved! WhatsApp credentials dispatched.`, 'success');
    await loadRiderApplications();
    renderRiderApplicationsTable();
    updateParcelMetrics();
  } catch (err) {
    showAdminToast(err.message || 'Approval failed. Please try again.', 'error');
  }
}

async function rejectRiderPartner(idx) {
  if (!allRiderApplications[idx]) return;
  const app = allRiderApplications[idx];

  try {
    const res = await fetch(`${API_BASE}/rider-applications/${app.id}/reject`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rejection failed.');

    app.status = 'Rejected';
    localStorage.setItem('rudraksha_rider_applications', JSON.stringify(allRiderApplications));

    const approvedDrivers = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
    const filtered = approvedDrivers.filter(d => (d.driver_phone || '').replace(/\D/g, '') !== String(app.phone || '').replace(/\D/g, ''));
    localStorage.setItem('rudraksha_approved_drivers', JSON.stringify(filtered));

    showAdminToast(`Rider application for "${app.name}" marked as Rejected.`, 'info');
    await loadRiderApplications();
    renderRiderApplicationsTable();
    updateParcelMetrics();
  } catch (err) {
    showAdminToast(err.message || 'Unable to reject the rider application.', 'error');
  }
}

function updateParcelMetrics() {
  const total = allAdminParcels.length;
  const active = allAdminParcels.filter(p => ['searching_driver', 'driver_assigned', 'reached_pickup', 'picked_up', 'in_transit', 'out_for_delivery'].includes(p.booking_status || p.status)).length;
  const revenue = allAdminParcels.reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);
  const ridersCount = allRiderApplications.length;

  if (document.getElementById('pclTotalCount')) document.getElementById('pclTotalCount').innerText = total;
  if (document.getElementById('pclActiveCount')) document.getElementById('pclActiveCount').innerText = active;
  if (document.getElementById('pclRidersCount')) document.getElementById('pclRidersCount').innerText = ridersCount;
  if (document.getElementById('badgeRiderAppCount')) document.getElementById('badgeRiderAppCount').innerText = ridersCount;
  if (document.getElementById('pclRevenueTotal')) document.getElementById('pclRevenueTotal').innerText = `₹${revenue.toLocaleString('en-IN')}`;
}

function filterParcelsTable(status, btnEl) {
  currentParcelFilter = status;
  document.querySelectorAll('#parcelFilterPills button').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  if (status === 'all') {
    renderParcelsTable(allAdminParcels);
  } else {
    const filtered = allAdminParcels.filter(p => (p.booking_status || p.status) === status);
    renderParcelsTable(filtered);
  }
}

function searchParcelsTable(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    filterParcelsTable(currentParcelFilter);
    return;
  }
  const filtered = allAdminParcels.filter(p =>
    (p.parcel_id && p.parcel_id.toLowerCase().includes(q)) ||
    (p.sender_name && p.sender_name.toLowerCase().includes(q)) ||
    (p.receiver_name && p.receiver_name.toLowerCase().includes(q)) ||
    (p.sender_phone && p.sender_phone.includes(q)) ||
    (p.receiver_phone && p.receiver_phone.includes(q)) ||
    (p.pickup_address && p.pickup_address.toLowerCase().includes(q)) ||
    (p.drop_address && p.drop_address.toLowerCase().includes(q))
  );
  renderParcelsTable(filtered);
}

function renderParcelsTable(list = allAdminParcels) {
  const tbody = document.getElementById('parcelsTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted"><i class="fa-solid fa-box-open me-2"></i>No parcel deliveries found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const pId = p.parcel_id || p.id || 'RP-PCL-XXXX';
    const sName = p.sender_name || 'Sender';
    const sPhone = p.sender_phone || '-';
    const rName = p.receiver_name || 'Receiver';
    const rPhone = p.receiver_phone || '-';
    const pickup = p.pickup_address || '-';
    const drop = p.drop_address || '-';
    const dist = p.distance_km || 5;
    const type = p.parcel_type || 'Package';
    const veh = (p.vehicle_type || 'bike').toUpperCase();
    const amount = `₹${p.total_amount || 0}`;
    const status = p.booking_status || p.status || 'searching_driver';
    const dPhone = p.assigned_driver_phone || '7296831460';
    const dName = p.assigned_driver_name || 'Assigned Driver';

    const driverDisplay = p.assigned_driver_name
      ? `<div><strong class="text-white small">👨‍✈️ ${p.assigned_driver_name}</strong><br><span class="small text-muted">+91 ${dPhone}</span></div>`
      : `<button class="btn btn-sm btn-outline-warning rounded-pill py-0 px-2" style="font-size: 0.72rem;" onclick="openAssignParcelDriverModal('${pId}')"><i class="fa-solid fa-plus me-1"></i>Assign Driver</button>`;

    const statusBadgeClass = {
      'searching_driver': 'bg-warning text-dark',
      'confirmed': 'bg-primary text-white',
      'driver_assigned': 'bg-info text-dark',
      'reached_pickup': 'bg-warning text-dark',
      'picked_up': 'bg-info text-dark',
      'in_transit': 'bg-primary text-white',
      'out_for_delivery': 'bg-warning text-dark',
      'delivered': 'bg-success text-white',
      'cancelled': 'bg-danger text-white'
    }[status] || 'bg-secondary text-white';

    const statusLabels = {
      'searching_driver': '🟡 Request Sent',
      'confirmed': '🔵 Confirmed',
      'driver_assigned': '🟣 Driver Assigned',
      'reached_pickup': '🟠 Reached Pickup',
      'picked_up': '📦 Parcel Picked Up',
      'in_transit': '🚚 In Transit',
      'out_for_delivery': '🛵 Out Delivery',
      'delivered': '🟢 Delivered',
      'cancelled': '🔴 Cancelled'
    };

    // 1. WhatsApp Customer Message
    const custWaMsg = `Hello ${sName}, this is Rudraksha Express Logistics. Your parcel order ${pId} status is: ${statusLabels[status] || status}. For any support, reply to this message.`;

    // 2. WhatsApp Driver Dispatch Message
    const driverWaMsg = 
`📦 *RUDRAKSHA EXPRESS - PARCEL DELIVERY ASSIGNMENT*
━━━━━━━━━━━━━━━━━━━━
🆔 *Parcel ID:* ${pId}
📍 *Pickup:* ${pickup}
📍 *Drop:* ${drop}
📦 *Category:* ${type} (${p.weight_category || ''})
🛵 *Vehicle:* ${veh}
👤 *Sender:* ${sName} (+91 ${sPhone})
👤 *Receiver:* ${rName} (+91 ${rPhone})
💰 *Collect Amount:* ${amount} (${p.payment_method || 'Cash'})
━━━━━━━━━━━━━━━━━━━━
Please confirm pickup on your driver portal.`;

    return `
      <tr class="border-bottom border-secondary border-opacity-10">
        <td>
          <strong class="text-warning" style="font-size: 0.88rem;">${pId}</strong>
          <div class="small text-muted" style="font-size: 0.7rem;">${p.created_at ? new Date(p.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Today'}</div>
        </td>
        <td>
          <div class="fw-bold text-white small">${sName}</div>
          <div class="small text-muted"><a href="tel:${sPhone}" class="text-decoration-none text-muted"><i class="fa-solid fa-phone text-success me-1"></i>+91 ${sPhone}</a></div>
        </td>
        <td>
          <div class="fw-bold text-white small">${rName}</div>
          <div class="small text-muted"><a href="tel:${rPhone}" class="text-decoration-none text-muted"><i class="fa-solid fa-phone text-success me-1"></i>+91 ${rPhone}</a></div>
        </td>
        <td>
          <div class="small text-white text-truncate" style="max-width: 140px;" title="${pickup}">📍 ${pickup.split(',')[0]}</div>
          <div class="small text-muted text-truncate" style="max-width: 140px;" title="${drop}">➔ ${drop.split(',')[0]}</div>
          <span class="badge bg-secondary-subtle text-secondary" style="font-size: 0.68rem;">${dist} KM</span>
        </td>
        <td>
          <span class="badge bg-dark border border-secondary text-white small">${type}</span>
          <div class="small text-warning mt-1 fw-bold">${veh}</div>
        </td>
        <td>
          <strong class="text-success">${amount}</strong>
          <div class="small text-muted" style="font-size: 0.68rem;">${(p.payment_method || 'Cash')}</div>
        </td>
        <td>
          <span class="badge ${statusBadgeClass} rounded-pill py-1 px-2 small">${statusLabels[status] || status}</span>
        </td>
        <td>${driverDisplay}</td>
        <td>
          <div class="d-flex gap-1 align-items-center flex-wrap">
            <select class="form-select form-select-sm bg-dark text-white border-secondary py-0" style="font-size: 0.72rem; width: 120px;" onchange="quickUpdateParcelStatus('${pId}', this.value)">
              <option value="searching_driver" ${status==='searching_driver'?'selected':''}>🟡 Request Sent</option>
              <option value="confirmed" ${status==='confirmed'?'selected':''}>🔵 Confirmed</option>
              <option value="driver_assigned" ${status==='driver_assigned'?'selected':''}>🟣 Driver Assigned</option>
              <option value="reached_pickup" ${status==='reached_pickup'?'selected':''}>🟠 Reached Pickup</option>
              <option value="picked_up" ${status==='picked_up'?'selected':''}>📦 Picked Up</option>
              <option value="in_transit" ${status==='in_transit'?'selected':''}>🚚 In Transit</option>
              <option value="out_for_delivery" ${status==='out_for_delivery'?'selected':''}>🛵 Out Delivery</option>
              <option value="delivered" ${status==='delivered'?'selected':''}>🟢 Delivered</option>
              <option value="cancelled" ${status==='cancelled'?'selected':''}>🔴 Cancelled</option>
            </select>
            <button class="btn btn-sm btn-outline-warning py-0 px-2 fw-bold" style="font-size: 0.72rem;" onclick="openBroadcastModal('${pId}')" title="📢 Broadcast to Rider WhatsApp Group">
              <i class="fa-solid fa-tower-broadcast text-warning me-1"></i>Broadcast
            </button>
            <a href="https://wa.me/91${sPhone}?text=${encodeURIComponent(custWaMsg)}" target="_blank" class="btn btn-sm btn-outline-success py-0 px-2" title="WhatsApp Customer">
              <i class="fa-brands fa-whatsapp"></i>
            </a>
            <a href="https://wa.me/91${dPhone}?text=${encodeURIComponent(driverWaMsg)}" target="_blank" class="btn btn-sm btn-outline-secondary py-0 px-2" title="Direct WhatsApp Driver">
              <i class="fa-solid fa-paper-plane"></i>
            </a>
            <a href="track.html?id=${pId}" target="_blank" class="btn btn-sm btn-outline-info py-0 px-2" title="Live Tracking">
              <i class="fa-solid fa-location-crosshairs"></i>
            </a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAssignParcelDriverModal(parcelId) {
  const parcel = allAdminParcels.find(p => (p.parcel_id === parcelId || p.id === parcelId));
  if (!parcel) return;

  document.getElementById('assignParcelId').value = parcelId;
  document.getElementById('assignParcelDisplayId').innerText = parcelId;
  document.getElementById('assignParcelSender').innerText = parcel.sender_name || 'Sender';
  document.getElementById('assignParcelReceiver').innerText = parcel.receiver_name || 'Receiver';

  const select = document.getElementById('assignParcelDriverSelect');
  if (select) {
    if (allRiderApplications.length > 0) {
      select.innerHTML = allRiderApplications.map(d => `
        <option value="${d.name}">${d.name} - ${d.vehType} (${d.vehNum}) • Phone: ${d.phone}</option>
      `).join('');
    } else {
      select.innerHTML = `
        <option value="Mukesh Sharma">Mukesh Sharma - Bike (RJ-14-AB-1234) • 9829012345</option>
        <option value="Vikram Singh">Vikram Singh - EV Scooter (RJ-14-MB-2244) • 9414012345</option>
        <option value="Rajesh Kumar">Rajesh Kumar - Tata Ace (RJ-14-GA-1024) • 7296831460</option>
      `;
    }
  }

  const modal = new bootstrap.Modal(document.getElementById('assignParcelDriverModal'));
  modal.show();
}

async function submitParcelDriverAssignment() {
  const parcelId = document.getElementById('assignParcelId')?.value;
  const select = document.getElementById('assignParcelDriverSelect');
  const driverName = select?.value || 'Assigned Driver';

  const p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (p) {
    p.assigned_driver_name = driverName;
    p.assigned_driver_phone = '7296831460';
    p.booking_status = 'driver_assigned';
    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
    localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));
  }

  showAdminToast(`Driver "${driverName}" assigned to Parcel ${parcelId}!`);
  bootstrap.Modal.getInstance(document.getElementById('assignParcelDriverModal'))?.hide();
  renderParcelsTable();
  updateParcelMetrics();
}

async function quickUpdateParcelStatus(parcelId, newStatus) {
  const p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (p) {
    p.booking_status = newStatus;
    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
    localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));
  }
  showAdminToast(`Parcel ${parcelId} status updated to "${newStatus.toUpperCase()}"`);
  renderParcelsTable();
  updateParcelMetrics();
}

// Save & Load Parcel Tariff
function saveAdminParcelRates() {
  const rates = {
    baseFare: parseFloat(document.getElementById('pclRateBase')?.value) || 40,
    perKm: parseFloat(document.getElementById('pclRatePerKm')?.value) || 10,
    handling: parseFloat(document.getElementById('pclRateHandling')?.value) || 10,
    weights: {
      upto_1kg: parseFloat(document.getElementById('pclWeightUpto1')?.value) || 0,
      '1_5kg': parseFloat(document.getElementById('pclWeight1to5')?.value) || 20,
      '5_10kg': parseFloat(document.getElementById('pclWeight5to10')?.value) || 40,
      '10_20kg': parseFloat(document.getElementById('pclWeight10to20')?.value) || 70,
      '20_50kg': parseFloat(document.getElementById('pclWeight20to50')?.value) || 120,
      '50kg_plus': parseFloat(document.getElementById('pclWeight50Plus')?.value) || 250
    },
    vehicles: {
      bike: parseFloat(document.getElementById('pclVehBike')?.value) || 0,
      auto: parseFloat(document.getElementById('pclVehAuto')?.value) || 50,
      mini_truck: parseFloat(document.getElementById('pclVehTruck')?.value) || 150
    },
    addons: {
      fragile: parseFloat(document.getElementById('pclAddonFragile')?.value) || 25,
      packaging: parseFloat(document.getElementById('pclAddonPackaging')?.value) || 40,
      insurance: parseFloat(document.getElementById('pclAddonInsurance')?.value) || 49
    }
  };

  localStorage.setItem('rudraksha_parcel_rates', JSON.stringify(rates));
  showAdminToast('✅ Rudraksha Parcel Tariff & Rates saved successfully!');
}

function loadAdminParcelRates() {
  const saved = localStorage.getItem('rudraksha_parcel_rates');
  if (!saved) return;
  try {
    const r = JSON.parse(saved);
    if (document.getElementById('pclRateBase')) document.getElementById('pclRateBase').value = r.baseFare || 40;
    if (document.getElementById('pclRatePerKm')) document.getElementById('pclRatePerKm').value = r.perKm || 10;
    if (document.getElementById('pclRateHandling')) document.getElementById('pclRateHandling').value = r.handling || 10;
    if (r.weights) {
      if (document.getElementById('pclWeightUpto1')) document.getElementById('pclWeightUpto1').value = r.weights.upto_1kg || 0;
      if (document.getElementById('pclWeight1to5')) document.getElementById('pclWeight1to5').value = r.weights['1_5kg'] || 20;
      if (document.getElementById('pclWeight5to10')) document.getElementById('pclWeight5to10').value = r.weights['5_10kg'] || 40;
      if (document.getElementById('pclWeight10to20')) document.getElementById('pclWeight10to20').value = r.weights['10_20kg'] || 70;
      if (document.getElementById('pclWeight20to50')) document.getElementById('pclWeight20to50').value = r.weights['20_50kg'] || 120;
      if (document.getElementById('pclWeight50Plus')) document.getElementById('pclWeight50Plus').value = r.weights['50kg_plus'] || 250;
    }
    if (r.vehicles) {
      if (document.getElementById('pclVehBike')) document.getElementById('pclVehBike').value = r.vehicles.bike || 0;
      if (document.getElementById('pclVehAuto')) document.getElementById('pclVehAuto').value = r.vehicles.auto || 50;
      if (document.getElementById('pclVehTruck')) document.getElementById('pclVehTruck').value = r.vehicles.mini_truck || 150;
    }
    if (r.addons) {
      if (document.getElementById('pclAddonFragile')) document.getElementById('pclAddonFragile').value = r.addons.fragile || 25;
      if (document.getElementById('pclAddonPackaging')) document.getElementById('pclAddonPackaging').value = r.addons.packaging || 40;
      if (document.getElementById('pclAddonInsurance')) document.getElementById('pclAddonInsurance').value = r.addons.insurance || 49;
    }
  } catch (err) {}
}

// Export CSV for Parcels
function exportParcelsToCSV() {
  if (allAdminParcels.length === 0) {
    alert('No parcel orders to export.');
    return;
  }
  let csv = 'Parcel ID,Sender Name,Sender Phone,Receiver Name,Receiver Phone,Pickup Address,Drop Address,Distance (KM),Category,Vehicle,Total Amount,Payment Mode,Status,Assigned Driver\n';
  allAdminParcels.forEach(p => {
    csv += `"${p.parcel_id || p.id}","${p.sender_name || ''}","${p.sender_phone || ''}","${p.receiver_name || ''}","${p.receiver_phone || ''}","${(p.pickup_address || '').replace(/"/g, '""')}","${(p.drop_address || '').replace(/"/g, '""')}",${p.distance_km || 0},"${p.parcel_type || ''}","${p.vehicle_type || ''}",${p.total_amount || 0},"${p.payment_method || ''}","${p.booking_status || p.status || ''}","${p.assigned_driver_name || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `rudraksha_parcels_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showAdminToast('📥 Exported Rudraksha Parcel Orders CSV!');
}

/* ==========================================================================
   12. RIDER GROUP WHATSAPP BROADCAST CONTROLLER (Phase 3D)
   ========================================================================== */
function getDriverDispatchUrl(parcelId) {
  const basePath = window.location.pathname.replace(/[^/]*$/, '');
  return `${window.location.origin}${basePath}driver.html?jobId=${parcelId}`;
}

function generateBroadcastMessage(parcel) {
  const pId = parcel.parcel_id || parcel.id;
  const pickup = parcel.pickup_address || 'Pickup Location';
  const drop = parcel.drop_address || 'Drop Location';
  const dist = parcel.distance_km || 5;
  const type = parcel.parcel_type || 'Package';
  const weight = parcel.weight_category || 'Standard';
  const veh = (parcel.vehicle_type || 'bike').toUpperCase();
  const fare = parcel.total_amount || 100;
  const payout = Math.round(Number(fare) * 0.85);
  const payMethod = parcel.payment_method || 'Cash on Delivery';
  const dispatchUrl = getDriverDispatchUrl(pId);

  return (
`🚨 *NEW PARCEL DELIVERY JOB AVAILABLE* 🚨
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* ${pId}
📍 *Pickup:* ${pickup}
📍 *Drop:* ${drop}
📏 *Distance:* ${dist} KM
📦 *Cargo:* ${type} (${weight})
🛵 *Vehicle:* ${veh}
💰 *Rider Payout:* ₹${payout} (Customer Bill: ₹${fare} via ${payMethod})

⚡ *First rider to tap and accept gets the job:*
👉 ${dispatchUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Fleet Dispatch • Tap link to accept immediately_`
  );
}

function openBroadcastModal(parcelId) {
  const parcel = allAdminParcels.find(p => (p.parcel_id === parcelId || p.id === parcelId));
  if (!parcel) {
    showAdminToast('Parcel order not found', 'error');
    return;
  }

  const pId = parcel.parcel_id || parcel.id;
  const fare = parcel.total_amount || 0;
  const payout = Math.round(Number(fare) * 0.85);
  const route = `${parcel.pickup_address?.split(',')[0] || 'Pickup'} ➔ ${parcel.drop_address?.split(',')[0] || 'Drop'}`;
  const veh = (parcel.vehicle_type || 'bike').toUpperCase();
  const dist = parcel.distance_km || 5;
  const broadcastMsg = generateBroadcastMessage(parcel);

  if (document.getElementById('bcastModalBadge')) document.getElementById('bcastModalBadge').innerText = pId;
  if (document.getElementById('bcastModalFare')) document.getElementById('bcastModalFare').innerText = `₹${fare}`;
  if (document.getElementById('bcastModalRoute')) document.getElementById('bcastModalRoute').innerText = route;
  if (document.getElementById('bcastModalVehicle')) document.getElementById('bcastModalVehicle').innerText = veh;
  if (document.getElementById('bcastModalDist')) document.getElementById('bcastModalDist').innerText = dist;
  if (document.getElementById('bcastModalPayout')) document.getElementById('bcastModalPayout').innerText = `₹${payout}`;

  const previewEl = document.getElementById('bcastMessagePreview');
  if (previewEl) previewEl.value = broadcastMsg;

  // WhatsApp share link - opens WhatsApp share sheet so owner can pick their Rider WhatsApp Group!
  const waBtn = document.getElementById('btnLaunchWhatsAppBroadcast');
  if (waBtn) {
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(broadcastMsg)}`;
  }

  const modalEl = document.getElementById('broadcastParcelModal');
  if (modalEl) {
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }
}

function copyBroadcastText() {
  const previewEl = document.getElementById('bcastMessagePreview');
  const text = previewEl?.value;
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      showAdminToast('📋 Broadcast announcement copied to clipboard!', 'success');
    }).catch(() => {
      previewEl.select();
      document.execCommand('copy');
      showAdminToast('📋 Copied to clipboard!', 'success');
    });
  }
}

function broadcastOpenParcelsModal() {
  const openOrders = allAdminParcels.filter(p => (p.booking_status || p.status) === 'searching_driver');
  if (openOrders.length === 0) {
    showAdminToast('All current parcel jobs have already been assigned to riders!', 'info');
    return;
  }

  if (openOrders.length === 1) {
    openBroadcastModal(openOrders[0].parcel_id || openOrders[0].id);
    return;
  }

  // Multiple open orders - create a combined digest
  const totalVal = openOrders.reduce((a,c)=>a+(Number(c.total_amount)||0), 0);
  const totalPayout = Math.round(totalVal * 0.85);

  const digest = 
`🚨 *RUDRAKSHA EXPRESS - ${openOrders.length} OPEN DELIVERY JOBS* 🚨
━━━━━━━━━━━━━━━━━━━━
Hey Fleet Team! Following orders are available for immediate pickup. Tap any link below to claim your job:

` + openOrders.map((p, idx) => {
    const pId = p.parcel_id || p.id;
    const payout = Math.round((Number(p.total_amount) || 100) * 0.85);
    const route = `${p.pickup_address?.split(',')[0]} ➔ ${p.drop_address?.split(',')[0]}`;
    const url = getDriverDispatchUrl(pId);
    return `*Job ${idx + 1} (${pId}):*\n📍 ${route} (${p.distance_km || 5} km)\n🛵 ${p.vehicle_type?.toUpperCase() || 'BIKE'} • ${p.parcel_type || 'Package'}\n💰 Rider Payout: *₹${payout}*\n👉 Claim Link: ${url}\n`;
  }).join('\n━━━━━━━━━━━━━━━━━━━━\n') +
`\n━━━━━━━━━━━━━━━━━━━━
_First rider to accept on their driver portal gets the order!_`;

  if (document.getElementById('bcastModalBadge')) document.getElementById('bcastModalBadge').innerText = `${openOrders.length} OPEN ORDERS`;
  if (document.getElementById('bcastModalFare')) document.getElementById('bcastModalFare').innerText = `Total ₹${totalVal}`;
  if (document.getElementById('bcastModalRoute')) document.getElementById('bcastModalRoute').innerText = `Multiple City Locations (${openOrders.length} Deliveries)`;
  if (document.getElementById('bcastModalVehicle')) document.getElementById('bcastModalVehicle').innerText = 'FLEET';
  if (document.getElementById('bcastModalDist')) document.getElementById('bcastModalDist').innerText = 'Various';
  if (document.getElementById('bcastModalPayout')) document.getElementById('bcastModalPayout').innerText = `₹${totalPayout}`;

  const previewEl = document.getElementById('bcastMessagePreview');
  if (previewEl) previewEl.value = digest;

  const waBtn = document.getElementById('btnLaunchWhatsAppBroadcast');
  if (waBtn) {
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(digest)}`;
  }

  const modalEl = document.getElementById('broadcastParcelModal');
  if (modalEl) {
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }
}

/* Real-time sync across tabs for incoming driver applications & parcel bookings */
window.addEventListener('storage', (e) => {
  if (e.key === 'rudraksha_rider_applications') {
    loadRiderApplications();
    renderDashboardRiderApps();
    renderRiderApplicationsTable();
    showAdminToast('🛵 New Driver Partner Application received!', 'new-order');
  } else if (e.key === 'rudraksha_parcels') {
    autoRefreshParcelPanel();
  }
});


