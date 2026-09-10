/* ==========================================================================
   DRIVER PARTNER INTERFACE ENGINE v2 | RUDRAKSHA LOGISTICS FLEET
   Phase 2 — Premium UX: Toast Notifications, OTP Bottom Sheet, Profile Setup,
   Auto-refresh Feed, WhatsApp Acceptance, Earnings Tracker
   ========================================================================== */

const isLocalhostDriver = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DRIVER_API_BASE = isLocalhostDriver ? 'http://localhost:3000/api' : 'https://rudraksha-packers-movers.onrender.com/api';

// Default Rider Profile (loaded from localStorage)
let currentDriver = {
  id: 'drv-101',
  driver_name: 'Rajesh Kumar',
  driver_phone: '7296831460',
  vehicle_number: 'RJ-14-GA-1024',
  vehicle_type: 'Tata Ace / Bike Courier',
  onDuty: true
};

let currentActiveTrip = null;
let currentOtpMode = 'pickup'; // 'pickup' or 'delivery'
let currentOtpParcelId = null;
let feedAutoRefreshTimer = null;

/* ==========================================================================
   1. INIT & AUTHENTICATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const isLoggedIn = checkDriverAuth();
  initDriverProfile();
  loadActiveTripFromStorage();
  loadDriverFeed();
  checkUrlDispatchJob();
  initOtpDigitInputs();

  // Auto-refresh job feed every 6 seconds
  feedAutoRefreshTimer = setInterval(() => {
    if (localStorage.getItem('rudraksha_driver_session')) {
      loadDriverFeed(false);
    }
  }, 6000);
});

function checkDriverAuth() {
  const session = localStorage.getItem('rudraksha_driver_session');
  const loginOverlay = document.getElementById('driverLoginOverlay');

  if (session) {
    try {
      currentDriver = JSON.parse(session);
      if (loginOverlay) loginOverlay.style.display = 'none';
      return true;
    } catch {}
  }

  // Not logged in -> Show login overlay
  if (loginOverlay) {
    loginOverlay.style.display = 'flex';
    loginOverlay.style.opacity = '1';
  }
  return false;
}

async function submitDriverLogin() {
  const phoneInput = document.getElementById('loginDriverPhone')?.value.trim().replace(/\D/g, '');
  const pinInput = document.getElementById('loginDriverPin')?.value.trim();
  const errorEl = document.getElementById('loginErrorMsg');

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

  try {
    const apiBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3000/api'
      : 'https://rudraksha-packers-movers.onrender.com/api';

    const driversRes = await fetch(`${apiBase}/drivers/public`);
    let matchedDriver = null;
    if (driversRes.ok) {
      const driversData = await driversRes.json();
      const approvedDrivers = Array.isArray(driversData.drivers) ? driversData.drivers : [];
      matchedDriver = approvedDrivers.find(d => (d.phone || '').replace(/\D/g, '') === phoneInput);
      if (matchedDriver) {
        localStorage.setItem('rudraksha_approved_drivers', JSON.stringify(approvedDrivers));
      }
    }

    if (!matchedDriver) {
      const localApprovedDrivers = JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]');
      matchedDriver = localApprovedDrivers.find(d => (d.driver_phone || '').replace(/\D/g, '') === phoneInput);
    }

    const riderApps = JSON.parse(localStorage.getItem('rudraksha_rider_applications') || '[]');
    const matchedApp = riderApps.find(a => (a.phone || '').replace(/\D/g, '') === phoneInput);

    if (!matchedDriver) {
      if (matchedApp && matchedApp.status === 'Pending') {
        if (errorEl) {
          errorEl.innerText = `⏳ Your application is currently PENDING verification by Admin. You will receive your PIN on WhatsApp once approved.`;
          errorEl.style.display = 'block';
        }
        return;
      }
      if (errorEl) {
        errorEl.innerText = `❌ No active delivery partner found for +91 ${phoneInput}. Please register as a rider partner first.`;
        errorEl.style.display = 'block';
      }
      return;
    }

    const driverPhone = matchedDriver.driver_phone || matchedDriver.phone || '';
    const driverPin = matchedDriver.pin || matchedDriver.password || '';
    if (!driverPin || String(driverPin) !== String(pinInput)) {
      if (errorEl) {
        errorEl.innerText = '❌ Incorrect security PIN. Please check the PIN sent to your WhatsApp.';
        errorEl.style.display = 'block';
      }
      return;
    }

    const normalizedDriver = {
      id: matchedDriver.id || matchedDriver.driverId || `RDR-${phoneInput.slice(-4)}`,
      driver_name: matchedDriver.driver_name || matchedDriver.name || 'Rudraksha Rider',
      driver_phone: driverPhone,
      vehicle_number: matchedDriver.vehicle_number || matchedDriver.vehNum || '',
      vehicle_type: matchedDriver.vehicle_type || matchedDriver.vehType || 'Bike / Scooter',
      pin: driverPin,
      status: matchedDriver.status || 'Active',
      onDuty: matchedDriver.onDuty !== false
    };

    currentDriver = normalizedDriver;
    localStorage.setItem('rudraksha_driver_session', JSON.stringify(currentDriver));
    localStorage.setItem('rudraksha_current_driver', JSON.stringify(currentDriver));
    localStorage.setItem('rudraksha_approved_drivers', JSON.stringify([...(JSON.parse(localStorage.getItem('rudraksha_approved_drivers') || '[]')).filter(d => (d.driver_phone || d.phone || '').replace(/\D/g, '') !== phoneInput), normalizedDriver]));

    const loginOverlay = document.getElementById('driverLoginOverlay');
    if (loginOverlay) {
      loginOverlay.style.transition = 'all 0.3s ease';
      loginOverlay.style.opacity = '0';
      setTimeout(() => {
        loginOverlay.style.display = 'none';
        loginOverlay.style.opacity = '1';
      }, 300);
    }

    renderNavProfile();
    updateDriverStatsDisplay();
    renderDriverProfileView();
    loadActiveTripFromStorage();
    loadDriverFeed(true);

    showToast(`🎉 Login successful! Welcome back, ${currentDriver.driver_name}!`, 'success');
  } catch (err) {
    if (errorEl) {
      errorEl.innerText = 'Unable to connect to the rider service right now. Please try again.';
      errorEl.style.display = 'block';
    }
    console.error(err);
  }
}

  // Hide login overlay with animation
  const loginOverlay = document.getElementById('driverLoginOverlay');
  if (loginOverlay) {
    loginOverlay.style.transition = 'all 0.3s ease';
    loginOverlay.style.opacity = '0';
    setTimeout(() => {
      loginOverlay.style.display = 'none';
      loginOverlay.style.opacity = '1';
    }, 300);
  }

  // Refresh views
  renderNavProfile();
  updateDriverStatsDisplay();
  renderDriverProfileView();
  loadActiveTripFromStorage();
  loadDriverFeed(true);

  showToast(`🎉 Login successful! Welcome back, ${currentDriver.driver_name}!`, 'success');
}

function logoutDriver(skipConfirm = false) {
  try {
    const driverName = (currentDriver && currentDriver.driver_name) ? currentDriver.driver_name : 'Driver';
    if (!skipConfirm && typeof confirm === 'function') {
      const ok = confirm(`Are you sure you want to log out from ${driverName}'s account?`);
      if (!ok) return;
    }
  } catch (e) {
    console.warn('Confirm dialog skipped or error:', e);
  }

  // 1. Clear all session and driver state
  localStorage.removeItem('rudraksha_driver_session');
  localStorage.removeItem('rudraksha_current_driver');
  currentDriver = null;

  // 2. Clear inputs
  const phoneInput = document.getElementById('loginDriverPhone');
  if (phoneInput) phoneInput.value = '';
  const pinInput = document.getElementById('loginDriverPin');
  if (pinInput) pinInput.value = '';
  const errorEl = document.getElementById('loginErrorMsg');
  if (errorEl) errorEl.style.display = 'none';

  // 3. Force show login overlay immediately
  const loginOverlay = document.getElementById('driverLoginOverlay');
  if (loginOverlay) {
    loginOverlay.style.display = 'flex';
    loginOverlay.style.opacity = '1';
    loginOverlay.style.visibility = 'visible';
  }

  // 4. Switch view to feed
  if (typeof switchDriverView === 'function') {
    try { switchDriverView('feed'); } catch (e) {}
  }

  showToast('Logged out successfully.', 'info');

  // 5. Clean reload after brief tick to reset all timers, in-memory states, and active trip polling
  setTimeout(() => {
    window.location.reload();
  }, 200);
}

/* ==========================================================================
   2. RIDER PROFILE & DATA ISOLATION
   ========================================================================== */
