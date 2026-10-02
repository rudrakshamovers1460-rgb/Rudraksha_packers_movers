/* ==========================================================================
   RUDRAKSHA RIDER PARTNER APP ENGINE v3.0 | ENTERPRISE LOGISTICS
   Full Data Isolation • Profile Photo Upload • Daily Earnings Wallet • PWA
   ========================================================================== */

const isLocalhostDriver = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DRIVER_API_BASE = isLocalhostDriver ? 'http://localhost:3000/api' : 'https://rudraksha-packers-movers.onrender.com/api';

const RIDER_TOKEN_KEY = 'rudraksha_rider_token';
const RIDER_SESSION_KEY = 'rudraksha_driver_session';

// Bulletproof Global Avatar Storage Identifier
window.AVATAR_PREFIX = window.AVATAR_PREFIX || 'rudraksha_rider_avatar_';
window.Avatar_prefix = window.Avatar_prefix || 'rudraksha_rider_avatar_';
var AVATAR_PREFIX = window.AVATAR_PREFIX;
var Avatar_prefix = window.Avatar_prefix;

function getAvatarStoragePrefix() {
  try {
    return window.AVATAR_PREFIX || window.Avatar_prefix || 'rudraksha_rider_avatar_';
  } catch {
    return 'rudraksha_rider_avatar_';
  }
}

// Active Rider State
let currentDriver = null;
let currentActiveTrip = null;
let currentOtpMode = 'pickup'; // 'pickup' or 'delivery'
let currentOtpParcelId = null;
let feedAutoRefreshTimer = null;
let deferredInstallPrompt = null;

// Dedicated Rider Notification & Order Alert Engine State
let isSoundEnabled = localStorage.getItem('rudraksha_rider_sound_enabled') !== 'false';
let audioCtx = null;
let sirenInterval = null;
let chimeTimeoutId = null;
let isAudioMutedForCurrentOrder = false;
let alertCountdownInterval = null;
let currentAlertingOrder = null;
let seenOrderIds = new Set();
let acknowledgedAssignedTrips = new Set();
let isFeedInitialSyncDone = false;
let lastSeenActiveTripId = null;
let riderGeoWatchId = null;

// Persistent storage helpers for order lifecycle (prevent repeat alerts & ignore declined orders)
function getDeclinedOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('rudraksha_rider_declined_orders') || '[]').map(String));
  } catch {
    return new Set();
  }
}

function addDeclinedOrderId(id) {
  if (!id) return;
  const set = getDeclinedOrderIds();
  set.add(String(id));
  localStorage.setItem('rudraksha_rider_declined_orders', JSON.stringify(Array.from(set)));
}

function getAlertedOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('rudraksha_rider_alerted_orders') || '[]').map(String));
  } catch {
    return new Set();
  }
}

function markOrderAlerted(id) {
  if (!id) return;
  const set = getAlertedOrderIds();
  set.add(String(id));
  localStorage.setItem('rudraksha_rider_alerted_orders', JSON.stringify(Array.from(set).slice(-100)));
}

/* ==========================================================================
   1. INITIALIZATION & AUTHENTICATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initPwaInstallIcon();
  initOtpDigitInputs();
  initRiderAlertSystem();
  initServiceWorkerActionListener();
  checkAndPromptNotificationPermission();

  const isAuth = await checkDriverAuth();
  if (isAuth) {
    onRiderAuthSuccess();
  } else {
    showLoginOverlay();
  }

  // Periodic Auto-refresh for live orders & dispatch (every 8 seconds)
  feedAutoRefreshTimer = setInterval(() => {
    if (getRiderToken()) {
      loadDriverFeed(false);
    }
  }, 8000);
});

function getRiderToken() {
  return localStorage.getItem(RIDER_TOKEN_KEY) || sessionStorage.getItem(RIDER_TOKEN_KEY);
}

function getRiderHeaders() {
  const token = getRiderToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function showLoginOverlay() {
  const overlay = document.getElementById('driverLoginOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.visibility = 'visible';
  }
}

function hideLoginOverlay() {
  const overlay = document.getElementById('driverLoginOverlay');
  if (overlay) {
    overlay.style.transition = 'all 0.3s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.style.opacity = '1';
    }, 300);
  }
}

function getActiveRiderAvatar() {
  if (!currentDriver) return null;
  try {
    const cleanPhone = String(currentDriver.phone || '').replace(/\D/g, '');
    const prefix = getAvatarStoragePrefix();
    return currentDriver.avatar_url || (cleanPhone ? localStorage.getItem(prefix + cleanPhone) : null);
  } catch {
    return currentDriver.avatar_url || null;
  }
}

/**
 * Validate current session with backend /api/rider/me
 */
