/**
 * Rudraksha Packers & Movers - Enterprise Customer Engine
 * Features:
 * - Leaflet OpenStreetMap Route Distance Engine (OSRM & Nominatim Geocoding)
 * - Browser Geolocation "Use My Current Location"
 * - Multi-Step Relocation Cost Wizard with Dynamic Theming
 * - Phone OTP Verification (Dev Mock & Production SMS ready)
 * - Real-Time Supabase / Express Backend Sync & Telegram Alerts
 * - Customer Live Tracking Portal & Status Stepper
 * - Printable GST-compliant Tax Quotation & Invoice
 */

// Global State (Initial state without forced presets)
let currentStep = 1;
let selectedVehicleType = null;
let selectedServiceType = null;
let selectedHouseSize = null;
let itemQuantities = {
  sofa: 0,
  bed: 0,
  dining: 0,
  fridge: 0,
  washing: 0,
  boxes: 0
};
let appliedCoupon = null;
let isPhoneVerified = false;
let verifiedPhoneNumber = '';
let otpCountdownInterval = null;
let currentTrackedBooking = null;

// Dedicated Vehicle Fleet Config (Dynamic)
let vehicleConfig = {
  'mini_truck': { name: 'Tata Ace / Mini (1.5 Ton)', basePrice: 2500, perKmRate: 35, icon: 'fa-truck-pickup', cap: 'Up to 1 BHK / Studio' },
  'tempo_14ft': { name: '14ft Tempo / Eicher (3.5 Ton)', basePrice: 3500, perKmRate: 45, icon: 'fa-truck', cap: 'Ideal for 1-2 BHK' },
  'truck_19ft': { name: '19ft Container Truck (7 Ton)', basePrice: 5500, perKmRate: 65, icon: 'fa-truck-moving', cap: '3+ BHK / Large Moving' },
  'bike': { name: 'Bike Transport Carrier', basePrice: 1500, perKmRate: 15, icon: 'fa-motorcycle', cap: 'Two-Wheeler Carrier' },
  'car': { name: 'Closed Car Carrier', basePrice: 4500, perKmRate: 35, icon: 'fa-car-side', cap: 'Hydraulic Car Carrier' }
};

// Map & Route Coordinates
let leafletMap = null;
let pickupMarker = null;
let dropMarker = null;
let routePolyline = null;
let pickupCoords = null; // [lat, lng]
let dropCoords = null;   // [lat, lng]

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_API_URL = 'https://rudraksha-packers-movers.onrender.com/api';
const BOOKING_API_URL = isLocalhost ? 'http://localhost:3000/api' : (localStorage.getItem('rudraksha_backend_api_url') || PRODUCTION_API_URL);

// Default Rate Configuration (Dynamic)
let ratesConfig = {
  baseRate: 2500,
  perKmRate: 40,
  floorNoLiftRate: 300,
  houseSizeRates: {
    '1rk': 0,
    '1bhk': 1000,
    '2bhk': 2500,
    '3bhk': 4500,
    'villa': 7500
  },
  itemRates: {
    sofa: 500,
    bed: 600,
    dining: 400,
    fridge: 400,
    washing: 350,
    boxes: 80
  },
  addonRates: {
    bubblePacking: 1500,
    unpacking: 1200,
    insurance: 999,
    vehicleTransport: 2500
  }
};

// Available Coupons Database (Dynamic)
let availableCoupons = [
  { code: 'FIRST500', type: 'fixed', value: 500, description: '₹500 flat off on first relocation' },
  { code: 'RELOCATE10', type: 'percent', value: 10, description: '10% discount on house shifting' },
  { code: 'FESTIVE15', type: 'percent', value: 15, description: '15% festive seasonal off' }
];

async function loadBackendData() {
  try {
    const res = await fetch(`${BOOKING_API_URL}/config`);
    if (res.ok) {
      const config = await res.json();
      if (config.vehicles && Object.keys(config.vehicles).length > 0) {
        vehicleConfig = config.vehicles;
      }
      if (config.rates) {
        ratesConfig = { ...ratesConfig, ...config.rates };
      }
      if (config.coupons && config.coupons.length > 0) {
        availableCoupons = config.coupons;
      }
      if (config.company) {
        applyCompanyConfig(config.company);
      }
      if (config.theme) {
        applyThemeConfig(config.theme);
      }
      renderVehicleCards();
      return;
    }
  } catch (e) {
    console.warn('API config fetch skipped, using localStorage fallback:', e.message);
  }

  // LocalStorage Fallback
  const cachedVehicles = localStorage.getItem('rudraksha_fleet_config');
  if (cachedVehicles) {
    try { vehicleConfig = JSON.parse(cachedVehicles); } catch {}
  }
  const cachedRates = localStorage.getItem('rudraksha_rates_config');
  if (cachedRates) {
    try { ratesConfig = { ...ratesConfig, ...JSON.parse(cachedRates) }; } catch {}
  }
  const cachedCoupons = localStorage.getItem('rudraksha_coupons');
  if (cachedCoupons) {
    try { availableCoupons = JSON.parse(cachedCoupons); } catch {}
  }
  const cachedCompany = localStorage.getItem('rudraksha_company_config');
  if (cachedCompany) {
    try { applyCompanyConfig(JSON.parse(cachedCompany)); } catch {}
  }
  const cachedTheme = localStorage.getItem('rudraksha_theme_settings');
  if (cachedTheme) {
    try { applyThemeConfig(JSON.parse(cachedTheme)); } catch {}
  }

  renderVehicleCards();
}

function renderVehicleCards() {
  const container = document.getElementById('vehicleCardsContainer');
  if (!container) return;

  const keys = Object.keys(vehicleConfig);
  if (keys.length === 0) return;

  container.innerHTML = keys.map((key) => {
    const v = vehicleConfig[key];
    const isSelected = selectedVehicleType === key;
    return `
      <div class="col-6 col-md-4 col-lg-2.4">
        <div class="vehicle-select-card ${isSelected ? 'selected' : ''}" data-vehicle="${key}" onclick="selectVehicleType('${key}')">
          <div class="vehicle-icon-wrap"><i class="fa-solid ${v.icon || 'fa-truck'}"></i></div>
          <h6 class="vehicle-name">${v.name}</h6>
          <span class="vehicle-cap">${v.cap || 'Standard Moving'}</span>
          <div class="vehicle-price-tag">Base ₹${Number(v.basePrice || 0).toLocaleString('en-IN')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function applyCompanyConfig(comp) {
  if (!comp) return;
  if (comp.phone) {
    document.querySelectorAll('a[href^="tel:"]').forEach(el => el.href = `tel:+91${comp.phone.replace(/\D/g, '')}`);
    document.querySelectorAll('.company-phone-text').forEach(el => el.innerText = `+91 ${comp.phone}`);
  }
  if (comp.whatsapp) {
    document.querySelectorAll('a[href*="wa.me"]').forEach(el => {
      el.href = `https://wa.me/91${comp.whatsapp.replace(/\D/g, '')}?text=Hello%20Rudraksha%20Packers,%20I%20want%20to%20inquire%20about%20shifting%20service`;
    });
  }
  if (comp.name) {
    document.querySelectorAll('.brand-title-text').forEach(el => el.innerText = comp.name);
  }
}

function applyThemeConfig(theme) {
  if (!theme) return;
  if (theme.primaryColor) {
    document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
  }
  if (theme.secondaryColor) {
    document.documentElement.style.setProperty('--secondary-color', theme.secondaryColor);
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  // Set default shifting date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  const shiftingDateInput = document.getElementById('shiftingDate');
  if (shiftingDateInput) shiftingDateInput.value = dateStr;

  // Initialize Leaflet Map
  initRouteMap();

  // Attach event listeners for live recalculations
  document.getElementById('distanceKm')?.addEventListener('input', recalculateTotal);
  document.getElementById('shiftingDate')?.addEventListener('change', updateSummaryTexts);

  // Initialize Live Location Autocomplete for Pickup and Drop
  initLocationAutocomplete('pickupCity', 'pickupSuggestions', 'pickup');
  initLocationAutocomplete('dropCity', 'dropSuggestions', 'drop');

  // Debounced auto-route lookup on input change
  document.getElementById('pickupCity')?.addEventListener('change', () => calculateOSRMRoute(false));
  document.getElementById('dropCity')?.addEventListener('change', () => calculateOSRMRoute(false));

  // Close autocomplete dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.location-input-wrap')) {
      document.querySelectorAll('.autocomplete-dropdown').forEach(d => d.classList.remove('show'));
    }
  });

  // Initial Calculation
  recalculateTotal();
  updateSummaryTexts();
});

