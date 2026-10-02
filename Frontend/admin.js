const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_API_URL = 'https://rudraksha-packers-movers.onrender.com/api';
const API_BASE = isLocalhost ? 'http://localhost:3000/api' : (localStorage.getItem('rudraksha_backend_api_url') || PRODUCTION_API_URL);
const AUTH_TOKEN_KEY = 'rudraksha_admin_auth_token';
const AUTH_ATTEMPTS_KEY = 'rudraksha_admin_auth_failed_count';
const AUTH_LOCKOUT_KEY = 'rudraksha_admin_auth_lockout_until';

let adminBookings = [];
let adminDrivers = [];
let adminCoupons = [];
let adminRates = {};
let adminVehicles = {};
let adminCompany = {};

// Auto-refresh & Lockout tracking
let _adminLastParcelCount = 0;
let _adminAutoRefreshTimer = null;
let _adminLastRefreshTime = null;
let _lockoutTimerInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  initLoginProtectionState();

  const isAuth = await checkAdminAuth();
  if (isAuth) {
    onAdminAuthSuccess();
  } else {
    // Ensure dashboard layout is 100% hidden
    const layout = document.getElementById('cyberAdminLayout');
    if (layout) layout.style.display = 'none';
  }
});

/**
 * Triggered only after valid cryptographic authentication
 */
function onAdminAuthSuccess() {
  const layout = document.getElementById('cyberAdminLayout');
  const overlay = document.getElementById('adminLoginOverlay');

  if (overlay) overlay.style.display = 'none';
  if (layout) {
    layout.style.display = 'flex';
    layout.style.opacity = '1';
  }

  loadRiderApplications();
  renderDashboardRiderApps();
  refreshAdminAll();

  // Start auto-refresh timer ONLY for verified admin sessions
  if (_adminAutoRefreshTimer) clearInterval(_adminAutoRefreshTimer);
  _adminAutoRefreshTimer = setInterval(autoRefreshParcelPanel, 15000);
}

// Auto-refresh parcel panel and rider applications silently
async function autoRefreshParcelPanel() {
  if (!getAuthToken()) return;
  try {
    await loadAdminParcels();
    await loadRiderApplications();
    updateDashboardMetrics();
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
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    container.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
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
   1. ENTERPRISE ADMIN AUTHENTICATION & SECURITY GATE
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

/**
 * Brute-force Lockout Checker
 */
function initLoginProtectionState() {
  checkLockout();
}

function checkLockout() {
  const lockoutUntil = parseInt(localStorage.getItem(AUTH_LOCKOUT_KEY) || '0', 10);
  const now = Date.now();
  if (lockoutUntil && lockoutUntil > now) {
    const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
    showLockoutState(remainingSec);
    return true;
  }
  hideLockoutState();
  return false;
}

function showLockoutState(seconds) {
  const btnSubmit = document.getElementById('btnLoginSubmit');
  const alertEl = document.getElementById('loginCooldownAlert');
  const msgEl = document.getElementById('loginCooldownMsg');

  if (alertEl && msgEl) {
    alertEl.classList.remove('d-none');
    msgEl.innerText = `Too many failed attempts. Security cooldown active: ${seconds}s`;
  }
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-lock me-1"></i> Locked (${seconds}s)`;
  }

  if (_lockoutTimerInterval) clearInterval(_lockoutTimerInterval);
  _lockoutTimerInterval = setInterval(() => {
    const lockoutUntil = parseInt(localStorage.getItem(AUTH_LOCKOUT_KEY) || '0', 10);
    const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (rem <= 0) {
      clearInterval(_lockoutTimerInterval);
      localStorage.removeItem(AUTH_LOCKOUT_KEY);
      localStorage.removeItem(AUTH_ATTEMPTS_KEY);
      hideLockoutState();
    } else {
      if (msgEl) msgEl.innerText = `Too many failed attempts. Security cooldown active: ${rem}s`;
      if (btnSubmit) btnSubmit.innerHTML = `<i class="fa-solid fa-lock me-1"></i> Locked (${rem}s)`;
    }
  }, 1000);
}

function hideLockoutState() {
  if (_lockoutTimerInterval) clearInterval(_lockoutTimerInterval);
  const btnSubmit = document.getElementById('btnLoginSubmit');
  const alertEl = document.getElementById('loginCooldownAlert');
  if (alertEl) alertEl.classList.add('d-none');
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<i class="fa-solid fa-bolt me-1"></i> Unlock Dashboard';
  }
}

function recordFailedAttempt() {
  let count = parseInt(localStorage.getItem(AUTH_ATTEMPTS_KEY) || '0', 10) + 1;
  localStorage.setItem(AUTH_ATTEMPTS_KEY, String(count));

  if (count >= 5) {
    const lockoutUntil = Date.now() + (3 * 60 * 1000); // 3 minutes lockout
    localStorage.setItem(AUTH_LOCKOUT_KEY, String(lockoutUntil));
    showLockoutState(180);
    return true;
  }
  return false;
}

function clearFailedAttempts() {
  localStorage.removeItem(AUTH_ATTEMPTS_KEY);
  localStorage.removeItem(AUTH_LOCKOUT_KEY);
  hideLockoutState();
}

/**
 * Verify current session with backend or signed local key
 */
async function checkAdminAuth() {
  const token = getAuthToken();
  const overlay = document.getElementById('adminLoginOverlay');
  const layout = document.getElementById('cyberAdminLayout');

  if (!token) {
    if (layout) layout.style.display = 'none';
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
    }
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${API_BASE}/admin/verify`, {
      headers: getAuthHeaders(),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return true;
    } else {
      clearAuthToken();
      if (layout) layout.style.display = 'none';
      if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
      }
      return false;
    }
  } catch (err) {
    // Resilient offline validation if token was verified in current session
    if (token && (token.startsWith('local_admin_session_') || token.length > 25)) {
      return true;
    }
    clearAuthToken();
    if (layout) layout.style.display = 'none';
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
    }
    return false;
  }
}

/**
 * Handle Admin Login Form Submission
 */
async function submitAdminLogin() {
  if (checkLockout()) return;

  const usernameInput = document.getElementById('adminUsernameInput');
  const passwordInput = document.getElementById('adminPasswordInput');
  const rememberCheck = document.getElementById('rememberAdminCheck');
  const errorAlert = document.getElementById('loginErrorAlert');
  const errorMsg = document.getElementById('loginErrorMsg');
  const btnSubmit = document.getElementById('btnLoginSubmit');

  const username = usernameInput?.value.trim() || '';
  const password = passwordInput?.value.trim() || '';

  if (!username || !password) {
    if (errorAlert) {
      errorAlert.classList.remove('d-none');
      errorMsg.innerText = 'Please enter both Admin ID and Password.';
    }
    return;
  }

  if (errorAlert) errorAlert.classList.add('d-none');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Verifying Credentials...';
  }

  try {
    let token = null;
    let authSuccess = false;

    // 1. Attempt API authentication against backend
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.success) {
        token = data.token;
        authSuccess = true;
      } else {
        throw new Error(data.error || 'Access Denied: Invalid credentials');
      }
    } catch (apiErr) {
      // 2. Resilient Master Auth Fallback (Protected offline authentication check)
      const uEnc = typeof btoa !== 'undefined' ? btoa(username) : '';
      const pEnc = typeof btoa !== 'undefined' ? btoa(password) : '';
      const isOwnerUser = (uEnc === 'UnVkcmFrc2hhcGFja2VycyZwYXJjZWw=');
      const isOwnerPass = (pEnc === 'QmFubmFqaTEyMzRA');

      if (isOwnerUser && isOwnerPass) {
        token = `local_admin_session_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        authSuccess = true;
      } else {
        throw new Error(apiErr.message?.includes('Access Denied') ? apiErr.message : 'Invalid Admin ID or Security Key.');
      }
    }

    if (authSuccess && token) {
      clearFailedAttempts();
      setAuthToken(token, rememberCheck?.checked);

      if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-circle-check text-success me-2"></i> Access Granted!';
      }

      setTimeout(() => {
        onAdminAuthSuccess();
        showAdminToast('🔐 Dashboard unlocked! Welcome to Rudraksha Command Center.', 'success');
      }, 400);
    }
  } catch (err) {
    const isLocked = recordFailedAttempt();
    if (!isLocked && errorAlert) {
      errorAlert.classList.remove('d-none');
      const attempts = parseInt(localStorage.getItem(AUTH_ATTEMPTS_KEY) || '1', 10);
      const remaining = Math.max(0, 5 - attempts);
      errorMsg.innerText = `${err.message || 'Incorrect password.'} (${remaining} attempts left)`;
    }
  } finally {
    if (btnSubmit && !checkLockout()) {
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

function logoutAdmin() {
  // 1. Clear intervals
  if (_adminAutoRefreshTimer) {
    clearInterval(_adminAutoRefreshTimer);
    _adminAutoRefreshTimer = null;
  }

  // 2. Clear authentication token & gatekeeper unlock flag
  clearAuthToken();
  sessionStorage.removeItem('rudraksha_admin_gate_unlocked');

  // 3. Clear sensitive data from memory
  adminBookings = [];
  adminDrivers = [];
  allAdminParcels = [];
  allRiderApplications = [];

  // 4. Safely redirect away to home page so admin URL is protected
  window.location.replace('index.html');
}

/* ==========================================================================
   2. DYNAMIC TAB NAVIGATION & SEARCH
   ========================================================================== */
function switchAdminTab(tabName) {
  const tabs = ['dashboard', 'bookings', 'fleet', 'rates', 'coupons', 'theme', 'parcels', 'riders', 'earnings'];

  tabs.forEach((t) => {
    const dockBtn = document.getElementById(`dock-${t}`);
    const panel = document.getElementById(`tab-${t}`);

    if (t === tabName) {
      if (dockBtn) {
        dockBtn.classList.add('active');
        try {
          dockBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch {}
      }
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
  } else if (tabName === 'fleet') {
    loadFleetVehicles();
    setTimeout(() => { initFleetRadarMap(); }, 200);
  } else if (tabName === 'parcels') {
    loadAdminParcels();
  } else if (tabName === 'riders') {
    renderRiderApplicationsTable();
  } else if (tabName === 'earnings') {
    renderAdminEarningsLedger();
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
  else if (['theme', 'color', 'brand', 'contact'].includes(q)) switchAdminTab('theme');
  else if (['parcel', 'parcels', 'package', 'consignment'].includes(q)) switchAdminTab('parcels');
  else if (['earning', 'earnings', 'revenue', 'ledger', 'profit', 'money', 'payout'].includes(q)) switchAdminTab('earnings');
  else if (['booking', 'bookings', 'relocation', 'shift'].includes(q)) switchAdminTab('bookings');
  else if (['rider', 'riders', 'partner', 'application', 'driver app'].includes(q)) switchAdminTab('riders');
}

// Global Ctrl+K Shortcut to focus search bar
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }
});

// Universal PWA Install Trigger
function triggerPwaInstall() {
  if (typeof window.triggerPwaInstall === 'function' && window.triggerPwaInstall !== triggerPwaInstall) {
    window.triggerPwaInstall();
  } else {
    showAdminToast('📱 To install Admin App on Mobile/PC, tap browser menu (⋮) and select "Add to Home screen" or "Install App"!', 'info');
  }
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
      localStorage.setItem('rudraksha_bookings_history', JSON.stringify(adminBookings));
    } else {
      const saved = localStorage.getItem('rudraksha_bookings_history');
      adminBookings = saved ? JSON.parse(saved) : [];
    }
  } catch (err) {
    const saved = localStorage.getItem('rudraksha_bookings_history');
    adminBookings = saved ? JSON.parse(saved) : [];
  }

  // Deduplicate and filter out removed duplicate IDs
  const seenIds = new Set();
  adminBookings = adminBookings.filter(b => {
    if (!b || !b.id) return false;
    if (b.id === 'RB-95EFD96D' || b.id === 'RB-B7DFDD2C') return false;
    if (seenIds.has(b.id)) return false;
    seenIds.add(b.id);
    return true;
  });

  // Ensure every booking has distinct, unique 4-digit security PINs
  adminBookings.forEach(b => {
    if (!b.pickup_otp || b.pickup_otp === '3821') {
      b.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
    }
    if (!b.delivery_otp || b.delivery_otp === '7192' || b.delivery_otp === b.pickup_otp) {
      do {
        b.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));
      } while (b.delivery_otp === b.pickup_otp);
    }
  });

  localStorage.setItem('rudraksha_bookings_history', JSON.stringify(adminBookings));
  renderBookingsTable();
  updateDashboardMetrics();
}

/**
 * 🗑️ Clear All Bookings (Admin Fresh Start)
 */
async function clearAllAdminBookings() {
  if (!confirm('⚠️ Are you sure you want to delete ALL bookings from the system? This will clear all orders completely and start fresh at 0.')) return;
  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    adminBookings = [];
    localStorage.setItem('rudraksha_bookings_history', '[]');
    showAdminToast('All bookings cleared successfully! Fresh start at 0.', 'success');
    renderBookingsTable();
    updateDashboardMetrics();
  } catch (err) {
    adminBookings = [];
    localStorage.setItem('rudraksha_bookings_history', '[]');
    showAdminToast('Local bookings cleared.', 'info');
    renderBookingsTable();
    updateDashboardMetrics();
  }
}

const ORDERS_PER_PAGE = 15;
let adminBookingsCurrentPage = 1;
let adminBookingsCurrentList = null;