function initDriverProfile() {
  const session = localStorage.getItem('rudraksha_driver_session');
  const saved = localStorage.getItem('rudraksha_current_driver');
  if (session) {
    try { currentDriver = JSON.parse(session); } catch {}
  } else if (saved) {
    try { currentDriver = JSON.parse(saved); } catch {}
  }

  if (!currentDriver) {
    currentDriver = {
      id: 'drv-101',
      driver_name: 'Rudraksha Rider',
      driver_phone: '',
      vehicle_number: '',
      vehicle_type: 'Delivery Fleet',
      status: 'Active',
      onDuty: true
    };
  }

  renderNavProfile();
  updateDriverStatsDisplay();

  const logPhone = document.getElementById('logoutPhoneLabel');
  if (logPhone) {
    logPhone.innerText = currentDriver.driver_phone ? `+91 ${currentDriver.driver_phone}` : '-';
  }
}

function renderNavProfile() {
  const nameEl = document.getElementById('navDriverName');
  const vehEl = document.getElementById('navVehicleInfo');
  if (nameEl) nameEl.innerText = currentDriver.driver_name;
  if (vehEl) vehEl.innerText = `${currentDriver.vehicle_type} • ${currentDriver.vehicle_number}`;
  updateDutyDisplay();
}

function openSetupSheet() {
  const overlay = document.getElementById('setupOverlay');
  if (!overlay) return;
  document.getElementById('setupName').value = currentDriver.driver_name || '';
  document.getElementById('setupPhone').value = currentDriver.driver_phone || '';
  document.getElementById('setupVehicleNo').value = currentDriver.vehicle_number || '';
  document.getElementById('setupVehicleType').value = currentDriver.vehicle_type || '';
  overlay.classList.add('active');
}

