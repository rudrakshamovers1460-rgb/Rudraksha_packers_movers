const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_API_URL = 'https://rudraksha-packers-movers.onrender.com/api';
const API_BASE = isLocalhost ? 'http://localhost:3000/api' : (localStorage.getItem('rudraksha_backend_api_url') || PRODUCTION_API_URL);

let currentBooking = null;
let trackMap = null;
let pickupMarker = null;
let dropMarker = null;
let vehicleMarker = null;
let routePolyline = null;

document.addEventListener('DOMContentLoaded', () => {
  // Check URL parameters for direct tracking link (e.g. track.html?id=RB-6DFFD540 or track.html?phone=9876543210)
  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get('id') || urlParams.get('phone') || urlParams.get('ref') || urlParams.get('b');

  if (queryParam) {
    document.getElementById('trackSearchInput').value = queryParam;
    fetchBookingAndTrack(queryParam);
  } else {
    // Populate sample chips from local storage if available
    loadQuickChips();
  }
});

function loadQuickChips() {
  try {
    const saved = localStorage.getItem('rudraksha_bookings_history');
    if (saved) {
      const list = JSON.parse(saved);
      if (list && list.length > 0) {
        const chipsContainer = document.getElementById('trackerSampleChips');
        chipsContainer.innerHTML = list.slice(0, 3).map(b => `
          <button type="button" class="sample-chip" onclick="quickFillTrack('${b.id}')">${b.id}</button>
        `).join('');
      }
    }
  } catch {}
}

function quickFillTrack(val) {
  document.getElementById('trackSearchInput').value = val;
  fetchBookingAndTrack(val);
}

function handleTrackingSearch() {
  const query = document.getElementById('trackSearchInput')?.value.trim();
  if (!query) return;
  fetchBookingAndTrack(query);
}

async function fetchBookingAndTrack(query) {
  const loadingEl = document.getElementById('trackerLoading');
  const notFoundEl = document.getElementById('trackerNotFound');
  const contentEl = document.getElementById('trackerContent');
  const btnSubmit = document.getElementById('btnTrackSubmit');

  if (loadingEl) loadingEl.classList.remove('d-none');
  if (notFoundEl) notFoundEl.classList.add('d-none');
  if (contentEl) contentEl.classList.add('d-none');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Tracking...';
  }

  try {
    let booking = null;

    // 0. If query looks like a parcel ID or parcel search, query parcel API first
    if (query.toUpperCase().includes('PCL') || query.startsWith('RP-')) {
      try {
        const pRes = await fetch(`${API_BASE}/parcels/track/${encodeURIComponent(query)}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.parcel) {
            booking = {
              ...pData.parcel,
              id: pData.parcel.parcel_id,
              customer_name: pData.parcel.sender_name,
              customer_phone: pData.parcel.sender_phone,
              isParcel: true
            };
          }
        }
      } catch {}
    }

    // 1. Try Relocation Backend API
    if (!booking) {
      try {
        const res = await fetch(`${API_BASE}/bookings/track/${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          booking = data.booking;
        }
      } catch (apiErr) {
        console.warn('Backend track API offline, checking local cache...', apiErr);
      }
    }

    // 2. Fallback to local storage (both bookings & parcels) — Phase 2: merged dual keys
    if (!booking) {
      try {
        const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
        const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
        const parcelMap = new Map();
        [...p1, ...p2].forEach(p => {
          const pid = p.parcel_id || p.id;
          if (pid && !parcelMap.has(pid)) parcelMap.set(pid, p);
        });
        const pList = Array.from(parcelMap.values());
        const cleanQ = query.trim().toLowerCase();
        const phoneClean = cleanQ.replace(/\D/g, '');
        const pMatch = pList.find(p =>
          (p.parcel_id && p.parcel_id.toLowerCase().includes(cleanQ)) ||
          (p.id && p.id.toLowerCase().includes(cleanQ)) ||
          (phoneClean && p.sender_phone && p.sender_phone.replace(/\D/g, '') === phoneClean) ||
          (phoneClean && p.receiver_phone && p.receiver_phone.replace(/\D/g, '') === phoneClean)
        );
        if (pMatch) {
          booking = {
            ...pMatch,
            id: pMatch.parcel_id || pMatch.id,
            customer_name: pMatch.sender_name,
            customer_phone: pMatch.sender_phone,
            isParcel: true
          };
        }
      } catch {}
    }

    if (!booking) {
      const localHistory = localStorage.getItem('rudraksha_bookings_history');
      if (localHistory) {
        const list = JSON.parse(localHistory);
        const cleanQ = query.trim().toLowerCase();
        const phoneClean = cleanQ.replace(/\D/g, '');
        booking = list.find(b => 
          (b.id && b.id.toLowerCase().includes(cleanQ)) ||
          (phoneClean && b.customer_phone && b.customer_phone.replace(/\D/g, '') === phoneClean) ||
          (phoneClean && b.phone && b.phone.replace(/\D/g, '') === phoneClean)
        );
      }
    }

    // 3. Fallback Sample Demo Booking if user tests with sample ID
    if (!booking && query === 'RB-6DFFD540') {
      booking = {
        id: 'RB-6DFFD540',
        customer_name: 'Customer Demo',
        customer_phone: '9876543210',
        customer_email: 'customer@rudraksha.com',
        pickup_address: 'Ajmer Road, Jaipur, Rajasthan',
        drop_address: 'Sector 54, Gurugram, Delhi NCR',
        distance_km: 274,
        shifting_date: 'Today, 30 Aug 2026',
        selected_vehicle: 'Closed Car Carrier',
        house_type: '2 BHK Apartment',
        total_amount: 15090,
        status: 'in_transit',
        assigned_driver_name: 'Vikram Singh',
        assigned_driver_phone: '9829012345',
        assigned_vehicle_no: 'RJ-14-GB-5521',
        assigned_vehicle_type: 'Closed Hydraulic Carrier',
        addons: ['Bubble Packing', 'Transit Insurance'],
        items: { sofa: 1, bed: 2, boxes: 10 }
      };
    }

    if (!booking) {
      throw new Error(`No booking found matching "${query}". Please verify your reference ID or mobile number.`);
    }

    currentBooking = booking;
    renderTrackingDashboard(booking);

    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) {
      contentEl.classList.remove('d-none');
      contentEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    if (loadingEl) loadingEl.classList.add('d-none');
    if (notFoundEl) {
      notFoundEl.classList.remove('d-none');
      document.getElementById('trackerErrorMsg').innerText = err.message || 'Booking not found.';
    }
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-location-crosshairs me-1"></i> <span>Track Live</span>';
    }
  }
}