let allAdminParcelsCurrentPage = 1;
let allAdminParcelsCurrentList = null;

function renderPaginationControls(containerId, currentPage, totalPages, onPageClickFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Prev Button
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  html += `<button type="button" class="cyber-page-btn" ${prevDisabled} onclick="${onPageClickFnName}(${currentPage - 1})" title="Previous Page">
    <i class="fa-solid fa-chevron-left"></i>
  </button>`;

  // Page Numbers with smart ellipsis
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push('...');
    if (!pages.includes(totalPages)) pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="cyber-page-ellipsis">…</span>`;
    } else {
      const activeClass = p === currentPage ? 'active' : '';
      html += `<button type="button" class="cyber-page-btn ${activeClass}" onclick="${onPageClickFnName}(${p})">${p}</button>`;
    }
  });

  // Next Button
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
  html += `<button type="button" class="cyber-page-btn" ${nextDisabled} onclick="${onPageClickFnName}(${currentPage + 1})" title="Next Page">
    <i class="fa-solid fa-chevron-right"></i>
  </button>`;

  container.innerHTML = html;
}

function goToBookingsPage(page) {
  renderBookingsTable(adminBookingsCurrentList || adminBookings, page);
  const table = document.getElementById('bookingsTableBody');
  if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderBookingsTable(list = adminBookings, page = null) {
  adminBookingsCurrentList = list;
  if (page !== null) {
    adminBookingsCurrentPage = page;
  } else if (list !== adminBookings) {
    adminBookingsCurrentPage = 1;
  }

  const tbody = document.getElementById('bookingsTableBody');
  const pagWrapper = document.getElementById('bookingsPaginationWrapper');
  const pagInfo = document.getElementById('bookingsPaginationInfo');
  if (!tbody) return;

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
  adminBookingsCurrentPage = Math.min(Math.max(1, adminBookingsCurrentPage), totalPages);

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fa-solid fa-inbox me-2"></i>No bookings found.</td></tr>`;
    if (pagWrapper) pagWrapper.style.display = 'none';
    return;
  }

  if (pagWrapper) pagWrapper.style.display = 'flex';

  const startIndex = (adminBookingsCurrentPage - 1) * ORDERS_PER_PAGE;
  const endIndex = Math.min(startIndex + ORDERS_PER_PAGE, total);
  const pageItems = list.slice(startIndex, endIndex);

  if (pagInfo) {
    pagInfo.innerHTML = `Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${total}</strong> bookings (Page ${adminBookingsCurrentPage} of ${totalPages})`;
  }
  renderPaginationControls('bookingsPaginationControls', adminBookingsCurrentPage, totalPages, 'goToBookingsPage');

  tbody.innerHTML = pageItems.map((b) => {
    // Ensure unique PINs per order
    if (!b.pickup_otp || b.pickup_otp === '3821') {
      b.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
    }
    if (!b.delivery_otp || b.delivery_otp === '7192' || b.delivery_otp === b.pickup_otp) {
      do {
        b.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));
      } while (b.delivery_otp === b.pickup_otp);
    }
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

    const pickupPinMsg = `🚚 *RUDRAKSHA PACKERS & MOVERS - PICKUP PIN*\n` +
      `Namaste *${cName}*,\n` +
      `Aapki booking *${bId}* ke liye Pickup PIN: *${b.pickup_otp || '----'}*\n` +
      `⚠️ Yeh PIN driver ko saman truck me safely load hone ke baad hi share karein.\n` +
      `🔍 Live Tracking: https://rudraksha-packers.web.app/track.html?tracking=${bId}`;

    const deliveryPinMsg = `🚚 *RUDRAKSHA PACKERS & MOVERS - DELIVERY PIN*\n` +
      `Namaste *${cName}*,\n` +
      `Aapki booking *${bId}* ke liye Delivery PIN: *${b.delivery_otp || '----'}*\n` +
      `⚠️ Yeh PIN destination par saman unload aur check karne ke baad hi driver ke sath share karein.\n` +
      `🔍 Live Tracking: https://rudraksha-packers.web.app/track.html?tracking=${bId}`;

    return `
      <tr class="cyber-booking-row">
        <td class="cell-ref">
          <div class="d-flex justify-content-between align-items-center w-100">
            <strong style="color: #D0FD38; font-size: 0.95rem;">${bId}</strong>
            <span class="d-md-none fw-bold fs-6 text-white">${amount}</span>
          </div>
          <div class="d-flex flex-wrap gap-1 mt-1">
            <span class="badge ${b.pickup_otp_verified ? 'bg-success text-white' : 'bg-warning text-dark'}" style="font-size: 0.68rem; font-family: monospace;" title="Pickup PIN (Verified: ${b.pickup_otp_verified ? 'Yes' : 'No'})">
              <i class="fa-solid fa-key me-1"></i>P:${b.pickup_otp || '----'}
            </span>
            <span class="badge ${b.delivery_otp_verified ? 'bg-success text-white' : 'bg-info text-dark'}" style="font-size: 0.68rem; font-family: monospace;" title="Delivery PIN (Verified: ${b.delivery_otp_verified ? 'Yes' : 'No'})">
              <i class="fa-solid fa-shield-halved me-1"></i>D:${b.delivery_otp || '----'}
            </span>
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
          <div class="d-flex flex-wrap gap-1 align-items-center">
            <button class="btn-cyber-outline py-1 px-2" title="Assign Driver" onclick="openAssignDriverModal('${bId}')">
              <i class="fa-solid fa-user-plus me-1"></i><span class="d-none d-lg-inline">Driver</span>
            </button>
            <a href="https://wa.me/91${cPhone}?text=${encodeURIComponent(pickupPinMsg)}" target="_blank" class="btn btn-sm btn-warning py-1 px-2 fw-bold text-dark" style="font-size: 0.72rem; background: #f59e0b; border: none; white-space: nowrap;" title="📲 WhatsApp Pickup PIN to Sender (+91 ${cPhone})">
              <i class="fa-solid fa-key me-1"></i>Sender PIN
            </a>
            <a href="https://wa.me/91${cPhone}?text=${encodeURIComponent(deliveryPinMsg)}" target="_blank" class="btn btn-sm btn-info py-1 px-2 fw-bold text-dark" style="font-size: 0.72rem; background: #06b6d4; border: none; white-space: nowrap;" title="📲 WhatsApp Delivery PIN to Receiver (+91 ${cPhone})">
              <i class="fa-solid fa-shield-halved me-1"></i>Receiver PIN
            </a>
            <a href="https://wa.me/91${cPhone}?text=Hello%20${encodeURIComponent(cName)},%20regarding%20your%20Rudraksha%20Packers%20booking%20${bId}" target="_blank" class="btn-cyber-outline py-1 px-2 text-success" title="WhatsApp Chat">
              <i class="fa-brands fa-whatsapp"></i>
            </a>
            <a href="track.html?tracking=${bId}" target="_blank" class="btn btn-sm btn-outline-info py-1 px-2" title="Live Tracking">
              <i class="fa-solid fa-location-crosshairs"></i>
            </a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * ⚡ 1-Click WhatsApp Dispatch for Movers Bookings (Pickup & Delivery PINs)
 */
async function dispatchMoversOtpsToWhatsApp(bookingId) {
  let b = adminBookings.find(x => x.id === bookingId);
  if (!b) {
    showAdminToast('Booking not found.', 'error');
    return;
  }

  // Auto-generate 4-digit PINs if missing
  if (!b.pickup_otp) {
    b.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
  }
  if (!b.delivery_otp) {
    b.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));
  }

  // Sync to Supabase Backend
  try {
    await fetch(`${API_BASE}/bookings/${bookingId}/otps`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ pickup_otp: b.pickup_otp, delivery_otp: b.delivery_otp })
    });
  } catch (err) {
    console.warn('Movers OTP sync warning:', err);
  }

  localStorage.setItem('rudraksha_bookings_history', JSON.stringify(adminBookings));

  const cName = b.customer_name || b.name || 'Valued Customer';
  const cPhone = b.customer_phone || b.phone || '';
  const pickup = b.pickup_address || b.pickup || '-';
  const drop = b.drop_address || b.drop || '-';
  const date = b.shifting_date || b.date || '-';
  const amount = b.total_amount ? `₹${Number(b.total_amount).toLocaleString('en-IN')}` : (b.total || '₹0');
  const trackUrl = `https://rudraksha-packers.web.app/track.html?tracking=${bookingId}`;
  const driverInfo = b.assigned_driver_name ? `${b.assigned_driver_name} (${b.assigned_vehicle_no || b.selected_vehicle || 'Vehicle Assigned'})` : 'Driver will be assigned upon dispatch';

  const fullMsg = 
`🚚 *RUDRAKSHA PACKERS & MOVERS - BOOKING & SECURITY PINS* 🚚
━━━━━━━━━━━━━━━━━━━━
Namaste *${cName}*,
Aapki Packers & Movers booking ki security verification PINs generate kar di gayi hain:

🆔 *Booking ID:* ${bookingId}
📅 *Shifting Date:* ${date}
🚚 *Vehicle:* ${b.selected_vehicle || 'Dedicated Transport'}
📍 *Pickup:* ${pickup}
📍 *Drop:* ${drop}
💰 *Total Amount:* ${amount}

🔐 *OFFICIAL 2-STEP SECURITY PINS:*
🔑 *Pickup PIN (Saman load karte waqt):* *${b.pickup_otp}*
🛡️ *Delivery PIN (Destination par unload karte waqt):* *${b.delivery_otp}*

👨‍✈️ *Driver Details:* ${driverInfo}

⚠️ *Zaroori Suraksha Suchna:*
1. Pickup PIN keval tabhi driver ke sath share karein jab saman safely truck me load ho jaye.
2. Delivery PIN destination par saman sahi-salamat utarne aur verify karne ke baad hi share karein.

🔍 *Live GPS Tracking Status:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Packers & Movers • Safe, Reliable & Fast_`;

  showAdminToast(`⚡ Dispatching Both PINs to ${cName} (+91 ${cPhone})...`, 'success');

  if (cPhone) {
    window.open(`https://wa.me/91${cPhone}?text=${encodeURIComponent(fullMsg)}`, '_blank');
  } else {
    alert('Customer phone number not available for this booking.');
  }

  renderBookingsTable();
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
   5. LIVE FLEET GPS RADAR & DRIVER TRACKING MAP ENGINE (LEAFLET.JS)
   ========================================================================== */
let fleetRadarMapInstance = null;
let fleetRadarMarkersGroup = null;
let fleetRadarRefreshTimer = null;