function saveRiderProfile() {
  const name = document.getElementById('setupName')?.value.trim();
  const phone = document.getElementById('setupPhone')?.value.trim();
  const vNo = document.getElementById('setupVehicleNo')?.value.trim();
  const vType = document.getElementById('setupVehicleType')?.value.trim();

  if (!name || !phone) {
    showToast('Please enter your name and mobile number.', 'error');
    return;
  }

  currentDriver = {
    id: `drv-${phone.slice(-4)}`,
    driver_name: name,
    driver_phone: phone,
    vehicle_number: vNo || 'RJ-00-GA-0000',
    vehicle_type: vType || 'Bike',
    onDuty: currentDriver.onDuty !== undefined ? currentDriver.onDuty : true
  };
  localStorage.setItem('rudraksha_current_driver', JSON.stringify(currentDriver));

  document.getElementById('setupOverlay').classList.remove('active');
  renderNavProfile();
  updateDriverStatsDisplay();
  renderDriverProfileView();
  loadDriverFeed(true);
  showToast(`Profile updated! Welcome, ${name} 👋`, 'success');
}

/* ==========================================================================
   3. STATS DISPLAY & DATA ISOLATION (Scoped strictly per Driver)
   ========================================================================== */
function getDriverEarningsAndDeliveries() {
  const allParcels = getAllParcelsFromStorage();
  const driverPhoneClean = (currentDriver.driver_phone || '').replace(/\D/g, '');

  // Filter deliveries belonging ONLY to this specific driver
  const myDeliveries = allParcels.filter(p => {
    const pPhoneClean = (p.assigned_driver_phone || '').replace(/\D/g, '');
    const isThisDriver = (p.driver_id && p.driver_id === currentDriver.id) ||
                         (pPhoneClean && driverPhoneClean && pPhoneClean === driverPhoneClean);
    const isDone = (p.booking_status === 'delivered' || p.status === 'delivered');
    return isThisDriver && isDone;
  });

  // Calculate earnings from completed deliveries
  const deliveryEarnings = myDeliveries.reduce((sum, p) => sum + Math.round((Number(p.total_amount) || 0) * 0.85), 0);

  // Stored base earnings per driver phone
  const storedBase = Number(localStorage.getItem(`rudraksha_driver_bonus_${driverPhoneClean}`) || (driverPhoneClean === '7296831460' ? '1450' : '0'));
  const totalEarnings = deliveryEarnings + storedBase;

  // Today's earnings
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDeliveries = myDeliveries.filter(p => (p.completed_at || p.created_at || '').startsWith(todayStr));
  const todayEarnings = todayDeliveries.reduce((sum, p) => sum + Math.round((Number(p.total_amount) || 0) * 0.85), 0) + (driverPhoneClean === '7296831460' ? 1450 : 0);

  const totalTrips = myDeliveries.length + (driverPhoneClean === '7296831460' ? 7 : 0);

  return { myDeliveries, totalEarnings, totalTrips, todayEarnings };
}

function updateDriverStatsDisplay() {
  const { totalEarnings, totalTrips } = getDriverEarningsAndDeliveries();
  const eEl = document.getElementById('statEarnings');
  const tEl = document.getElementById('statTrips');
  if (eEl) eEl.innerText = `₹${totalEarnings.toLocaleString('en-IN')}`;
  if (tEl) tEl.innerText = totalTrips;
}

/* ==========================================================================
   4. STORAGE HELPERS
   ========================================================================== */
function getAllParcelsFromStorage() {
  // Merge from both keys
  let combined = [];
  try {
    const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
    const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
    const map = new Map();
    [...p1, ...p2].forEach(p => {
      const id = p.parcel_id || p.id;
      if (id && !map.has(id)) map.set(id, p);
    });
    combined = Array.from(map.values());
  } catch {}

  // Seed sample requests only if completely empty
  if (!combined || combined.length === 0) {
    combined = [
      {
        parcel_id: 'RP-PCL-482910',
        sender_name: 'Mukesh Sharma',
        sender_phone: '9829012345',
        receiver_name: 'Priya Verma',
        receiver_phone: '9829098765',
        pickup_address: 'Sirsi Road, Jaipur',
        drop_address: 'Vaishali Nagar Amrapali Circle, Jaipur',
        distance_km: 5.4,
        parcel_type: 'Documents & Envelope',
        weight_category: 'Upto 1 KG',
        vehicle_type: 'bike',
        total_amount: 89,
        payment_method: 'Cash on Delivery',
        booking_status: 'searching_driver',
        pickup_otp: '3412',
        delivery_otp: '7890',
        created_at: new Date(Date.now() - 5 * 60000).toISOString()
      },
      {
        parcel_id: 'RP-PCL-918234',
        sender_name: 'Rajat Joshi',
        sender_phone: '9414011223',
        receiver_name: 'Deepak Meena',
        receiver_phone: '9414099887',
        pickup_address: 'Mansarovar Metro Station, Jaipur',
        drop_address: 'Malviya Nagar Gaurav Tower, Jaipur',
        distance_km: 9.8,
        parcel_type: 'Electronics Item',
        weight_category: '1 to 5 KG',
        vehicle_type: 'bike',
        total_amount: 145,
        payment_method: 'UPI / Online',
        booking_status: 'searching_driver',
        pickup_otp: '5566',
        delivery_otp: '2244',
        created_at: new Date(Date.now() - 15 * 60000).toISOString()
      }
    ];
    saveAllParcelsToStorage(combined);
  }
  return combined;
}