async function checkDriverAuth() {
  const token = getRiderToken();
  const cachedSession = localStorage.getItem(RIDER_SESSION_KEY);

  if (cachedSession) {
    try {
      currentDriver = JSON.parse(cachedSession);
      const cleanPhone = String(currentDriver?.phone || '').replace(/\D/g, '');
      if (cleanPhone) {
        const prefix = getAvatarStoragePrefix();
        const localAvatar = localStorage.getItem(prefix + cleanPhone);
        if (localAvatar && !currentDriver.avatar_url) {
          currentDriver.avatar_url = localAvatar;
        }
      }
    } catch {}
  }

  if (!token) return false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${DRIVER_API_BASE}/rider/me`, {
      headers: getRiderHeaders(),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.rider) {
        try {
          const cleanPhone = String(data.rider.phone || currentDriver?.phone || '').replace(/\D/g, '');
          const prefix = getAvatarStoragePrefix();
          const savedAvatar = cleanPhone ? localStorage.getItem(prefix + cleanPhone) : null;

          // Preserve avatar_url: if backend provided one, keep and store it; otherwise restore from local persistent avatar!
          if (data.rider.avatar_url) {
            if (cleanPhone) localStorage.setItem(prefix + cleanPhone, data.rider.avatar_url);
          } else if (savedAvatar) {
            data.rider.avatar_url = savedAvatar;
          } else if (currentDriver?.avatar_url) {
            data.rider.avatar_url = currentDriver.avatar_url;
            if (cleanPhone) localStorage.setItem(prefix + cleanPhone, currentDriver.avatar_url);
          }
        } catch (e) {
          console.warn('Avatar sync non-critical warning:', e);
        }

        currentDriver = data.rider;
        localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
        return true;
      }
    }
  } catch (err) {
    // If backend timeout, allow cached session if valid token exists
    if (currentDriver && currentDriver.id) {
      return true;
    }
  }

  return Boolean(currentDriver && currentDriver.id);
}

function onRiderAuthSuccess() {
  hideLoginOverlay();
  renderNavProfile();
  renderDriverProfileView();
  loadDriverEarnings();
  loadDriverFeed(true);
  checkAndPromptNotificationPermission();
  initRiderLiveGeolocation();
}

function initRiderLiveGeolocation() {
  if (!('geolocation' in navigator) || riderGeoWatchId) return;

  function transmitPosition(pos) {
    if (!currentDriver || currentDriver.onDuty === false) return;
    const { latitude, longitude, speed, heading, accuracy } = pos.coords;
    fetch(`${API_BASE}/rider/location`, {
      method: 'POST',
      headers: getRiderHeaders(),
      body: JSON.stringify({
        latitude,
        longitude,
        speed: speed || 0,
        heading: heading || 0,
        accuracy: accuracy || 0
      })
    }).catch(() => {});
  }

  try {
    navigator.geolocation.getCurrentPosition(transmitPosition, () => {}, { enableHighAccuracy: true });
    riderGeoWatchId = navigator.geolocation.watchPosition(transmitPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 10000
    });
  } catch (e) {
    console.warn('Geolocation init warning:', e);
  }
}

async function submitDriverLogin() {
  const phoneInput = document.getElementById('loginDriverPhone')?.value.trim().replace(/\D/g, '');
  const pinInput = document.getElementById('loginDriverPin')?.value.trim();
  const rememberCheck = document.getElementById('rememberDriverCheck')?.checked;
  const errorEl = document.getElementById('loginErrorMsg');
  const btnLogin = document.getElementById('btnLoginDriver');

  if (!phoneInput || phoneInput.length < 10) {
    if (errorEl) {
      errorEl.innerText = 'Please enter a valid 10-digit mobile number.';
      errorEl.style.display = 'block';
    }
    return;
  }
  if (!pinInput || pinInput.length < 4) {
    if (errorEl) {
      errorEl.innerText = 'Please enter your 4-digit security PIN.';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (errorEl) errorEl.style.display = 'none';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Logging in...';
  }

  try {
    let authSuccess = false;
    let driverData = null;
    let token = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${DRIVER_API_BASE}/rider/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput, pin: pinInput }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        authSuccess = true;
        driverData = data.driver;
        token = data.token;
      } else if (res.status === 401 || res.status === 403 || res.status === 400) {
        throw new Error(data.error || 'Access Denied: Invalid phone or PIN.');
      }
    } catch (networkErr) {
      if (networkErr.message && networkErr.message.includes('Access Denied')) throw networkErr;
    }

    // Local Fallback Authorization if backend is sleeping or waking up
    if (!authSuccess) {
      const approvedList = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
      const appsList = JSON.parse(localStorage.getItem('rudraksha_rider_applications') || '[]');
      
      const foundApproved = approvedList.find(d => String(d.driver_phone || d.phone || '').replace(/\D/g, '') === phoneInput);
      const foundApp = appsList.find(a => String(a.phone || '').replace(/\D/g, '') === phoneInput);

      if (foundApproved) {
        if (foundApproved.pin && String(foundApproved.pin).trim() !== pinInput) {
          throw new Error('❌ Incorrect Security PIN. Please enter the 4-digit PIN sent to your WhatsApp.');
        }
        driverData = {
          id: foundApproved.id || `RDR-${phoneInput.slice(-4)}`,
          driver_name: foundApproved.driver_name || foundApproved.name || 'Rider Partner',
          phone: phoneInput,
          vehicle_type: foundApproved.vehicle_type || 'Bike',
          vehicle_number: foundApproved.vehicle_number || '',
          status: 'Active',
          onDuty: true
        };
        token = `local_token_${phoneInput}_${Date.now()}`;
        authSuccess = true;
      } else if (foundApp && foundApp.status === 'Approved') {
        if (foundApp.pin && String(foundApp.pin).trim() !== pinInput) {
          throw new Error('❌ Incorrect Security PIN. Please check your WhatsApp approval message.');
        }
        driverData = {
          id: foundApp.driverId || `RDR-${phoneInput.slice(-4)}`,
          driver_name: foundApp.name,
          phone: phoneInput,
          vehicle_type: foundApp.vehType || 'Bike',
          vehicle_number: foundApp.vehNum || '',
          status: 'Active',
          onDuty: true
        };
        token = `local_token_${phoneInput}_${Date.now()}`;
        authSuccess = true;
      } else if (foundApp && foundApp.status === 'Pending') {
        throw new Error('⏳ Your driver application is under review. You will receive your PIN on WhatsApp once approved.');
      } else if (foundApp && foundApp.status === 'Rejected') {
        throw new Error('❌ Your driver application was declined. Please contact Rudraksha Support at +91 7296831460.');
      } else {
        throw new Error(`❌ No approved driver account found for +91 ${phoneInput}. Please register as a rider partner first.`);
      }
    }

    // Save persistent avatar
    try {
      const cleanPhone = String(driverData?.phone || phoneInput).replace(/\D/g, '');
      const prefix = getAvatarStoragePrefix();
      const savedAvatar = cleanPhone ? localStorage.getItem(prefix + cleanPhone) : null;
      if (savedAvatar && !driverData.avatar_url) {
        driverData.avatar_url = savedAvatar;
      }
    } catch {}

    const storage = rememberCheck ? localStorage : sessionStorage;
    storage.setItem(RIDER_TOKEN_KEY, token);
    localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(driverData));
    currentDriver = driverData;

    showToast(`🎉 Welcome, ${currentDriver.driver_name || 'Rider'}!`, 'success');
    onRiderAuthSuccess();
  } catch (err) {
    if (errorEl) {
      errorEl.innerText = err.message || 'Login failed. Please verify your phone & PIN.';
      errorEl.style.display = 'block';
    }
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket me-2"></i> Login to Driver Dashboard';
    }
  }
}

/**
 * Rider Logout
 */
function logoutDriver() {
  if (confirm('Are you sure you want to log out from Rudraksha Rider?')) {
    localStorage.removeItem(RIDER_TOKEN_KEY);
    sessionStorage.removeItem(RIDER_TOKEN_KEY);
    localStorage.removeItem(RIDER_SESSION_KEY);
    currentDriver = null;
    currentActiveTrip = null;
    showLoginOverlay();
    showToast('👋 Successfully logged out. Stay safe on the road!', 'info');
  }
}

/* ==========================================================================
   2. PWA INSTALL ACTION ICON & DIRECT DOWNLOAD
   ========================================================================== */
const isStandaloneDriver = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function initPwaInstallIcon() {
  // 1. Service worker already registered in driver.html head; ensure update
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg && reg.update) reg.update();
    }).catch(() => {});
  }

  // 2. Intercept install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window._driverInstallPrompt = e;
    console.log('[Rider PWA] Native install prompt captured!');
    if (window._waitingForDriverInstall) {
      window._waitingForDriverInstall = false;
      triggerPwaInstall();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window._driverInstallPrompt = null;
    closeDriverInstallModal();
    showToast('🚀 Rudraksha Rider Partner App installed on your device!', 'success');
  });
}

/**
 * Universal Infallible Driver PWA Installer
 * Works on Android Chrome, Samsung Internet, Xiaomi MIUI, iOS Safari, and In-App Webviews
 */
async function triggerPwaInstall() {
  // 1. Check if native prompt is immediately available
  const nativePrompt = window._driverInstallPrompt || deferredInstallPrompt;
  if (nativePrompt) {
    try {
      await nativePrompt.prompt();
      const choice = await nativePrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        showToast('🎉 Rudraksha Driver App successfully installed!', 'success');
        window._driverInstallPrompt = null;
        deferredInstallPrompt = null;
        closeDriverInstallModal();
        return;
      }
    } catch (err) {
      console.warn('Native prompt error:', err);
    }
  }

  // 2. Wait briefly (up to 300ms) in case beforeinstallprompt was pending
  window._waitingForDriverInstall = true;
  const promptArrived = await new Promise((resolve) => {
    if (window._driverInstallPrompt || deferredInstallPrompt) return resolve(true);
    const timer = setTimeout(() => resolve(false), 300);
    const onPrompt = () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      resolve(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt, { once: true });
  });
  window._waitingForDriverInstall = false;

  if (promptArrived) {
    const freshPrompt = window._driverInstallPrompt || deferredInstallPrompt;
    if (freshPrompt) {
      try {
        await freshPrompt.prompt();
        const choice = await freshPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showToast('🎉 Rudraksha Driver App successfully installed!', 'success');
          window._driverInstallPrompt = null;
          deferredInstallPrompt = null;
          closeDriverInstallModal();
          return;
        }
      } catch (err) {}
    }
  }

  // 3. Guaranteed UI Fallback: Open Universal Installation Modal
  openDriverInstallModal();
}

function openDriverInstallModal() {
  const overlay = document.getElementById('driverInstallOverlay');
  const body = document.getElementById('driverInstallModalBody');
  if (!overlay || !body) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isWebview = /FBAN|FBAV|Instagram|WhatsApp|Line|Twitter|Telegram/i.test(navigator.userAgent);
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const nativePrompt = window._driverInstallPrompt || deferredInstallPrompt;

  let html = '';

  if (isWebview || isStandalone) {
    // A. WhatsApp / In-App Browser OR Opened from Customer App Standalone
    html = `
      <div style="background: rgba(249,115,22,0.14); border: 1.5px solid rgba(249,115,22,0.35); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px;">
        <div style="font-weight: 800; font-size: 0.88rem; color: #fb923c; display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <i class="fa-solid fa-motorcycle text-warning"></i> Dedicated Driver App Install
        </div>
        <p style="font-size: 0.78rem; color: #cbd5e1; margin: 0; line-height: 1.45;">
          Phone me <strong>Rudraksha Driver App</strong> ko alag se home screen par install karne ke liye neeche diye button se <strong>Google Chrome me kholein</strong> aur 1 tap me install karein!
        </p>
      </div>

      <button type="button" onclick="openInAndroidChrome()" style="width: 100%; background: linear-gradient(135deg, #f97316, #ea580c); border: none; color: #fff; border-radius: 14px; padding: 14px; font-weight: 800; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 18px rgba(249,115,22,0.45); margin-bottom: 12px;">
        <i class="fa-brands fa-chrome"></i>
        <span>🚀 Google Chrome me Kholein & Install Karein</span>
      </button>
    `;
  } else if (isIOS) {
    // B. Apple iOS (Safari)
    html = `
      <p style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 14px; line-height: 1.4;">
        iPhone Safari me Driver App install karne ke liye ye 3 aasan steps karein:
      </p>

      <div class="install-step-box">
        <div class="install-step-num">1</div>
        <div style="flex: 1;">Safari browser me screen ke bilkul niche <strong>Share icon ( <i class="fa-solid fa-arrow-up-from-bracket" style="color:#38bdf8;"></i> )</strong> par tap karein.</div>
      </div>

      <div class="install-step-box">
        <div class="install-step-num">2</div>
        <div style="flex: 1;">Options me thoda niche scroll karke <strong>'Add to Home Screen' ( <i class="fa-regular fa-square-plus" style="color:#22c55e;"></i> )</strong> chunein.</div>
      </div>

      <div class="install-step-box">
        <div class="install-step-num">3</div>
        <div style="flex: 1;">Upar right side me <strong>'Add'</strong> dabayein — Driver App aapke iPhone par turant install ho jayegi!</div>
      </div>
    `;
  } else {
    // C. Android Chrome / Redmi A4 5G / Desktop
    html = `
      ${nativePrompt ? `
        <button type="button" onclick="executeNativeInstallPrompt()" style="width: 100%; background: linear-gradient(135deg, #22c55e, #16a34a); border: none; color: #fff; border-radius: 14px; padding: 14px; font-weight: 800; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 18px rgba(34,197,94,0.45); margin-bottom: 14px;">
          <i class="fa-solid fa-circle-down"></i>
          <span>📲 Direct Install Dialog Kholein</span>
        </button>
      ` : ''}

      <p style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 14px; line-height: 1.4;">
        Mobile phone me direct install karne ke liye ye steps follow karein:
      </p>

      <div class="install-step-box">
        <div class="install-step-num">1</div>
        <div style="flex: 1;">Browser ke upar right corner me <strong>3 Dots ( <i class="fa-solid fa-ellipsis-vertical" style="color:#f97316;"></i> ) Menu</strong> par tap karein.</div>
      </div>

      <div class="install-step-box">
        <div class="install-step-num">2</div>
        <div style="flex: 1;">Menu me <strong>'Install app'</strong> ya <strong>'Add to Home screen'</strong> par tap karein.</div>
      </div>

      <div class="install-step-box">
        <div class="install-step-num">3</div>
        <div style="flex: 1;"><strong>'Install'</strong> dabayein — Rudraksha Rider Partner App aapke phone me turant install ho jayegi!</div>
      </div>
    `;
  }

  body.innerHTML = html;
  overlay.classList.add('active');
}

function closeDriverInstallModal() {
  const overlay = document.getElementById('driverInstallOverlay');
  if (overlay) overlay.classList.remove('active');
}

function openInAndroidChrome() {
  const currentUrl = window.location.href.split('#')[0];
  const noProto = currentUrl.replace(/^https?:\/\//, '');
  const scheme = window.location.protocol.replace(':', '') || 'https';
  const chromeIntent = `intent://${noProto}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  window.location.href = chromeIntent;
  setTimeout(() => {
    copyDriverAppLink();
  }, 1200);
}

function copyDriverAppLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('📋 Link copied! Paste in Chrome browser to install.', 'success');
  }).catch(() => {
    showToast(`App Link: ${url}`, 'info');
  });
}

async function executeNativeInstallPrompt() {
  const prompt = window._driverInstallPrompt || deferredInstallPrompt;
  if (prompt) {
    try {
      closeDriverInstallModal();
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        showToast('🎉 Rudraksha Driver App successfully installed!', 'success');
      }
      window._driverInstallPrompt = null;
      deferredInstallPrompt = null;
    } catch (err) {
      console.warn('Native prompt error:', err);
    }
  } else {
    showToast('Chrome Menu (⋮) ➔ "Install app" dabayein', 'info');
  }
}

/* ==========================================================================
   3. PROFILE & PHOTO UPLOAD (Camera / Gallery Support)
   ========================================================================== */
function renderNavProfile() {
  if (!currentDriver) return;
  const nameEl = document.getElementById('navDriverName');
  const vehEl = document.getElementById('navVehicleInfo');
  const avatarImg = document.getElementById('navAvatarImg');
  const avatarIcon = document.getElementById('navAvatarIcon');

  if (nameEl) nameEl.innerText = currentDriver.driver_name || 'Rudraksha Rider';
  if (vehEl) vehEl.innerText = `${currentDriver.vehicle_type || 'Vehicle'} • ${currentDriver.vehicle_number || '-'}`;

  const activeAvatar = getActiveRiderAvatar();
  if (activeAvatar) {
    if (avatarImg) {
      avatarImg.src = activeAvatar;
      avatarImg.style.display = 'block';
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        if (avatarIcon) avatarIcon.style.display = 'block';
      };
    }
    if (avatarIcon) avatarIcon.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (avatarIcon) avatarIcon.style.display = 'block';
  }

  updateDutyDisplay();
}