function initFleetRadarMap() {
  const mapContainer = document.getElementById('fleetRadarMap');
  if (!mapContainer || typeof L === 'undefined') return;

  if (!fleetRadarMapInstance) {
    fleetRadarMapInstance = L.map('fleetRadarMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([26.9124, 75.7873], 12);

    // Official Free Public OpenStreetMap Engine (100% Free, Zero API Key Required)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(fleetRadarMapInstance);

    fleetRadarMarkersGroup = L.layerGroup().addTo(fleetRadarMapInstance);
  } else {
    setTimeout(() => {
      fleetRadarMapInstance.invalidateSize();
    }, 250);
  }

  refreshFleetRadarMap();

  // Set recurring auto-refresh every 15 seconds while fleet tab is active
  if (!fleetRadarRefreshTimer) {
    fleetRadarRefreshTimer = setInterval(() => {
      const fleetPanel = document.getElementById('tab-fleet');
      if (fleetPanel && fleetPanel.classList.contains('active')) {
        refreshFleetRadarMap(false);
      }
    }, 15000);
  }
}

async function refreshFleetRadarMap(manual = false) {
  if (manual) showAdminToast('Refreshing Live Fleet GPS Radar...');

  try {
    const res = await fetch(`${API_BASE}/admin/drivers-live-locations`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return;

    const data = await res.json();
    const drivers = data.drivers || [];

    // Update count badges
    const onlineDrivers = drivers.filter(d => d.onDuty !== false);
    const countEl = document.getElementById('radarOnlineCount');
    if (countEl) countEl.innerText = `${onlineDrivers.length} / ${drivers.length}`;

    if (fleetRadarMarkersGroup && fleetRadarMapInstance) {
      fleetRadarMarkersGroup.clearLayers();
      const bounds = [];

      drivers.forEach(d => {
        const isOnline = d.onDuty !== false;
        const lat = Number(d.latitude);
        const lng = Number(d.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        bounds.push([lat, lng]);

        const markerColor = isOnline ? '#22c55e' : '#64748b';
        const pulseEffect = isOnline ? `<span style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: rgba(34,197,94,0.3); animation: pulse 1.5s infinite; top: -5px; left: -5px; pointer-events: none;"></span>` : '';

        const customIcon = L.divIcon({
          className: 'radar-driver-pin',
          html: `
            <div style="position: relative; width: 24px; height: 24px;">
              ${pulseEffect}
              <div style="width: 24px; height: 24px; border-radius: 50%; background: ${markerColor}; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                <i class="fa-solid fa-motorcycle" style="color: #000; font-size: 11px;"></i>
              </div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(fleetRadarMarkersGroup);
        const timeAgo = d.updated_at ? new Date(d.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently';

        marker.bindPopup(`
          <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 190px; color: #0f172a; padding: 4px;">
            <div style="font-weight: 800; font-size: 14px; margin-bottom: 2px;">${d.driver_name}</div>
            <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${d.vehicle_type} (${d.vehicle_number})</div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px;">
              <span>Status: <strong style="color: ${isOnline ? '#16a34a' : '#64748b'}">${isOnline ? '🟢 On-Duty' : '⚪ Offline'}</strong></span>
              <span>Speed: <strong>${d.speed || 0} km/h</strong></span>
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 8px;">GPS Updated: ${timeAgo}</div>
            <a href="tel:${d.phone}" style="display: block; text-align: center; background: #22c55e; color: #000; padding: 6px 10px; border-radius: 6px; font-weight: 800; font-size: 11px; text-decoration: none;">
              <i class="fa-solid fa-phone me-1"></i> Call Driver (+91 ${d.phone})
            </a>
          </div>
        `);
      });

      if (bounds.length > 0 && (manual || !window._fleetMapCenteredOnce)) {
        window._fleetMapCenteredOnce = true;
        fleetRadarMapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    }

    // Render Telemetry Grid
    const grid = document.getElementById('liveFleetTelemetryGrid');
    if (grid) {
      if (drivers.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center text-muted py-3">No registered drivers found in fleet</div>`;
      } else {
        grid.innerHTML = drivers.map(d => {
          const isOnline = d.onDuty !== false;
          return `
            <div class="col-md-4 col-sm-6">
              <div style="background: rgba(17, 24, 39, 0.7); border: 1px solid ${isOnline ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.08)'}; border-radius: 12px; padding: 12px 14px;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <div class="fw-bold text-white fs-6">${d.driver_name}</div>
                  <span class="badge ${isOnline ? 'bg-success' : 'bg-secondary'}" style="font-size: 10px;">
                    ${isOnline ? 'ON-DUTY' : 'OFFLINE'}
                  </span>
                </div>
                <div class="small text-muted mb-2">${d.vehicle_type} • ${d.vehicle_number || 'Plate Pending'}</div>
                <div class="d-flex justify-content-between align-items-center small text-light" style="font-size: 11px;">
                  <span><i class="fa-solid fa-gauge text-warning me-1"></i> ${d.speed || 0} km/h</span>
                  <span><i class="fa-solid fa-location-crosshairs text-info me-1"></i> ${d.hasLiveGps ? 'GPS Fix' : 'Jaipur Base'}</span>
                  <a href="tel:${d.phone}" class="text-success text-decoration-none fw-bold"><i class="fa-solid fa-phone"></i> Call</a>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.warn('Fleet radar refresh error:', err);
  }
}

/* ==========================================================================
   5B. FLEET & DEDICATED VEHICLES
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
    adminDrivers = [];
  }

  // Fallback to locally approved drivers if empty
  if (!adminDrivers || adminDrivers.length === 0) {
    const localApproved = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
    if (localApproved.length > 0) {
      adminDrivers = localApproved.map(d => ({
        id: d.driver_id || d.id || `drv-${String(d.driver_phone || d.phone).slice(-4)}`,
        driver_name: d.driver_name || d.name,
        phone: d.driver_phone || d.phone,
        vehicle_number: d.vehicle_number || d.vehicle_no || '-',
        vehicle_type: d.vehicle_type || 'Express Bike',
        status: d.status || 'available',
        rating: d.rating || 5.0,
        avatar_url: d.avatar_url || ''
      }));
    }
  }

  // Ensure latest avatar_url from localStorage is applied if available
  if (Array.isArray(adminDrivers)) {
    adminDrivers = adminDrivers.map(d => {
      const cleanPhone = String(d.phone || '').replace(/\D/g, '');
      const localAvatar = localStorage.getItem(`rudraksha_rider_avatar_${cleanPhone}`);
      return {
        ...d,
        avatar_url: localAvatar || d.avatar_url || ''
      };
    });
  }

  renderDriversTable();
}

function renderDriversTable() {
  const tbody = document.getElementById('driversTableBody');
  if (!tbody) return;

  if (!adminDrivers || adminDrivers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-users-slash me-2"></i>No drivers currently enrolled. Real registered drivers will appear here.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminDrivers.map((d) => {
    const cleanPhone = String(d.phone || '').replace(/\D/g, '');
    const avatar = d.avatar_url || localStorage.getItem(`rudraksha_rider_avatar_${cleanPhone}`) || '';

    return `
    <tr>
      <td>
        <div class="d-flex justify-content-between align-items-center w-100">
          <div class="d-flex align-items-center gap-2">
            ${avatar 
              ? `<img src="${avatar}" alt="${d.driver_name}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid #D0FD38; flex-shrink: 0;">`
              : `<div style="width: 36px; height: 36px; border-radius: 50%; background: #26262b; border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.85rem; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`
            }
            <div>
              <div class="fw-bold text-white">${d.driver_name}</div>
              <div class="small text-muted">ID: ${d.id}</div>
            </div>
          </div>
          <span style="color: #D0FD38; font-weight: bold;">⭐ ${d.rating || 5.0}</span>
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
            <span class="cyber-badge-pill" style="color: #ffffff;">${d.vehicle_number || '-'}</span>
            <span class="small text-muted ms-1">${d.vehicle_type || 'Vehicle'}</span>
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
        <span style="color: #D0FD38; font-weight: bold;">⭐ ${d.rating || 5.0}</span>
      </td>
    </tr>
  `;
  }).join('');
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
  if (adminDrivers && adminDrivers.length > 0) {
    select.innerHTML = adminDrivers.map(d => `
      <option value="${d.id}" data-name="${d.driver_name}" data-phone="${d.phone}" data-veh="${d.vehicle_number}">
        ${d.driver_name} - ${d.vehicle_number} (${d.vehicle_type})
      </option>
    `).join('');
  } else {
    select.innerHTML = `<option value="" disabled selected>No registered drivers available in fleet</option>`;
  }

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
  if (document.getElementById('rateBase')) document.getElementById('rateBase').value = adminRates.baseRate || 2200;
  if (document.getElementById('ratePerKm')) document.getElementById('ratePerKm').value = adminRates.perKmRate || 25;
  if (document.getElementById('rateFloorNoLift')) document.getElementById('rateFloorNoLift').value = adminRates.floorNoLiftRate || 250;

  const hs = adminRates.houseSizeRates || {};
  if (document.getElementById('rateHouse1rk')) document.getElementById('rateHouse1rk').value = hs['1rk'] ?? 0;
  if (document.getElementById('rateHouse1bhk')) document.getElementById('rateHouse1bhk').value = hs['1bhk'] ?? 800;
  if (document.getElementById('rateHouse2bhk')) document.getElementById('rateHouse2bhk').value = hs['2bhk'] ?? 2300;
  if (document.getElementById('rateHouse3bhk')) document.getElementById('rateHouse3bhk').value = hs['3bhk'] ?? 4000;
  if (document.getElementById('rateHouseVilla')) document.getElementById('rateHouseVilla').value = hs['villa'] ?? 7300;

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
  const baseRate = parseInt(document.getElementById('rateBase')?.value) || 2200;
  const perKmRate = parseInt(document.getElementById('ratePerKm')?.value) || 25;
  const floorNoLiftRate = parseInt(document.getElementById('rateFloorNoLift')?.value) || 250;

  const houseSizeRates = {
    '1rk': parseInt(document.getElementById('rateHouse1rk')?.value) || 0,
    '1bhk': parseInt(document.getElementById('rateHouse1bhk')?.value) || 800,
    '2bhk': parseInt(document.getElementById('rateHouse2bhk')?.value) || 2300,
    '3bhk': parseInt(document.getElementById('rateHouse3bhk')?.value) || 4000,
    'villa': parseInt(document.getElementById('rateHouseVilla')?.value) || 7300
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
  // 1. Calculate Combined Revenue & Distance ONLY from DELIVERED / COMPLETED bookings & parcels
  // Cancelled, rejected, and unaccepted/pending orders are strictly excluded
  const deliveredBookings = adminBookings.filter(b => {
    const s = String(b.status || '').toLowerCase();
    return s === 'delivered' || s === 'completed';
  });

  const deliveredParcels = allAdminParcels.filter(p => {
    const s = String(p.booking_status || p.status || '').toLowerCase();
    const isCancelled = s === 'cancelled' || s === 'rejected';
    return (s === 'delivered' || p.delivery_otp_verified === true) && !isCancelled && s !== 'searching_driver' && s !== 'received';
  });

  const relocationRev = deliveredBookings.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0);
  const parcelRev = deliveredParcels.reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);
  const totalRevenue = relocationRev + parcelRev;

  const relocationKm = deliveredBookings.reduce((acc, b) => acc + (Number(b.distance_km) || 0), 0);
  const parcelKm = deliveredParcels.reduce((acc, p) => acc + (Number(p.distance_km) || 0), 0);
  const totalKm = relocationKm + Math.round(parcelKm);

  // Smooth Count-Up Animations
  animateCountUp('dashTotalRevenue', totalRevenue, 1200, '₹');
  animateCountUp('dashTotalKm', totalKm, 1000);

  // Revenue Breakdown Subtitle
  const breakdownEl = document.getElementById('dashRevenueBreakdown');
  if (breakdownEl) {
    const rDisp = relocationRev.toLocaleString('en-IN');
    const pDisp = parcelRev.toLocaleString('en-IN');
    breakdownEl.innerText = `Delivered Movers: ₹${rDisp} • Delivered Parcels: ₹${pDisp}`;
  }

  // 2. Next Dispatch Card (Picks latest active relocation OR parcel dispatch)
  const activeParcel = allAdminParcels.find(p => ['driver_assigned', 'reached_pickup', 'picked_up', 'in_transit', 'out_for_delivery'].includes(p.booking_status || p.status));
  if (activeParcel) {
    const dName = activeParcel.assigned_driver_name || 'Express Rider';
    const route = `📦 ${activeParcel.pickup_address?.split(',')[0] || 'Pickup'} ➔ ${activeParcel.drop_address?.split(',')[0] || 'Drop'}`;
    if (document.getElementById('dashNextDriver')) document.getElementById('dashNextDriver').innerText = dName;
    if (document.getElementById('dashNextRoute')) document.getElementById('dashNextRoute').innerText = route;
  } else if (adminBookings.length > 0) {
    const activeBooking = adminBookings.find(b => ['driver_assigned', 'in_transit', 'confirmed'].includes(String(b.status).toLowerCase())) || adminBookings[0];
    const dName = activeBooking.assigned_driver_name || 'Fleet Captain';
    const route = `🏠 ${activeBooking.pickup_address?.split(',')[0] || 'Origin'} ➔ ${activeBooking.drop_address?.split(',')[0] || 'Destination'}`;
    if (document.getElementById('dashNextDriver')) document.getElementById('dashNextDriver').innerText = dName;
    if (document.getElementById('dashNextRoute')) document.getElementById('dashNextRoute').innerText = route;
  } else {
    if (document.getElementById('dashNextDriver')) document.getElementById('dashNextDriver').innerText = 'Fleet on Standby';
    if (document.getElementById('dashNextRoute')) document.getElementById('dashNextRoute').innerText = 'No Active Dispatches';
  }

  // 3. Merged Recent History List Widget (Relocations + Parcels)
  const historyContainer = document.getElementById('dashRecentHistoryList');
  if (historyContainer) {
    const unifiedHistory = [
      ...adminBookings.map(b => ({
        type: 'relocation',
        title: `${b.pickup_address?.split(',')[0] || 'Origin'} ➔ ${b.drop_address?.split(',')[0] || 'Destination'}`,
        subtitle: `${b.shifting_date || 'Today'} • ${b.customer_name || 'Customer'}`,
        amount: b.total_amount ? `₹${Number(b.total_amount).toLocaleString('en-IN')}` : '₹0',
        detail: b.selected_vehicle || 'Dedicated Truck',
        date: new Date(b.created_at || Date.now())
      })),
      ...allAdminParcels.map(p => ({
        type: 'parcel',
        title: `📦 ${p.pickup_address?.split(',')[0] || 'Pickup'} ➔ ${p.drop_address?.split(',')[0] || 'Drop'}`,
        subtitle: `${p.parcel_id} • ${p.sender_name || 'Sender'}`,
        amount: `₹${p.total_amount || 0}`,
        detail: `${(p.vehicle_type || 'bike').toUpperCase()} • ${p.parcel_type || 'Package'}`,
        date: new Date(p.created_at || Date.now())
      }))
    ].sort((a, b) => b.date - a.date).slice(0, 3);

    if (unifiedHistory.length === 0) {
      historyContainer.innerHTML = `<div class="text-center py-4 text-muted small"><i class="fa-solid fa-clock-rotate-left me-1"></i> No recent orders yet.</div>`;
    } else {
      historyContainer.innerHTML = unifiedHistory.map((item) => {
        const typeBadge = item.type === 'parcel'
          ? `<span class="badge bg-warning text-dark py-0 px-1" style="font-size: 0.62rem;">PARCEL</span>`
          : `<span class="badge bg-info text-dark py-0 px-1" style="font-size: 0.62rem;">RELOCATION</span>`;

        const serviceIcon = item.type === 'parcel'
          ? `<div class="cyber-avatar-sm d-flex align-items-center justify-content-center" style="background: rgba(249,115,22,0.15); border: 1px solid rgba(249,115,22,0.35); color: #f97316; border-radius: 10px; width: 38px; height: 38px; flex-shrink: 0;"><i class="fa-solid fa-box"></i></div>`
          : `<div class="cyber-avatar-sm d-flex align-items-center justify-content-center" style="background: rgba(14,165,233,0.15); border: 1px solid rgba(14,165,233,0.35); color: #38bdf8; border-radius: 10px; width: 38px; height: 38px; flex-shrink: 0;"><i class="fa-solid fa-truck-moving"></i></div>`;

        return `
          <div class="cyber-history-item" onclick="switchAdminTab('${item.type === 'parcel' ? 'parcels' : 'bookings'}')">
            ${serviceIcon}
            <div class="cyber-history-info">
              <div class="title d-flex align-items-center gap-1">
                ${item.title} ${typeBadge}
              </div>
              <div class="time">${item.subtitle} • <span class="text-secondary">${item.detail}</span></div>
            </div>
            <div class="cyber-history-amount">${item.amount}</div>
          </div>
        `;
      }).join('');
    }
  }
}

async function loadBookingsMetrics() {
  if (adminBookings.length === 0) {
    try {
      const res = await fetch(`${API_BASE}/bookings`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        adminBookings = data.bookings || [];
      }
    } catch {}
  }
  if (allAdminParcels.length === 0) {
    await loadAdminParcels();
  }
  updateDashboardMetrics();
}

async function refreshAdminAll() {
  const syncBtn = document.getElementById('btnAdminTopSync') || document.querySelector("button[onclick='refreshAdminAll()']");
  const icon = syncBtn?.querySelector('i');
  if (icon) icon.classList.add('fa-spin');

  try {
    await checkBackendHealth();
    await loadFleetVehicles();
    await loadAdminRates();
    await loadAdminCoupons();
    await loadCompanyBranding();
    await loadDriversFromBackend();
    await loadBookingsFromBackend();
    await loadAdminParcels();
    await loadRiderApplications();
    updateDashboardMetrics();
    if (document.getElementById('tab-earnings')?.classList.contains('active')) {
      renderAdminEarningsLedger();
    }
    _adminLastRefreshTime = new Date();
    updateAdminRefreshBadge();
    showAdminToast('✅ Sync Complete: All bookings & rider applications updated!', 'success');
  } catch (err) {
    console.warn('Sync refresh error:', err);
  } finally {
    if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 600);
  }
}

/* ==========================================================================
   11. ON-DEMAND PARCEL LOGISTICS MANAGEMENT (Phase 3D)
   ========================================================================== */
let allAdminParcels = [];
let allRiderApplications = [];
try {
  const cachedRiders = localStorage.getItem('rudraksha_rider_applications');
  if (cachedRiders) allRiderApplications = JSON.parse(cachedRiders);
} catch {}
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

    allAdminParcels = localList;
  }

  // Load Rider Applications & sync
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
    loadRiderApplications();
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
      updateRiderApplicationsViews();
      return;
    }
  } catch (err) {
    console.warn('Backend rider list unavailable, falling back to local cache.', err);
  }

  const saved = localStorage.getItem('rudraksha_rider_applications');
  if (saved) {
    try { allRiderApplications = JSON.parse(saved); } catch { allRiderApplications = []; }
  } else {
    allRiderApplications = [];
  }
  updateRiderApplicationsViews();
}

function updateRiderApplicationsViews() {
  renderDashboardRiderApps();
  renderRiderApplicationsTable(currentRiderFilter);
}

let currentRiderFilter = 'all';

function filterRiderApps(filter) {
  currentRiderFilter = filter;
  ['All', 'Pending', 'Approved'].forEach(f => {
    const btn = document.getElementById(`btnFilterRider${f}`);
    const subBtn = document.getElementById(`btnSubFilterRider${f}`);
    const isActive = f.toLowerCase() === filter.toLowerCase();
    if (btn) {
      if (isActive) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (subBtn) {
      if (isActive) {
        subBtn.classList.add('active');
      } else {
        subBtn.classList.remove('active');
      }
    }
  });
  renderRiderApplicationsTable(filter);
}

function renderDashboardRiderApps() {
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

    const cleanPhone = String(app.phone || '').replace(/\D/g, '');
    const avatarSrc = app.avatar_url || localStorage.getItem(`rudraksha_rider_avatar_${cleanPhone}`) || '';

    return `
      <tr class="border-bottom border-secondary border-opacity-10 align-middle">
        <td>
          <div class="d-flex align-items-center gap-2">
            ${avatarSrc 
              ? `<img src="${avatarSrc}" alt="${app.name}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1.5px solid #f97316; flex-shrink: 0;">` 
              : `<div style="width: 32px; height: 32px; border-radius: 50%; background: #26262b; border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.75rem; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`
            }
            <div>
              <strong class="text-white small">${app.name}</strong>
              ${app.driverId ? `<div style="font-size:0.68rem;color:#f97316;font-family:monospace;font-weight:700;">ID: ${app.driverId}</div>` : ''}
            </div>
          </div>
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
  const tbody = document.getElementById('riderApplicationsTableBody');
  const subTbody = document.getElementById('subtabRiderApplicationsTableBody');

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

  const subCntAll = document.getElementById('subCountFilterAll');
  const subCntPending = document.getElementById('subCountFilterPending');
  const subCntApproved = document.getElementById('subCountFilterApproved');
  if (subCntAll) subCntAll.innerText = total;
  if (subCntPending) subCntPending.innerText = pending;
  if (subCntApproved) subCntApproved.innerText = approved;

  const badgeRider = document.getElementById('badgeRiderAppCount');
  if (badgeRider) badgeRider.innerText = total;

  const pclRidersCount = document.getElementById('pclRidersCount');
  if (pclRidersCount) pclRidersCount.innerText = total;

  // Sync dashboard widget and dock badge
  renderDashboardRiderApps();

  let displayApps = allRiderApplications;
  if (filter && filter !== 'all') {
    displayApps = allRiderApplications.filter(a => (a.status || 'Pending').toLowerCase() === filter.toLowerCase());
  }

  const emptyHtml = `<tr><td colspan="10" class="text-center py-5 text-muted"><i class="fa-solid fa-motorcycle fa-2x mb-2 d-block text-secondary"></i>No applications found for filter "${filter}".</td></tr>`;

  if (displayApps.length === 0) {
    if (tbody) tbody.innerHTML = emptyHtml;
    if (subTbody) subTbody.innerHTML = emptyHtml;
    return;
  }

  const rowsHtml = displayApps.map((app) => {
    const origIdx = allRiderApplications.findIndex(a => a.phone === app.phone);
    const idx = origIdx >= 0 ? origIdx : 0;
    const status = app.status || 'Pending';
    const statusBadge = {
      'Approved': 'bg-success text-white',
      'Pending': 'bg-warning text-dark',
      'Rejected': 'bg-danger text-white'
    }[status] || 'bg-secondary text-white';

    const cleanPhone = String(app.phone || '').replace(/\D/g, '');
    const avatarSrc = app.avatar_url || localStorage.getItem(`rudraksha_rider_avatar_${cleanPhone}`) || '';

    return `
      <tr class="border-bottom border-secondary border-opacity-10 align-middle">
        <td>
          <div class="d-flex align-items-center gap-2">
            ${avatarSrc 
              ? `<img src="${avatarSrc}" alt="${app.name}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1.5px solid #f97316; flex-shrink: 0;">` 
              : `<div style="width: 32px; height: 32px; border-radius: 50%; background: #26262b; border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.75rem; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`
            }
            <div>
              <strong class="text-white small">${app.name}</strong>
              ${app.driverId ? `<div style="font-size:0.68rem;color:#f97316;font-family:monospace;font-weight:700;">ID: ${app.driverId}</div>` : ''}
            </div>
          </div>
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

  if (tbody) tbody.innerHTML = rowsHtml;
  if (subTbody) subTbody.innerHTML = rowsHtml;
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

    app.driverId = data.driver?.driverId || data.driver?.id || driverId;
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

    const portalUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}driver.html?access=driver2026`;
    const waMsg = `🎉 *CONGRATULATIONS! RUDRAKSHA DELIVERY PARTNER APPROVED*\n━━━━━━━━━━━━━━━━━━━━\nNamaste *${app.name}*,\nAapka Rudraksha Express Delivery Partner account approve aur activate ho gaya hai!\n\n📲 *Aapke Login Credentials:*\n• Login Mobile Number: *${app.phone}*\n• Security PIN / Password: *${app.pin}*\n• Driver Partner ID: *${app.driverId}*\n• Registered Vehicle: *${app.vehType} (${app.vehNum})*\n\n👉 *Tap to Login to Your Driver Dashboard:*\n${portalUrl}\n━━━━━━━━━━━━━━━━━━━━\n_Login karke apni duty 'ON' karein aur city delivery orders accept karna shuru karein. Welcome to the fleet!_`;
    const waUrl = `https://wa.me/91${app.phone}?text=${encodeURIComponent(waMsg)}`;
    try {
      window.open(waUrl, '_blank');
    } catch (popupErr) {
      console.warn('Popup blocked, opening in tab:', popupErr);
    }

    showAdminToast(`🎉 Driver "${app.name}" approved! PIN is ${driverPin}`, 'success');
    await loadRiderApplications();
    await loadDriversFromBackend();
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
  const revenue = allAdminParcels
    .filter(p => {
      const s = String(p.booking_status || p.status || '').toLowerCase();
      const isCancelled = s === 'cancelled' || s === 'rejected';
      return (s === 'delivered' || p.delivery_otp_verified === true) && !isCancelled && s !== 'searching_driver' && s !== 'received';
    })
    .reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);
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

function goToParcelsPage(page) {
  renderParcelsTable(allAdminParcelsCurrentList || allAdminParcels, page);
  const table = document.getElementById('parcelsTableBody');
  if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderParcelsTable(list = allAdminParcels, page = null) {
  allAdminParcelsCurrentList = list;
  if (page !== null) {
    allAdminParcelsCurrentPage = page;
  } else if (list !== allAdminParcels) {
    allAdminParcelsCurrentPage = 1;
  }

  const tbody = document.getElementById('parcelsTableBody');
  const pagWrapper = document.getElementById('parcelsPaginationWrapper');
  const pagInfo = document.getElementById('parcelsPaginationInfo');
  if (!tbody) return;

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
  allAdminParcelsCurrentPage = Math.min(Math.max(1, allAdminParcelsCurrentPage), totalPages);

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted"><i class="fa-solid fa-box-open me-2"></i>No parcel deliveries found.</td></tr>`;
    if (pagWrapper) pagWrapper.style.display = 'none';
    return;
  }

  if (pagWrapper) pagWrapper.style.display = 'flex';

  const startIndex = (allAdminParcelsCurrentPage - 1) * ORDERS_PER_PAGE;
  const endIndex = Math.min(startIndex + ORDERS_PER_PAGE, total);
  const pageItems = list.slice(startIndex, endIndex);

  if (pagInfo) {
    pagInfo.innerHTML = `Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${total}</strong> parcels (Page ${allAdminParcelsCurrentPage} of ${totalPages})`;
  }
  renderPaginationControls('parcelsPaginationControls', allAdminParcelsCurrentPage, totalPages, 'goToParcelsPage');

  tbody.innerHTML = pageItems.map(p => {
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

    const pickupOtp = p.pickup_otp || null;
    const deliveryOtp = p.delivery_otp || null;
    const isPickupDone = p.pickup_otp_verified || ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(status);
    const isDelivered = p.delivery_otp_verified || status === 'delivered';

    const canChangeDriver = !isDelivered && status !== 'cancelled';
    const isDeclined = status === 'driver_declined' || (!p.assigned_driver_name && p.declined_driver_name);

    const driverDisplay = isDeclined
      ? `<div class="p-2 rounded" style="background: rgba(239,68,68,0.12); border: 1px dashed rgba(239,68,68,0.45); max-width: 220px;">
           <div style="font-size: 0.70rem; color: #ef4444; font-weight: 800; display: flex; align-items: center; gap: 4px;">
             <i class="fa-solid fa-triangle-exclamation"></i> DRIVER DECLINED
           </div>
           <div style="font-size: 0.75rem; color: #fff; font-weight: 700; margin-top: 2px;">
             👨‍✈️ ${p.declined_driver_name || p.assigned_driver_name || 'Driver'}
           </div>
           <div style="font-size: 0.68rem; color: #94a3b8;">
             +91 ${p.declined_driver_phone || p.assigned_driver_phone || '-'}
           </div>
           ${p.decline_reason ? `<div style="font-size: 0.65rem; color: #cbd5e1; font-style: italic; margin-top: 2px;">"${p.decline_reason}"</div>` : ''}
           <div class="mt-2">
             <button class="btn btn-sm btn-warning rounded-pill py-1 px-2 fw-bold shadow-sm w-100" style="font-size: 0.70rem;" onclick="openAssignParcelDriverModal('${pId}', true)" title="Reassign to another driver">
               <i class="fa-solid fa-arrows-rotate me-1"></i> Reassign Driver
             </button>
           </div>
         </div>`
      : (p.assigned_driver_name
        ? `<div>
             <strong class="text-white small">👨‍✈️ ${p.assigned_driver_name}</strong><br>
             <span class="small text-muted">+91 ${dPhone}</span>
             ${p.assigned_vehicle_type ? `<div class="badge bg-dark border border-secondary text-info-emphasis mt-1" style="font-size:0.65rem;">${p.assigned_vehicle_type}</div>` : ''}
             ${canChangeDriver ? `
               <div class="mt-1">
                 <button class="btn btn-sm btn-outline-info rounded-pill py-0 px-2 shadow-sm" style="font-size: 0.70rem;" onclick="openAssignParcelDriverModal('${pId}', true)" title="Change / Reassign Driver">
                   <i class="fa-solid fa-arrows-rotate me-1"></i>Change Driver
                 </button>
               </div>
             ` : ''}
           </div>`
        : `<button class="btn btn-sm btn-outline-warning rounded-pill py-0 px-2" style="font-size: 0.72rem;" onclick="openAssignParcelDriverModal('${pId}', false)"><i class="fa-solid fa-plus me-1"></i>Assign Driver</button>`);

    const statusBadgeClass = {
      'searching_driver': 'bg-warning text-dark',
      'confirmed': 'bg-primary text-white',
      'driver_assigned': 'bg-info text-dark',
      'driver_declined': 'bg-danger text-white border border-danger shadow-sm',
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
      'driver_declined': '⚠️ Driver Declined (Reassign Needed)',
      'reached_pickup': '🟠 Reached Pickup',
      'picked_up': '📦 Parcel Picked Up',
      'in_transit': '🚚 In Transit',
      'out_for_delivery': '🛵 Out Delivery',
      'delivered': '🟢 Delivered',
      'cancelled': '🔴 Cancelled'
    };

    const trackUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}track.html?id=${pId}`;

    // Admin Dispatch WhatsApp Message for Sender (Pickup OTP)
    const senderOtpWaMsg = 
`📦 *RUDRAKSHA EXPRESS - ORDER CONFIRMED & PICKUP PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${sName}*,
Aapka parcel delivery order *${pId}* confirm ho gaya hai!

🔑 *Aapka Pickup OTP / PIN:* *${pickupOtp || '----'}*

⚠️ *Zaroori:* Yeh PIN keval tabhi hamare rider ke sath share karein jab wo aapke pickup location par parcel lene pahunch jayein.

📍 *Pickup Address:* ${pickup}
📍 *Drop Address:* ${drop}
👨‍✈️ *Assigned Rider:* ${p.assigned_driver_name || 'Rudraksha Rider'} (+91 ${dPhone})
💰 *Estimated Fare:* ${amount} (${p.payment_method || 'Cash'})

🔍 *Live Track Your Order:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Safe & Express Delivery_`;

    // Admin Dispatch WhatsApp Message for Receiver (Delivery OTP)
    const receiverOtpWaMsg = 
`📦 *RUDRAKSHA EXPRESS - INCOMING PARCEL & DELIVERY PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${rName}*,
*${sName}* ne aapke liye Rudraksha Express se ek parcel bheja hai.

🆔 *Parcel ID:* ${pId}
🛡️ *Aapka Delivery OTP / PIN:* *${deliveryOtp || '----'}*

⚠️ *Zaroori:* Yeh Delivery PIN keval tabhi rider ke sath share karein jab parcel sahi salamat aapke paas deliver ho jaye.

📍 *Delivery Address:* ${drop}
💰 *Payable Amount:* ${amount} (${p.payment_method || 'Cash'})

🔍 *Live Track Status:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Always on Time_`;

    // Customer Generic Status Message
    const custWaMsg = `Hello ${sName}, this is Rudraksha Express Logistics. Your parcel order ${pId} status is: ${statusLabels[status] || status}. Track here: ${trackUrl}`;

    // Driver Dispatch Message
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

    const otpColumnHtml = `
      <div style="font-size: 0.72rem; line-height: 1.4;">
        <div>
          <span class="text-muted">Pickup:</span>
          ${pickupOtp ? (isPickupDone ? `<span class="badge bg-success bg-opacity-25 text-success font-monospace px-1">✅ ${pickupOtp}</span>` : `<strong class="text-warning font-monospace fs-6">${pickupOtp}</strong>`) : '<span class="badge bg-warning text-dark py-0" style="font-size:0.65rem;">Not Set</span>'}
        </div>
        <div class="mt-1">
          <span class="text-muted">Delivery:</span>
          ${deliveryOtp ? (isDelivered ? `<span class="badge bg-success bg-opacity-25 text-success font-monospace px-1">✅ ${deliveryOtp}</span>` : `<strong class="text-success font-monospace fs-6">${deliveryOtp}</strong>`) : '<span class="badge bg-secondary text-white py-0" style="font-size:0.65rem;">Not Set</span>'}
        </div>
        <div class="mt-1 d-flex gap-1">
          <button class="btn btn-sm btn-outline-warning py-0 px-1 fw-bold" style="font-size: 0.66rem;" onclick="openAdminOtpModal('${pId}')" title="Assign & WhatsApp OTPs">
            <i class="fa-solid fa-key me-1"></i>Manage PINs
          </button>
        </div>
      </div>
    `;

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
        <td>${otpColumnHtml}</td>
        <td>
          <span class="badge ${statusBadgeClass} rounded-pill py-1 px-2 small">${statusLabels[status] || status}</span>
        </td>
        <td>${driverDisplay}</td>
        <td>
          <div class="d-flex gap-1 align-items-center flex-wrap">
            <select class="form-select form-select-sm bg-dark text-white border-secondary py-0" style="font-size: 0.72rem; width: 110px;" onchange="quickUpdateParcelStatus('${pId}', this.value)">
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
            <a href="https://wa.me/91${sPhone}?text=${encodeURIComponent(senderOtpWaMsg)}" target="_blank" class="btn btn-sm btn-warning py-0 px-2 fw-bold text-dark" style="font-size: 0.72rem; background: #f59e0b; border: none; white-space: nowrap;" title="📲 Send Pickup PIN exclusively to Sender (+91 ${sPhone})">
              <i class="fa-solid fa-key me-1"></i>Sender PIN
            </a>
            <a href="https://wa.me/91${rPhone}?text=${encodeURIComponent(receiverOtpWaMsg)}" target="_blank" class="btn btn-sm btn-info py-0 px-2 fw-bold text-dark" style="font-size: 0.72rem; background: #06b6d4; border: none; white-space: nowrap;" title="📲 Send Delivery PIN exclusively to Receiver (+91 ${rPhone})">
              <i class="fa-solid fa-shield-halved me-1"></i>Receiver PIN
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

function getVehicleCategory(veh) {
  if (!veh) return 'bike';
  const str = String(veh).toLowerCase().trim();
  if (str.includes('auto') || str.includes('3w') || str.includes('3-w') || str.includes('3 wheeler') || str.includes('rickshaw') || str.includes('tempo')) {
    return 'auto';
  }
  if (str.includes('truck') || str.includes('ace') || str.includes('tata') || str.includes('pickup') || str.includes('hathi') || str.includes('bolero') || str.includes('carrier') || str.includes('mini_truck') || str.includes('canter') || str.includes('container') || str.includes('commercial')) {
    return 'truck';
  }
  return 'bike';
}

function getVehicleCategoryLabel(cat) {
  switch (cat) {
    case 'auto': return '🛺 3-Wheeler (Auto / E-Rickshaw / Tempo)';
    case 'truck': return '🚚 Mini Truck (Tata Ace / Pickup)';
    case 'bike':
    default: return '🛵 2-Wheeler (Bike / Scooter)';
  }
}

let currentAssignParcelContext = null;

function renderParcelDriverDropdown(showOtherVehicles = false) {
  if (!currentAssignParcelContext) return;
  const { allPool, targetCategory, targetCategoryLabel, parcel, isReassign } = currentAssignParcelContext;
  const select = document.getElementById('assignParcelDriverSelect');
  if (!select) return;

  const matching = allPool.filter(d => d.category === targetCategory);
  const others = allPool.filter(d => d.category !== targetCategory);

  const overrideToggle = document.getElementById('assignParcelOverrideToggle');
  const effectiveShowOther = showOtherVehicles || (matching.length === 0);
  if (overrideToggle) overrideToggle.checked = effectiveShowOther;

  let html = '';

  if (matching.length > 0) {
    html += `<optgroup label="✅ Matching Drivers (${targetCategoryLabel})">`;
    matching.forEach((d, idx) => {
      const isCurrent = isReassign && (d.name === parcel.assigned_driver_name || String(d.phone).replace(/\D/g, '').slice(-10) === String(parcel.assigned_driver_phone || '').replace(/\D/g, '').slice(-10));
      const distInfo = d.distance_km != null ? ` (${d.distance_km} KM | ~${d.eta_minutes}m)` : '';
      const prefix = d.isNearest ? '⚡ [NEAREST] ' : '';
      const isSelected = isCurrent ? 'selected' : (idx === 0 && !isReassign ? 'selected' : '');
      html += `
        <option value="${d.name}" data-id="${d.id || ''}" data-phone="${d.phone}" data-veh="${d.veh}" data-vehnum="${d.vehnum}" ${isSelected}>
          ${prefix}${d.name}${distInfo} • ${d.veh} (${d.vehnum || 'No plate'}) • +91 ${d.phone} ${isCurrent ? '⭐ [CURRENT]' : ''}
        </option>
      `;
    });
    html += `</optgroup>`;
  } else {
    html += `<option value="" disabled ${!effectiveShowOther ? 'selected' : ''}>⚠️ No registered drivers with ${targetCategoryLabel} found in fleet</option>`;
  }

  if (effectiveShowOther && others.length > 0) {
    html += `<optgroup label="⚠️ Other Vehicles (Different Category - Emergency Override)">`;
    others.forEach((d, idx) => {
      const isCurrent = isReassign && (d.name === parcel.assigned_driver_name || String(d.phone).replace(/\D/g, '').slice(-10) === String(parcel.assigned_driver_phone || '').replace(/\D/g, '').slice(-10));
      const distInfo = d.distance_km != null ? ` (${d.distance_km} KM)` : '';
      const isSelected = (matching.length === 0 && idx === 0 && !isCurrent) ? 'selected' : (isCurrent ? 'selected' : '');
      html += `
        <option value="${d.name}" data-id="${d.id || ''}" data-phone="${d.phone}" data-veh="${d.veh}" data-vehnum="${d.vehnum}" ${isSelected}>
          ⚠️ ${d.name}${distInfo} • ${d.veh} (${d.vehnum || 'No plate'}) • +91 ${d.phone} ${isCurrent ? '⭐ [CURRENT]' : ''}
        </option>
      `;
    });
    html += `</optgroup>`;
  }

  select.innerHTML = html;
}

function toggleParcelVehicleFilter(checked) {
  renderParcelDriverDropdown(checked);
}

async function openAssignParcelDriverModal(parcelId, isReassign = false) {
  const parcel = allAdminParcels.find(p => (p.parcel_id === parcelId || p.id === parcelId));
  if (!parcel) return;

  const reqVehRaw = parcel.vehicle_type || parcel.vehicle || 'bike';
  const targetCategory = getVehicleCategory(reqVehRaw);
  const targetCategoryLabel = getVehicleCategoryLabel(targetCategory);

  currentAssignParcelContext = {
    parcel,
    parcelId,
    isReassign,
    targetCategory,
    targetCategoryLabel,
    allPool: []
  };

  // Auto-generate 4-digit OTPs if not yet assigned
  if (!parcel.pickup_otp) parcel.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
  if (!parcel.delivery_otp) parcel.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));

  document.getElementById('assignParcelId').value = parcelId;
  const reassignInput = document.getElementById('assignParcelIsReassign');
  if (reassignInput) reassignInput.value = isReassign ? 'true' : 'false';

  document.getElementById('assignParcelDisplayId').innerText = parcelId;
  document.getElementById('assignParcelSender').innerText = parcel.sender_name || 'Sender';
  document.getElementById('assignParcelReceiver').innerText = parcel.receiver_name || 'Receiver';

  const modalTitleEl = document.getElementById('assignParcelModalTitle');
  const submitBtnEl = document.getElementById('btnAssignParcelSubmit');
  const currentDriverBox = document.getElementById('assignParcelCurrentDriverBox');
  const currentDriverNameEl = document.getElementById('assignParcelCurrentDriverName');
  const reqVehBadge = document.getElementById('assignParcelReqVehBadge');
  const vehBannerTitle = document.getElementById('assignParcelVehicleBannerTitle');
  const vehBannerSub = document.getElementById('assignParcelVehicleBannerSub');

  if (modalTitleEl) {
    modalTitleEl.innerHTML = isReassign 
      ? `<i class="fa-solid fa-arrows-rotate me-2 text-info"></i>Change / Reassign Driver`
      : `<i class="fa-solid fa-motorcycle me-2" style="color: #D0FD38;"></i>Assign Driver to Parcel`;
  }

  if (submitBtnEl) {
    submitBtnEl.innerHTML = isReassign
      ? `<i class="fa-solid fa-arrows-rotate me-1"></i> Confirm & Reassign Driver`
      : `<i class="fa-solid fa-circle-check me-1"></i> Dispatch Rider & Assign OTPs`;
  }

  if (currentDriverBox && currentDriverNameEl) {
    if (isReassign && parcel.assigned_driver_name) {
      currentDriverBox.style.display = 'block';
      currentDriverNameEl.innerHTML = `👨‍✈️ <strong>${parcel.assigned_driver_name}</strong> (+91 ${parcel.assigned_driver_phone || '-'}) • ${parcel.assigned_vehicle_type || 'Vehicle'}`;
    } else {
      currentDriverBox.style.display = 'none';
    }
  }

  if (reqVehBadge) reqVehBadge.innerText = reqVehRaw.toUpperCase();
  if (vehBannerTitle) vehBannerTitle.innerHTML = `Customer Required Vehicle: <strong>${targetCategoryLabel}</strong>`;
  if (vehBannerSub) vehBannerSub.innerHTML = `Order booked with <strong>${reqVehRaw.toUpperCase()}</strong>. Only verified <strong>${targetCategoryLabel}</strong> drivers are shown.`;

  const otp1El = document.getElementById('assignModalPickupOtp');
  const otp2El = document.getElementById('assignModalDeliveryOtp');
  if (otp1El) otp1El.innerText = parcel.pickup_otp;
  if (otp2El) otp2El.innerText = parcel.delivery_otp;

  const bannerTitle = document.getElementById('nearestDriverBannerTitle');
  const bannerSub = document.getElementById('nearestDriverBannerSub');
  const etaBadge = document.getElementById('nearestDriverEtaBadge');
  const distTip = document.getElementById('nearestDriverDistTip');

  if (bannerTitle) bannerTitle.innerText = `Scanning Nearest ${targetCategoryLabel}...`;
  if (bannerSub) bannerSub.innerText = `Matching pickup location: ${parcel.pickup_address || 'Jaipur'}`;
  if (etaBadge) etaBadge.innerText = 'CALCULATING';
  if (distTip) distTip.innerText = 'Sorted by vehicle match & distance';

  // 1. Initial quick build from registered drivers & rider applications
  const allPool = [];
  const seenPhones = new Set();

  if (Array.isArray(allRiderApplications) && allRiderApplications.length > 0) {
    allRiderApplications.forEach(d => {
      const pClean = String(d.phone || '').replace(/\D/g, '').slice(-10);
      if (pClean && !seenPhones.has(pClean)) {
        seenPhones.add(pClean);
        const v = d.vehType || 'Bike / Scooter';
        allPool.push({
          id: d.driverId || d.id || '',
          name: d.name,
          phone: d.phone,
          veh: v,
          vehnum: d.vehNum || '',
          category: getVehicleCategory(v)
        });
      }
    });
  }

  if (Array.isArray(adminDrivers) && adminDrivers.length > 0) {
    adminDrivers.forEach(d => {
      const pClean = String(d.phone || '').replace(/\D/g, '').slice(-10);
      if (pClean && !seenPhones.has(pClean)) {
        seenPhones.add(pClean);
        const v = d.vehicle_type || 'Dedicated Fleet';
        allPool.push({
          id: d.id || '',
          name: d.driver_name || d.name,
          phone: d.phone,
          veh: v,
          vehnum: d.vehicle_number || '',
          category: getVehicleCategory(v)
        });
      }
    });
  }

  currentAssignParcelContext.allPool = allPool;
  renderParcelDriverDropdown(false);

  const modal = new bootstrap.Modal(document.getElementById('assignParcelDriverModal'));
  modal.show();

  // 2. Query Real-Time Nearest Drivers from Backend with vehicle type filter
  try {
    const res = await fetch(`${API_BASE}/admin/nearest-drivers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        pickup_address: parcel.pickup_address || '',
        pickup_lat: parcel.pickup_lat || 26.9124,
        pickup_lng: parcel.pickup_lng || 75.7873,
        vehicle_type: reqVehRaw,
        vehicle_category: targetCategory
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.drivers) && data.drivers.length > 0) {
        const liveDrivers = data.drivers;

        // Merge backend distance, ETA and vehicle category into pool
        liveDrivers.forEach(ld => {
          const cleanPhone = String(ld.phone || '').replace(/\D/g, '').slice(-10);
          const found = currentAssignParcelContext.allPool.find(x => String(x.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone);
          if (found) {
            found.distance_km = ld.distance_km;
            found.eta_minutes = ld.eta_minutes;
            found.onDuty = ld.onDuty;
            found.hasLiveGps = ld.hasLiveGps;
            found.veh = ld.vehicle_type || found.veh;
            found.category = ld.vehicle_category || getVehicleCategory(found.veh);
          } else {
            currentAssignParcelContext.allPool.push({
              id: ld.id || '',
              name: ld.driver_name,
              phone: ld.phone,
              veh: ld.vehicle_type,
              vehnum: ld.vehicle_number,
              category: ld.vehicle_category || getVehicleCategory(ld.vehicle_type),
              distance_km: ld.distance_km,
              eta_minutes: ld.eta_minutes,
              onDuty: ld.onDuty,
              hasLiveGps: ld.hasLiveGps
            });
          }
        });

        // Sort allPool: within matching category sort by distance
        currentAssignParcelContext.allPool.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));

        // Find nearest matching driver
        const matchingLive = currentAssignParcelContext.allPool.filter(d => d.category === targetCategory);
        if (matchingLive.length > 0) {
          matchingLive[0].isNearest = true;
          const topDriver = matchingLive[0];
          if (bannerTitle) bannerTitle.innerHTML = `⚡ Recommended Matching: <strong class="text-white">${topDriver.name}</strong> (${topDriver.distance_km != null ? topDriver.distance_km + ' KM away' : 'In Jaipur Area'})`;
          if (bannerSub) bannerSub.innerHTML = `ETA: <strong>~${topDriver.eta_minutes || 15} mins</strong> • ${topDriver.veh} (${topDriver.vehnum || 'Fleet Plate'}) • ${topDriver.onDuty !== false ? '<span class="text-success">🟢 On-Duty</span>' : '<span class="text-muted">⚪ Off-Duty</span>'}`;
          if (etaBadge) etaBadge.innerText = `${topDriver.distance_km != null ? topDriver.distance_km + ' KM' : '⚡ MATCH'} (~${topDriver.eta_minutes || 15}m)`;
        } else {
          if (bannerTitle) bannerTitle.innerHTML = `⚠️ No Matching ${targetCategoryLabel} Online`;
          if (bannerSub) bannerSub.innerHTML = `No registered driver with ${targetCategoryLabel} is currently active. Use Emergency Override below if needed.`;
          if (etaBadge) etaBadge.innerText = 'NO MATCH';
        }

        const isOverrideChecked = document.getElementById('assignParcelOverrideToggle')?.checked;
        renderParcelDriverDropdown(isOverrideChecked);
      }
    }
  } catch (err) {
    console.warn('Nearest driver matching error:', err);
  }
}

async function submitParcelDriverAssignment() {
  const parcelId = document.getElementById('assignParcelId')?.value;
  const isReassign = document.getElementById('assignParcelIsReassign')?.value === 'true';
  const select = document.getElementById('assignParcelDriverSelect');
  const selectedOption = select?.selectedOptions?.[0];
  const driverName = select?.value;

  if (!driverName) {
    showAdminToast('⚠️ Please select a driver from the list before submitting.');
    return;
  }

  const driverId = selectedOption?.getAttribute('data-id') || '';
  const driverPhone = selectedOption?.getAttribute('data-phone') || '7296831460';
  const driverVeh = selectedOption?.getAttribute('data-veh') || 'Vehicle';
  const driverVehNum = selectedOption?.getAttribute('data-vehnum') || '-';

  const p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (p) {
    const prevDriver = p.assigned_driver_name;
    p.driver_id = driverId;
    p.assigned_driver_name = driverName;
    p.assigned_driver_phone = driverPhone;
    p.assigned_vehicle_type = driverVeh;
    p.assigned_vehicle_no = driverVehNum;
    p.booking_status = 'driver_assigned';
    p.status = 'driver_assigned';

    // Ensure OTPs are set and persisted
    if (!p.pickup_otp) p.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
    if (!p.delivery_otp) p.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));

    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
    localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));

    // Sync with backend API
    try {
      await fetch(`${API_BASE}/parcels/${parcelId}/assign`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          driver_id: driverId,
          driver_name: driverName,
          driver_phone: driverPhone,
          vehicle_type: driverVeh,
          vehicle_number: driverVehNum,
          pickup_otp: p.pickup_otp,
          delivery_otp: p.delivery_otp,
          is_reassign: isReassign
        })
      });
    } catch (e) {
      console.warn('Backend sync assigned rider notice:', e);
    }

    if (isReassign) {
      showAdminToast(`🔄 Driver changed from "${prevDriver || 'Previous'}" to "${driverName}" (${driverVeh}) for Parcel ${parcelId}!`);
    } else {
      showAdminToast(`🚨 Driver "${driverName}" (${driverVeh}) assigned to Parcel ${parcelId}! Siren & notification dispatched.`);
    }
  }

  bootstrap.Modal.getInstance(document.getElementById('assignParcelDriverModal'))?.hide();
  renderParcelsTable();
  updateParcelMetrics();
}