/* ==========================================================================
   1. MAP & ROUTE ENGINE (OpenStreetMap, Leaflet, Live Autocomplete, OSRM)
   ========================================================================== */

function initRouteMap() {
  const mapEl = document.getElementById('routeMap');
  if (!mapEl || typeof L === 'undefined') return;

  try {
    // Default center at Jaipur (Company Headquarter & Hub: 26.9124, 75.7873)
    leafletMap = L.map('routeMap').setView([26.9124, 75.7873], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);

    // Allow user to click anywhere on map to pinpoint their exact location
    leafletMap.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      await applyPinpointCoords(lat, lng, 'Pinned on Map', true);
    });
  } catch (err) {
    console.warn('Leaflet map initialization skipped or map container not ready:', err);
  }
}

/**
 * Apply Pinpoint Coordinates from Map Click, Drag, or GPS
 */
async function applyPinpointCoords(lat, lng, defaultLabel = 'Selected Point', isPickup = true) {
  const statusEl = document.getElementById('routeMapStatus');
  if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary-custom me-1"></i> Pinpointing exact location on map...';

  if (isPickup) {
    pickupCoords = [lat, lng];

    if (leafletMap) {
      if (pickupMarker) {
        pickupMarker.setLatLng([lat, lng]);
      } else {
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);
        pickupMarker.on('dragend', async (e) => {
          const newPos = e.target.getLatLng();
          await applyPinpointCoords(newPos.lat, newPos.lng, 'Dragged Pin', true);
        });
      }
      pickupMarker.bindPopup('<b>📍 Your Pickup Location</b><br><small class="text-muted">Drag to adjust</small>').openPopup();
      leafletMap.panTo([lat, lng]);
    }

    // High precision reverse geocode to get exact street/colony
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      const data = await res.json();
      let address = '';
      if (data && data.address) {
        const a = data.address;
        const street = a.road || a.suburb || a.neighbourhood || a.residential || '';
        const city = a.city || a.town || a.county || a.state_district || '';
        const state = a.state || '';
        address = [street, city, state].filter(Boolean).join(', ');
      }
      if (!address && data && data.display_name) {
        address = data.display_name.split(',').slice(0, 3).join(',');
      }

      const finalAddress = address || defaultLabel;
      const pickupInput = document.getElementById('pickupCity');
      if (pickupInput) {
        pickupInput.value = finalAddress;
        updateSummaryTexts();
      }
      if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-1"></i> Exact Location Set: <strong>${finalAddress}</strong>`;
    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-1"></i> Location pinned at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`;
    }

    // Auto calculate route if drop is filled
    const dropVal = document.getElementById('dropCity')?.value.trim();
    if (dropVal) calculateOSRMRoute(false);
  }
}

/**
 * Fast Indian Location Auto-Suggest Engine
 */
let autocompleteDebounceTimer = null;
function initLocationAutocomplete(inputId, dropdownId, type) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(autocompleteDebounceTimer);

    if (type === 'pickup') pickupCoords = null;
    if (type === 'drop') dropCoords = null;

    if (query.length < 2) {
      dropdown.innerHTML = '';
      dropdown.classList.remove('show');
      return;
    }

    autocompleteDebounceTimer = setTimeout(async () => {
      try {
        // Photon OpenStreetMap Search API
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`);
        const data = await res.json();

        if (data && data.features && data.features.length > 0) {
          dropdown.innerHTML = '';
          data.features.forEach(f => {
            const props = f.properties;
            const [lng, lat] = f.geometry.coordinates;

            const name = props.name || '';
            const city = props.city || props.county || props.state || '';
            const state = props.state || props.country || '';
            const sub = [city, state].filter(Boolean).join(', ');

            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `
              <i class="fa-solid ${type === 'pickup' ? 'fa-location-dot' : 'fa-flag-checkered'}"></i>
              <div>
                <span class="autocomplete-main-text">${name}</span>
                <span class="autocomplete-sub-text">${sub}</span>
              </div>
            `;

            item.addEventListener('click', () => {
              const fullAddress = [name, sub].filter(Boolean).join(', ');
              input.value = fullAddress;
              dropdown.classList.remove('show');

              if (type === 'pickup') {
                pickupCoords = [lat, lng];
                if (leafletMap) {
                  if (pickupMarker) pickupMarker.setLatLng([lat, lng]);
                  else pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);
                  pickupMarker.bindPopup(`<b>📍 ${fullAddress}</b>`).openPopup();
                  leafletMap.setView([lat, lng], 14);
                }
              } else {
                dropCoords = [lat, lng];
                if (leafletMap) {
                  if (dropMarker) dropMarker.setLatLng([lat, lng]);
                  else dropMarker = L.marker([lat, lng]).addTo(leafletMap);
                  dropMarker.bindPopup(`<b>🏁 ${fullAddress}</b>`);
                }
              }

              updateSummaryTexts();
              calculateOSRMRoute(false);
            });

            dropdown.appendChild(item);
          });
          dropdown.classList.add('show');
        } else {
          dropdown.classList.remove('show');
        }
      } catch (err) {
        console.warn('Autocomplete fetch error:', err);
      }
    }, 250);
  });
}

/**
 * 1-Click Quick Location Chip Selector
 */
async function selectQuickArea(type, fullAddress) {
  const input = document.getElementById(type === 'pickup' ? 'pickupCity' : 'dropCity');
  if (input) input.value = fullAddress;

  const coords = await geocodeAddress(fullAddress);
  if (coords) {
    if (type === 'pickup') {
      pickupCoords = coords;
      if (leafletMap) {
        if (pickupMarker) pickupMarker.setLatLng(coords);
        else pickupMarker = L.marker(coords, { draggable: true }).addTo(leafletMap);
        pickupMarker.bindPopup(`<b>📍 ${fullAddress}</b>`).openPopup();
        leafletMap.setView(coords, 14);
      }
    } else {
      dropCoords = coords;
      if (leafletMap) {
        if (dropMarker) dropMarker.setLatLng(coords);
        else dropMarker = L.marker(coords).addTo(leafletMap);
        dropMarker.bindPopup(`<b>🏁 ${fullAddress}</b>`);
      }
    }
  }

  updateSummaryTexts();
  calculateOSRMRoute(false);
}

/**
 * Smart Geolocation Engine: Direct Browser Permission Prompt -> Pinpoint GPS -> Modal Guide if Blocked
 */
async function useCurrentLocation() {
  const statusEl = document.getElementById('routeMapStatus');
  const btn = document.getElementById('btnUsePreciseLocation');

  if (btn) {
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary me-1"></i> Requesting GPS...';
    btn.disabled = true;
  }

  if (statusEl) {
    statusEl.innerHTML = '<span class="text-primary fw-semibold"><i class="fa-solid fa-hand-pointer me-1"></i> 👆 Please click <strong>"Allow"</strong> on your browser\'s location permission prompt</span>';
  }

  if (!navigator.geolocation) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs me-1"></i> Use Precise Location';
    }
    await useNetworkLocationFallback();
    return;
  }

  // Request high-accuracy GPS with maximumAge: 0 to force a live check and trigger the browser prompt
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-circle-check text-success me-1"></i> Location Active';
      }

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy || 10);
      pickupCoords = [lat, lng];

      // Update Map View
      if (leafletMap) {
        leafletMap.setView([lat, lng], 15);
        if (pickupMarker) leafletMap.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng]).addTo(leafletMap)
          .bindPopup(`<b>📍 Your Exact Pickup Location</b><br><small class="text-muted">GPS Accuracy: ±${accuracy}m</small>`)
          .openPopup();
      }

      // Reverse geocode with high precision Nominatim
      try {
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary-custom me-1"></i> Resolving street address...';
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await res.json();
        let address = '';
        if (data && data.address) {
          const a = data.address;
          const street = a.road || a.suburb || a.neighbourhood || a.commercial || a.residential || '';
          const city = a.city || a.town || a.county || a.state_district || '';
          const state = a.state || '';
          const postcode = a.postcode ? ` - ${a.postcode}` : '';
          address = [street, city, state].filter(Boolean).join(', ') + postcode;
        }
        if (!address && data && data.display_name) {
          address = data.display_name.split(',').slice(0, 4).join(',');
        }

        const finalAddress = address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        const pickupInput = document.getElementById('pickupCity');
        if (pickupInput) {
          pickupInput.value = finalAddress;
          updateSummaryTexts();
        }
        if (statusEl) {
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-1"></i> Exact GPS Location: <strong>${finalAddress}</strong>`;
        }
      } catch (e) {
        const pickupInput = document.getElementById('pickupCity');
        if (pickupInput) {
          pickupInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          updateSummaryTexts();
        }
        if (statusEl) {
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-1"></i> GPS Coordinates captured: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`;
        }
      }

      // If drop address already filled, compute route
      const dropVal = document.getElementById('dropCity')?.value.trim();
      if (dropVal) {
        calculateOSRMRoute(false);
      }
    },
    async (error) => {
      console.warn('Geolocation Error:', error.code, error.message);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-location-crosshairs me-1"></i> Use Precise Location';
      }

      if (error.code === 1) {
        // PERMISSION_DENIED: Browser popup was dismissed or blocked previously
        const modalEl = document.getElementById('locationPermissionModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
          const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
          modal.show();
        }
        if (statusEl) {
          statusEl.innerHTML = '<span class="text-danger fw-semibold"><i class="fa-solid fa-lock me-1"></i> Location permission is blocked. Click the 🔒 lock icon in the address bar to Allow.</span>';
        }
      } else {
        // Timeout or Position Unavailable - fallback to IP Geolocation
        await useNetworkLocationFallback();
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/**
 * Retry GPS location after user unblocks permission in address bar
 */
function retryLocationPermission() {
  const modalEl = document.getElementById('locationPermissionModal');
  if (modalEl && typeof bootstrap !== 'undefined') {
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
  }
  setTimeout(() => {
    useCurrentLocation();
  }, 300);
}

/**
 * Network / IP Location Fallback
 */
async function useNetworkLocationFallback() {
  const statusEl = document.getElementById('routeMapStatus');
  if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary-custom me-1"></i> Detecting city via network...';

  try {
    let res = await fetch('https://ipwho.is/');
    let data = await res.json();

    if (!data || !data.success || !data.latitude) {
      res = await fetch('https://ipapi.co/json/');
      data = await res.json();
    }

    if (data && data.latitude && data.longitude) {
      const lat = data.latitude;
      const lng = data.longitude;
      const placeName = [data.city, data.region, data.country].filter(Boolean).join(', ');

      pickupCoords = [lat, lng];

      if (leafletMap) {
        leafletMap.setView([lat, lng], 12);
        if (pickupMarker) leafletMap.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng]).addTo(leafletMap).bindPopup(`<b>📍 ${placeName}</b>`).openPopup();
      }

      const pickupInput = document.getElementById('pickupCity');
      if (pickupInput) {
        pickupInput.value = placeName;
        updateSummaryTexts();
      }

      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-location-dot text-primary-custom me-1"></i> Network Area: <strong>${placeName}</strong> <span class="small text-muted">(Click 🔒 in address bar for street GPS)</span>`;
      }

      const dropVal = document.getElementById('dropCity')?.value.trim();
      if (dropVal) calculateOSRMRoute(false);
      return;
    }
    throw new Error('All IP services failed');
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation text-warning me-1"></i> Please type your pickup area or city name manually.';
    }
  }
}