function renderDriverProfileView() {
  if (!currentDriver) return;

  const pName = document.getElementById('profileRiderName');
  const pPhone = document.getElementById('profileRiderPhone');
  const pVeh = document.getElementById('profileRiderVehicle');
  const pDl = document.getElementById('profileDlNumber');
  const pCity = document.getElementById('profileCityShift');
  const pAvatar = document.getElementById('profileAvatarImg');
  const logPhone = document.getElementById('logoutPhoneLabel');

  if (pName) pName.innerText = currentDriver.driver_name || 'Rider Partner';
  if (pPhone) pPhone.innerText = currentDriver.phone ? `+91 ${currentDriver.phone}` : '-';
  if (pVeh) pVeh.innerText = `${currentDriver.vehicle_type || 'Fleet'} • ${currentDriver.vehicle_number || '-'}`;
  if (pDl) pDl.innerText = currentDriver.dl_number || 'RJ14-VERIFIED';
  if (pCity) pCity.innerText = `${currentDriver.city || 'Jaipur'} • ${currentDriver.shift || 'Full Time'}`;
  if (logPhone) logPhone.innerText = currentDriver.phone ? `+91 ${currentDriver.phone}` : '-';

  const activeAvatar = getActiveRiderAvatar();
  if (pAvatar && activeAvatar) {
    pAvatar.src = activeAvatar;
    pAvatar.onerror = () => { pAvatar.src = 'logo.png'; };
  }

  updateDutyDisplay();
}

/**
 * Handle Camera / Gallery Photo Upload
 * 1. Compresses image on canvas
 * 2. Uploads to Free Image Cloud Hosting (ImgBB CDN) to keep zero load on website
 * 3. Saves lightweight Cloud URL to backend and persistent local storage
 */
async function uploadToCloudImageHost(base64Data) {
  try {
    const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    const formData = new FormData();
    formData.append('image', cleanBase64);

    // Free ImgBB Cloud CDN API
    const res = await fetch('https://api.imgbb.com/1/upload?key=6d207e021d1221e525e9690d8012ad7b', {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data?.url) {
        console.log('✅ Image successfully saved on Cloud CDN:', data.data.url);
        return data.data.url;
      }
    }
  } catch (cloudErr) {
    console.warn('Cloud CDN upload fallback to local URI:', cloudErr);
  }
  return base64Data; // fallback to compressed data
}

function handleRiderPhotoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showToast('📸 Saving profile photo...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      // Compress to max 320x320 JPEG
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 320;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);

      // Instantly update UI with local preview
      const pAvatar = document.getElementById('profileAvatarImg');
      const navAvatar = document.getElementById('navAvatarImg');
      const navIcon = document.getElementById('navAvatarIcon');

      if (pAvatar) {
        pAvatar.src = compressedBase64;
        pAvatar.style.display = 'block';
      }
      if (navAvatar) {
        navAvatar.src = compressedBase64;
        navAvatar.style.display = 'block';
      }
      if (navIcon) navIcon.style.display = 'none';

      // Permanently save to dedicated local persistent key by phone
      const cleanPhone = String(currentDriver?.phone || '').replace(/\D/g, '');
      const prefix = getAvatarStoragePrefix();
      if (cleanPhone) {
        localStorage.setItem(prefix + cleanPhone, compressedBase64);
      }

      if (currentDriver) {
        currentDriver.avatar_url = compressedBase64;
        localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
      }

      // Update in local approved drivers & rider applications roster
      try {
        const approvedDrivers = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
        const dIdx = approvedDrivers.findIndex(d => String(d.driver_phone || d.phone || '').replace(/\D/g, '') === cleanPhone);
        if (dIdx >= 0) {
          approvedDrivers[dIdx].avatar_url = compressedBase64;
          localStorage.setItem('rudraksha_approved_drivers', JSON.stringify(approvedDrivers));
        }

        const riderApps = JSON.parse(localStorage.getItem('rudraksha_rider_applications') || '[]');
        const aIdx = riderApps.findIndex(a => String(a.phone || '').replace(/\D/g, '') === cleanPhone);
        if (aIdx >= 0) {
          riderApps[aIdx].avatar_url = compressedBase64;
          localStorage.setItem('rudraksha_rider_applications', JSON.stringify(riderApps));
        }
      } catch (errLocal) {}

      // Try free Cloud CDN in background for smaller payload if possible
      let finalAvatarUrl = compressedBase64;
      try {
        const cloudUrl = await uploadToCloudImageHost(compressedBase64);
        if (cloudUrl && cloudUrl.startsWith('http')) {
          finalAvatarUrl = cloudUrl;
          if (cleanPhone) localStorage.setItem(prefix + cleanPhone, finalAvatarUrl);
          if (currentDriver) {
            currentDriver.avatar_url = finalAvatarUrl;
            localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
          }
        }
      } catch (cErr) {}

      // Sync with backend across all devices & Admin Panel
      await syncPhotoToBackend(finalAvatarUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function syncPhotoToBackend(photoUrl) {
  const cleanPhone = String(currentDriver?.phone || '').replace(/\D/g, '');
  const prefix = getAvatarStoragePrefix();
  let synced = false;

  // 1. Send to dedicated /api/rider/avatar (uploads to Supabase Storage + updates DB)
  try {
    const res = await fetch(`${DRIVER_API_BASE}/rider/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cleanPhone, avatar_url: photoUrl })
    });
    if (res.ok) {
      synced = true;
      const resData = await res.json().catch(() => ({}));
      const cloudUrl = resData.avatar_url || photoUrl;

      if (cleanPhone) {
        localStorage.setItem(prefix + cleanPhone, cloudUrl);
      }
      if (currentDriver) {
        currentDriver.avatar_url = cloudUrl;
        localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
      }

      // Update UI img tags with cloud URL
      const pAvatar = document.getElementById('profileAvatarImg');
      const navAvatar = document.getElementById('navAvatarImg');
      if (pAvatar) pAvatar.src = cloudUrl;
      if (navAvatar) navAvatar.src = cloudUrl;

      showToast('☁️ Photo uploaded to Supabase Storage & synced across all devices!', 'success');
      return;
    }
  } catch (err1) {}

  // 2. Fallback to PATCH /api/rider/profile
  try {
    const res2 = await fetch(`${DRIVER_API_BASE}/rider/profile`, {
      method: 'PATCH',
      headers: getRiderHeaders(),
      body: JSON.stringify({ avatar_url: photoUrl })
    });
    if (res2.ok) {
      synced = true;
      const resData2 = await res2.json().catch(() => ({}));
      const cloudUrl = resData2.rider?.avatar_url || photoUrl;
      if (cleanPhone) {
        localStorage.setItem(prefix + cleanPhone, cloudUrl);
      }
      if (currentDriver) {
        currentDriver.avatar_url = cloudUrl;
        localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
      }
      showToast('✅ Profile photo updated in cloud!', 'success');
      return;
    }
  } catch (err2) {
    console.warn('Backend photo sync warning:', err2);
  }

  if (!synced) {
    showToast('Photo saved locally. Will sync to Supabase Storage once connected.', 'info');
  }
}

function openSetupSheet() {
  const overlay = document.getElementById('setupOverlay');
  if (!overlay || !currentDriver) return;
  document.getElementById('setupName').value = currentDriver.driver_name || '';
  document.getElementById('setupPhone').value = currentDriver.phone || '';
  document.getElementById('setupVehicleNo').value = currentDriver.vehicle_number || '';
  document.getElementById('setupVehicleType').value = currentDriver.vehicle_type || '';
  overlay.classList.add('active');
}

async function saveRiderProfile() {
  const name = document.getElementById('setupName')?.value.trim();
  const vNo = document.getElementById('setupVehicleNo')?.value.trim();
  const vType = document.getElementById('setupVehicleType')?.value.trim();

  if (!name) {
    showToast('Please enter your full name.', 'error');
    return;
  }

  if (currentDriver) {
    currentDriver.driver_name = name;
    currentDriver.vehicle_number = vNo || currentDriver.vehicle_number;
    currentDriver.vehicle_type = vType || currentDriver.vehicle_type;
    localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));
  }

  document.getElementById('setupOverlay')?.classList.remove('active');
  renderNavProfile();
  renderDriverProfileView();

  try {
    await fetch(`${DRIVER_API_BASE}/rider/profile`, {
      method: 'PATCH',
      headers: getRiderHeaders(),
      body: JSON.stringify({
        driver_name: name,
        vehicle_number: vNo,
        vehicle_type: vType
      })
    });
    showToast('Profile saved!', 'success');
  } catch {}
}

/* ==========================================================================
   4. DUTY TOGGLE (Online / Offline)
   ========================================================================== */
async function toggleDriverDuty() {
  if (!currentDriver) return;
  const newDuty = !Boolean(currentDriver.onDuty);
  currentDriver.onDuty = newDuty;
  localStorage.setItem(RIDER_SESSION_KEY, JSON.stringify(currentDriver));

  updateDutyDisplay();

  try {
    await fetch(`${DRIVER_API_BASE}/rider/duty`, {
      method: 'PATCH',
      headers: getRiderHeaders(),
      body: JSON.stringify({ onDuty: newDuty })
    });
    showToast(newDuty ? '🟢 You are now ON DUTY! Ready to accept jobs.' : '🔴 You are now OFF DUTY.', newDuty ? 'success' : 'info');
  } catch {
    showToast(newDuty ? '🟢 On Duty (Local Mode)' : '🔴 Off Duty (Local Mode)', 'info');
  }

  loadDriverFeed(false);
}

function updateDutyDisplay() {
  if (!currentDriver) return;
  const isDuty = currentDriver.onDuty !== false;

  const navBadge = document.getElementById('navDutyBadge');
  const navPulse = document.getElementById('navDutyPulse');
  const navText = document.getElementById('navDutyText');
  const statusText = document.getElementById('profileDutyStatusText');
  const btnToggle = document.getElementById('btnToggleDuty');

  if (navBadge) {
    navBadge.style.color = isDuty ? 'var(--green)' : '#ef4444';
    navBadge.style.borderColor = isDuty ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
    navBadge.style.background = isDuty ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  }
  if (navPulse) {
    navPulse.style.background = isDuty ? 'var(--green)' : '#ef4444';
  }
  if (navText) navText.innerText = isDuty ? 'ON DUTY' : 'OFF DUTY';

  if (statusText) {
    statusText.innerText = isDuty ? '🟢 On Duty (Receiving Orders)' : '🔴 Off Duty (Not Accepting Orders)';
    statusText.style.color = isDuty ? 'var(--green)' : '#ef4444';
  }
  if (btnToggle) {
    btnToggle.innerText = isDuty ? 'Go Off Duty' : 'Go On Duty';
    btnToggle.className = isDuty ? 'btn btn-sm btn-outline-danger rounded-pill px-3 py-1 fw-bold' : 'btn btn-sm btn-outline-success rounded-pill px-3 py-1 fw-bold';
  }
}

/* ==========================================================================
   5. EARNINGS & TIME-FILTERED FINANCIAL LEDGER (100% Direct Customer Payment)
   ========================================================================== */
let allRiderTrips = [];
let allRiderEarningsData = null;
let currentEarningsFilter = '7d';

async function loadDriverEarnings() {
  if (!getRiderToken()) return;

  try {
    const res = await fetch(`${DRIVER_API_BASE}/rider/earnings`, {
      headers: getRiderHeaders()
    });

    if (res.ok) {
      const data = await res.json();
      allRiderEarningsData = data;
      allRiderTrips = data.trips || [];

      updateEarningsUI(data);
      applyEarningsTimeFilter();
      return;
    }
  } catch (e) {
    console.warn('Earnings load offline fallback:', e);
  }

  fallbackLocalEarnings();
}

function updateEarningsUI(data) {
  const statEarn = document.getElementById('statEarnings');
  const statTrips = document.getElementById('statTrips');
  const pTotal = document.getElementById('profileTotalEarnings');
  const pTrips = document.getElementById('profileCompletedTrips');
  const pToday = document.getElementById('profileTodayEarnings');
  const jDateEl = document.getElementById('profileJoiningDate');

  const todayStr = `₹${(data.todayEarnings || 0).toLocaleString('en-IN')}`;
  const totalStr = `₹${(data.allTimeEarnings || data.totalEarnings || 0).toLocaleString('en-IN')}`;

  if (statEarn) statEarn.innerText = todayStr;
  if (statTrips) statTrips.innerText = data.completedTripsCount || 0;
  if (pTotal) pTotal.innerText = totalStr;
  if (pTrips) pTrips.innerText = data.completedTripsCount || 0;
  if (pToday) pToday.innerText = todayStr;

  // Render Date of Joining
  if (jDateEl && data.dateOfJoining) {
    const d = new Date(data.dateOfJoining);
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const daysAgo = Math.max(0, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
    jDateEl.innerHTML = `<i class="fa-regular fa-calendar-check me-1"></i> Date of Joining: <strong style="color:#fff;">${dateStr}</strong> (${daysAgo === 0 ? 'Aaj jude hain' : `${daysAgo} din pehle`})`;
  }
}

/**
 * Handle Time Filter clicks: 7d, 30d, 6m, 1y, all
 */
function setTimeFilter(filterKey) {
  currentEarningsFilter = filterKey;

  // Toggle button active classes
  ['7d', '30d', '6m', '1y', 'all'].forEach(k => {
    const btn = document.getElementById(`filterBtn_${k}`);
    if (btn) {
      if (k === filterKey) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  applyEarningsTimeFilter();
}

function applyEarningsTimeFilter() {
  if (!allRiderEarningsData) return;

  const now = Date.now();
  const timeWindows = {
    '7d': { ms: 7 * 24 * 60 * 60 * 1000, label: 'Pichhle 7 din ki kamai • Customer se direct Cash/UPI mila', amount: allRiderEarningsData.last7DaysEarnings },
    '30d': { ms: 30 * 24 * 60 * 60 * 1000, label: 'Pichhle 30 din (1 Mahina) ki kamai • 100% Aapka', amount: allRiderEarningsData.last30DaysEarnings },
    '6m': { ms: 180 * 24 * 60 * 60 * 1000, label: 'Pichhle 6 mahine ki total kamai • 0% Commission', amount: allRiderEarningsData.last6MonthsEarnings },
    '1y': { ms: 365 * 24 * 60 * 60 * 1000, label: 'Pichhle 1 saal ki kamai • Complete Ledger', amount: allRiderEarningsData.last1YearEarnings },
    'all': { ms: Infinity, label: 'Jab se aap Jude hain tab se All Time kamai', amount: allRiderEarningsData.allTimeEarnings }
  };

  const selected = timeWindows[currentEarningsFilter] || timeWindows['7d'];
  const filteredValEl = document.getElementById('filteredEarningsVal');
  const filteredSubEl = document.getElementById('filteredEarningsSub');

  if (filteredValEl) {
    const amt = selected.amount !== undefined ? selected.amount : 0;
    filteredValEl.innerText = `₹${amt.toLocaleString('en-IN')}`;
  }
  if (filteredSubEl) {
    filteredSubEl.innerText = selected.label;
  }

  // Filter delivery history list according to selected window
  const cutoff = now - selected.ms;
  const filteredTrips = allRiderTrips.filter(t => {
    if (selected.ms === Infinity) return true;
    const tTime = t.timestamp || new Date(t.date).getTime();
    return tTime >= cutoff;
  });

  renderPastDeliveriesList(filteredTrips);
}

function renderPastDeliveriesList(trips) {
  const container = document.getElementById('myPastDeliveriesList');
  const badge = document.getElementById('profileTripsCountBadge');
  if (!container) return;

  if (badge) badge.innerText = trips.length;

  if (!trips || trips.length === 0) {
    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border); border-radius: 14px; padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
        <i class="fa-solid fa-box-open" style="font-size: 1.6rem; color: #475569; margin-bottom: 8px; display: block;"></i>
        Is time period mein koi delivery record nahi mila.
      </div>
    `;
    return;
  }

  container.innerHTML = trips.map(t => `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; margin-bottom: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div>
          <span style="font-size: 0.76rem; font-weight: 800; color: #fff;">${t.id}</span>
          <span style="display: inline-block; margin-left: 6px; background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 12px;">
            ✓ Customer se Prapt
          </span>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 1.1rem; font-weight: 900; color: var(--green);">+₹${t.customer_price || t.driver_earning}</span>
        </div>
      </div>
      <div style="font-size: 0.74rem; color: #cbd5e1; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <i class="fa-solid fa-circle" style="font-size: 6px; color: var(--accent);"></i>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><strong>Pickup:</strong> ${t.pickup || 'Pickup Point'}</span>
      </div>
      <div style="font-size: 0.74rem; color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
        <i class="fa-solid fa-location-dot" style="font-size: 8px; color: var(--green);"></i>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><strong>Drop:</strong> ${t.drop || 'Drop Point'}</span>
      </div>
      <div style="font-size: 0.68rem; color: #64748b; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span>Payment: <strong>${t.payment_mode || 'Cash / Direct UPI'}</strong></span>
        <span>${t.date ? new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Delivered'}</span>
      </div>
    </div>
  `).join('');
}

function fallbackLocalEarnings() {
  if (!currentDriver) return;
  const cleanPhone = String(currentDriver.phone || '').replace(/\D/g, '');
  const driverId = currentDriver.id;

  const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
  const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
  const map = new Map();
  [...p1, ...p2].forEach(p => { if (p && (p.parcel_id || p.id)) map.set(p.parcel_id || p.id, p); });
  const allParcels = Array.from(map.values());

  const myDeliveredTrips = allParcels.filter(p => {
    const isThisDriver = (driverId && p.driver_id === driverId) ||
                         (cleanPhone && p.assigned_driver_phone && String(p.assigned_driver_phone).replace(/\D/g, '') === cleanPhone);
    const st = (p.booking_status || p.status || '').toLowerCase();
    const isCancelled = st === 'cancelled' || st === 'canceled' || st === 'rejected';
    const isDelivered = (st === 'delivered' || p.delivery_otp_verified === true) && !isCancelled && st !== 'searching_driver' && st !== 'received';
    return isThisDriver && isDelivered;
  }).map(p => ({
    id: p.parcel_id || p.id,
    customer_price: Number(p.total_amount || 0),
    driver_earning: Number(p.total_amount || 0),
    pickup: p.pickup_address,
    drop: p.drop_address,
    payment_mode: p.payment_method || 'Cash on Delivery',
    date: p.created_at || new Date().toISOString(),
    timestamp: new Date(p.created_at || Date.now()).getTime()
  }));

  const totalEarnings = myDeliveredTrips.reduce((acc, t) => acc + t.driver_earning, 0);

  allRiderTrips = myDeliveredTrips;
  allRiderEarningsData = {
    todayEarnings: totalEarnings,
    last7DaysEarnings: totalEarnings,
    last30DaysEarnings: totalEarnings,
    last6MonthsEarnings: totalEarnings,
    last1YearEarnings: totalEarnings,
    allTimeEarnings: totalEarnings,
    completedTripsCount: myDeliveredTrips.length,
    dateOfJoining: currentDriver.approved_at || currentDriver.created_at || new Date().toISOString()
  };

  updateEarningsUI(allRiderEarningsData);
  applyEarningsTimeFilter();
}

/* ==========================================================================
   7. LIVE JOBS FEED & ACTIVE TRIP DISPATCH
   ========================================================================== */
async function loadDriverFeed(showRefreshAnim = false) {
  const feedList = document.getElementById('driverFeedList');
  const feedCountEl = document.getElementById('feedCount');
  const activeContainer = document.getElementById('activeTripContainer');
  if (!feedList) return;

  if (showRefreshAnim) {
    const btn = document.getElementById('btnRefreshFeed');
    if (btn) {
      const icon = btn.querySelector('i');
      if (icon) { icon.classList.add('fa-spin'); setTimeout(() => icon.classList.remove('fa-spin'), 600); }
    }
  }

  let activeTripFound = null;
  let availableList = [];
  let feedLoadedFromBackend = false;
  const declinedSet = getDeclinedOrderIds();
  const alertedSet = getAlertedOrderIds();

  try {
    const res = await fetch(`${DRIVER_API_BASE}/rider/jobs`, {
      headers: getRiderHeaders()
    });

    if (res.ok) {
      const data = await res.json();
      feedLoadedFromBackend = true;
      
      // Filter out any trip that has status delivered or was declined
      if (data.activeTrip) {
        const st = data.activeTrip.booking_status || data.activeTrip.status;
        const aId = String(data.activeTrip.parcel_id || data.activeTrip.id);
        if (st !== 'delivered' && !data.activeTrip.delivery_otp_verified && st !== 'driver_declined' && !declinedSet.has(aId)) {
          activeTripFound = data.activeTrip;
        }
      }

      availableList = (data.availableJobs || []).filter(p => {
        const st = p.booking_status || p.status;
        const pId = String(p.parcel_id || p.id);
        return st !== 'delivered' && !p.delivery_otp_verified && (st === 'searching_driver' || st === 'received') && !declinedSet.has(pId);
      });
    }
  } catch (err) {
    console.warn('Jobs feed network notice, using local cache:', err);
  }

  // Local Storage Fallback if backend is offline or waking up
  if (!feedLoadedFromBackend) {
    const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
    const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
    const map = new Map();
    [...p1, ...p2].forEach(p => { if (p && (p.parcel_id || p.id)) map.set(p.parcel_id || p.id, p); });
    const allParcels = Array.from(map.values());

    const cleanPhone = String(currentDriver?.phone || '').replace(/\D/g, '');
    const driverId = currentDriver?.id;

    // Check active trip for this driver (excluding declined or delivered)
    const localActive = allParcels.find(p => {
      const pId = String(p.parcel_id || p.id);
      if (declinedSet.has(pId)) return false;
      const isAssigned = (driverId && p.driver_id === driverId) ||
                         (cleanPhone && p.assigned_driver_phone && String(p.assigned_driver_phone).replace(/\D/g, '') === cleanPhone);
      const st = p.booking_status || p.status || '';
      const isDelivered = st === 'delivered' || p.delivery_otp_verified;
      const isDeclined = st === 'driver_declined';
      const isActiveStatus = ['driver_assigned', 'reached_pickup', 'picked_up', 'in_transit', 'out_for_delivery'].includes(st);
      return isAssigned && isActiveStatus && !isDelivered && !isDeclined;
    });

    activeTripFound = localActive || null;

    if (!activeTripFound && currentDriver?.onDuty !== false) {
      availableList = allParcels.filter(p => {
        const pId = String(p.parcel_id || p.id);
        if (declinedSet.has(pId)) return false;
        const st = p.booking_status || p.status || '';
        const isDelivered = st === 'delivered' || p.delivery_otp_verified;
        return (st === 'searching_driver' || st === 'received') && !p.driver_id && !isDelivered;
      });
    }
  }

  currentActiveTrip = activeTripFound;

  // Render Active Trip if rider is assigned
  if (activeContainer) {
    if (currentActiveTrip) {
      activeContainer.innerHTML = buildActiveTripCard(currentActiveTrip);
    } else {
      activeContainer.innerHTML = '';
    }
  }

  // Render Available Jobs Feed
  if (feedCountEl) feedCountEl.innerText = availableList.length > 0 ? availableList.length : '';

  // Automatic Real-Time Order Arrival Detection & Trigger (Direct Assignment & Open Pool)
  // 1. Direct Admin Assignment Detection & Urgent Alert (Fires ONLY ONCE per order!)
  if (currentActiveTrip) {
    const activeTripId = String(currentActiveTrip.parcel_id || currentActiveTrip.id);
    const tripStatus = currentActiveTrip.booking_status || currentActiveTrip.status || '';
    const isDirectAdminAssigned = tripStatus === 'driver_assigned' || tripStatus === 'received';

    // If assigned by admin and NOT yet alerted or declined, trigger alert ONCE!
    if (isDirectAdminAssigned && !alertedSet.has(activeTripId) && !declinedSet.has(activeTripId)) {
      markOrderAlerted(activeTripId);
      lastSeenActiveTripId = activeTripId;
      currentActiveTrip.isDirectAssignment = true;
      openNewOrderAlertModal(currentActiveTrip);
    }
  }

  // 2. Open Available Pool Jobs Detection & Alert (Fires ONLY ONCE)
  if (currentDriver && currentDriver.onDuty !== false && !currentActiveTrip) {
    if (!isFeedInitialSyncDone) {
      availableList.forEach(p => seenOrderIds.add(String(p.parcel_id || p.id)));
    } else {
      const brandNewJobs = availableList.filter(p => {
        const id = String(p.parcel_id || p.id);
        return !seenOrderIds.has(id) && !alertedSet.has(id) && !declinedSet.has(id);
      });
      if (brandNewJobs.length > 0) {
        const latestJob = brandNewJobs[0];
        const latestJobId = String(latestJob.parcel_id || latestJob.id);
        markOrderAlerted(latestJobId);
        brandNewJobs.forEach(p => seenOrderIds.add(String(p.parcel_id || p.id)));
        latestJob.isDirectAssignment = false;
        openNewOrderAlertModal(latestJob);
      }
    }
  } else {
    availableList.forEach(p => seenOrderIds.add(String(p.parcel_id || p.id)));
  }

  isFeedInitialSyncDone = true;

  if (currentActiveTrip) {
    feedList.innerHTML = `
      <div class="empty-state" style="padding: 24px 16px;">
        <div class="empty-icon" style="color: var(--green);"><i class="fa-solid fa-circle-check"></i></div>
        <div class="empty-title">Trip in Progress</div>
        <div class="empty-sub">Complete your active trip above to receive new orders.</div>
      </div>
    `;
    return;
  }

  if (availableList.length === 0) {
    feedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-satellite-dish"></i></div>
        <div class="empty-title">Scanning for Delivery Jobs...</div>
        <div class="empty-sub">New orders appear here automatically every 8 seconds.</div>
      </div>
    `;
    return;
  }

  feedList.innerHTML = availableList.map(p => buildFeedCard(p)).join('');
}

function buildActiveTripCard(trip) {
  const pId = trip.parcel_id || trip.id;
  const st = trip.booking_status || trip.status || 'driver_assigned';
  const isDelivered = st === 'delivered' || trip.delivery_otp_verified;

  // Safety check: Never render active trip box if trip is delivered
  if (isDelivered) {
    return '';
  }

  const pickupAddr = trip.pickup_address || 'Pickup Point';
  const dropAddr = trip.drop_address || 'Drop Point';
  const fare = Number(trip.total_amount || 0);
  const riderShare = fare; // 100% Direct Customer Payment, 0% Company Commission
  const isPickedUp = st === 'picked_up' || st === 'in_transit' || st === 'out_for_delivery';

  const customerPhone = isPickedUp ? (trip.receiver_phone || trip.sender_phone) : (trip.sender_phone || trip.receiver_phone);
  const targetAddress = isPickedUp ? dropAddr : pickupAddr;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetAddress)}&travelmode=driving&dir_action=navigate`;
  const navBtnLabel = isPickedUp ? '🏁 Route to Drop (Google Maps)' : '🧭 Route to Pickup (Google Maps)';

  return `
    <div class="active-trip-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <span class="active-badge"><i class="fa-solid fa-bolt"></i> ACTIVE TRIP</span>
        <span class="trip-status-pill">${st.replace(/_/g, ' ').toUpperCase()}</span>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div>
          <div class="trip-id-label">Order Number</div>
          <div class="trip-id-val">${pId}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.65rem; color: #22c55e; font-weight: 800; text-transform: uppercase;">100% Direct Cash/UPI</div>
          <div style="font-size: 1.4rem; font-weight: 900; color: var(--green);">₹${riderShare}</div>
        </div>
      </div>

      <div class="route-info-box">
        <div class="route-row">
          <div class="route-icon pickup"><i class="fa-solid fa-arrow-up"></i></div>
          <div style="flex: 1;">
            <div class="route-label">PICKUP FROM</div>
            <div class="route-addr">${pickupAddr}</div>
            <div class="route-contact">Sender: ${trip.sender_name || 'Customer'} (+91 ${trip.sender_phone || '-'})</div>
          </div>
        </div>
        <div class="route-row">
          <div class="route-icon drop"><i class="fa-solid fa-location-dot"></i></div>
          <div style="flex: 1;">
            <div class="route-label">DELIVER TO</div>
            <div class="route-addr">${dropAddr}</div>
            <div class="route-contact">Receiver: ${trip.receiver_name || 'Customer'} (+91 ${trip.receiver_phone || '-'})</div>
          </div>
        </div>
      </div>

      <!-- Quick Action Buttons: Call & Turn-by-Turn Google Maps Navigation -->
      <div style="display: grid; grid-template-columns: 1fr 1.35fr; gap: 8px; margin-bottom: 14px;">
        <a href="tel:${customerPhone}" class="btn-refresh" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; font-size: 0.82rem; font-weight: 700; color: #fff; text-decoration: none; border-color: rgba(255,255,255,0.2);">
          <i class="fa-solid fa-phone text-success"></i> Call Customer
        </a>
        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-refresh" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; font-size: 0.82rem; font-weight: 700; color: #38bdf8; text-decoration: none; border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.08);">
          <i class="fa-solid ${isPickedUp ? 'fa-flag-checkered text-warning' : 'fa-diamond-turn-right text-info'}"></i> ${navBtnLabel}
        </a>
      </div>

      <!-- OTP Verification Trigger Button -->
      ${!isPickedUp ? `
        <button type="button" class="btn-verify-otp" style="background: linear-gradient(135deg, #f97316, #ea580c);" onclick="openOtpSheet('pickup', '${pId}')">
          <i class="fa-solid fa-key"></i> Enter Customer Pickup PIN
        </button>
      ` : `
        <button type="button" class="btn-verify-otp" onclick="openOtpSheet('delivery', '${pId}')">
          <i class="fa-solid fa-circle-check"></i> Enter Delivery PIN & Complete Trip
        </button>
      `}
    </div>
  `;
}

function buildFeedCard(parcel) {
  const pId = parcel.parcel_id || parcel.id;
  const fare = Number(parcel.total_amount || 0);
  const riderShare = fare; // 100% Direct to Rider

  return `
    <div class="feed-card" id="card-${pId}">
      <div class="feed-top" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <div style="font-weight: 800; font-size: 0.95rem; color: #fff; letter-spacing: -0.2px;">${pId}</div>
          <div style="font-size: 0.72rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">${(parcel.parcel_type || 'Package')} Delivery</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.35rem; font-weight: 900; color: #22c55e;">₹${riderShare}</div>
          <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Fare</div>
        </div>
      </div>

      <div class="feed-routes">
        <div class="feed-route-row">
          <i class="fa-solid fa-arrow-up feed-route-icon pickup"></i>
          <span class="feed-route-text"><strong>Pickup:</strong> ${parcel.pickup_address || 'Pickup Point'}</span>
        </div>
        <div class="feed-route-row">
          <i class="fa-solid fa-location-dot feed-route-icon drop"></i>
          <span class="feed-route-text"><strong>Drop:</strong> ${parcel.drop_address || 'Drop Point'}</span>
        </div>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; margin-top: 12px;">
        <button class="btn-accept-job" onclick="acceptDriverJob('${pId}')" style="flex: 1; padding: 11px;">
          <i class="fa-solid fa-circle-check me-1"></i> Accept Job (Earn ₹${riderShare})
        </button>
      </div>
    </div>
  `;
}

async function acceptDriverJob(parcelId) {
  if (!currentDriver) return;
  if (!currentDriver.onDuty) {
    showToast('Please toggle ON DUTY before accepting jobs.', 'error');
    return;
  }

  try {
    const res = await fetch(`${DRIVER_API_BASE}/rider/jobs/${parcelId}/accept`, {
      method: 'POST',
      headers: getRiderHeaders()
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to accept this job.');
    }

    showToast('🚀 Job accepted! Heading to pickup.', 'success');
    switchDriverView('feed');
    loadDriverFeed(true);
  } catch (err) {
    showToast(err.message || 'Error accepting job.', 'error');
  }
}

/* ==========================================================================
   8. OTP BOTTOM SHEET VERIFICATION
   ========================================================================== */
function initOtpDigitInputs() {
  const digits = [document.getElementById('otp1'), document.getElementById('otp2'), document.getElementById('otp3'), document.getElementById('otp4')];
  digits.forEach((el, idx) => {
    if (!el) return;
    el.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val;
      if (val && idx < 3) digits[idx + 1]?.focus();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        digits[idx - 1]?.focus();
      }
    });
  });
}

function openOtpSheet(mode, parcelId) {
  currentOtpMode = mode;
  currentOtpParcelId = parcelId;

  const overlay = document.getElementById('otpOverlay');
  const title = document.getElementById('otpSheetTitle');
  const sub = document.getElementById('otpSheetSub');
  const btnLabel = document.getElementById('btnVerifyLabel');

  [1, 2, 3, 4].forEach(i => {
    const inp = document.getElementById(`otp${i}`);
    if (inp) inp.value = '';
  });

  if (mode === 'pickup') {
    if (title) title.innerText = 'Enter Pickup Verification PIN';
    if (sub) sub.innerText = 'Ask the sender on ground for their 4-digit PIN to load the parcel.';
    if (btnLabel) btnLabel.innerText = 'Verify Pickup PIN';
  } else {
    if (title) title.innerText = 'Enter Delivery PIN';
    if (sub) sub.innerText = 'Ask the receiver for their 4-digit PIN to complete delivery.';
    if (btnLabel) btnLabel.innerText = 'Verify & Complete Delivery';
  }

  if (overlay) overlay.classList.add('active');
  setTimeout(() => document.getElementById('otp1')?.focus(), 200);
}

function closeOtpSheet() {
  const overlay = document.getElementById('otpOverlay');
  if (overlay) overlay.classList.remove('active');
}

async function submitOtpVerification() {
  const digits = [
    document.getElementById('otp1')?.value.trim() || '',
    document.getElementById('otp2')?.value.trim() || '',
    document.getElementById('otp3')?.value.trim() || '',
    document.getElementById('otp4')?.value.trim() || ''
  ];
  const enteredOtp = digits.join('');

  if (enteredOtp.length !== 4) {
    showToast('Please enter all 4 digits of the PIN.', 'error');
    return;
  }

  const btn = document.getElementById('btnVerifyOtp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Verifying...'; }

  const endpoint = currentOtpMode === 'pickup' ? 'verify-pickup-otp' : 'verify-delivery-otp';

  try {
    let isSuccess = false;
    let serverMessage = '';

    const isMovers = String(currentOtpParcelId).startsWith('RB-');
    let primaryUrl = isMovers 
      ? `${DRIVER_API_BASE}/bookings/${currentOtpParcelId}/${endpoint}`
      : `${DRIVER_API_BASE}/parcels/${currentOtpParcelId}/${endpoint}`;

    try {
      let res = await fetch(primaryUrl, {
        method: 'POST',
        headers: getRiderHeaders(),
        body: JSON.stringify({ otp: enteredOtp })
      });

      // If 404, fallback check on the other endpoint
      if (res.status === 404 && !isMovers) {
        res = await fetch(`${DRIVER_API_BASE}/bookings/${currentOtpParcelId}/${endpoint}`, {
          method: 'POST',
          headers: getRiderHeaders(),
          body: JSON.stringify({ otp: enteredOtp })
        });
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        isSuccess = true;
        serverMessage = data.message || '';
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (fetchErr) {
      if (fetchErr.message && (fetchErr.message.includes('PIN') || fetchErr.message.includes('Invalid') || fetchErr.message.includes('Incorrect'))) {
        throw fetchErr;
      }
    }

    // Local Storage synchronization & fallback check (Parcels)
    const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
    const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
    const all = [...p1, ...p2];
    const targetParcel = all.find(p => (p.parcel_id === currentOtpParcelId || p.id === currentOtpParcelId));

    if (targetParcel) {
      if (currentOtpMode === 'pickup') {
        const expected = String(targetParcel.pickup_otp || '').replace(/\D/g, '');
        if (expected && enteredOtp !== expected) {
          throw new Error('Invalid Pickup PIN. Please ask sender for the correct PIN.');
        }
        targetParcel.booking_status = 'picked_up';
        targetParcel.status = 'picked_up';
        targetParcel.pickup_otp_verified = true;
      } else {
        const expected = String(targetParcel.delivery_otp || '').replace(/\D/g, '');
        if (expected && enteredOtp !== expected) {
          throw new Error('Invalid Delivery PIN. Please ask receiver for the correct PIN.');
        }
        targetParcel.booking_status = 'delivered';
        targetParcel.status = 'delivered';
        targetParcel.delivery_otp_verified = true;
        targetParcel.pickup_otp_verified = true;
      }
      localStorage.setItem('rudraksha_parcels', JSON.stringify(p1));
      localStorage.setItem('rudraksha_parcels_history', JSON.stringify(p2));
    }

    // Local Storage synchronization & fallback check (Movers Bookings)
    try {
      const bHistory = JSON.parse(localStorage.getItem('rudraksha_bookings_history') || '[]');
      const targetB = bHistory.find(b => (b.id === currentOtpParcelId));
      if (targetB) {
        if (currentOtpMode === 'pickup') {
          const expected = String(targetB.pickup_otp || '').replace(/\D/g, '');
          if (expected && enteredOtp !== expected) {
            throw new Error('Invalid Pickup PIN. Please ask customer for correct PIN.');
          }
          targetB.status = 'in_transit';
          targetB.booking_status = 'in_transit';
          targetB.pickup_otp_verified = true;
        } else {
          const expected = String(targetB.delivery_otp || '').replace(/\D/g, '');
          if (expected && enteredOtp !== expected) {
            throw new Error('Invalid Delivery PIN. Please ask customer for correct PIN.');
          }
          targetB.status = 'delivered';
          targetB.booking_status = 'delivered';
          targetB.delivery_otp_verified = true;
          targetB.pickup_otp_verified = true;
        }
        localStorage.setItem('rudraksha_bookings_history', JSON.stringify(bHistory));
      }
    } catch (_) {}

    closeOtpSheet();

    if (currentOtpMode === 'pickup') {
      showToast('✅ Pickup PIN verified! Samaan successfully loaded.', 'success');
      // Trigger Instant Official WhatsApp Confirmation Receipt to Customer
      triggerPickupReceiptToCustomer(currentActiveTrip, currentOtpParcelId);
    } else {
      const fare = currentActiveTrip?.total_amount ? `₹${currentActiveTrip.total_amount}` : '';
      showToast(`🎉 Delivery Complete! ${fare} added to your wallet!`, 'success');
      currentActiveTrip = null;
      const activeContainer = document.getElementById('activeTripContainer');
      if (activeContainer) activeContainer.innerHTML = '';
      loadDriverEarnings();
      renderDriverProfileView();
    }

    loadDriverFeed(true);
  } catch (err) {
    showToast(err.message || 'Verification failed.', 'error');
    // Shake inputs
    const wrap = document.querySelector('.otp-input-wrap');
    if (wrap) {
      wrap.style.animation = 'shake 0.4s ease';
      setTimeout(() => wrap.style.animation = '', 400);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-circle-check me-2"></i> <span id="btnVerifyLabel">${currentOtpMode === 'pickup' ? 'Verify Pickup PIN' : 'Verify & Complete Delivery'}</span>`;
    }
  }
}

/**
 * 📲 1-Click WhatsApp Pickup Confirmation Receipt to Customer
 */
function triggerPickupReceiptToCustomer(trip, tripId) {
  const t = trip || currentActiveTrip || {};
  const cName = t.sender_name || t.customer_name || 'Customer';
  const cPhone = t.sender_phone || t.customer_phone || '';
  const dropAddr = t.drop_address || t.drop || 'Destination Point';
  const dName = currentDriver?.name || currentDriver?.driver_name || 'Official Rudraksha Driver';
  const dPhone = currentDriver?.phone || '';
  const veh = currentDriver?.vehicle_number || currentDriver?.vehicle_no || currentDriver?.vehicle_type || 'Assigned Logistics Vehicle';
  const deliveryOtp = t.delivery_otp || '';
  const trackId = tripId || t.parcel_id || t.id || 'ORDER';

  const receiptMsg = 
`🚚 *RUDRAKSHA PACKERS & MOVERS - PICKUP CONFIRMATION RECEIPT* 🚚
━━━━━━━━━━━━━━━━━━━━
Namaste *${cName}*,
Aapka consignment hamare official driver dwara successfully verify karke safely truck/vehicle me load kar liya gaya hai!

📦 *Booking / Order ID:* ${trackId}
👨‍✈️ *Verified Driver:* ${dName}
📞 *Driver Contact:* ${dPhone ? '+91 ' + dPhone : '-'}
🚗 *Vehicle:* ${veh}
📍 *Destination Drop:* ${dropAddr}
${deliveryOtp ? `🔐 *Delivery PIN:* *${deliveryOtp}*\n*(Yeh Delivery PIN destination par saman unload aur check karne ke baad hi driver ke sath share karein)*\n` : ''}
🔍 *Live GPS Tracking Status:*
https://rudraksha-packers.web.app/track.html?tracking=${trackId}
━━━━━━━━━━━━━━━━━━━━
_Aapka samaan hamari zimmedari hai. Safe & Secure Transit!_
_Rudraksha Packers & Movers • Helpline: +91 7999818816_`;

  const waUrl = cPhone ? `https://wa.me/91${cPhone}?text=${encodeURIComponent(receiptMsg)}` : '#';

  // Populate receipt modal
  const orderEl = document.getElementById('receiptOrderId');
  const nameEl = document.getElementById('receiptCustomerName');
  const phoneEl = document.getElementById('receiptCustomerPhone');
  const btnEl = document.getElementById('btnSendCustomerReceipt');

  if (orderEl) orderEl.innerText = trackId;
  if (nameEl) nameEl.innerText = cName;
  if (phoneEl) phoneEl.innerText = cPhone ? `+91 ${cPhone}` : 'Not provided';
  if (btnEl) btnEl.href = waUrl;

  // Open modal
  const overlay = document.getElementById('pickupReceiptOverlay');
  if (overlay) overlay.classList.add('active');

  // Attempt automatic WhatsApp open in new window
  if (cPhone) {
    try {
      window.open(waUrl, '_blank');
    } catch (_) {}
  }
}

function closePickupReceiptModal() {
  const overlay = document.getElementById('pickupReceiptOverlay');
  if (overlay) overlay.classList.remove('active');
}

/* ==========================================================================
   9. VIEW NAVIGATION & TOASTS
   ========================================================================== */
function switchDriverView(viewName) {
  const feedSec = document.getElementById('driverFeedSection');
  const profSec = document.getElementById('driverProfileSection');
  const btnFeed = document.getElementById('btnTabFeed');
  const btnActive = document.getElementById('btnTabActive');
  const btnProf = document.getElementById('btnTabProfile');

  [btnFeed, btnActive, btnProf].forEach(b => b?.classList.remove('active'));

  if (viewName === 'profile') {
    if (feedSec) feedSec.style.display = 'none';
    if (profSec) profSec.style.display = 'block';
    if (btnProf) btnProf.classList.add('active');
    loadDriverEarnings();
    renderDriverProfileView();
  } else if (viewName === 'active') {
    if (feedSec) feedSec.style.display = 'block';
    if (profSec) profSec.style.display = 'none';
    if (btnActive) btnActive.classList.add('active');
    const activeEl = document.getElementById('activeTripContainer');
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth' });
  } else {
    if (feedSec) feedSec.style.display = 'block';
    if (profSec) profSec.style.display = 'none';
    if (btnFeed) btnFeed.classList.add('active');
    loadDriverFeed(false);
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-triangle-exclamation' : 'fa-bell');
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'all 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ==========================================================================
   10. RIDER NOTIFICATION & ORDER ALERT ENGINE (Problem 10 Implementation)
   Audible Web Audio Synthesizer • Push Notifications • Urgent Alert Modal
   ========================================================================== */

/**
 * Initialize Alert System, unlock audio context & update UI buttons
 */
function initRiderAlertSystem() {
  updateRiderSoundButtonUI();
  updateRiderNotifButtonUI();

  // Autoplay compliance: unlock AudioContext on first user interaction
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch (e) {}
  };
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });
}

/**
 * Check notification permission and show setup card if default
 */
function checkAndPromptNotificationPermission() {
  if (!('Notification' in window)) return;
  const setupCard = document.getElementById('notifSetupCard');
  if (Notification.permission === 'default') {
    if (setupCard) setupCard.style.display = 'block';
  } else {
    if (setupCard) setupCard.style.display = 'none';
  }
  updateRiderNotifButtonUI();
}

/**
 * Web Audio API Context (Zero external MP3 dependencies, 100% offline & infallible)
 */
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a calm, pleasant iPhone style notification chime (D5 -> A5 -> D6)
 * Soft sine wave harmonics, gentle volume (0.30), completely non-irritating
 */
function playIphoneNotificationChime() {
  if (!isSoundEnabled || isAudioMutedForCurrentOrder) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Elegant 3-note melodic iPhone chime (D5 -> A5 -> D6)
    const notes = [
      { freq: 587.33, start: 0.00, duration: 0.20, vol: 0.25 },
      { freq: 880.00, start: 0.12, duration: 0.22, vol: 0.28 },
      { freq: 1174.66, start: 0.25, duration: 0.35, vol: 0.26 }
    ];

    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(n.vol, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration);
    });
  } catch (err) {
    console.warn('Notification chime notice:', err);
  }
}