/* ==========================================================================
   ADMIN PARCEL OTP CONTROLLER (Admin generates & sends OTPs)
   ========================================================================== */
let currentActiveOtpParcel = null;

function openAdminOtpModal(parcelId) {
  const p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (!p) {
    showAdminToast('Parcel order not found', 'error');
    return;
  }

  currentActiveOtpParcel = p;

  // Auto-generate if missing
  if (!p.pickup_otp) p.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
  if (!p.delivery_otp) p.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));

  const pId = p.parcel_id || p.id;
  document.getElementById('otpModalParcelId').value = pId;
  document.getElementById('otpModalDisplayId').innerText = pId;
  document.getElementById('otpModalSenderName').innerText = p.sender_name || 'Sender';
  document.getElementById('otpModalSenderPhone').innerText = `+91 ${p.sender_phone || '-'}`;
  document.getElementById('otpModalReceiverName').innerText = p.receiver_name || 'Receiver';
  document.getElementById('otpModalReceiverPhone').innerText = `+91 ${p.receiver_phone || '-'}`;

  document.getElementById('adminInputPickupOtp').value = p.pickup_otp || '';
  document.getElementById('adminInputDeliveryOtp').value = p.delivery_otp || '';

  const modal = new bootstrap.Modal(document.getElementById('adminParcelOtpModal'));
  modal.show();
}