/**
 * Free OSRM Road Distance & Routing Engine
 */
async function calculateOSRMRoute(showAlert = true) {
  const pickup = document.getElementById('pickupCity')?.value.trim();
  const drop = document.getElementById('dropCity')?.value.trim();
  const statusEl = document.getElementById('routeMapStatus');
  const distBadge = document.getElementById('routeDistanceCalculated');

  if (!pickup || !drop) {
    if (showAlert) alert('Please enter both Pickup and Drop locations to find route.');
    return;
  }

  if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary-custom me-1"></i> Calculating real road distance via OSRM...';

  try {
    // 1. Geocode Pickup if not already coordinates
    let pCoord = pickupCoords;
    if (!pCoord) {
      pCoord = await geocodeAddress(pickup);
      pickupCoords = pCoord;
    }

    // 2. Geocode Drop
    let dCoord = dropCoords;
    if (!dCoord) {
      dCoord = await geocodeAddress(drop);
      dropCoords = dCoord;
    }

    if (!pCoord || !dCoord) {
      if (statusEl) {
        statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation text-warning me-1"></i> Could not pinpoint location. Please check city name (e.g. Delhi, Jaipur, Mumbai).';
      }
      return;
    }

    // 3. Call Free OSRM Routing API (lng,lat order)
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pCoord[1]},${pCoord[0]};${dCoord[1]},${dCoord[0]}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl);
    const data = await res.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const distanceKm = Math.max(1, Math.round(route.distance / 1000));
      const durationMins = Math.round(route.duration / 60);

      // Update distance input and badge
      setDistance(distanceKm);
      if (distBadge) distBadge.innerText = `${distanceKm} KM (${durationMins} mins drive)`;
      if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-1"></i> Road route found: <strong>${distanceKm} KM</strong> (${durationMins} min drive)`;

      // Draw markers and route on Leaflet map
      if (leafletMap) {
        if (pickupMarker) leafletMap.removeLayer(pickupMarker);
        if (dropMarker) leafletMap.removeLayer(dropMarker);
        if (routePolyline) leafletMap.removeLayer(routePolyline);

        pickupMarker = L.marker(pCoord).addTo(leafletMap).bindPopup(`<b>📍 Pickup:</b> ${pickup}`).openPopup();
        dropMarker = L.marker(dCoord).addTo(leafletMap).bindPopup(`<b>🏁 Drop:</b> ${drop}`);

        const routeCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        routePolyline = L.polyline(routeCoords, { color: '#f97316', weight: 5, opacity: 0.85 }).addTo(leafletMap);

        leafletMap.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
      }
    } else {
      throw new Error('No driving route found between these points.');
    }
  } catch (err) {
    console.warn('OSRM routing fallback:', err);
    if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-circle-info text-secondary me-1"></i> Approx estimate mode active.`;
  }
}

async function geocodeAddress(query) {
  if (!query || !query.trim()) return null;
  const cleanQuery = query.trim();

  // 1. Nominatim with clean query in India
  try {
    const encoded = encodeURIComponent(cleanQuery + ', India');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=in&limit=1`);
    const results = await res.json();
    if (results && results.length > 0) {
      return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
    }
  } catch (e) {
    console.warn('Nominatim geocode primary failed:', e);
  }

  // 2. Try searching without adding ', India'
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=1`);
    const results = await res.json();
    if (results && results.length > 0) {
      return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
    }
  } catch (e) {
    console.warn('Nominatim fallback failed:', e);
  }

  // 3. Photon Komoot API fallback
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=1`);
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return [lat, lng];
    }
  } catch (e) {
    console.warn('Photon fallback failed:', e);
  }

  return null;
}

/* ==========================================================================
   2. OTP VERIFICATION ENGINE (Google Firebase Phone Auth + Dev/Server Fallback)
   ========================================================================== */

let firebaseConfirmationResult = null;
window.recaptchaVerifier = null;

function initFirebaseVerifier() {
  if (typeof firebase !== 'undefined' && window.isFirebaseConfigured && window.isFirebaseConfigured()) {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.firebaseConfig);
      }
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
          size: 'invisible',
          callback: () => {
            // Invisible recaptcha solved
          }
        });
      }
      return true;
    } catch (e) {
      console.warn('Firebase verifier init note:', e.message);
    }
  }
  return false;
}

async function requestPhoneOTP() {
  const phoneInput = document.getElementById('custPhone') || document.getElementById('otpPhoneInput');
  const phone = (phoneInput?.value || '').replace(/\D/g, '');

  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit WhatsApp mobile number first.');
    if (phoneInput) phoneInput.focus();
    return;
  }

  if (phoneInput && phoneInput.id === 'otpPhoneInput' && document.getElementById('custPhone')) {
    document.getElementById('custPhone').value = phone;
  }

  const btnSend = document.getElementById('btnSendOtp');
  if (btnSend) {
    btnSend.disabled = true;
    btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Sending...';
  }

  const isFirebaseActive = initFirebaseVerifier();

  try {
    if (isFirebaseActive) {
      try {
        // 1. Send Real SMS via Google Firebase Phone Auth (10,000 Free SMS/Month)
        const fullPhoneNumber = `+91${phone}`;
        firebaseConfirmationResult = await firebase.auth().signInWithPhoneNumber(fullPhoneNumber, window.recaptchaVerifier);
        
        const otpSection = document.getElementById('otpVerificationSection');
        if (otpSection) otpSection.style.display = 'block';
        
        document.getElementById('otpTargetPhone').innerText = `+91 ${phone}`;
        const statusMsg = document.getElementById('otpStatusMsg');
        if (statusMsg) {
          statusMsg.innerHTML = `<span class="text-success"><i class="fa-brands fa-google me-1"></i> <strong>Google SMS Sent!</strong> Verification code delivered to +91 ${phone}.</span>`;
        }
        startOtpTimer(30);
        document.getElementById('otp1')?.focus();
        return;
      } catch (fbErr) {
        console.warn('Firebase SMS error:', fbErr);
        if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
          try { window.recaptchaVerifier.clear(); } catch(e){}
          window.recaptchaVerifier = null;
        }

        if (fbErr.code === 'auth/operation-not-allowed') {
          alert('⚠️ Firebase Notice:\nPhone Auth is not enabled in Firebase Console yet.\n\n👉 Go to: Firebase Console -> Authentication -> Sign-in method -> Click "Phone" -> Enable -> Save.\n\nFor now, we have opened the Dev Mode so you can verify using code: 123456');
        } else if (fbErr.code === 'auth/unauthorized-domain') {
          alert('⚠️ Firebase Notice:\nThis domain is not added to Authorized Domains in Firebase.\n\n👉 Go to: Firebase Console -> Authentication -> Settings -> Authorized domains -> Add your domain (e.g. rudraksh-packers-and-movers.pages.dev).');
        } else {
          alert(`Firebase SMS Notice: ${fbErr.message}\n\nFalling back to test mode (use code: 123456).`);
        }
      }
    }

    // 2. Server OTP fallback
    const otpResponse = await fetch(`${BOOKING_API_URL}/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const otpData = await otpResponse.json().catch(() => ({}));
    if (!otpResponse.ok || !otpData.success) {
      throw new Error(otpData.error || 'OTP service is unavailable.');
    }

    const otpSection = document.getElementById('otpVerificationSection');
    if (otpSection) otpSection.style.display = 'block';
    
    document.getElementById('otpTargetPhone').innerText = `+91 ${phone}`;
    const statusMsg = document.getElementById('otpStatusMsg');
    if (statusMsg) {
      const devHint = otpData.devOtp ? ` Test code: <strong>${otpData.devOtp}</strong>` : '';
      statusMsg.innerHTML = `<span class="text-info"><i class="fa-solid fa-circle-info me-1"></i> ${otpData.message || 'OTP sent successfully.'}${devHint}</span>`;
    }

    startOtpTimer(30);
    document.getElementById('otp1')?.focus();
  } catch (err) {
    console.error('OTP request error:', err);
    alert(`Could not send OTP: ${err.message}`);
  } finally {
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.innerHTML = '<i class="fa-solid fa-rotate me-1"></i> Resend OTP';
    }
  }
}