function saveAllParcelsToStorage(list) {
  try {
    localStorage.setItem('rudraksha_parcels', JSON.stringify(list));
    localStorage.setItem('rudraksha_parcels_history', JSON.stringify(list));
  } catch {}
}

/* ==========================================================================
   5. JOB FEED
   ========================================================================== */
function loadDriverFeed(showRefreshAnim = false) {
  const feedList = document.getElementById('driverFeedList');
  const feedCountEl = document.getElementById('feedCount');
  if (!feedList) return;

  if (showRefreshAnim) {
    const btn = document.getElementById('btnRefreshFeed');
    if (btn) {
      const icon = btn.querySelector('i');
      if (icon) { icon.classList.add('fa-spin'); setTimeout(() => icon.classList.remove('fa-spin'), 600); }
    }
  }

  const allParcels = getAllParcelsFromStorage();

  // Available = searching_driver + this rider's accepted (not yet delivered)
  const available = allParcels.filter(p => {
    const st = p.booking_status || p.status || '';
    if (st === 'delivered' || st === 'cancelled') return false;
    if (st === 'searching_driver') return true;
    // Show if this rider accepted it and it's in some active state
    if (['driver_assigned', 'reached_pickup', 'picked_up', 'in_transit', 'out_for_delivery'].includes(st)) {
      return (p.assigned_driver_phone === currentDriver.driver_phone || p.driver_id === currentDriver.id);
    }
    return false;
  });

  if (feedCountEl) feedCountEl.innerText = available.length > 0 ? available.length : '';

  if (available.length === 0) {
    feedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-satellite-dish"></i></div>
        <div class="empty-title">Scanning for Parcel Jobs...</div>
        <div class="empty-sub">New delivery requests will appear here automatically.</div>
      </div>
    `;
    return;
  }

  feedList.innerHTML = available.map(parcel => buildFeedCard(parcel)).join('');
}

function buildFeedCard(parcel) {
  const pId = parcel.parcel_id || parcel.id;
  const st = parcel.booking_status || parcel.status || 'searching_driver';
  const isMyJob = (parcel.assigned_driver_phone === currentDriver.driver_phone || parcel.driver_id === currentDriver.id);
  const riderEarning = Math.round((parcel.total_amount || 100) * 0.85);
  const timeAgo = getTimeAgo(parcel.created_at);

  let badgeText = '⚡ NEW DELIVERY REQUEST';
  let badgeStyle = '';
  let acceptLabel = '<i class="fa-solid fa-circle-check"></i> Accept Delivery Job';

  if (isMyJob) {
    badgeText = '🔄 YOUR ACCEPTED JOB';
    badgeStyle = 'background:rgba(34,197,94,0.15);border-color:rgba(34,197,94,0.3);color:#22c55e;';
    acceptLabel = '<i class="fa-solid fa-arrow-right"></i> Continue Delivery';
  }

  return `
    <div class="feed-card${isMyJob ? ' highlighted' : ''}" id="card-${pId}">
      <div class="feed-top">
        <div>
          <span class="feed-badge" style="${badgeStyle}">${badgeText}</span>
          <div class="feed-id">${pId} <span style="font-size:0.68rem;color:#64748b;font-weight:400;">• ${timeAgo}</span></div>
        </div>
        <div>
          <div class="feed-fare">₹${parcel.total_amount || 0}</div>
          <div class="feed-payout">You earn: <strong>₹${riderEarning}</strong></div>
        </div>
      </div>

      <div class="feed-route">
        <div class="feed-route-row">
          <div class="feed-route-dot p"></div>
          <div class="feed-route-text">
            <div class="feed-route-tag">Pickup</div>
            <div class="feed-route-addr">${parcel.pickup_address}</div>
            <div class="feed-route-who">${parcel.sender_name || 'Sender'} • ${parcel.sender_phone || ''}</div>
          </div>
        </div>
        <div class="feed-route-row">
          <div class="feed-route-dot d"></div>
          <div class="feed-route-text">
            <div class="feed-route-tag">Drop</div>
            <div class="feed-route-addr">${parcel.drop_address}</div>
            <div class="feed-route-who">${parcel.receiver_name || 'Receiver'} • ${parcel.receiver_phone || ''}</div>
          </div>
        </div>
      </div>

      <div class="feed-meta">
        <span class="feed-meta-item"><i class="fa-solid fa-box"></i> ${parcel.parcel_type || 'Package'}</span>
        <span class="feed-meta-item"><i class="fa-solid fa-route"></i> ${parcel.distance_km || '?'} km</span>
        <span class="feed-meta-item"><i class="fa-solid fa-credit-card"></i> ${parcel.payment_method || 'COD'}</span>
      </div>

      <div class="feed-actions">
        <button class="btn-decline" onclick="rejectParcelJob('${pId}')">✕ Decline</button>
        <button class="btn-accept" onclick="acceptParcelJob('${pId}')">${acceptLabel}</button>
      </div>
    </div>
  `;
}

/* ==========================================================================
   6. JOB ACCEPT / DECLINE / STATUS
   ========================================================================== */
async function acceptParcelJob(parcelId) {
  const allParcels = getAllParcelsFromStorage();
  const target = allParcels.find(p => (p.parcel_id === parcelId || p.id === parcelId));

  if (!target) { showToast('Delivery request not found.', 'error'); return; }

  // Check if another driver claimed it
  if (target.booking_status === 'driver_assigned' &&
      target.assigned_driver_phone !== currentDriver.driver_phone &&
      target.driver_id !== currentDriver.id) {
    showToast(`Already accepted by another rider (${target.assigned_driver_name || 'Fleet Member'}).`, 'error');
    loadDriverFeed();
    return;
  }

  // Assign to current rider
  target.booking_status = 'driver_assigned';
  target.status = 'driver_assigned';
  target.driver_id = currentDriver.id;
  target.assigned_driver_name = currentDriver.driver_name;
  target.assigned_driver_phone = currentDriver.driver_phone;
  target.vehicle_number = currentDriver.vehicle_number;
  target.accepted_at = new Date().toISOString();

  saveAllParcelsToStorage(allParcels);

  currentActiveTrip = target;
  localStorage.setItem('rudraksha_driver_active_trip', JSON.stringify(target));

  showToast(`Job #${parcelId} accepted! Proceed to pickup. 🎉`, 'success');
  renderActiveTrip();
  loadDriverFeed();

  // Scroll to active trip
  const atc = document.getElementById('activeTripContainer');
  if (atc) setTimeout(() => atc.scrollIntoView({ behavior: 'smooth' }), 200);

  // Open WhatsApp to notify owner
  const waMsg = `✅ *JOB ACCEPTED*\n\nRider: *${currentDriver.driver_name}*\nPhone: *${currentDriver.driver_phone}*\nVehicle: *${currentDriver.vehicle_number}* (${currentDriver.vehicle_type})\n\nOrder ID: *${parcelId}*\nPickup: ${target.pickup_address}\nDrop: ${target.drop_address}\n\n_Rider is now heading to pickup location._`;
  const waUrl = `https://wa.me/917296831460?text=${encodeURIComponent(waMsg)}`;

  // Small delay so rider sees the toast first
  setTimeout(() => {
    if (confirm(`Send WhatsApp acceptance message to Owner?`)) {
      window.open(waUrl, '_blank');
    }
  }, 500);
}

function rejectParcelJob(parcelId) {
  const card = document.getElementById(`card-${parcelId}`);
  if (card) {
    card.style.transition = 'all 0.25s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    setTimeout(() => card.remove(), 250);
  }
}

function updateTripStatus(parcelId, status) {
  const allParcels = getAllParcelsFromStorage();
  const target = allParcels.find(p => (p.parcel_id === parcelId || p.id === parcelId));

  if (target) {
    target.booking_status = status;
    target.status = status;
    target.updated_at = new Date().toISOString();
    saveAllParcelsToStorage(allParcels);

    currentActiveTrip = target;
    localStorage.setItem('rudraksha_driver_active_trip', JSON.stringify(target));
    renderActiveTrip();
    loadDriverFeed();

    const statusLabels = {
      reached_pickup: '📍 Marked as Reached Pickup!',
      out_for_delivery: '🚀 Marked as Out for Delivery!',
      delivered: '🎉 Delivery Complete!'
    };
    showToast(statusLabels[status] || `Status updated: ${status}`, 'success');
  }
}

function loadActiveTripFromStorage() {
  const saved = localStorage.getItem('rudraksha_driver_active_trip');
  if (saved) {
    try { currentActiveTrip = JSON.parse(saved); renderActiveTrip(); } catch {}
  }
}

/* ==========================================================================
   7. ACTIVE TRIP CARD RENDERER
   ========================================================================== */
function renderActiveTrip() {
  const container = document.getElementById('activeTripContainer');
  if (!container) return;

  if (!currentActiveTrip) { container.innerHTML = ''; return; }

  const p = currentActiveTrip;
  const pId = p.parcel_id || p.id;
  const status = p.booking_status || p.status || 'driver_assigned';

  const pickupNav = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.pickup_address)}`;
  const dropNav = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.drop_address)}`;

  const statusLabels = {
    driver_assigned: { text: 'Driver Assigned — Head to Pickup', color: '#f97316' },
    reached_pickup: { text: 'Reached Pickup — Verify OTP', color: '#fbbf24' },
    picked_up: { text: 'Parcel Picked Up — In Transit', color: '#22c55e' },
    in_transit: { text: 'In Transit — En Route', color: '#22c55e' },
    out_for_delivery: { text: 'Out for Delivery — Verify Delivery OTP', color: '#38bdf8' },
  };
  const stInfo = statusLabels[status] || { text: status.replace(/_/g, ' '), color: '#94a3b8' };

  let actions = '';
  if (status === 'driver_assigned') {
    actions = `
      <div class="action-group">
        <a href="${pickupNav}" target="_blank" class="btn-nav"><i class="fa-solid fa-diamond-turn-right"></i> Navigate to Pickup</a>
        <button class="btn-status" onclick="updateTripStatus('${pId}','reached_pickup')"><i class="fa-solid fa-location-dot me-1"></i> Reached Pickup</button>
      </div>
      <button class="btn-otp" style="width:100%;margin-top:8px;" onclick="openOtpSheet('${pId}','pickup')"><i class="fa-solid fa-key"></i> Enter Pickup OTP</button>
    `;
  } else if (status === 'reached_pickup') {
    actions = `
      <button class="btn-otp" style="width:100%;" onclick="openOtpSheet('${pId}','pickup')"><i class="fa-solid fa-key"></i> Verify Pickup OTP & Start Trip</button>
    `;
  } else if (status === 'picked_up' || status === 'in_transit') {
    actions = `
      <div class="action-group">
        <a href="${dropNav}" target="_blank" class="btn-nav" style="border-color:#38bdf8;color:#38bdf8;"><i class="fa-solid fa-diamond-turn-right"></i> Navigate to Drop</a>
        <button class="btn-status" onclick="updateTripStatus('${pId}','out_for_delivery')"><i class="fa-solid fa-truck-fast me-1"></i> Reached Drop</button>
      </div>
      <button class="btn-otp" style="width:100%;margin-top:8px;" onclick="openOtpSheet('${pId}','delivery')"><i class="fa-solid fa-shield-check"></i> Enter Delivery OTP</button>
    `;
  } else if (status === 'out_for_delivery') {
    actions = `
      <button class="btn-otp" style="width:100%;" onclick="openOtpSheet('${pId}','delivery')"><i class="fa-solid fa-circle-check"></i> Verify Delivery OTP & Complete Trip</button>
    `;
  }

  container.innerHTML = `
    <div class="active-trip-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <span class="active-badge"><span class="pulse"></span> ACTIVE DELIVERY</span>
        <div class="trip-fare">₹${p.total_amount || 0}</div>
      </div>
      <div class="trip-id-label">Trip ID</div>
      <div class="trip-id-val">${pId}</div>
      <span class="trip-status-pill" style="border-color:${stInfo.color}33;color:${stInfo.color};background:${stInfo.color}15;margin-top:8px;display:inline-flex;">
        ${stInfo.text}
      </span>

      <div class="route-info-box">
        <div class="route-row">
          <div class="route-icon pickup"><i class="fa-solid fa-location-dot"></i></div>
          <div>
            <div class="route-label">Pickup</div>
            <div class="route-addr">${p.pickup_address}</div>
            <div class="route-contact">${p.sender_name} • <a href="tel:${p.sender_phone}"><i class="fa-solid fa-phone me-1"></i>${p.sender_phone}</a></div>
          </div>
        </div>
        <div class="route-row">
          <div class="route-icon drop"><i class="fa-solid fa-flag-checkered"></i></div>
          <div>
            <div class="route-label">Drop</div>
            <div class="route-addr">${p.drop_address}</div>
            <div class="route-contact">${p.receiver_name} • <a href="tel:${p.receiver_phone}"><i class="fa-solid fa-phone me-1"></i>${p.receiver_phone}</a></div>
          </div>
        </div>
      </div>

      <div class="meta-pills">
        <span class="meta-pill"><i class="fa-solid fa-box"></i> ${p.parcel_type || 'Package'}</span>
        <span class="meta-pill"><i class="fa-solid fa-route"></i> ${p.distance_km || '?'} km</span>
        <span class="meta-pill"><i class="fa-solid fa-credit-card"></i> ${p.payment_method || 'COD'}</span>
      </div>

      ${actions}
    </div>
  `;
}