/**
 * Trigger order chime notification (plays once, followed by 1 gentle reminder after 4 seconds)
 */
function startOrderAlertChime() {
  muteAlertSound();
  isAudioMutedForCurrentOrder = false;
  if (!isSoundEnabled) return;

  playIphoneNotificationChime();
  // Optional single gentle reminder after 4 seconds (never an infinite repeating siren!)
  chimeTimeoutId = setTimeout(() => {
    if (!isAudioMutedForCurrentOrder && isSoundEnabled) {
      playIphoneNotificationChime();
    }
  }, 4000);
}

/**
 * Instantly stops/mutes all alert sounds and vibration
 */
function muteAlertSound() {
  isAudioMutedForCurrentOrder = true;
  if (chimeTimeoutId) {
    clearTimeout(chimeTimeoutId);
    chimeTimeoutId = null;
  }
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if ('vibrate' in navigator) {
    try { navigator.vibrate(0); } catch (e) {}
  }
}

/**
 * Backward compatibility aliases
 */
function playDualBeepChime() {
  playIphoneNotificationChime();
}
function startOrderAlertSirenLoop() {
  startOrderAlertChime();
}
function stopOrderAlertSirenLoop() {
  muteAlertSound();
}

/**
 * Toggle Rider Alert Sound (Mute / Unmute)
 */