function autoFillDevOtp(code = '123456') {
  const digits = String(code).padStart(6, '123456').slice(0, 6).split('');
  for (let i = 1; i <= 6; i++) {
    const input = document.getElementById(`otp${i}`);
    if (input) input.value = digits[i - 1] || '';
  }
  const statusMsg = document.getElementById('otpStatusMsg');
  if (statusMsg) {
    statusMsg.innerHTML = `<span class="text-success"><i class="fa-solid fa-check-double me-1"></i> Auto-filled OTP (${code}). Click "Verify OTP" to continue!</span>`;
  }
}

function startOtpTimer(seconds) {
  clearInterval(otpCountdownInterval);
  let remaining = seconds;
  const timerEl = document.getElementById('otpTimer');
  const resendBtn = document.getElementById('btnResendOtp');

  if (resendBtn) resendBtn.disabled = true;

  otpCountdownInterval = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.innerText = remaining;
    if (remaining <= 0) {
      clearInterval(otpCountdownInterval);
      if (resendBtn) resendBtn.disabled = false;
    }
  }, 1000);
}

function moveToNextOtp(current, nextId) {
  if (current.value.length === 1 && nextId) {
    document.getElementById(nextId)?.focus();
  }
}

async function verifyEnteredOTP() {
  const phone = document.getElementById('custPhone')?.value.replace(/\D/g, '');
  const digits = [
    document.getElementById('otp1')?.value || '',
    document.getElementById('otp2')?.value || '',
    document.getElementById('otp3')?.value || '',
    document.getElementById('otp4')?.value || '',
    document.getElementById('otp5')?.value || '',
    document.getElementById('otp6')?.value || ''
  ].join('');

  if (digits.length < 6) {
    alert('Please enter the full 6-digit OTP code.');
    return;
  }

  const statusMsg = document.getElementById('otpStatusMsg');
  if (statusMsg) statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Verifying OTP...';

  if (!phone) {
    const fallbackPhoneInput = document.getElementById('custPhone') || document.getElementById('otpPhoneInput');
    if (fallbackPhoneInput) {
      fallbackPhoneInput.focus();
    }
    throw new Error('Phone number is missing.');
  }

  try {
    if (firebaseConfirmationResult) {
      // 1. Verify with Google Firebase
      await firebaseConfirmationResult.confirm(digits);
    } else {
      // 2. Verify with Backend API (Supports 123456 & generated code)
      const response = await fetch(`${BOOKING_API_URL}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: digits })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Invalid OTP code.');
      }
    }

    isPhoneVerified = true;
    verifiedPhoneNumber = phone;

    // Hide OTP box, show Verified Badge
    const otpSection = document.getElementById('otpVerificationSection');
    if (otpSection) otpSection.style.display = 'none';

    const badge = document.getElementById('phoneVerifiedBadge');
    if (badge) {
      badge.style.display = 'block';
      const verifiedTextEl = document.getElementById('verifiedPhoneText');
      if (verifiedTextEl) verifiedTextEl.textContent = phone;
      else badge.setAttribute('title', phone);
    }

    const mainPhoneInput = document.getElementById('custPhone');
    if (mainPhoneInput) mainPhoneInput.value = phone;
    const otpPhoneInput = document.getElementById('otpPhoneInput');
    if (otpPhoneInput) otpPhoneInput.value = phone;

    alert('✅ Mobile number verified successfully!');
  } catch (err) {
    if (statusMsg) {
      statusMsg.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i> ${err.message}</span>`;
    }
  }
}

/* ==========================================================================
   3. MULTI-STEP WIZARD & PRICE ENGINE
   ========================================================================== */

/**
 * Validates all previous steps sequentially before transitioning to target step
 */
function validateAndGoStep(targetStep) {
  if (targetStep < 1 || targetStep > 4) return;

  // Going backward is always allowed without blocking validation
  if (targetStep <= currentStep) {
    goToStep(targetStep);
    return;
  }

  // Going forward: Strictly validate EVERY preceding step from Step 1 up to (targetStep - 1)
  for (let s = 1; s < targetStep; s++) {
    if (!validateStep(s)) {
      // Return user to the incomplete step to complete it
      goToStep(s);
      return;
    }
  }

  // All previous steps are verified -> proceed to targetStep
  goToStep(targetStep);
}

/**
 * Directly switches to a specific wizard step (1-4)
 */
function goToStep(step) {
  if (step < 1 || step > 4) return;

  // Invalidate Leaflet Map Size when step 1 is opened
  if (step === 1 && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 200);
  }

  // Hide all steps, show target step
  for (let s = 1; s <= 4; s++) {
    const el = document.getElementById(`step${s}`);
    if (el) el.classList.remove('active');
  }

  const targetEl = document.getElementById(`step${step}`);
  if (targetEl) targetEl.classList.add('active');

  currentStep = step;

  // Update Stepper Progress UI
  const nodes = document.querySelectorAll('.step-node');
  nodes.forEach((node) => {
    const stepNum = parseInt(node.getAttribute('data-step') || '1');
    if (stepNum === step) {
      node.classList.add('active');
      node.classList.remove('completed');
    } else if (stepNum < step) {
      node.classList.remove('active');
      node.classList.add('completed');
    } else {
      node.classList.remove('active', 'completed');
    }
  });

  // Update Progress Line Width
  const progressPercent = ((step - 1) / 3) * 100;
  const progressBar = document.getElementById('stepperProgressBar');
  if (progressBar) progressBar.style.width = `${progressPercent}%`;

  // Auto-initialize vehicle & house type defaults on Step 2
  if (step >= 2) {
    if (!selectedVehicleType) selectVehicleType('mini_truck');
    if (!selectedHouseSize) selectHouseSize('1bhk');
  }

  recalculateTotal();
  updateSummaryTexts();

  // Smooth scroll into calculator view
  const calcEl = document.getElementById('calculator');
  if (calcEl) {
    calcEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function navigateWizard(direction) {
  const next = currentStep + direction;
  if (direction > 0) {
    validateAndGoStep(next);
  } else {
    goToStep(next);
  }
}

function validateStep(step) {
  if (step === 1) {
    const pickupInput = document.getElementById('pickupCity');
    const dropInput = document.getElementById('dropCity');
    const pickup = pickupInput?.value?.trim() || '';
    const drop = dropInput?.value?.trim() || '';
    const date = document.getElementById('shiftingDate')?.value;

    if (!pickup || pickup.length < 2) {
      alert('⚠️ Missing Detail: Please enter your Pickup Address / Area in Step 1 before proceeding.');
      if (pickupInput) {
        pickupInput.focus();
        pickupInput.classList.add('is-invalid');
        setTimeout(() => pickupInput.classList.remove('is-invalid'), 3500);
      }
      return false;
    }

    if (!drop || drop.length < 2) {
      alert('⚠️ Missing Detail: Please enter your Drop Destination City / Area in Step 1 before proceeding.');
      if (dropInput) {
        dropInput.focus();
        dropInput.classList.add('is-invalid');
        setTimeout(() => dropInput.classList.remove('is-invalid'), 3500);
      }
      return false;
    }

    // Default moving date to tomorrow if not set
    if (!date) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const iso = tomorrow.toISOString().split('T')[0];
      const dateEl = document.getElementById('shiftingDate');
      if (dateEl) dateEl.value = iso;
    }

    // Default distance to 25 KM if not set
    const distInput = document.getElementById('distanceKm');
    if (!distInput || !distInput.value || parseFloat(distInput.value) <= 0) {
      setDistance(25);
    }
  } else if (step === 2) {
    if (!selectedVehicleType) {
      selectVehicleType('mini_truck');
    }
    if (!selectedHouseSize) {
      selectHouseSize('1bhk');
    }
  } else if (step === 3) {
    recalculateTotal();
  }
  return true;
}

function setDistance(km) {
  const input = document.getElementById('distanceKm');
  if (input) input.value = km;
  const distDisplay = document.getElementById('routeDistanceDisplay');
  if (distDisplay) distDisplay.innerText = `${km} KM (Confirmed Route)`;
  recalculateTotal();
  updateSummaryTexts();
}

function selectQuickArea(type, value) {
  if (type === 'pickup') {
    const el = document.getElementById('pickupCity');
    if (el) el.value = value;
  } else if (type === 'drop') {
    const el = document.getElementById('dropCity');
    if (el) el.value = value;
  }
  updateSummaryTexts();
  calculateOSRMRoute(false);
}

function selectVehicleType(type) {
  if (!vehicleConfig[type]) return;
  selectedVehicleType = type;

  document.querySelectorAll('.vehicle-select-card').forEach((card) => {
    if (card.getAttribute('data-vehicle') === type) {
      card.classList.add('active');
      card.classList.add('selected');
    } else {
      card.classList.remove('active');
      card.classList.remove('selected');
    }
  });

  if (type === 'bike') {
    selectedServiceType = 'Bike Transport';
  } else if (type === 'car') {
    selectedServiceType = 'Car Transport';
  } else if (type === 'mini_truck') {
    selectedServiceType = 'Tata Ace / Mini Truck on Rent';
  } else if (type === 'tempo_14ft') {
    selectedServiceType = '14ft Tempo Shifting';
  } else if (type === 'truck_19ft') {
    selectedServiceType = '19ft Large Container Shifting';
  }

  recalculateTotal();
  updateSummaryTexts();
}

function setServiceCategory(serviceCategory) {
  selectedServiceType = serviceCategory;
  const lower = String(serviceCategory || '').toLowerCase();

  if (lower.includes('bike')) {
    selectVehicleType('bike');
  } else if (lower.includes('car')) {
    selectVehicleType('car');
  } else if (lower.includes('tempo') || lower.includes('truck')) {
    selectVehicleType('tempo_14ft');
  } else if (lower.includes('office') || lower.includes('industrial') || lower.includes('warehouse')) {
    selectVehicleType('truck_19ft');
  } else {
    selectVehicleType('mini_truck');
  }

  const calcSection = document.getElementById('calculator');
  if (calcSection) {
    calcSection.scrollIntoView({ behavior: 'smooth' });
  }
}

function scrollToCalculatorWithService(serviceCategory) {
  setServiceCategory(serviceCategory);
}

function selectHouseSize(size) {
  selectedHouseSize = size;
  document.querySelectorAll('.house-size-card').forEach((card) => {
    if (card.getAttribute('data-size') === size) {
      card.classList.add('active');
      card.classList.add('selected');
    } else {
      card.classList.remove('active');
      card.classList.remove('selected');
    }
  });

  recalculateTotal();
  updateSummaryTexts();
}

function updateItemCount(itemKey, delta) {
  if (itemQuantities.hasOwnProperty(itemKey)) {
    itemQuantities[itemKey] = Math.max(0, (itemQuantities[itemKey] || 0) + delta);
    const cntEl = document.getElementById(`count-${itemKey}`);
    if (cntEl) cntEl.innerText = itemQuantities[itemKey];
    const qtyEl = document.getElementById(`qty_${itemKey}`);
    if (qtyEl) qtyEl.innerText = itemQuantities[itemKey];
    recalculateTotal();
  }
}

function updateItemQty(itemKey, delta) {
  updateItemCount(itemKey, delta);
}

function calculatePrice() {
  recalculateTotal();
}

function toggleAddon(addonKey, sourceEvent) {
  const checkbox = document.getElementById(`addon_${addonKey}`) || document.getElementById(`addon${addonKey.charAt(0).toUpperCase() + addonKey.slice(1)}`);
  if (checkbox) {
    if (!sourceEvent || sourceEvent.target !== checkbox) checkbox.checked = !checkbox.checked;
    recalculateTotal();
  }
}

function applyCouponCode() {
  const input = document.getElementById('couponCodeInput');
  const msgEl = document.getElementById('couponStatusMsg');
  if (!input || !msgEl) return;

  const code = input.value.trim().toUpperCase();
  if (!code) {
    msgEl.innerHTML = '<span class="text-danger">Please enter a coupon code.</span>';
    return;
  }

  const match = availableCoupons.find((c) => c.code.toUpperCase() === code);
  if (match) {
    appliedCoupon = match;
    msgEl.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i> Coupon <strong>${match.code}</strong> applied!</span>`;
  } else {
    appliedCoupon = null;
    msgEl.innerHTML = '<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i> Invalid promo code.</span>';
  }

  recalculateTotal();
}

function recalculateTotal() {
  if (!selectedVehicleType) selectedVehicleType = 'mini_truck';
  if (!selectedHouseSize) selectedHouseSize = '1bhk';

  const veh = vehicleConfig[selectedVehicleType] || { name: 'Tata Ace / Mini (1.5 Ton)', basePrice: 2500, perKmRate: 35 };
  let distKm = parseFloat(document.getElementById('distanceKm')?.value || 25);
  if (isNaN(distKm) || distKm <= 0) distKm = 25;

  const perKmRate = veh.perKmRate || ratesConfig.perKmRate || 35;
  const distanceCost = distKm * perKmRate;
  const houseSizeFee = selectedHouseSize ? (ratesConfig.houseSizeRates[selectedHouseSize] || 0) : 0;
  const baseVehicleCost = veh.basePrice || 2500;

  let inventoryCost = 0;
  for (const key in itemQuantities) {
    inventoryCost += (itemQuantities[key] || 0) * (ratesConfig.itemRates[key] || 100);
  }

  const pickupFloor = parseInt(document.getElementById('pickupFloor')?.value || 0);
  const pickupLift = document.getElementById('pickupLift')?.checked ?? true;
  const dropFloor = parseInt(document.getElementById('dropFloor')?.value || 0);
  const dropLift = document.getElementById('dropLift')?.checked ?? true;

  let floorLaborCost = 0;
  if (!pickupLift && pickupFloor > 0) floorLaborCost += pickupFloor * ratesConfig.floorNoLiftRate;
  if (!dropLift && dropFloor > 0) floorLaborCost += dropFloor * ratesConfig.floorNoLiftRate;

  let addonCost = 0;
  const bubbleChecked = document.getElementById('addonBubblePacking')?.checked || document.getElementById('addon_bubblePacking')?.checked;
  const unpackingChecked = document.getElementById('addonUnpacking')?.checked || document.getElementById('addon_unpacking')?.checked;
  const insuranceChecked = document.getElementById('addonInsurance')?.checked || document.getElementById('addon_insurance')?.checked;
  const vehTransChecked = document.getElementById('addonVehicleTransport')?.checked || document.getElementById('addon_vehicleTransport')?.checked;

  if (bubbleChecked) addonCost += ratesConfig.addonRates.bubblePacking || 1500;
  if (unpackingChecked) addonCost += ratesConfig.addonRates.unpacking || 1200;
  if (insuranceChecked) addonCost += ratesConfig.addonRates.insurance || 999;
  if (vehTransChecked) addonCost += ratesConfig.addonRates.vehicleTransport || 2500;

  const subtotal = baseVehicleCost + distanceCost + houseSizeFee + inventoryCost + floorLaborCost + addonCost;

  let discountAmount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.type === 'percent') discountAmount = Math.round((subtotal * appliedCoupon.value) / 100);
    else if (appliedCoupon.type === 'fixed') discountAmount = appliedCoupon.value;
  }

  const finalTotal = Math.max(0, subtotal - discountAmount);

  // Update Summary Card elements in DOM
  const elBase = document.getElementById('priceBase');
  if (elBase) elBase.innerText = `₹${(baseVehicleCost + houseSizeFee).toLocaleString('en-IN')}`;

  const elDist = document.getElementById('priceDistance');
  if (elDist) elDist.innerText = `₹${distanceCost.toLocaleString('en-IN')}`;

  const elItems = document.getElementById('priceItems') || document.getElementById('priceInventory');
  if (elItems) elItems.innerText = `₹${inventoryCost.toLocaleString('en-IN')}`;

  const elFloor = document.getElementById('priceFloor') || document.getElementById('priceLabor');
  if (elFloor) elFloor.innerText = `₹${floorLaborCost.toLocaleString('en-IN')}`;

  const elAddons = document.getElementById('priceAddons');
  if (elAddons) elAddons.innerText = `₹${addonCost.toLocaleString('en-IN')}`;

  const elDiscount = document.getElementById('priceDiscount');
  if (elDiscount) elDiscount.innerText = `-₹${discountAmount.toLocaleString('en-IN')}`;

  const discountWrap = document.getElementById('discountLineWrap') || document.getElementById('couponDiscountRow');
  if (discountWrap) {
    discountWrap.style.display = discountAmount > 0 ? 'flex' : 'none';
  }

  const elTotal = document.getElementById('priceTotal');
  if (elTotal) elTotal.innerText = `₹${finalTotal.toLocaleString('en-IN')}`;

  // Sync Mobile Floating Price Bar
  const elMobileTotal = document.getElementById('mobilePriceTotalDisplay');
  if (elMobileTotal) elMobileTotal.innerText = `₹${finalTotal.toLocaleString('en-IN')}`;

  // Mini summary card badge updates
  const sumVeh = document.getElementById('summaryVehicleName');
  if (sumVeh) sumVeh.innerText = veh.name;

  const sumHouse = document.getElementById('summaryHouseType');
  if (sumHouse) {
    const houseMap = { '1rk': '1 RK Studio', '1bhk': '1 BHK Apartment', '2bhk': '2 BHK Apartment', '3bhk': '3 BHK Apartment', 'villa': '4+ BHK / Villa' };
    sumHouse.innerText = houseMap[selectedHouseSize] || selectedHouseSize;
  }

  const sumDistBadge = document.getElementById('summaryDistanceBadge');
  if (sumDistBadge) sumDistBadge.innerText = `${distKm} KM`;

  const sumDistKm = document.getElementById('summaryDistKm');
  if (sumDistKm) sumDistKm.innerText = distKm;
}

function scrollToQuoteSummary() {
  const summaryEl = document.getElementById('quoteSummaryCard');
  if (summaryEl) {
    summaryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    summaryEl.classList.add('animate-shake');
    setTimeout(() => summaryEl.classList.remove('animate-shake'), 700);
  }
}

function updateSummaryTexts() {
  const pickup = document.getElementById('pickupCity')?.value.trim() || 'Sirsi Road, Jaipur';
  const drop = document.getElementById('dropCity')?.value.trim() || 'Mansarovar, Jaipur';
  const dist = document.getElementById('distanceKm')?.value || 25;
  const date = document.getElementById('shiftingDate')?.value || 'Upcoming';
  const veh = selectedVehicleType ? vehicleConfig[selectedVehicleType] : null;

  if (document.getElementById('sumPickup')) document.getElementById('sumPickup').innerText = pickup;
  if (document.getElementById('sumDrop')) document.getElementById('sumDrop').innerText = drop;
  if (document.getElementById('sumDistance')) document.getElementById('sumDistance').innerText = `${dist} KM`;
  if (document.getElementById('sumDate')) document.getElementById('sumDate').innerText = date;
  if (document.getElementById('sumVehicle')) {
    document.getElementById('sumVehicle').innerText = veh ? veh.name : 'Tata Ace / Mini';
  }

  const houseMap = {
    '1rk': '1 RK Studio',
    '1bhk': '1 BHK Apartment',
    '2bhk': '2 BHK Apartment',
    '3bhk': '3 BHK Apartment',
    'villa': '4+ BHK / Villa'
  };
  if (document.getElementById('sumHouseType')) {
    document.getElementById('sumHouseType').innerText = selectedHouseSize ? (houseMap[selectedHouseSize] || selectedHouseSize) : '1 BHK Moving';
  }
}

function handlePreviewInvoiceClick() {
  previewCurrentInvoice();
}

function handleBookRelocationSubmit() {
  processWhatsAppCheckout(true);
}

/* ==========================================================================
   4. BOOKING SUBMISSION & TELEGRAM DISPATCH
   ========================================================================== */

async function processWhatsAppCheckout(openWhatsApp = true) {
  const custName = document.getElementById('custName')?.value.trim();
  const custPhone = document.getElementById('custPhone')?.value.trim();
  const custEmail = document.getElementById('custEmail')?.value.trim() || null;

  if (!custName || custName.length < 2) {
    alert('⚠️ Please enter your Full Name.');
    document.getElementById('custName')?.focus();
    return;
  }

  const cleanPhone = custPhone ? custPhone.replace(/\D/g, '') : '';
  if (cleanPhone.length < 10) {
    alert('⚠️ Please enter a valid 10-digit WhatsApp Mobile Number.');
    document.getElementById('custPhone')?.focus();
    return;
  }

  if (!isPhoneVerified || verifiedPhoneNumber !== cleanPhone) {
    alert('Please verify this mobile number with OTP before placing the booking.');
    return;
  }

  const pickup = document.getElementById('pickupCity')?.value.trim();
  const drop = document.getElementById('dropCity')?.value.trim();
  const dist = parseFloat(document.getElementById('distanceKm')?.value || 0);
  const date = document.getElementById('shiftingDate')?.value;

  if (!pickup || !drop || !date || dist <= 0) {
    alert('⚠️ Incomplete Details:\nPlease fill Pickup, Drop, Distance, and Moving Date in Step 1 first.');
    return;
  }

  if (!selectedVehicleType || !selectedHouseSize) {
    alert('⚠️ Incomplete Details:\nPlease choose your Transport Vehicle and House Size in Step 2 first.');
    return;
  }

  const pFloor = document.getElementById('pickupFloor')?.value || 0;
  const pLift = document.getElementById('pickupLift')?.checked;
  const dFloor = document.getElementById('dropFloor')?.value || 0;
  const dLift = document.getElementById('dropLift')?.checked;

  const paymentMode = document.querySelector('input[name="paymentMode"]:checked')?.value || 'cash_on_delivery';

  // Add-ons
  const addons = [];
  if (document.getElementById('addon_bubblePacking')?.checked) addons.push('Premium Bubble Packing');
  if (document.getElementById('addon_unpacking')?.checked) addons.push('Unpacking & Assembly');
  if (document.getElementById('addon_insurance')?.checked) addons.push('Transit Risk Insurance');
  if (document.getElementById('addon_vehicleTransport')?.checked) addons.push('Vehicle Transportation');

  const totalRaw = document.getElementById('priceTotal')?.innerText || '₹0';
  const totalAmount = parseFloat(totalRaw.replace(/[^\d.]/g, '')) || 0;
  const veh = vehicleConfig[selectedVehicleType] || { name: 'Custom Fleet' };

  // Build Payload
  const bookingPayload = {
    customer_name: custName,
    customer_phone: cleanPhone,
    customer_email: custEmail,
    pickup_address: pickup,
    pickup_lat: pickupCoords ? pickupCoords[0] : null,
    pickup_lng: pickupCoords ? pickupCoords[1] : null,
    pickup_floor: Number(pFloor),
    pickup_lift: pLift,
    drop_address: drop,
    drop_lat: dropCoords ? dropCoords[0] : null,
    drop_lng: dropCoords ? dropCoords[1] : null,
    drop_floor: Number(dFloor),
    drop_lift: dLift,
    distance_km: dist,
    shifting_date: date,
    service_type: selectedServiceType || 'House Shifting',
    selected_vehicle: veh.name,
    house_type: selectedHouseSize,
    items: { ...itemQuantities },
    addons: addons,
    coupon_applied: appliedCoupon?.code || null,
    total_amount: totalAmount,
    payment_mode: paymentMode,
    phone_verified: true
  };

  let createdBooking = null;

  try {
    const apiRes = await fetch(`${BOOKING_API_URL}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingPayload)
    });

    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok || !data.booking) throw new Error(data.error || 'Booking could not be saved.');
    createdBooking = data.booking;
  } catch (err) {
    alert(`Booking failed: ${err.message}`);
    return;
  }

  const finalBookingId = createdBooking.id;
  const finalBookingData = createdBooking;
  const trackUrl = (() => {
    try {
      const baseUrl = new URL('track.html', window.location.href);
      baseUrl.searchParams.set('id', finalBookingId);
      return baseUrl.toString();
    } catch {
      return `track.html?id=${encodeURIComponent(finalBookingId)}`;
    }
  })();

  try {
    const history = JSON.parse(localStorage.getItem('rudraksha_bookings_history') || '[]');
    history.unshift(finalBookingData);
    localStorage.setItem('rudraksha_bookings_history', JSON.stringify(history.slice(0, 50)));
  } catch {}

  if (openWhatsApp) {
    // Structured Professional WhatsApp Message
    let msg = `🚚 *RUDRAKSHA PACKERS & MOVERS - NEW BOOKING*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🆔 *Booking ID:* \`${finalBookingId}\`\n`;
    msg += `👤 *Customer Name:* ${custName}\n`;
    msg += `📱 *Phone:* +91 ${cleanPhone}\n`;
    if (custEmail) msg += `📧 *Email:* ${custEmail}\n`;
    msg += `📍 *Pickup:* ${pickup}\n`;
    msg += `🏁 *Drop:* ${drop}\n`;
    msg += `📏 *Distance:* ${dist} KM\n`;
    msg += `📅 *Moving Date:* ${date}\n`;
    msg += `🏠 *Move Size:* ${selectedHouseSize ? selectedHouseSize.toUpperCase() : 'STANDARD'}\n`;
    msg += `🚛 *Vehicle:* ${veh.name}\n`;
    msg += `💰 *Total Amount:* ₹${totalAmount.toLocaleString('en-IN')}\n`;
    msg += `💳 *Payment Mode:* ${paymentMode === 'upi_advance' ? 'UPI Advance 10%' : 'Pay on Delivery (0 Advance)'}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Please lock my slot and send driver contact details. Thank you!`;

    // Open WhatsApp in new tab
    const waUrl = `https://wa.me/917296831460?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  }

  // Show Success Popup Modal with Live Tracking & Printable Invoice
  showBookingSuccessModal(finalBookingId, finalBookingData);
}

function showBookingSuccessModal(bookingId, bookingData) {
  currentTrackedBooking = bookingData;
  document.getElementById('successBookingId').innerText = bookingId;

  // 1. WhatsApp Confirmation Link
  const trackUrl = (() => {
    try {
      const baseUrl = new URL('track.html', window.location.href);
      baseUrl.searchParams.set('id', bookingId);
      return baseUrl.toString();
    } catch {
      return `track.html?id=${encodeURIComponent(bookingId)}`;
    }
  })();
  const waMsg = `📦 *RUDRAKSHA PACKERS & MOVERS - BOOKING CONFIRMED* 🚚\n\n` +
    `Dear *${bookingData.customer_name || 'Customer'}*,\n` +
    `Your relocation booking *${bookingId}* is successfully registered!\n\n` +
    `📍 *Pickup:* ${bookingData.pickup_address}\n` +
    `🏁 *Drop:* ${bookingData.drop_address}\n` +
    `📅 *Moving Date:* ${bookingData.shifting_date}\n` +
    `🚛 *Vehicle:* ${bookingData.selected_vehicle || 'Dedicated Truck'}\n` +
    `💰 *Total Amount:* ₹${Number(bookingData.total_amount || 0).toLocaleString('en-IN')}\n\n` +
    `🗺️ *Live GPS Real-Time Track Link:*\n${trackUrl}\n\n` +
    `📞 *24x7 Support:* +91 72968 31460\n` +
    `_Thank you for choosing Rudraksha Packers & Movers!_`;

  const waBtn = document.getElementById('successWhatsAppBtn');
  if (waBtn) {
    const custPhone = String(bookingData.customer_phone || '').replace(/\D/g, '');
    waBtn.href = `https://wa.me/91${custPhone}?text=${encodeURIComponent(waMsg)}`;
  }

  // 2. Track Button
  document.getElementById('successTrackBtn').onclick = () => {
    window.location.href = `track.html?id=${bookingId}`;
  };

  // 3. Invoice Button
  document.getElementById('successInvoiceBtn').onclick = () => {
    renderTaxInvoice(bookingData);
    const invModal = new bootstrap.Modal(document.getElementById('invoiceModal'));
    invModal.show();
  };

  const modal = new bootstrap.Modal(document.getElementById('bookingSuccessModal'));
  modal.show();
}