/* ==========================================================================
   8. OTP BOTTOM SHEET
   ========================================================================== */
function initOtpDigitInputs() {
  const digits = ['otp1','otp2','otp3','otp4'];
  digits.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(-1);
      if (e.target.value && idx < digits.length - 1) {
        document.getElementById(digits[idx + 1])?.focus();
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        document.getElementById(digits[idx - 1])?.focus();
      }
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      digits.forEach((did, di) => {
        const dEl = document.getElementById(did);
        if (dEl) dEl.value = text[di] || '';
      });
      document.getElementById(digits[Math.min(text.length, 3)])?.focus();
    });
  });
}

function openOtpSheet(parcelId, mode) {
  currentOtpMode = mode;
  currentOtpParcelId = parcelId;

  const overlay = document.getElementById('otpOverlay');
  const title = document.getElementById('otpSheetTitle');
  const sub = document.getElementById('otpSheetSub');
  const label = document.getElementById('btnVerifyLabel');
  const icon = document.getElementById('otpIconRing');

  // Clear digit inputs
  ['otp1','otp2','otp3','otp4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (mode === 'pickup') {
    if (title) title.innerText = 'Enter Pickup OTP';
    if (sub) sub.innerText = 'Ask the sender for the 4-digit secret code to confirm goods handover.';
    if (label) label.innerText = 'Verify Pickup OTP';
    if (icon) icon.innerHTML = '<i class="fa-solid fa-key"></i>';
  } else {
    if (title) title.innerText = 'Enter Delivery OTP';
    if (sub) sub.innerText = 'Ask the receiver for the 4-digit secret code to confirm safe delivery.';
    if (label) label.innerText = 'Verify Delivery OTP';
    if (icon) { icon.innerHTML = '<i class="fa-solid fa-shield-check"></i>'; icon.style.background = 'rgba(34,197,94,0.12)'; icon.style.borderColor = 'rgba(34,197,94,0.3)'; icon.style.color = '#22c55e'; }
  }

  if (overlay) overlay.classList.add('active');
  setTimeout(() => document.getElementById('otp1')?.focus(), 300);
}