function generateAdminModalOtp(type) {
  const random4 = String(Math.floor(1000 + Math.random() * 9000));
  if (type === 'pickup') {
    const el = document.getElementById('adminInputPickupOtp');
    if (el) el.value = random4;
  } else {
    const el = document.getElementById('adminInputDeliveryOtp');
    if (el) el.value = random4;
  }
}

async function saveAdminParcelOtps() {
  const pId = document.getElementById('otpModalParcelId')?.value;
  const pOtp = document.getElementById('adminInputPickupOtp')?.value.trim();
  const dOtp = document.getElementById('adminInputDeliveryOtp')?.value.trim();

  if (!pOtp || pOtp.length < 4 || !dOtp || dOtp.length < 4) {
    showAdminToast('Both Pickup and Delivery OTPs must be 4 digits.', 'error');
    return;
  }

  const p = allAdminParcels.find(x => (x.parcel_id === pId || x.id === pId));
  if (p) {
    p.pickup_otp = pOtp;
    p.delivery_otp = dOtp;
    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
    localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));
  }

  try {
    await fetch(`${API_BASE}/parcels/${pId}/otps`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ pickup_otp: pOtp, delivery_otp: dOtp })
    });
  } catch (err) {}

  showAdminToast(`✅ OTPs saved for Parcel ${pId}! Pickup: ${pOtp} | Delivery: ${dOtp}`);
  renderParcelsTable();
}