/* ==========================================================================
   5. LIVE CUSTOMER TRACKING PORTAL
   ========================================================================== */

function openTrackingModal(prefillId = '') {
  const modal = new bootstrap.Modal(document.getElementById('trackingModal'));
  modal.show();

  const input = document.getElementById('trackSearchInput') || document.getElementById('trackBookingIdInput');
  if (input && prefillId) {
    input.value = prefillId;
    searchBookingTracking();
  }
}

function searchBookingTracking() {
  const input = document.getElementById('trackSearchInput') || document.getElementById('trackBookingIdInput');
  const query = input?.value.trim();
  if (!query) {
    const error = document.getElementById('trackSearchError');
    if (error) {
      error.textContent = 'Please enter a booking ID or mobile number.';
      error.style.display = 'block';
    }
    return;
  }
  fetchBookingAndTrack(query);
}

async function trackBookingStatus() {
  searchBookingTracking();
}

function renderTrackingView(b) {
  const container = document.getElementById('trackingResult') || document.getElementById('trackResultsContainer');
  if (container && container.id === 'trackingResult') {
    container.innerHTML = '';
    container.style.display = 'block';
  }

  const statusHierarchy = ['received', 'reviewing', 'confirmed', 'driver_assigned', 'in_transit', 'delivered'];
  const currentIdx = statusHierarchy.indexOf((b.status || 'received').toLowerCase());
  const mappedIdx = currentIdx >= 0 ? currentIdx : 0;

  const statusLabels = {
    'received': 'Order Received',
    'reviewing': 'Under Review',
    'confirmed': 'Slot Confirmed',
    'driver_assigned': 'Driver Assigned',
    'in_transit': 'Goods In Transit',
    'delivered': 'Delivered & Shifted'
  };

  const trackIdEl = document.getElementById('trackModalBookingId') || document.getElementById('trackDisplayId');
  const trackStatusEl = document.getElementById('trackCurrentStatusBadge') || document.getElementById('trackStatusBadge');
  const trackCustNameEl = document.getElementById('trackCustName');

  if (trackIdEl) trackIdEl.innerText = b.id || 'RB-XXXXXX';
  if (trackStatusEl) trackStatusEl.innerText = statusLabels[(b.status || 'received').toLowerCase()] || (b.status || 'received');
  if (trackCustNameEl) trackCustNameEl.innerText = b.customer_name || b.name || 'Customer';

  const routeTextEl = document.getElementById('trackRouteText') || document.getElementById('trackPickupText');
  if (routeTextEl) {
    routeTextEl.innerText = `${b.pickup_address || 'Jaipur'} ➔ ${b.drop_address || 'Delhi'}`;
  }
  const dateTextEl = document.getElementById('trackDateText');
  if (dateTextEl) dateTextEl.innerText = b.shifting_date || 'Upcoming';

  const summaryBookingId = document.getElementById('trackDisplayId');
  if (summaryBookingId) summaryBookingId.innerText = b.id || 'RB-XXXXXX';
  const summaryPickup = document.getElementById('trackPickupText');
  if (summaryPickup) summaryPickup.innerText = b.pickup_address || 'Jaipur';
  const summaryDrop = document.getElementById('trackDropText');
  if (summaryDrop) summaryDrop.innerText = b.drop_address || 'Delhi';
  const summaryDistance = document.getElementById('trackDistanceText');
  if (summaryDistance) summaryDistance.innerText = `${b.distance_km || b.distanceKm || 25} KM`;
  const summaryAmount = document.getElementById('trackAmountText');
  if (summaryAmount) summaryAmount.innerText = `₹${Number(b.total_amount || 0).toLocaleString('en-IN')}`;

  const driverCard = document.getElementById('assignedDriverCard') || document.getElementById('trackDriverCard');
  const driverName = document.getElementById('driverName') || document.getElementById('trackDriverName');
  const driverVehicle = document.getElementById('driverVehicle') || document.getElementById('trackVehicleNo');
  const driverPhone = document.getElementById('driverPhoneCall') || document.getElementById('trackCallDriverBtn');

  if (b.assigned_driver_name) {
    if (driverCard) driverCard.style.display = 'flex';
    if (driverName) driverName.innerText = b.assigned_driver_name;
    if (driverVehicle) driverVehicle.innerText = b.assigned_vehicle_no || 'Tata Ace';
    if (driverPhone) driverPhone.href = `tel:+91${b.assigned_driver_phone || '7296831460'}`;
    const driverPhoneText = document.getElementById('trackDriverPhone');
    if (driverPhoneText) driverPhoneText.innerText = b.assigned_driver_phone || '7296831460';
  } else if (driverCard) {
    driverCard.style.display = 'none';
  }

  const timelineKeys = ['received', 'reviewing', 'confirmed', 'driver_assigned', 'in_transit', 'delivered'];
  timelineKeys.forEach((stepKey, index) => {
    const nodeId = `stepNode_${stepKey}`;
    const node = document.getElementById(nodeId);
    if (node) node.classList.toggle('active', index <= mappedIdx);

    const legacyNode = document.getElementById(`trackStep${index + 1}`);
    if (legacyNode) legacyNode.classList.toggle('active', index <= mappedIdx);
  });

  if (container && container.id === 'trackResultsContainer') {
    container.style.display = 'block';
  }
}