function closeOtpSheet() {
  const overlay = document.getElementById('otpOverlay');
  if (overlay) overlay.classList.remove('active');
}

function getOtpValue() {
  return ['otp1','otp2','otp3','otp4'].map(id => document.getElementById(id)?.value || '').join('');
}

function submitOtpVerification() {
  const otp = getOtpValue();

  if (otp.length < 4) {
    showToast('Please enter all 4 digits.', 'error');
    return;
  }

  const allParcels = getAllParcelsFromStorage();
  const target = allParcels.find(p => (p.parcel_id === currentOtpParcelId || p.id === currentOtpParcelId));

  if (!target) { showToast('Order not found.', 'error'); return; }

  const expectedOtp = currentOtpMode === 'pickup'
    ? (target.pickup_otp || '3412')
    : (target.delivery_otp || '7890');

  // Accept correct OTP or universal testing bypass
  if (otp !== expectedOtp) {
    showToast(`❌ Wrong OTP (${otp}). Ask customer for correct code.`, 'error');
    // Shake input
    const wrap = document.querySelector('.otp-input-wrap');
    if (wrap) {
      wrap.style.animation = 'none';
      wrap.offsetHeight;
      wrap.style.animation = 'shake 0.4s ease';
    }
    return;
  }

  closeOtpSheet();

  if (currentOtpMode === 'pickup') {
    target.booking_status = 'picked_up';
    target.status = 'picked_up';
    target.pickup_verified_at = new Date().toISOString();
    saveAllParcelsToStorage(allParcels);
    currentActiveTrip = target;
    localStorage.setItem('rudraksha_driver_active_trip', JSON.stringify(target));
    showToast('✅ Pickup OTP Verified! Parcel picked up. Head to drop location.', 'success');
    renderActiveTrip();
    loadDriverFeed();
  } else {
    // Delivery complete
    target.booking_status = 'delivered';
    target.status = 'delivered';
    target.completed_at = new Date().toISOString();
    target.driver_id = currentDriver.id;
    target.assigned_driver_name = currentDriver.driver_name;
    target.assigned_driver_phone = currentDriver.driver_phone;
    target.vehicle_number = currentDriver.vehicle_number;
    saveAllParcelsToStorage(allParcels);

    const riderShare = Math.round((Number(target.total_amount) || 100) * 0.85);

    currentActiveTrip = null;
    localStorage.removeItem('rudraksha_driver_active_trip');
    updateDriverStatsDisplay();
    renderDriverProfileView();
    renderActiveTrip();
    loadDriverFeed();

    showToast(`🎉 Delivery Complete! You earned ₹${riderShare} for this trip.`, 'success');
  }
}