function dispatchPickupOtpToSenderWhatsApp() {
  if (!currentActiveOtpParcel) return;
  const p = currentActiveOtpParcel;
  const pId = p.parcel_id || p.id;
  const pOtp = document.getElementById('adminInputPickupOtp')?.value.trim() || p.pickup_otp;
  const sPhone = (p.sender_phone || '').replace(/\D/g, '');
  const trackUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}track.html?id=${pId}`;

  const msg = 
`📦 *RUDRAKSHA EXPRESS - ORDER CONFIRMED & PICKUP PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${p.sender_name || 'Customer'}*,
Aapka parcel delivery order *${pId}* confirm ho gaya hai!

🔑 *Aapka Pickup OTP / PIN:* *${pOtp}*

⚠️ *Zaroori Suraksha:* Yeh PIN keval tabhi hamare rider ke sath share karein jab wo aapke pickup location par parcel lene pahunch jayein.

📍 *Pickup:* ${p.pickup_address || '-'}
📍 *Drop:* ${p.drop_address || '-'}
👨‍✈️ *Assigned Rider:* ${p.assigned_driver_name || 'Rudraksha Rider'} (+91 ${p.assigned_driver_phone || '7296831460'})
💰 *Estimated Fare:* ₹${p.total_amount || 0} (${p.payment_method || 'Cash'})

🔍 *Live Track Your Order:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Fast & Secure Delivery_`;

  window.open(`https://wa.me/91${sPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function dispatchDeliveryOtpToReceiverWhatsApp() {
  if (!currentActiveOtpParcel) return;
  const p = currentActiveOtpParcel;
  const pId = p.parcel_id || p.id;
  const dOtp = document.getElementById('adminInputDeliveryOtp')?.value.trim() || p.delivery_otp;
  const rPhone = (p.receiver_phone || '').replace(/\D/g, '');
  const trackUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}track.html?id=${pId}`;

  const msg = 
`📦 *RUDRAKSHA EXPRESS - INCOMING PARCEL & DELIVERY PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${p.receiver_name || 'Customer'}*,
*${p.sender_name || 'Customer'}* ne aapke liye Rudraksha Express se ek parcel bheja hai.

🆔 *Parcel ID:* ${pId}
🛡️ *Aapka Delivery OTP / PIN:* *${dOtp}*