function openInvoiceForTrackedBooking() {
  if (currentTrackedBooking) {
    renderTaxInvoice(currentTrackedBooking);
    const invModal = new bootstrap.Modal(document.getElementById('invoiceModal'));
    invModal.show();
  }
}

function openFeedbackModalFromTracking() {
  if (currentTrackedBooking) {
    document.getElementById('fbBookingId').value = currentTrackedBooking.id;
    document.getElementById('fbCustomerName').value = currentTrackedBooking.customer_name || '';
    const fbModal = new bootstrap.Modal(document.getElementById('feedbackModal'));
    fbModal.show();
  }
}

/* ==========================================================================
   6. TAX INVOICE & ESTIMATE GENERATOR
   ========================================================================== */

function previewCurrentInvoice() {
  const custName = document.getElementById('custName')?.value.trim();
  const custPhone = document.getElementById('custPhone')?.value.trim();
  const custEmail = document.getElementById('custEmail')?.value.trim() || 'customer@example.com';
  const pickup = document.getElementById('pickupCity')?.value.trim();
  const drop = document.getElementById('dropCity')?.value.trim();
  const dist = parseFloat(document.getElementById('distanceKm')?.value || 0);
  const date = document.getElementById('shiftingDate')?.value;

  if (!pickup || !drop || !date || dist <= 0) {
    alert('⚠️ Incomplete Details:\nPlease fill Pickup, Drop, Distance, and Moving Date in Step 1 first.');
    return;
  }

  if (!selectedVehicleType || !selectedHouseSize) {
    alert('⚠️ Incomplete Details:\nPlease select your Transport Vehicle and House Size in Step 2 first.');
    return;
  }

  if (!custName || custName.length < 2) {
    alert('⚠️ Please enter your Full Name in Step 5 before previewing the invoice.');
    document.getElementById('custName')?.focus();
    return;
  }

  const cleanPhone = custPhone ? custPhone.replace(/\D/g, '') : '';
  if (cleanPhone.length < 10) {
    alert('⚠️ Please enter your 10-digit WhatsApp Mobile Number in Step 5 before previewing the invoice.');
    document.getElementById('custPhone')?.focus();
    return;
  }

  const totalVal = parseFloat(document.getElementById('priceTotal')?.innerText.replace(/[^\d.]/g, '')) || 0;

  const mockBooking = {
    id: `EST-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    customer_name: custName,
    customer_phone: cleanPhone,
    customer_email: custEmail,
    pickup_address: pickup,
    drop_address: drop,
    distance_km: dist,
    shifting_date: date,
    total_amount: totalVal
  };

  renderTaxInvoice(mockBooking);
  const invModal = new bootstrap.Modal(document.getElementById('invoiceModal'));
  invModal.show();
}

function renderTaxInvoice(booking) {
  document.getElementById('invBookingId').innerText = booking.id || 'RB-ESTIMATE';
  document.getElementById('invDateToday').innerText = new Date().toLocaleDateString('en-IN');
  document.getElementById('invCustName').innerText = booking.customer_name || booking.name || 'Valued Customer';
  document.getElementById('invCustPhone').innerText = booking.customer_phone || booking.phone || '-';
  document.getElementById('invCustEmail').innerText = booking.customer_email || 'customer@mail.com';
  document.getElementById('invPickup').innerText = booking.pickup_address || booking.pickup || '-';
  document.getElementById('invDrop').innerText = booking.drop_address || booking.drop || '-';
  document.getElementById('invShiftingDate').innerText = booking.shifting_date || booking.date || 'Upcoming';
  document.getElementById('invDistance').innerText = `${booking.distance_km || 25} KM`;
  document.getElementById('invDistanceKmRow').innerText = booking.distance_km || 25;

  // Sync itemized breakdown
  const baseVal = document.getElementById('priceBase')?.innerText || '₹2,500.00';
  const distVal = document.getElementById('priceDistance')?.innerText || '₹875.00';
  const invVal = document.getElementById('priceInventory')?.innerText || '₹1,200.00';
  const laborVal = document.getElementById('priceLabor')?.innerText || '₹0.00';
  const addonsVal = document.getElementById('priceAddons')?.innerText || '₹0.00';

  if (document.getElementById('invBaseCharge')) document.getElementById('invBaseCharge').innerText = baseVal;
  if (document.getElementById('invDistCharge')) document.getElementById('invDistCharge').innerText = distVal;
  if (document.getElementById('invInventoryCharge')) document.getElementById('invInventoryCharge').innerText = invVal;
  if (document.getElementById('invLaborCharge')) document.getElementById('invLaborCharge').innerText = laborVal;
  if (document.getElementById('invAddonsCharge')) document.getElementById('invAddonsCharge').innerText = addonsVal;

  const total = booking.total_amount || parseFloat(document.getElementById('priceTotal')?.innerText.replace(/[^\d.]/g, '')) || 5700;
  document.getElementById('invGrandTotal').innerText = `₹${Number(total).toLocaleString('en-IN')}.00`;
  document.getElementById('invSubtotal').innerText = `₹${Number(total).toLocaleString('en-IN')}.00`;

  const discountRow = document.getElementById('invDiscountRow');
  if (appliedCoupon && discountRow) {
    discountRow.style.display = 'table-row';
    document.getElementById('invCouponCode').innerText = appliedCoupon.code;
    document.getElementById('invDiscountAmount').innerText = document.getElementById('priceDiscount')?.innerText || '- ₹0.00';
  } else if (discountRow) {
    discountRow.style.display = 'none';
  }
}

function printInvoice() {
  window.print();
}

/* ==========================================================================
   7. CUSTOMER FEEDBACK SUBMISSION
   ========================================================================== */

async function submitCustomerFeedback() {
  const bookingId = document.getElementById('fbBookingId').value;
  const name = document.getElementById('fbCustomerName').value;
  const rating = document.getElementById('fbRating').value;
  const review = document.getElementById('fbReview').value;
  const statusMsg = document.getElementById('fbStatusMsg');

  if (statusMsg) statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Submitting review...';

  try {
    const res = await fetch(`${BOOKING_API_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, customer_name: name, rating, review })
    });

    if (!res.ok) throw new Error('Could not submit feedback.');

    if (statusMsg) {
      statusMsg.innerHTML = '<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i> Thank you! Your feedback has been recorded.</span>';
    }

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById('feedbackModal'))?.hide();
    }, 1500);
  } catch (err) {
    if (statusMsg) statusMsg.innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

/* ==========================================================================
   8. BACKEND PERSISTENCE & DATA LOADING
   ========================================================================== */

function applyCSSVariables(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.primaryColor) root.style.setProperty('--primary-color', theme.primaryColor);
  if (theme.secondaryColor) root.style.setProperty('--secondary-color', theme.secondaryColor);
  if (theme.accentColor) root.style.setProperty('--accent-color', theme.accentColor);
}

// Background Video Auto-play booster & Calculator Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadBackendData();

  // Set default shifting date to tomorrow
  const dateInput = document.getElementById('shiftingDate');
  if (dateInput && !dateInput.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }

  // Pre-select default vehicle and house size
  selectVehicleType('mini_truck');
  selectHouseSize('1bhk');

  // Initial calculation and summary sync
  recalculateTotal();
  updateSummaryTexts();

  const heroVideo = document.querySelector('.hero-background-video');
  if (heroVideo) {
    heroVideo.muted = true;
    const playPromise = heroVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy prevented immediate playback
        document.addEventListener('click', () => {
          heroVideo.play().catch(() => {});
        }, { once: true });
      });
    }
  }
});