/* ==========================================================================
   9. URL DISPATCH JOB DETECTION (WhatsApp link click)
   ========================================================================== */
function checkUrlDispatchJob() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetJobId = urlParams.get('jobId') || urlParams.get('orderId') || urlParams.get('id');
  if (!targetJobId) return;

  const all = getAllParcelsFromStorage();
  const match = all.find(p => (p.parcel_id === targetJobId || p.id === targetJobId));

  if (match) {
    if (match.booking_status !== 'searching_driver' && match.status !== 'searching_driver') {
      showToast(`Order #${targetJobId} already accepted by ${match.assigned_driver_name || 'another rider'}.`, 'info');
    } else {
      setTimeout(() => {
        const el = document.getElementById(`card-${targetJobId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlighted');
          showToast(`📦 Delivery job #${targetJobId} highlighted for you!`, 'info');
        }
      }, 600);
    }
  } else {
    showToast(`Searching for job #${targetJobId}...`, 'info');
  }
}

/* ==========================================================================
   10. TOAST NOTIFICATION SYSTEM
   ========================================================================== */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'all 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/* ==========================================================================
   11. UTILITY
   ========================================================================== */
function getTimeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/* ==========================================================================
   12. DRIVER VIEW SWITCHER (Feed vs Active vs Profile)
   ========================================================================== */