function toggleRiderAlertSound() {
  isSoundEnabled = !isSoundEnabled;
  localStorage.setItem('rudraksha_rider_sound_enabled', isSoundEnabled ? 'true' : 'false');
  updateRiderSoundButtonUI();

  if (isSoundEnabled) {
    isAudioMutedForCurrentOrder = false;
    playIphoneNotificationChime();
    showToast('🔊 Order chime alert turned ON!', 'success');
  } else {
    muteAlertSound();
    showToast('🔇 Order chime alert muted.', 'info');
  }
}

function updateRiderSoundButtonUI() {
  const btn = document.getElementById('btnRiderSoundToggle');
  const icon = document.getElementById('soundToggleIcon');
  const text = document.getElementById('soundToggleText');
  const modalStatus = document.getElementById('alertSoundStatusText');

  if (btn && icon && text) {
    if (isSoundEnabled) {
      btn.style.color = '#22c55e';
      btn.style.borderColor = 'rgba(34,197,94,0.3)';
      btn.style.background = 'rgba(34,197,94,0.08)';
      icon.className = 'fa-solid fa-volume-high';
      text.innerText = 'Sound ON';
    } else {
      btn.style.color = '#94a3b8';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
      btn.style.background = 'rgba(255,255,255,0.04)';
      icon.className = 'fa-solid fa-volume-xmark';
      text.innerText = 'Sound OFF';
    }
  }

  if (modalStatus) {
    modalStatus.innerHTML = isSoundEnabled
      ? '<i class="fa-solid fa-volume-high me-1"></i> Chime Active'
      : '<i class="fa-solid fa-volume-xmark me-1 text-muted"></i> Chime Muted';
    modalStatus.style.color = isSoundEnabled ? '#22c55e' : '#94a3b8';
  }
}