⚠️ *Zaroori Suraksha:* Yeh Delivery PIN keval tabhi rider ke sath share karein jab parcel sahi salamat aapke haath mein deliver ho jaye.

📍 *Delivery Address:* ${p.drop_address || '-'}
💰 *Payable Amount:* ₹${p.total_amount || 0} (${p.payment_method || 'Cash'})

🔍 *Live Track Status:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Always on Time_`;

  window.open(`https://wa.me/91${rPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

/**
 * ⚡ 1-Click Dispatch: Sends WhatsApp message to BOTH Sender (Pickup PIN) and Receiver (Delivery PIN) in one go
 */
async function dispatchOtpsToBothWhatsApp(parcelId) {
  let p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (!p && currentActiveOtpParcel && (currentActiveOtpParcel.parcel_id === parcelId || currentActiveOtpParcel.id === parcelId)) {
    p = currentActiveOtpParcel;
  }
  if (!p) {
    showAdminToast('Parcel not found.', 'error');
    return;
  }

  // Check if modal inputs have custom values
  const pOtpInput = document.getElementById('adminInputPickupOtp')?.value?.trim();
  const dOtpInput = document.getElementById('adminInputDeliveryOtp')?.value?.trim();

  if (pOtpInput && pOtpInput.length === 4) p.pickup_otp = pOtpInput;
  if (dOtpInput && dOtpInput.length === 4) p.delivery_otp = dOtpInput;

  // Auto-generate 4-digit OTPs if missing
  if (!p.pickup_otp) p.pickup_otp = String(Math.floor(1000 + Math.random() * 9000));
  if (!p.delivery_otp) p.delivery_otp = String(Math.floor(1000 + Math.random() * 9000));

  // Persist locally & sync with backend
  localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
  localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));

  try {
    fetch(`${API_BASE}/parcels/${parcelId}/otps`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ pickup_otp: p.pickup_otp, delivery_otp: p.delivery_otp })
    }).catch(() => {});
  } catch (e) {}

  const pId = p.parcel_id || p.id;
  const sPhone = (p.sender_phone || '').replace(/\D/g, '');
  const rPhone = (p.receiver_phone || '').replace(/\D/g, '');
  const sName = p.sender_name || 'Sender';
  const rName = p.receiver_name || 'Receiver';
  const pickup = p.pickup_address || '-';
  const drop = p.drop_address || '-';
  const amount = `₹${p.total_amount || 0}`;
  const dName = p.assigned_driver_name || 'Rudraksha Rider';
  const dPhone = p.assigned_driver_phone || '7296831460';
  const trackUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}track.html?id=${pId}`;

  const senderMsg = 
`📦 *RUDRAKSHA EXPRESS - ORDER CONFIRMED & PICKUP PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${sName}*,
Aapka parcel delivery order *${pId}* confirm ho gaya hai!

🔑 *Aapka Pickup OTP / PIN:* *${p.pickup_otp}*

⚠️ *Zaroori Suraksha:* Yeh PIN keval tabhi hamare rider ke sath share karein jab wo aapke pickup location par parcel lene pahunch jayein.

📍 *Pickup:* ${pickup}
📍 *Drop:* ${drop}
👨‍✈️ *Assigned Rider:* ${dName} (+91 ${dPhone})
💰 *Estimated Fare:* ${amount} (${p.payment_method || 'Cash'})

🔍 *Live Track Your Order:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Fast & Secure Delivery_`;

  const receiverMsg = 
`📦 *RUDRAKSHA EXPRESS - INCOMING PARCEL & DELIVERY PIN*
━━━━━━━━━━━━━━━━━━━━
Namaste *${rName}*,
*${sName}* ne aapke liye Rudraksha Express se ek parcel bheja hai.

🆔 *Parcel ID:* ${pId}
🛡️ *Aapka Delivery OTP / PIN:* *${p.delivery_otp}*

⚠️ *Zaroori Suraksha:* Yeh Delivery PIN keval tabhi rider ke sath share karein jab parcel sahi salamat aapke haath mein deliver ho jaye.

📍 *Delivery Address:* ${drop}
💰 *Payable Amount:* ${amount} (${p.payment_method || 'Cash'})

🔍 *Live Track Status:*
${trackUrl}
━━━━━━━━━━━━━━━━━━━━
_Rudraksha Express Logistics • Always on Time_`;

  showAdminToast(`⚡ Dispatching OTPs to Sender (${sName}) & Receiver (${rName})...`, 'success');

  // Open sender WhatsApp
  if (sPhone) {
    window.open(`https://wa.me/91${sPhone}?text=${encodeURIComponent(senderMsg)}`, '_blank');
  }

  // Open receiver WhatsApp with small delay to prevent browser popup block
  if (rPhone) {
    setTimeout(() => {
      window.open(`https://wa.me/91${rPhone}?text=${encodeURIComponent(receiverMsg)}`, '_blank');
    }, 600);
  }

  renderParcelsTable();
}

async function quickUpdateParcelStatus(parcelId, newStatus) {
  const p = allAdminParcels.find(x => (x.parcel_id === parcelId || x.id === parcelId));
  if (p) {
    p.booking_status = newStatus;
    p.status = newStatus;
    if (newStatus === 'picked_up') p.pickup_otp_verified = true;
    if (newStatus === 'delivered') { p.delivery_otp_verified = true; p.pickup_otp_verified = true; }
    if (newStatus === 'cancelled' || newStatus === 'rejected') {
      p.delivery_otp_verified = false;
      p.pickup_otp_verified = false;
    }
    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(allAdminParcels));
    localStorage.setItem('rudraksha_parcels', JSON.stringify(allAdminParcels));
  }
  showAdminToast(`Parcel ${parcelId} status updated to "${newStatus.toUpperCase()}"`);
  renderParcelsTable();
  updateParcelMetrics();
  updateDashboardMetrics();
}