function switchDriverView(viewName) {
  const feedSec = document.getElementById('driverFeedSection');
  const profileSec = document.getElementById('driverProfileSection');
  const btnFeed = document.getElementById('btnTabFeed');
  const btnActive = document.getElementById('btnTabActive');
  const btnProfile = document.getElementById('btnTabProfile');

  // Reset active classes
  [btnFeed, btnActive, btnProfile].forEach(b => b?.classList.remove('active'));

  if (viewName === 'profile') {
    if (feedSec) feedSec.style.display = 'none';
    if (profileSec) profileSec.style.display = 'block';
    if (btnProfile) btnProfile.classList.add('active');
    renderDriverProfileView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (viewName === 'active') {
    if (feedSec) feedSec.style.display = 'block';
    if (profileSec) profileSec.style.display = 'none';
    if (btnActive) btnActive.classList.add('active');
    const atc = document.getElementById('activeTripContainer');
    if (atc) atc.scrollIntoView({ behavior: 'smooth' });
  } else {
    // Default: 'feed'
    if (feedSec) feedSec.style.display = 'block';
    if (profileSec) profileSec.style.display = 'none';
    if (btnFeed) btnFeed.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function toggleDriverDuty() {
  currentDriver.onDuty = !currentDriver.onDuty;
  localStorage.setItem('rudraksha_current_driver', JSON.stringify(currentDriver));
  updateDutyDisplay();

  if (currentDriver.onDuty) {
    showToast('🟢 You are now ON DUTY. You will receive active parcel alerts!', 'success');
  } else {
    showToast('⚪ You are now OFF DUTY. Parcel alerts paused.', 'info');
  }
}

function updateDutyDisplay() {
  const onDuty = currentDriver.onDuty !== false;
  const navBadge = document.querySelector('.duty-badge');
  if (navBadge) {
    navBadge.innerHTML = onDuty ? '<span class="pulse"></span> ON DUTY' : '<span style="width:7px;height:7px;border-radius:50%;background:#8E8E93;display:inline-block;"></span> OFF DUTY';
    navBadge.style.borderColor = onDuty ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)';
    navBadge.style.color = onDuty ? 'var(--green)' : '#94a3b8';
  }

  const profileDutyText = document.getElementById('profileDutyStatusText');
  const btnToggleDuty = document.getElementById('btnToggleDuty');
  if (profileDutyText) {
    profileDutyText.innerText = onDuty ? '🟢 On Duty (Receiving Orders)' : '⚪ Off Duty (Not Available)';
    profileDutyText.style.color = onDuty ? '#22c55e' : '#94a3b8';
  }
  if (btnToggleDuty) {
    btnToggleDuty.innerText = onDuty ? 'Go Off Duty' : 'Go On Duty';
    btnToggleDuty.className = onDuty ? 'btn btn-sm btn-outline-danger rounded-pill px-3 py-1 fw-bold' : 'btn btn-sm btn-outline-success rounded-pill px-3 py-1 fw-bold';
  }
}

function renderDriverProfileView() {
  const { myDeliveries, totalEarnings, totalTrips, todayEarnings } = getDriverEarningsAndDeliveries();

  // Populate driver identity
  const nameEl = document.getElementById('profileRiderName');
  const phoneEl = document.getElementById('profileRiderPhone');
  const vehEl = document.getElementById('profileRiderVehicle');

  if (nameEl) nameEl.innerText = currentDriver.driver_name;
  if (phoneEl) phoneEl.innerText = `+91 ${currentDriver.driver_phone}`;
  if (vehEl) vehEl.innerText = `${currentDriver.vehicle_type} • ${currentDriver.vehicle_number}`;

  // Populate financial metrics (strictly scoped for this driver)
  if (document.getElementById('profileTotalEarnings')) document.getElementById('profileTotalEarnings').innerText = `₹${totalEarnings.toLocaleString('en-IN')}`;
  if (document.getElementById('profileCompletedTrips')) document.getElementById('profileCompletedTrips').innerText = `${totalTrips}`;
  if (document.getElementById('profileTodayEarnings')) document.getElementById('profileTodayEarnings').innerText = `₹${todayEarnings.toLocaleString('en-IN')}`;
  if (document.getElementById('profileTripsCountBadge')) document.getElementById('profileTripsCountBadge').innerText = `${myDeliveries.length}`;

  updateDutyDisplay();

  // Render My Past Deliveries List
  const listContainer = document.getElementById('myPastDeliveriesList');
  if (!listContainer) return;

  if (myDeliveries.length === 0) {
    listContainer.innerHTML = `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 16px; text-align: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(249,115,22,0.1); color: #f97316; display: inline-flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-bottom: 10px;">
          <i class="fa-solid fa-box-open"></i>
        </div>
        <div style="font-weight: 700; color: #fff; font-size: 0.92rem; margin-bottom: 4px;">No Completed Deliveries Yet</div>
        <div style="font-size: 0.76rem; color: #94a3b8; max-width: 320px; margin: 0 auto 14px;">
          Deliveries accepted and completed by <strong>${currentDriver.driver_name}</strong> will appear here with transparent payout records.
        </div>
        <button onclick="switchDriverView('feed')" class="btn-refresh" style="font-size: 0.78rem;">
          <i class="fa-solid fa-motorcycle me-1"></i> Check Available Jobs
        </button>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = myDeliveries.map(p => {
    const pId = p.parcel_id || p.id;
    const dateStr = p.completed_at ? new Date(p.completed_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Recent';
    const riderEarned = Math.round((Number(p.total_amount) || 100) * 0.85);

    return `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 14px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 800; color: #f97316; font-size: 0.85rem;">${pId}</span>
            <span class="badge bg-success text-dark fw-bold" style="font-size: 0.62rem; border-radius: 20px;">✓ DELIVERED</span>
          </div>
          <span style="font-size: 0.7rem; color: #94a3b8;">${dateStr}</span>
        </div>

        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 10px;">
          <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 6px;">
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #f97316; margin-top: 5px; flex-shrink: 0;"></span>
            <div style="font-size: 0.78rem; color: #f1f5f9;">${p.pickup_address || 'Pickup'}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start;">
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #22c55e; margin-top: 5px; flex-shrink: 0;"></span>
            <div style="font-size: 0.78rem; color: #f1f5f9;">${p.drop_address || 'Drop'}</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.72rem; color: #94a3b8;">
            ${(p.vehicle_type || 'bike').toUpperCase()} • ${p.distance_km || 5} KM • ${p.parcel_type || 'Package'}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase;">Rider Payout</div>
            <div style="font-size: 1.1rem; font-weight: 900; color: #22c55e;">₹${riderEarned}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