/* ==========================================================================
   2. RENDER TRACKING DETAILS & TIMELINE
   ========================================================================== */
function renderTrackingDashboard(b) {
  const bId = b.id || 'RB-XXXXXX';
  const cName = b.customer_name || b.name || 'Customer';
  const cPhone = b.customer_phone || b.phone || '-';
  const pickup = b.pickup_address || b.pickup || 'Jaipur';
  const drop = b.drop_address || b.drop || 'Delhi NCR';
  const dist = b.distance_km || b.distanceKm || 25;
  const date = b.shifting_date || b.date || 'Today';
  const vehicle = b.selected_vehicle || 'Dedicated Truck';
  const amount = b.total_amount ? `₹${Number(b.total_amount).toLocaleString('en-IN')}` : (b.total || '₹0');
  const status = (b.status || 'received').toLowerCase();

  // Top Banner
  document.getElementById('displayBookingId').innerText = bId;
  document.getElementById('displayShiftingDate').innerHTML = `<i class="fa-solid fa-calendar-day text-warning me-1"></i> ${date}`;

  // Status mapping
  const statusConfig = {
    'received': { heading: 'Booking Received & Logged', sub: 'Our team is preparing your relocation dispatch', pill: '📥 Order Received', icon: 'fa-inbox' },
    'searching_driver': { heading: 'Searching Nearby Rider', sub: 'Broadcasting delivery job to nearby verified drivers', pill: '📡 Searching Driver', icon: 'fa-tower-broadcast' },
    'reviewing': { heading: 'Cargo Inventory Verified', sub: 'Packaging checklist and cargo clearance approved', pill: '🔍 Verified & Confirmed', icon: 'fa-clipboard-check' },
    'confirmed': { heading: 'Relocation Confirmed', sub: 'Vehicle and driver scheduled for transit', pill: '✅ Booking Confirmed', icon: 'fa-circle-check' },
    'driver_assigned': { heading: 'Driver Assigned & Moving', sub: 'Assigned rider is en route to pickup address', pill: '🛵 Driver Assigned', icon: 'fa-id-badge' },
    'reached_pickup': { heading: 'Driver Reached Pickup', sub: 'Driver arrived at pickup. Please verify with Pickup OTP.', pill: '📍 Reached Pickup', icon: 'fa-location-dot' },
    'picked_up': { heading: 'Parcel Picked Up', sub: 'Pickup OTP verified. Shipment loaded for transit.', pill: '📦 Picked Up', icon: 'fa-box' },
    'in_transit': { heading: 'Shipment In Transit (On Road)', sub: 'Moving safely towards destination on schedule', pill: '🛣️ In Transit (Live GPS)', icon: 'fa-truck-fast' },
    'out_for_delivery': { heading: 'Out For Delivery', sub: 'Driver is near drop location. Prepare Delivery OTP.', pill: '🚀 Out For Delivery', icon: 'fa-paper-plane' },
    'delivered': { heading: 'Safely Delivered & Completed', sub: 'Delivery OTP verified. Goods safely handed over.', pill: '🏁 Delivered', icon: 'fa-flag-checkered' },
    'cancelled': { heading: 'Booking Cancelled', sub: 'This relocation order has been cancelled', pill: '❌ Cancelled', icon: 'fa-ban' }
  };

  const currentStatusInfo = statusConfig[status] || statusConfig['received'];
  document.getElementById('displayStatusHeading').innerText = currentStatusInfo.heading;
  document.getElementById('displayStatusSub').innerText = currentStatusInfo.sub;
  document.getElementById('displayStatusPill').innerText = currentStatusInfo.pill;
  document.getElementById('bannerStatusIcon').innerHTML = `<i class="fa-solid ${currentStatusInfo.icon}"></i>`;

  // Milestone Stepper Timeline
  updateTimelineMilestones(status);

  // Driver Profile Card
  const driverName = b.assigned_driver_name || 'Mukesh Sharma (Assigned Driver)';
  const driverPhone = b.assigned_driver_phone || '9876543210';
  const driverVehicleNo = b.assigned_vehicle_no || 'RJ-14-GA-1024';
  const driverVehicleType = b.assigned_vehicle_type || vehicle;

  document.getElementById('driverName').innerText = driverName;
  document.getElementById('driverVehicleNo').innerText = driverVehicleNo;
  document.getElementById('driverVehicleType').innerText = driverVehicleType;
  document.getElementById('btnCallDriver').href = `tel:${driverPhone}`;
  document.getElementById('btnWhatsappDriver').href = `https://wa.me/91${driverPhone}?text=Hello%20${encodeURIComponent(driverName)},%20regarding%20my%20Rudraksha%20booking%20${bId}`;

  // Shipment Breakdown
  document.getElementById('summaryCustomerName').innerText = cName;
  document.getElementById('summaryCustomerPhone').innerText = `+91 ${cPhone}`;
  document.getElementById('summaryHouseType').innerText = (b.house_type || 'Standard Cargo').toUpperCase();
  document.getElementById('summaryVehicle').innerText = vehicle;
  document.getElementById('summaryPickup').innerText = pickup;
  document.getElementById('summaryDrop').innerText = drop;
  document.getElementById('summaryTotalAmount').innerText = amount;

  const addonsList = Array.isArray(b.addons) && b.addons.length > 0 ? b.addons.join(', ') : 'Standard Transit Protection';
  document.getElementById('summaryAddons').innerText = addonsList;

  // Map Route Names
  document.getElementById('mapPickupName').innerText = pickup.split(',')[0];
  document.getElementById('mapDropName').innerText = drop.split(',')[0];
  // Update UPI QR Code & Instant Payment Link
  const upiQrImg = document.getElementById('trackUpiQrImg');
  const btnPayUpiDirect = document.getElementById('btnPayUpiDirect');
  const upiPayload = `upi://pay?pa=7296831460@upi&pn=Rudraksha%20Packers&am=500&cu=INR&tr=${bId}&tn=Booking%20Token%20${bId}`;
  if (upiQrImg) {
    upiQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiPayload)}`;
  }
  if (btnPayUpiDirect) {
    btnPayUpiDirect.href = upiPayload;
  }

  // Initialize and Render Map
  initLiveTrackMap(b, status);

  // Phase 3B: Initialize parcel-specific OTP panel + auto-refresh for parcel bookings
  if (b.isParcel) {
    setTimeout(() => initParcelTrackingMode(b), 200);
  }
}

function shareLiveTrackingWhatsApp() {
  if (!currentBooking) return;
  const b = currentBooking;
  const bId = b.id || 'RB-XXXXXX';
  const pickup = b.pickup_address || 'Jaipur';
  const drop = b.drop_address || 'Delhi NCR';
  const trackUrl = `${window.location.origin}${window.location.pathname}?id=${bId}`;

  const msg = `🚚 *Rudraksha Packers & Movers - Live Shipment Tracking* 📍\n\n` +
    `Track my shifting in real-time from *${pickup.split(',')[0]}* to *${drop.split(',')[0]}*:\n\n` +
    `🔗 *Live GPS Tracking Link:*\n${trackUrl}\n\n` +
    `Booking Ref: *${bId}*\n` +
    `📞 24x7 Helpline: +91 72968 31460`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
}

/* ==========================================================================
   3. TIMELINE STEPPER HIGHLIGHTER
   ========================================================================== */
function updateTimelineMilestones(status) {
  const steps = ['received', 'reviewing', 'assigned', 'transit', 'delivered'];
  const lines = ['line-1', 'line-2', 'line-3', 'line-4'];

  // Status index mapping
  let activeIdx = 0;
  if (status === 'received' || status === 'searching_driver') activeIdx = 0;
  else if (status === 'reviewing' || status === 'confirmed') activeIdx = 1;
  else if (status === 'driver_assigned' || status === 'reached_pickup') activeIdx = 2;
  else if (status === 'picked_up' || status === 'in_transit' || status === 'out_for_delivery') activeIdx = 3;
  else if (status === 'delivered') activeIdx = 4;

  steps.forEach((stepKey, idx) => {
    const stepEl = document.getElementById(`step-${stepKey}`);
    if (!stepEl) return;

    stepEl.classList.remove('completed', 'active');
    if (idx < activeIdx) {
      stepEl.classList.add('completed');
    } else if (idx === activeIdx) {
      stepEl.classList.add('active');
    }
  });

  lines.forEach((lineId, idx) => {
    const lineEl = document.getElementById(lineId);
    if (!lineEl) return;

    lineEl.classList.remove('completed', 'active');
    if (idx < activeIdx) {
      lineEl.classList.add('completed');
    } else if (idx === activeIdx) {
      lineEl.classList.add('active');
    }
  });
}

/* ==========================================================================
   4. LEAFLET MAP & ANIMATED TRUCK
   ========================================================================== */
function initLiveTrackMap(booking, status) {
  // Default coordinates: Jaipur to Delhi/Gurugram
  let pLat = parseFloat(booking.pickup_lat) || 26.9124;
  let pLng = parseFloat(booking.pickup_lng) || 75.7873;
  let dLat = parseFloat(booking.drop_lat) || 28.4595;
  let dLng = parseFloat(booking.drop_lng) || 77.0266;

  // If map not initialized yet
  if (!trackMap) {
    trackMap = L.map('liveTrackMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([pLat, pLng], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18
    }).addTo(trackMap);
  }

  // Clear existing layers
  if (pickupMarker) trackMap.removeLayer(pickupMarker);
  if (dropMarker) trackMap.removeLayer(dropMarker);
  if (vehicleMarker) trackMap.removeLayer(vehicleMarker);
  if (routePolyline) trackMap.removeLayer(routePolyline);

  // Custom Icon Helpers
  const greenIcon = L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="width:20px;height:20px;background:#22c55e;border:3px solid #fff;border-radius:50%;box-shadow:0 0 14px #22c55e;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  const orangeIcon = L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="width:20px;height:20px;background:#f97316;border:3px solid #fff;border-radius:50%;box-shadow:0 0 14px #f97316;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  pickupMarker = L.marker([pLat, pLng], { icon: greenIcon }).addTo(trackMap)
    .bindPopup(`<b>Origin (Pickup):</b><br>${booking.pickup_address || 'Jaipur'}`);

  dropMarker = L.marker([dLat, dLng], { icon: orangeIcon }).addTo(trackMap)
    .bindPopup(`<b>Destination (Drop):</b><br>${booking.drop_address || 'Delhi NCR'}`);

  // Route Polyline
  const routePoints = [[pLat, pLng], [dLat, dLng]];
  routePolyline = L.polyline(routePoints, {
    color: '#f97316',
    weight: 4,
    opacity: 0.8,
    dashArray: '8, 8'
  }).addTo(trackMap);

  // Calculate Vehicle position on route
  let progressRatio = 0.05;
  if (status === 'received') progressRatio = 0.05;
  else if (status === 'reviewing' || status === 'confirmed') progressRatio = 0.15;
  else if (status === 'driver_assigned') progressRatio = 0.30;
  else if (status === 'in_transit') progressRatio = 0.65;
  else if (status === 'delivered') progressRatio = 1.0;

  const vLat = pLat + (dLat - pLat) * progressRatio;
  const vLng = pLng + (dLng - pLng) * progressRatio;

  const truckIcon = L.divIcon({
    className: 'custom-truck-pin',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:40px;height:40px;background:rgba(208,253,56,0.25);border-radius:50%;animation:pulseDot 1.5s infinite;"></div>
        <div style="width:34px;height:34px;background:#17171A;border:2px solid #D0FD38;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#D0FD38;box-shadow:0 0 15px rgba(208,253,56,0.6);font-size:14px;position:relative;z-index:2;">
          <i class="fa-solid fa-truck-fast"></i>
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  vehicleMarker = L.marker([vLat, vLng], { icon: truckIcon }).addTo(trackMap)
    .bindPopup(`<b>🚚 Moving Vehicle:</b><br>${booking.assigned_driver_name || 'Fleet Driver'}<br>Status: ${(status).toUpperCase()}`)
    .openPopup();

  // Fit bounds to show both origin and destination
  const bounds = L.latLngBounds(routePoints);
  trackMap.fitBounds(bounds, { padding: [40, 40] });

  setTimeout(() => { trackMap.invalidateSize(); }, 300);
}

function recenterMap() {
  if (trackMap && vehicleMarker) {
    trackMap.setView(vehicleMarker.getLatLng(), 11, { animate: true });
    vehicleMarker.openPopup();
  }
}

function copyBookingRef() {
  if (!currentBooking) return;
  const id = currentBooking.id || '';
  navigator.clipboard.writeText(id).then(() => {
    const btn = document.querySelector('.btn-copy-ref');
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 2000);
    }
  }).catch(() => {});
}

/* ==========================================================================
   3B. PARCEL-SPECIFIC TRACKING ENHANCEMENTS (Phase 3B)
   ========================================================================== */
let _trackAutoRefreshTimer = null;

// Inject parcel OTP panel and start live auto-refresh when tracking a parcel
function initParcelTrackingMode(booking) {
  if (!booking.isParcel) return;

  // Inject OTP panel below the banner card
  const main = document.getElementById('trackerContent');
  const existingOtpPanel = document.getElementById('parcelOtpTrackPanel');
  if (existingOtpPanel) existingOtpPanel.remove();

  const status = (booking.booking_status || booking.status || 'searching_driver').toLowerCase();
  const isDelivered = status === 'delivered';
  const pickupVerified = ['picked_up','in_transit','out_for_delivery','delivered'].includes(status);

  const panel = document.createElement('div');
  panel.id = 'parcelOtpTrackPanel';
  panel.style.cssText = 'margin-bottom:20px;';
  panel.innerHTML = `
    <div style="background:linear-gradient(135deg,#13141a,#0f1016);border:1px solid rgba(249,115,22,0.25);border-radius:20px;padding:20px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#f97316,#fbbf24);"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:gap(8px);">
        <div>
          <div style="font-size:0.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;"><i class="fa-solid fa-shield-keyhole" style="color:#f97316;margin-right:5px;"></i>Parcel Security OTPs</div>
          <div style="font-size:0.8rem;color:#64748b;">Share these with your rider at pickup & delivery to verify handover.</div>
        </div>
        <span style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);border-radius:20px;padding:3px 10px;font-size:0.68rem;font-weight:700;color:#f97316;">📦 PARCEL</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div style="background:${pickupVerified ? 'rgba(34,197,94,0.08)' : 'rgba(249,115,22,0.08)'};border:1.5px solid ${pickupVerified ? 'rgba(34,197,94,0.3)' : 'rgba(249,115,22,0.3)'};border-radius:14px;padding:12px;text-align:center;">
          <div style="font-size:0.62rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${pickupVerified ? '✅ Pickup Verified' : '🔑 Pickup OTP'}</div>
          <div style="font-size:1.6rem;font-weight:900;color:${pickupVerified ? '#22c55e' : '#f97316'};letter-spacing:5px;">${booking.pickup_otp || '––––'}</div>
          <div style="font-size:0.62rem;color:#64748b;margin-top:4px;">${pickupVerified ? 'OTP confirmed by rider' : 'Share with rider at pickup'}</div>
        </div>
        <div style="background:${isDelivered ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.05)'};border:1.5px solid ${isDelivered ? 'rgba(34,197,94,0.4)' : 'rgba(34,197,94,0.2)'};border-radius:14px;padding:12px;text-align:center;">
          <div style="font-size:0.62rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${isDelivered ? '✅ Delivery Verified' : '🛡️ Delivery OTP'}</div>
          <div style="font-size:1.6rem;font-weight:900;color:${isDelivered ? '#22c55e' : '#22c55e'};letter-spacing:5px;opacity:${isDelivered ? '1' : '0.8'};">${booking.delivery_otp || '––––'}</div>
          <div style="font-size:0.62rem;color:#64748b;margin-top:4px;">${isDelivered ? 'OTP confirmed by rider' : 'Share with rider at delivery'}</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="https://wa.me/917296831460?text=${encodeURIComponent(`📦 Help needed with parcel: ${booking.id || booking.parcel_id}\nStatus: ${status}`)}" target="_blank"
           style="flex:1;min-width:120px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:9px 12px;font-size:0.78rem;font-weight:600;color:#22c55e;text-decoration:none;">
          <i class="fa-brands fa-whatsapp"></i> WhatsApp Support
        </a>
        <button onclick="shareParcelTrackingLink()" style="flex:1;min-width:120px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:9px 12px;font-size:0.78rem;font-weight:600;color:#38bdf8;cursor:pointer;">
          <i class="fa-solid fa-share-nodes me-1"></i> Share Tracking Link
        </button>
      </div>
    </div>
  `;

  // Insert after tracker-banner-card
  const bannerCard = main?.querySelector('.tracker-banner-card');
  if (bannerCard && bannerCard.nextSibling) {
    main.insertBefore(panel, bannerCard.nextSibling);
  } else if (main) {
    main.insertBefore(panel, main.firstChild);
  }

  // Start auto-refresh polling every 15s for live status updates
  startTrackAutoRefresh(booking.id || booking.parcel_id);
}

function startTrackAutoRefresh(parcelId) {
  clearInterval(_trackAutoRefreshTimer);
  _trackAutoRefreshTimer = setInterval(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem('rudraksha_parcels') || '[]');
      const p2 = JSON.parse(localStorage.getItem('rudraksha_parcels_history') || '[]');
      const map = new Map();
      [...p1, ...p2].forEach(p => { const id = p.parcel_id || p.id; if (id && !map.has(id)) map.set(id, p); });
      const updated = map.get(parcelId);
      if (updated) {
        const oldStatus = (currentBooking?.booking_status || currentBooking?.status || '').toLowerCase();
        const newStatus = (updated.booking_status || updated.status || '').toLowerCase();
        if (oldStatus !== newStatus) {
          // Status changed — re-render
          const merged = { ...currentBooking, ...updated, id: parcelId, customer_name: updated.sender_name, customer_phone: updated.sender_phone, isParcel: true };
          currentBooking = merged;
          renderTrackingDashboard(merged);
          showTrackToast(`📦 Status updated: ${newStatus.replace(/_/g,' ').toUpperCase()}`);
        }
      }
    } catch {}
  }, 15000);
}

function shareParcelTrackingLink() {
  if (!currentBooking) return;
  const id = currentBooking.id || currentBooking.parcel_id || '';
  const trackUrl = `${window.location.origin}${window.location.pathname}?id=${id}`;
  const msg = `📦 *Track my Rudraksha Express Parcel*\n\nParcel ID: *${id}*\n\n🔍 Live Tracking Link:\n${trackUrl}\n\n📞 Support: +91 72968 31460`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function showTrackToast(msg) {
  let container = document.getElementById('trackToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'trackToastContainer';
    container.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'background:#1c1d26;border:1px solid rgba(34,197,94,0.35);border-left:3px solid #22c55e;border-radius:10px;padding:10px 16px;font-size:0.82rem;font-weight:600;color:#f1f5f9;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:trackToastIn 0.3s ease;white-space:nowrap;';
  toast.textContent = msg;
  if (!document.getElementById('trackToastStyle')) {
    const s = document.createElement('style'); s.id = 'trackToastStyle';
    s.textContent = '@keyframes trackToastIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
  container.appendChild(toast);
  setTimeout(() => { toast.style.transition = 'all 0.3s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}



/* ==========================================================================
   5. TAX INVOICE PREVIEW MODAL
   ========================================================================== */
function openInvoicePreview() {
  if (!currentBooking) return;
  const b = currentBooking;

  const modalBody = document.getElementById('invoiceModalBody');
  if (!modalBody) return;

  const bId = b.id || 'RB-XXXXXX';
  const cName = b.customer_name || b.name || 'Valued Customer';
  const cPhone = b.customer_phone || b.phone || '-';
  const pickup = b.pickup_address || b.pickup || 'Jaipur';
  const drop = b.drop_address || b.drop || 'Delhi NCR';
  const dist = b.distance_km || b.distanceKm || 25;
  const date = b.shifting_date || b.date || 'Today';
  const vehicle = b.selected_vehicle || 'Tata Ace (1.5 Ton)';
  const total = b.total_amount ? Number(b.total_amount) : 15090;

  modalBody.innerHTML = `
    <div style="background: #ffffff; color: #1e293b; padding: 24px; border-radius: 12px; font-family: 'Plus Jakarta Sans', sans-serif;">
      <!-- Invoice Header -->
      <div class="d-flex justify-content-between align-items-start border-bottom pb-3 mb-3">
        <div>
          <h4 class="fw-bold text-dark mb-0">RUDRAKSHA PACKERS & MOVERS</h4>
          <div class="small text-muted">All India Relocation & Logistics • ISO 9001:2015</div>
          <div class="small text-muted">Near SNM Hospital, Gandhipath (West), Jaipur, RJ • +91 7296831460</div>
        </div>
        <div class="text-end">
          <span class="badge bg-dark fs-6">TAX INVOICE</span>
          <div class="fw-bold mt-1 text-dark">REF: ${bId}</div>
          <div class="small text-muted">Date: ${date}</div>
        </div>
      </div>

      <!-- Bill To & Route -->
      <div class="row g-3 mb-3">
        <div class="col-6">
          <div class="p-2 border rounded bg-light">
            <div class="small fw-bold text-secondary">CUSTOMER DETAILS:</div>
            <div class="fw-bold text-dark">${cName}</div>
            <div class="small text-muted">Phone: +91 ${cPhone}</div>
          </div>
        </div>
        <div class="col-6">
          <div class="p-2 border rounded bg-light">
            <div class="small fw-bold text-secondary">RELOCATION ROUTE:</div>
            <div class="small text-dark fw-semibold">${pickup} ➔ ${drop}</div>
            <div class="small text-muted">Distance: ${dist} KM • Vehicle: ${vehicle}</div>
          </div>
        </div>
      </div>

      <!-- Charge Summary Table -->
      <table class="table table-bordered table-sm mb-3">
        <thead class="table-light">
          <tr>
            <th>Description of Services</th>
            <th class="text-end">Amount (INR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base Relocation & Transport Fee (${vehicle})</td>
            <td class="text-end">₹${Math.round(total * 0.70).toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td>Professional Packing, Labor & Handling Charges</td>
            <td class="text-end">₹${Math.round(total * 0.20).toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td>Transit Insurance & Cargo Protection</td>
            <td class="text-end">₹${Math.round(total * 0.10).toLocaleString('en-IN')}</td>
          </tr>
          <tr class="table-light fw-bold">
            <td>TOTAL AMOUNT PAYABLE</td>
            <td class="text-end fs-6 text-primary">₹${total.toLocaleString('en-IN')}</td>
          </tr>
        </tbody>
      </table>

      <!-- Footer Signature -->
      <div class="d-flex justify-content-between align-items-end pt-2 border-top">
        <div class="small text-muted">
          <div>Payment Mode: Confirmed</div>
          <div>Computer generated invoice. No signature required.</div>
        </div>
        <div class="text-end">
          <div class="fw-bold text-dark" style="font-family: cursive;">Rudraksha Logistics</div>
          <div class="small text-muted">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;

  const modal = new bootstrap.Modal(document.getElementById('invoiceModal'));
  modal.show();
}