/**
 * Browser & PWA Push Notification Permission Request
 */
async function requestRiderNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications are not supported in this browser.', 'info');
    return;
  }

  // Unlock audio context on user gesture
  const unlockCtx = getAudioContext();
  if (unlockCtx && unlockCtx.state === 'suspended') {
    unlockCtx.resume().catch(() => {});
  }

  try {
    const perm = await Notification.requestPermission();
    const setupCard = document.getElementById('notifSetupCard');
    if (setupCard) setupCard.style.display = (perm === 'default') ? 'block' : 'none';
    updateRiderNotifButtonUI();

    if (perm === 'granted') {
      playIphoneNotificationChime();
      showToast('🎉 Push & Chime Alerts successfully activated!', 'success');

      // Immediate test notification via Service Worker
      await showRiderBrowserNotification({
        parcel_id: 'TEST-OK',
        total_amount: 250,
        pickup_address: 'Vaishali Nagar, Jaipur',
        drop_address: 'Mansarovar, Jaipur',
        isDirectAssignment: true
      });
    } else {
      showToast('Notifications permission not allowed. In-app popup will still work.', 'info');
    }
  } catch (err) {
    console.warn('Notification permission error:', err);
  }
}

function updateRiderNotifButtonUI() {
  const btn = document.getElementById('btnRiderNotifPerm');
  const text = document.getElementById('notifPermText');
  if (!btn || !text) return;

  if (!('Notification' in window)) {
    btn.style.display = 'none';
    return;
  }

  if (Notification.permission === 'granted') {
    btn.style.color = '#22c55e';
    btn.style.borderColor = 'rgba(34,197,94,0.3)';
    btn.style.background = 'rgba(34,197,94,0.08)';
    text.innerText = 'Push: Active';
  } else if (Notification.permission === 'denied') {
    btn.style.color = '#ef4444';
    btn.style.borderColor = 'rgba(239,68,68,0.3)';
    btn.style.background = 'rgba(239,68,68,0.08)';
    text.innerText = 'Push: Blocked';
  } else {
    btn.style.color = '#38bdf8';
    btn.style.borderColor = 'rgba(56,189,248,0.3)';
    btn.style.background = 'rgba(56,189,248,0.08)';
    text.innerText = 'Enable Push';
  }
}

/**
 * Trigger System / Android Lock Screen Notification via Service Worker
 * With 3 clear actions: Accept, Decline, Silent
 */
async function showRiderBrowserNotification(order) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const pId = order.parcel_id || order.id || 'ORDER';
    const fare = Number(order.total_amount || 0);
    const pickup = (order.pickup_address || 'Pickup Point').slice(0, 40);
    const drop = (order.drop_address || 'Drop Point').slice(0, 40);
    const isAssigned = order.isDirectAssignment === true;

    const title = isAssigned 
      ? `🚨 NAYA ORDER ASSIGN HUA! (Kamai ₹${fare})` 
      : `⚡ NAYA PARCEL ORDER! (Kamai ₹${fare})`;

    const options = {
      body: `📍 Pickup: ${pickup}\n🏁 Drop: ${drop}\nKamai: ₹${fare}`,
      icon: 'driver-icon-192.png',
      badge: 'driver-icon-192.png',
      tag: `rudraksha-order-${pId}`,
      renotify: false, // Do NOT re-buzz repeatedly
      requireInteraction: true,
      silent: false,
      vibrate: [250, 100, 250],
      actions: [
        { action: 'accept', title: '✅ ACCEPT' },
        { action: 'decline', title: '❌ DECLINE' },
        { action: 'silent', title: '🔕 SILENT' }
      ],
      data: {
        url: './driver.html',
        orderId: pId
      }
    };

    // 1. Mandatory for Android Chrome & Mobile PWA
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, options);
          return;
        }
      } catch (swErr) {
        console.warn('SW notification fallback to window notification:', swErr);
      }
    }

    // 2. Fallback to standard window Notification for desktop
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      notif.close();
      openNewOrderAlertModal(order);
    };
  } catch (err) {
    console.warn('Browser notification display error:', err);
  }
}

/**
 * Open High-Priority New Order Alert Modal with Countdown & iPhone Chime Sound
 * Shows the 3 prominent actions: [ACCEPT], [DECLINE], [SILENT]
 */