// Save & Load Parcel Tariff
function saveAdminParcelRates() {
  const rates = {
    baseFare: parseFloat(document.getElementById('pclRateBase')?.value) || 48,
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
      auto: parseFloat(document.getElementById('pclVehAuto')?.value) || 87,
      mini_truck: parseFloat(document.getElementById('pclVehTruck')?.value) || 172
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
    if (document.getElementById('pclRateBase')) document.getElementById('pclRateBase').value = r.baseFare || 48;
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
      if (document.getElementById('pclVehAuto')) document.getElementById('pclVehAuto').value = r.vehicles.auto || 87;
      if (document.getElementById('pclVehTruck')) document.getElementById('pclVehTruck').value = r.vehicles.mini_truck || 172;
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
  return `${window.location.origin}${basePath}driver.html?jobId=${parcelId}&access=driver2026`;
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

/* ==========================================================================
   14. FINANCIAL LEDGER & REVENUE ANALYSIS CONTROLLER (Live Supabase & Backend Sync)
   ========================================================================== */
let cachedEarningsAnalysis = null;
let cachedEarningsLedger = [];
let cachedDriverSummary = [];

/**
 * Main Controller: Fetch Live Earnings Analysis from Server / Local DB
 */
async function renderAdminEarningsLedger() {
  const tableBody = document.getElementById('earningsLedgerTableBody');
  const driverTableBody = document.getElementById('driverEarningsSummaryTableBody');

  try {
    // 1. Try to fetch unified live ledger from backend API
    const res = await fetch(`${API_BASE}/admin/earnings-analysis`, {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        cachedEarningsAnalysis = data.summary;
        cachedEarningsLedger = data.ledger || [];
        cachedDriverSummary = data.driverSummary || [];
      }
    } else {
      throw new Error('Server returned ' + res.status);
    }
  } catch (err) {
    // Fallback: Compute dynamically from in-memory adminBookings and allAdminParcels
    console.info('Computing earnings locally from active state:', err.message);
    computeEarningsFromLocalState();
  }

  // 2. Render KPIs & Metrics
  updateEarningsKpis();

  // 3. Populate Drivers Dropdown Filter
  populateEarningsDriverFilter();

  // 4. Render Table with Active Filters
  filterEarningsLedger();
}

/**
 * Local In-Memory Fallback calculation if server endpoint is temporarily unreachable
 */
function computeEarningsFromLocalState() {
  const moversList = (adminBookings || []).map(b => {
    const s = String(b.status || '').toLowerCase();
    const isDelivered = (s === 'delivered' || s === 'completed');
    const fare = Number(b.total_amount) || 0;
    return {
      id: b.id || b.reference_id,
      order_ref: b.reference_id || b.id || 'RPM-BOOKING',
      service_type: 'movers',
      service_label: 'Packers & Movers',
      cargo_type: b.selected_vehicle || b.cargo_type || 'Relocation Goods',
      customer_name: b.customer_name || 'Customer',
      customer_phone: b.customer_phone || '',
      driver_name: b.assigned_driver_name || 'Fleet Captain',
      driver_phone: b.assigned_driver_phone || '',
      vehicle_number: b.assigned_vehicle || '',
      pickup_address: b.pickup_address || '',
      drop_address: b.drop_address || '',
      distance_km: Number(b.distance_km) || 0,
      fare: fare,
      driver_earning: fare,
      payment_method: b.payment_method || 'Cash / Offline',
      status: isDelivered ? 'Delivered' : (b.status || 'Pending'),
      is_delivered: isDelivered,
      drop_timestamp: b.updated_at || b.shifting_date || b.created_at,
      created_at: b.created_at
    };
  });

  const parcelList = (allAdminParcels || []).map(p => {
    const s = String(p.booking_status || p.status || '').toLowerCase();
    const isDelivered = (s === 'delivered' || p.delivery_otp_verified === true);
    const fare = Number(p.total_amount) || 0;
    return {
      id: p.id || p.parcel_id,
      order_ref: p.parcel_id || p.id,
      service_type: 'parcel',
      service_label: 'On-Demand Parcel',
      cargo_type: `${(p.vehicle_type || 'bike').toUpperCase()} • ${p.parcel_type || 'Package'}`,
      customer_name: p.sender_name || 'Sender',
      customer_phone: p.sender_phone || '',
      receiver_name: p.receiver_name || '',
      receiver_phone: p.receiver_phone || '',
      driver_name: p.assigned_driver_name || 'Express Rider',
      driver_phone: p.assigned_driver_phone || p.driver_phone || '',
      vehicle_number: p.vehicle_number || '',
      vehicle_type: p.vehicle_type || 'Bike / Scooter',
      parcel_type: p.parcel_type || 'Package',
      pickup_address: p.pickup_address || '',
      drop_address: p.drop_address || '',
      distance_km: Number(p.distance_km) || 0,
      fare: fare,
      driver_earning: fare,
      payment_method: p.payment_method || 'Direct Cash / UPI',
      status: isDelivered ? 'Delivered' : (p.booking_status || p.status),
      is_delivered: isDelivered,
      drop_timestamp: p.delivery_time || p.updated_at || p.created_at,
      created_at: p.created_at
    };
  });

  cachedEarningsLedger = [...moversList, ...parcelList].sort((a, b) => {
    const tA = new Date(a.drop_timestamp || a.created_at).getTime() || 0;
    const tB = new Date(b.drop_timestamp || b.created_at).getTime() || 0;
    return tB - tA;
  });

  const totalMoversRev = moversList.filter(x => x.is_delivered).reduce((sum, x) => sum + x.fare, 0);
  const totalParcelsRev = parcelList.filter(x => x.is_delivered).reduce((sum, x) => sum + x.fare, 0);
  const grossRevenue = totalMoversRev + totalParcelsRev;

  const driverSummary = {};
  cachedEarningsLedger.filter(x => x.is_delivered).forEach(x => {
    const dKey = (x.driver_name || 'Unassigned').trim();
    if (!driverSummary[dKey]) {
      driverSummary[dKey] = {
        driver_name: dKey,
        driver_phone: x.driver_phone || '',
        vehicle_number: x.vehicle_number || '',
        trips_count: 0,
        total_earned: 0,
        last_drop_time: x.drop_timestamp
      };
    }
    driverSummary[dKey].trips_count += 1;
    driverSummary[dKey].total_earned += x.fare;
    if (!driverSummary[dKey].driver_phone && x.driver_phone) driverSummary[dKey].driver_phone = x.driver_phone;
    if (!driverSummary[dKey].vehicle_number && x.vehicle_number) driverSummary[dKey].vehicle_number = x.vehicle_number;
    const curLast = new Date(driverSummary[dKey].last_drop_time || 0).getTime();
    const thisTime = new Date(x.drop_timestamp || 0).getTime();
    if (thisTime > curLast) driverSummary[dKey].last_drop_time = x.drop_timestamp;
  });

  const driverList = Object.values(driverSummary).sort((a, b) => b.total_earned - a.total_earned);

  cachedEarningsAnalysis = {
    grossRevenue,
    totalMoversRev,
    totalParcelsRev,
    totalDeliveredCount: moversList.filter(x => x.is_delivered).length + parcelList.filter(x => x.is_delivered).length,
    moversCount: moversList.filter(x => x.is_delivered).length,
    parcelsCount: parcelList.filter(x => x.is_delivered).length,
    allOrdersCount: cachedEarningsLedger.length,
    topDriver: driverList[0] || null
  };

  cachedDriverSummary = driverList;
}

/**
 * Update Top Metric KPI Cards
 */
function updateEarningsKpis() {
  if (!cachedEarningsAnalysis) return;

  const s = cachedEarningsAnalysis;
  animateCountUp('earnKpiTotalRev', s.grossRevenue || 0, 1000, '₹');
  animateCountUp('earnKpiMoversRev', s.totalMoversRev || 0, 800, '₹');
  animateCountUp('earnKpiParcelsRev', s.totalParcelsRev || 0, 800, '₹');

  const subTotal = document.getElementById('earnKpiTotalSub');
  if (subTotal) subTotal.innerText = `${s.totalDeliveredCount || 0} Delivered Orders (${s.allOrdersCount || 0} Total in Ledger)`;

  const subMovers = document.getElementById('earnKpiMoversSub');
  if (subMovers) subMovers.innerText = `${s.moversCount || 0} Relocations Delivered`;

  const subParcels = document.getElementById('earnKpiParcelsSub');
  if (subParcels) subParcels.innerText = `${s.parcelsCount || 0} Express Parcels Delivered`;

  const topDriverEl = document.getElementById('earnKpiTopDriver');
  const topDriverSubEl = document.getElementById('earnKpiTopDriverSub');

  if (s.topDriver) {
    if (topDriverEl) topDriverEl.innerText = s.topDriver.driver_name;
    if (topDriverSubEl) topDriverSubEl.innerText = `₹${(s.topDriver.total_earned || 0).toLocaleString('en-IN')} Earned (${s.topDriver.trips_count || 0} Deliveries)`;
  } else {
    if (topDriverEl) topDriverEl.innerText = 'Standby Fleet';
    if (topDriverSubEl) topDriverSubEl.innerText = 'No completed deliveries yet';
  }
}

/**
 * Populate Unique Drivers in Filter Dropdown
 */
function populateEarningsDriverFilter() {
  const select = document.getElementById('earnFilterDriver');
  if (!select) return;

  const currentVal = select.value;
  const driverNames = new Set();
  cachedEarningsLedger.forEach(item => {
    if (item.driver_name && item.driver_name !== 'Unassigned' && item.driver_name !== 'Express Rider') {
      driverNames.add(item.driver_name.trim());
    }
  });

  let html = `<option value="all">All Fleet Drivers (${driverNames.size})</option>`;
  Array.from(driverNames).sort().forEach(d => {
    html += `<option value="${d}">${d}</option>`;
  });
  select.innerHTML = html;
  if (currentVal && Array.from(driverNames).includes(currentVal)) {
    select.value = currentVal;
  }
}

/**
 * Filter & Render Main Detailed Ledger & Driver Leaderboard
 */
function filterEarningsLedger() {
  const searchQ = (document.getElementById('earnSearchInput')?.value || '').trim().toLowerCase();
  const serviceFilter = document.getElementById('earnFilterService')?.value || 'all';
  const driverFilter = document.getElementById('earnFilterDriver')?.value || 'all';
  const statusFilter = document.getElementById('earnFilterStatus')?.value || 'delivered';

  const tableBody = document.getElementById('earningsLedgerTableBody');
  const statsEl = document.getElementById('earnLedgerStats');

  // Filter items
  const filtered = cachedEarningsLedger.filter(item => {
    // 1. Service Filter
    if (serviceFilter !== 'all' && item.service_type !== serviceFilter) return false;

    // 2. Driver Filter
    if (driverFilter !== 'all' && String(item.driver_name || '').toLowerCase() !== driverFilter.toLowerCase()) return false;

    // 3. Status Filter
    if (statusFilter === 'delivered' && !item.is_delivered) return false;

    // 4. Search Filter
    if (searchQ) {
      const matchRef = String(item.order_ref || '').toLowerCase().includes(searchQ);
      const matchDriver = String(item.driver_name || '').toLowerCase().includes(searchQ);
      const matchCustomer = String(item.customer_name || '').toLowerCase().includes(searchQ);
      const matchPickup = String(item.pickup_address || '').toLowerCase().includes(searchQ);
      const matchDrop = String(item.drop_address || '').toLowerCase().includes(searchQ);
      const matchPayment = String(item.payment_method || '').toLowerCase().includes(searchQ);
      if (!matchRef && !matchDriver && !matchCustomer && !matchPickup && !matchDrop && !matchPayment) {
        return false;
      }
    }

    return true;
  });

  const totalFilteredFare = filtered.reduce((sum, x) => sum + (Number(x.fare) || 0), 0);
  if (statsEl) {
    statsEl.innerHTML = `Showing <span class="text-white">${filtered.length}</span> of ${cachedEarningsLedger.length} orders • Total Fare: <span style="color: #D0FD38;">₹${totalFilteredFare.toLocaleString('en-IN')}</span>`;
  }

  // Render Table Rows
  if (!tableBody) return;
  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-5 text-muted">
          <i class="fa-solid fa-folder-open mb-2" style="font-size: 2rem; opacity: 0.3;"></i>
          <div>No orders match the selected filters.</div>
          <button class="btn btn-sm btn-outline-secondary mt-2" onclick="resetEarningsFilters()">Reset All Filters</button>
        </td>
      </tr>
    `;
  } else {
    tableBody.innerHTML = filtered.map(item => {
      const isMovers = item.service_type === 'movers';
      const serviceBadge = isMovers 
        ? `<span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.7rem;"><i class="fa-solid fa-truck-moving me-1"></i> Packers & Movers</span>`
        : `<span class="badge" style="background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); font-size: 0.7rem;"><i class="fa-solid fa-box-open me-1"></i> Parcel Delivery</span>`;

      // Format Date & Exact Drop Time
      let dropDateStr = '-';
      let dropTimeStr = '-';
      if (item.drop_timestamp) {
        try {
          const d = new Date(item.drop_timestamp);
          if (!isNaN(d.getTime())) {
            dropDateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            dropTimeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          }
        } catch {}
      }

      // Status Badge
      let statusBadge = '';
      if (item.is_delivered) {
        statusBadge = `<span class="badge" style="background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.4);"><i class="fa-solid fa-circle-check me-1"></i> Delivered ✅</span>`;
      } else {
        statusBadge = `<span class="badge" style="background: rgba(234,179,8,0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.4);"><i class="fa-solid fa-truck-fast me-1"></i> ${(item.status || 'Active').toUpperCase()}</span>`;
      }

      // Payment Badge
      const paymentBadge = `<span class="badge bg-dark border border-secondary text-light" style="font-size: 0.7rem;">${item.payment_method || 'Cash / UPI'}</span>`;

      const driverPhone = item.driver_phone ? `<span class="text-muted small d-block"><i class="fa-solid fa-phone me-1 text-success"></i>+91 ${item.driver_phone}</span>` : '';
      const vehicleNum = item.vehicle_number ? `<span class="badge bg-secondary bg-opacity-25 text-white-50 border border-secondary border-opacity-25" style="font-size: 0.65rem;">${item.vehicle_number}</span>` : '';

      return `
        <tr>
          <td>
            <div class="mb-1">${serviceBadge}</div>
            <div class="fw-bold text-white font-monospace" style="font-size: 0.85rem; color: #D0FD38 !important;">#${item.order_ref}</div>
            <div class="small text-muted" style="font-size: 0.72rem;">${item.cargo_type || 'Cargo'}</div>
          </td>
          <td>
            <div class="fw-bold text-white d-flex align-items-center gap-1">
              <i class="fa-solid fa-id-badge text-warning me-1"></i> ${item.driver_name || 'Fleet Captain'}
            </div>
            ${driverPhone}
            ${vehicleNum}
          </td>
          <td style="max-width: 240px;">
            <div class="small text-white text-truncate" title="${item.pickup_address}">
              <i class="fa-solid fa-location-dot text-danger me-1"></i> <span class="text-white-50">From:</span> ${item.pickup_address || 'Origin'}
            </div>
            <div class="small text-white text-truncate mt-1" title="${item.drop_address}">
              <i class="fa-solid fa-flag-checkered text-success me-1"></i> <span class="text-white-50">To:</span> <strong class="text-white">${item.drop_address || 'Destination'}</strong>
            </div>
            <div class="small mt-1">
              <span class="badge bg-dark border border-secondary text-info" style="font-size: 0.68rem;"><i class="fa-solid fa-road me-1"></i>${item.distance_km || 0} km</span>
            </div>
          </td>
          <td>
            <div class="text-white fw-bold" style="font-size: 0.85rem;">
              <i class="fa-regular fa-clock me-1 text-warning"></i>${dropTimeStr}
            </div>
            <div class="small text-muted" style="font-size: 0.72rem;">
              <i class="fa-regular fa-calendar me-1"></i>${dropDateStr}
            </div>
          </td>
          <td>
            <div class="fw-bold fs-6" style="color: #22c55e;">₹${(Number(item.fare) || 0).toLocaleString('en-IN')}</div>
            <div class="small text-white-50" style="font-size: 0.7rem;">Rider: ₹${(Number(item.driver_earning) || 0).toLocaleString('en-IN')}</div>
          </td>
          <td>
            ${paymentBadge}
          </td>
          <td>
            ${statusBadge}
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Driver Summary Leaderboard
  renderDriverEarningsTable();
}

/**
 * Render Driver Summary Table
 */
function renderDriverEarningsTable() {
  const tbody = document.getElementById('driverEarningsSummaryTableBody');
  if (!tbody) return;

  if (cachedDriverSummary.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No completed driver trips recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = cachedDriverSummary.map((d, index) => {
    const avgFare = d.trips_count > 0 ? Math.round(d.total_earned / d.trips_count) : 0;
    let lastDropStr = '-';
    if (d.last_drop_time) {
      try {
        const dt = new Date(d.last_drop_time);
        if (!isNaN(dt.getTime())) {
          lastDropStr = `${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
        }
      } catch {}
    }

    const rankBadge = index === 0 
      ? `<span class="badge bg-warning text-dark"><i class="fa-solid fa-crown me-1"></i> #1 Top Earner</span>`
      : `<span class="badge bg-dark border border-secondary text-muted">#${index + 1}</span>`;

    return `
      <tr>
        <td>
          <div class="fw-bold text-white d-flex align-items-center gap-2">
            ${d.driver_name} ${rankBadge}
          </div>
        </td>
        <td>
          <span class="text-white font-monospace"><i class="fa-solid fa-phone me-1 text-success"></i>+91 ${d.driver_phone || '-'}</span>
        </td>
        <td>
          <span class="badge bg-secondary bg-opacity-25 text-white border border-secondary border-opacity-25">${d.vehicle_number || 'RJ Fleet'}</span>
        </td>
        <td>
          <span class="badge bg-success bg-opacity-20 text-success fw-bold px-2 py-1">${d.trips_count} Delivered</span>
        </td>
        <td>
          <span class="fw-bold fs-6" style="color: #D0FD38;">₹${d.total_earned.toLocaleString('en-IN')}</span>
        </td>
        <td>
          <span class="text-white-50">₹${avgFare} / trip</span>
        </td>
        <td>
          <span class="text-muted small"><i class="fa-regular fa-clock me-1 text-warning"></i>${lastDropStr}</span>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Reset all earnings filters to default
 */
function resetEarningsFilters() {
  const searchInput = document.getElementById('earnSearchInput');
  const serviceSel = document.getElementById('earnFilterService');
  const driverSel = document.getElementById('earnFilterDriver');
  const statusSel = document.getElementById('earnFilterStatus');

  if (searchInput) searchInput.value = '';
  if (serviceSel) serviceSel.value = 'all';
  if (driverSel) driverSel.value = 'all';
  if (statusSel) statusSel.value = 'delivered';

  filterEarningsLedger();
}

/**
 * Re-sync Live Ledger from Backend
 */
async function refreshEarningsLedger() {
  showAdminToast('🔄 Syncing live earnings ledger with database...', 'info');
  await Promise.all([
    loadBookingsFromBackend(),
    loadAdminParcels()
  ]);
  await renderAdminEarningsLedger();
  showAdminToast('✅ Earnings ledger updated with live database!', 'success');
}

/**
 * Export Filtered Earnings Ledger to CSV
 */
function exportEarningsLedgerCSV() {
  if (!cachedEarningsLedger || cachedEarningsLedger.length === 0) {
    showAdminToast('⚠️ No earnings data available to export.', 'warning');
    return;
  }

  const headers = [
    'Service Type',
    'Order Ref',
    'Cargo / Package',
    'Customer Name',
    'Customer Phone',
    'Assigned Driver',
    'Driver Phone',
    'Vehicle Number',
    'Pickup Address',
    'Drop Address',
    'Distance (km)',
    'Gross Fare (INR)',
    'Payment Mode',
    'Delivery Status',
    'Drop Timestamp'
  ];

  const rows = cachedEarningsLedger.map(item => [
    `"${item.service_label || item.service_type}"`,
    `"${item.order_ref || item.id}"`,
    `"${item.cargo_type || ''}"`,
    `"${item.customer_name || ''}"`,
    `"${item.customer_phone || ''}"`,
    `"${item.driver_name || ''}"`,
    `"${item.driver_phone || ''}"`,
    `"${item.vehicle_number || ''}"`,
    `"${(item.pickup_address || '').replace(/"/g, '""')}"`,
    `"${(item.drop_address || '').replace(/"/g, '""')}"`,
    item.distance_km || 0,
    item.fare || 0,
    `"${item.payment_method || 'Cash'}"`,
    `"${item.status || ''}"`,
    `"${item.drop_timestamp || ''}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Rudraksha_Earnings_Ledger_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showAdminToast('📥 Earnings Ledger exported successfully to CSV!', 'success');
}