function openNewOrderAlertModal(order) {
  if (!order) return;
  currentAlertingOrder = order;

  const overlay = document.getElementById('newOrderAlertOverlay');
  if (!overlay) return;
  const fareEl = document.getElementById('alertModalFare');
  const btnFareEl = document.getElementById('alertBtnFare');
  const idEl = document.getElementById('alertModalOrderId');
  const pickupEl = document.getElementById('alertModalPickup');
  const dropEl = document.getElementById('alertModalDrop');
  const secEl = document.getElementById('alertCountdownSeconds');
  const barEl = document.getElementById('alertTimerProgress');
  const badgeText = document.getElementById('alertModalBadgeText');
  const btnLabel = document.getElementById('alertBtnLabel');
  const btnIcon = document.getElementById('alertBtnIcon');
  const modalStatus = document.getElementById('alertSoundStatusText');
  const btnSilent = document.getElementById('btnAlertSilent');

  const pId = order.parcel_id || order.id || 'RDR-JOB';
  const fare = Number(order.total_amount || 0);
  const isDirect = order.isDirectAssignment === true;

  if (fareEl) fareEl.innerText = `₹${fare}`;
  if (btnFareEl) btnFareEl.innerText = `${fare}`;
  if (idEl) idEl.innerText = `Booking #${pId} • ${(order.parcel_type || 'Package').toUpperCase()}`;
  if (pickupEl) pickupEl.innerText = order.pickup_address || 'Pickup Location, Jaipur';
  if (dropEl) dropEl.innerText = order.drop_address || 'Delivery Location, Jaipur';

  if (badgeText) {
    badgeText.innerText = isDirect ? '🚨 NAYA ORDER ASSIGN HUA HAI! (ADMIN DISPATCH)' : '⚡ NAYA PARCEL DELIVERY JOB AVAILABLE!';
  }
  if (btnLabel) {
    btnLabel.innerHTML = isDirect 
      ? `START ROUTE • Kamai ₹<span>${fare}</span>` 
      : `ACCEPT (₹<span>${fare}</span>)`;
  }
  if (btnIcon) {
    btnIcon.className = isDirect ? 'fa-solid fa-diamond-turn-right me-1' : 'fa-solid fa-circle-check me-1';
  }

  // Reset Silent button & status
  isAudioMutedForCurrentOrder = false;
  if (modalStatus) {
    modalStatus.innerHTML = isSoundEnabled
      ? '<i class="fa-solid fa-volume-high"></i> <span>Chime Active</span>'
      : '<i class="fa-solid fa-volume-xmark text-muted"></i> <span>Muted</span>';
    modalStatus.style.color = isSoundEnabled ? '#22c55e' : '#94a3b8';
  }
  if (btnSilent) {
    btnSilent.style.opacity = '1';
    btnSilent.innerHTML = '<i class="fa-solid fa-volume-xmark" id="btnAlertSilentIcon"></i><span id="btnAlertSilentText">SILENT</span>';
  }

  // Start 45s countdown timer
  if (alertCountdownInterval) clearInterval(alertCountdownInterval);
  let remainingSeconds = 45;
  if (secEl) secEl.innerText = remainingSeconds;
  if (barEl) barEl.style.width = '100%';

  alertCountdownInterval = setInterval(() => {
    remainingSeconds--;
    if (secEl) secEl.innerText = remainingSeconds;
    if (barEl) {
      const pct = Math.max(0, (remainingSeconds / 45) * 100);
      barEl.style.width = `${pct}%`;
    }

    if (remainingSeconds <= 0) {
      dismissNewOrderAlert(false);
      showToast('Order alert auto-dismissed. Still available in active trip.', 'info');
    }
  }, 1000);

  // Play pleasant iPhone notification chime (plays once, not an infinite irritating loop)
  startOrderAlertChime();

  // Gentle vibration (short dual pulse)
  if ('vibrate' in navigator) {
    try { navigator.vibrate([250, 100, 250]); } catch (e) {}
  }

  // Fire Android lock screen push notification via Service Worker
  showRiderBrowserNotification(order);

  // Show modal
  overlay.classList.add('active');
}

/**
 * Dismiss the Alert Modal and silence audio
 */
function dismissNewOrderAlert(isManual = true) {
  muteAlertSound();
  if (alertCountdownInterval) {
    clearInterval(alertCountdownInterval);
    alertCountdownInterval = null;
  }

  if (currentAlertingOrder) {
    const oId = String(currentAlertingOrder.parcel_id || currentAlertingOrder.id);
    acknowledgedAssignedTrips.add(oId);
    markOrderAlerted(oId);
  }

  const overlay = document.getElementById('newOrderAlertOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }

  if (isManual) {
    showToast('Chime silenced. Order is available in your dashboard.', 'info');
  }
}

/**
 * Option 1: Rider clicks "SILENT" on Alert Modal or Notification
 * Immediately mutes sound & vibration, keeps order on screen for action
 */
function silenceIncomingAlertOrder() {
  muteAlertSound();

  const modalStatus = document.getElementById('alertSoundStatusText');
  if (modalStatus) {
    modalStatus.innerHTML = '<i class="fa-solid fa-volume-xmark me-1 text-muted"></i> <span>Silenced</span>';
    modalStatus.style.color = '#94a3b8';
  }
  const btnSilent = document.getElementById('btnAlertSilent');
  if (btnSilent) {
    btnSilent.style.opacity = '0.7';
    btnSilent.innerHTML = '<i class="fa-solid fa-volume-xmark"></i><span>MUTED</span>';
  }

  showToast('🔕 Audio silenced. Order is on your screen.', 'info');
}

/**
 * Option 2: Rider clicks "DECLINE" on Alert Modal or Notification
 * Completely stops alert, marks order declined locally & in backend,
 * and permanently prevents it from ever returning to this driver.
 */
async function declineIncomingAlertOrder() {
  const orderToDecline = currentAlertingOrder;
  if (!orderToDecline) {
    dismissNewOrderAlert(false);
    return;
  }
  const orderId = String(orderToDecline.parcel_id || orderToDecline.id);

  // 1. Immediately mute sound and close modal
  muteAlertSound();
  dismissNewOrderAlert(false);

  // 2. Mark permanently as declined & alerted locally
  addDeclinedOrderId(orderId);
  markOrderAlerted(orderId);

  // 3. Clear active trip locally if this order was assigned to this driver
  if (currentActiveTrip && String(currentActiveTrip.parcel_id || currentActiveTrip.id) === orderId) {
    currentActiveTrip = null;
    const activeEl = document.getElementById('activeTripContainer');
    if (activeEl) activeEl.innerHTML = '';
  }

  // 4. Update local storage caches so it never pops up again
  try {
    ['rudraksha_parcels', 'rudraksha_parcels_history'].forEach(key => {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const idx = list.findIndex(p => String(p.parcel_id || p.id) === orderId);
      if (idx !== -1) {
        list[idx].booking_status = 'driver_declined';
        list[idx].status = 'driver_declined';
        list[idx].driver_id = null;
        list[idx].assigned_driver_name = null;
        list[idx].declined_driver_id = currentDriver?.id;
        list[idx].declined_driver_name = currentDriver?.driver_name;
        list[idx].declined_driver_phone = currentDriver?.phone;
        list[idx].declined_at = new Date().toISOString();
      }
      localStorage.setItem(key, JSON.stringify(list));
    });
  } catch (e) {}

  // 5. Notify backend API so Admin Dashboard gets instant notice & Telegram dispatch
  try {
    await fetch(`${DRIVER_API_BASE}/rider/jobs/${encodeURIComponent(orderId)}/decline`, {
      method: 'POST',
      headers: getRiderHeaders(),
      body: JSON.stringify({
        driver_id: currentDriver?.id,
        driver_name: currentDriver?.driver_name,
        driver_phone: currentDriver?.phone,
        reason: 'Declined by driver via app notification'
      })
    });
  } catch (apiErr) {
    console.warn('Decline API network notice:', apiErr);
  }

  showToast('❌ Order declined. Admin will reassign to another driver.', 'info');
  loadDriverFeed(false);
}

/**
 * Option 3: Rider clicks "ACCEPT ORDER / START ROUTE" on Alert Modal or Notification
 */
async function acceptIncomingAlertOrder() {
  if (!currentAlertingOrder) return;
  const orderToAccept = currentAlertingOrder;
  const orderId = String(orderToAccept.parcel_id || orderToAccept.id);
  const isDirect = orderToAccept.isDirectAssignment === true;

  muteAlertSound();
  markOrderAlerted(orderId);
  dismissNewOrderAlert(false);

  if (isDirect) {
    // Already assigned by admin! Scroll to active trip card with highlight
    switchDriverView('feed');
    const activeEl = document.getElementById('activeTripContainer');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth' });
    }
    showToast('🚀 Order assigned! Customer pickup par navigate karein.', 'success');
  } else {
    // Open Pool Job: call accept API
    if (currentDriver && !currentDriver.onDuty) {
      await toggleDriverDuty();
    }
    await acceptDriverJob(orderId);
  }
}

/**
 * Service Worker Action Message Listener (Handles lock screen Accept / Decline / Silent taps)
 */
function initServiceWorkerActionListener() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.type === 'RIDER_NOTIFICATION_ACTION') {
        console.log('[Rider App] Action from Notification:', data.action, data.orderId);
        if (data.action === 'silent') {
          silenceIncomingAlertOrder();
        } else if (data.action === 'decline') {
          declineIncomingAlertOrder();
        } else if (data.action === 'accept') {
          acceptIncomingAlertOrder();
        }
      }
    });
  }
}

/**
 * Test Order Alert Button (Simulates Admin Assignment with Siren & Lock Screen Push)
 */
function triggerTestNewOrderAlert() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const sampleLocalities = [
    { pickup: 'Vaishali Nagar (Near Amrapali Circle), Jaipur', drop: 'Mansarovar Metro Station (Pillar 64), Jaipur', fare: 240 },
    { pickup: 'Malviya Nagar (World Trade Park), Jaipur', drop: 'C-Scheme (Ahinsa Circle), Jaipur', fare: 280 },
    { pickup: 'Raja Park (LBS College Marg), Jaipur', drop: 'Jagatpura (Railway Flyover), Jaipur', fare: 320 }
  ];
  const randLoc = sampleLocalities[Math.floor(Math.random() * sampleLocalities.length)];
  const testJobId = 'RDR-' + Math.floor(10000 + Math.random() * 90000);

  const testOrder = {
    parcel_id: testJobId,
    id: testJobId,
    total_amount: randLoc.fare,
    pickup_address: randLoc.pickup,
    drop_address: randLoc.drop,
    parcel_type: 'Urgent Express Box / Document',
    sender_name: 'Jaipur Merchant Hub',
    sender_phone: '9829012345',
    receiver_name: 'Customer Delivery Point',
    receiver_phone: '9829067890',
    isDirectAssignment: true,
    booking_status: 'driver_assigned',
    created_at: new Date().toISOString()
  };

  showToast('🔔 Siren, Vibration & Lock Screen Push testing...', 'info');
  openNewOrderAlertModal(testOrder);
}

/**
 * Direct Driver APK Downloader
 * Downloads the full 51.9 MB APK from GitHub CDN / Render
 */
window.startDriverApkDownload = function(e, el) {
  if (e && e.preventDefault) e.preventDefault();
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const apkUrl = isLocal
    ? '/downloads/RudrakshaDriver.apk'
    : 'https://github.com/rudrakshamovers1460-rgb/Rudraksha_packers_movers/releases/latest/download/RudrakshaDriver.apk';
  try {
    if (typeof showToast === 'function') {
      showToast('📲 Official Rudraksha Driver APK (52.5 MB) download ho raha hai...', 'success');
    }
  } catch (err) {
    console.error('Download toast error:', err);
  }
  const a = document.createElement('a');
  a.href = apkUrl;
  a.download = 'RudrakshaDriver.apk';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 500);
};
