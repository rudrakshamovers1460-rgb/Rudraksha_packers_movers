require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./services/supabase');
const telegram = require('./services/telegram');
const otpService = require('./services/otp');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const isProduction = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER || (isProduction ? '' : 'admin');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'local-dev-only-change-me');
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || (isProduction ? '' : 'local-dev-secret-change-me');

if (!isProduction && (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SECRET_KEY)) {
  console.warn('Warning: development admin credentials are active. Set ADMIN_USER, ADMIN_PASSWORD and ADMIN_SECRET_KEY before deployment.');
}

function generateAdminToken() {
  const payload = JSON.stringify({ role: 'admin', time: Date.now() });
  const hmac = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}::${hmac}`).toString('base64');
}

function verifyAdminToken(token) {
  if (!token) return false;
  try {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const decoded = Buffer.from(cleanToken, 'base64').toString('utf8');
    const [payloadStr, hmac] = decoded.split('::');
    if (!payloadStr || !hmac) return false;
    const expectedHmac = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(payloadStr).digest('hex');
    const received = Buffer.from(hmac, 'utf8');
    const expected = Buffer.from(expectedHmac, 'utf8');
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    const payload = JSON.parse(payloadStr);
    if (payload.role !== 'admin' || !Number.isFinite(payload.time) || payload.time > Date.now()) return false;
    // Token valid for 7 days
    if (Date.now() - payload.time > 7 * 24 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASSWORD || !ADMIN_SECRET_KEY || !verifyAdminToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'rudraksha-packers-api',
    supabaseActive: db.isSupabaseActive(),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    otpMode: process.env.OTP_MODE || 'dev',
    time: new Date().toISOString()
  });
});

/* ==========================================================================
   ADMIN AUTHENTICATION ENDPOINTS
   ========================================================================== */
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    if (!ADMIN_USER || !ADMIN_PASSWORD || !ADMIN_SECRET_KEY) {
      return res.status(503).json({ error: 'Admin credentials are not configured on the server.' });
    }

    const isUserValid = username && username.trim().toLowerCase() === ADMIN_USER.toLowerCase();
    const isPassValid = password.trim() === ADMIN_PASSWORD;

    if (!isUserValid || !isPassValid) {
      return res.status(401).json({ error: 'Invalid admin username or password.' });
    }

    const token = generateAdminToken();
    res.json({
      success: true,
      token,
      user: { name: 'Owner / Administrator', role: 'owner' },
      message: 'Authentication successful.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !verifyAdminToken(authHeader)) {
    return res.status(401).json({ valid: false, error: 'Unauthorized or session expired.' });
  }
  res.json({ valid: true, message: 'Admin session is active.' });
});

/* ==========================================================================
   RIDER APPLICATION ENDPOINTS
   ========================================================================== */
app.get('/api/rider-applications', requireAdmin, async (req, res, next) => {
  try {
    const applications = await db.getRiderApplications();
    res.json({ applications });
  } catch (err) {
    next(err);
  }
});

app.post('/api/rider-applications', async (req, res, next) => {
  try {
    const { name, phone, city, shift, vehType, vehNum, dlNum } = req.body;
    const cleanPhone = String(phone || '').replace(/\D/g, '');

    if (!name || !city || !cleanPhone || cleanPhone.length !== 10 || !vehNum || !dlNum) {
      return res.status(400).json({ error: 'Please fill all required rider partner details.' });
    }

    const existingApps = await db.getRiderApplications();
    const duplicate = existingApps.find(app => String(app.phone || '').replace(/\D/g, '') === cleanPhone);
    if (duplicate) {
      return res.status(409).json({
        error: 'This mobile number already has a rider application on file.',
        application: duplicate,
        message: `Application already submitted for +91 ${cleanPhone}.`
      });
    }

    const application = await db.createRiderApplication({
      id: `app-${Date.now()}`,
      name: String(name).trim(),
      phone: cleanPhone,
      city: String(city).trim(),
      shift: shift || 'Full Time (8-10 Hours)',
      vehType: vehType || 'Bike / Scooter',
      vehNum: String(vehNum).trim(),
      dlNum: String(dlNum).trim(),
      status: 'Pending',
      date: new Date().toISOString(),
      created_at: new Date().toISOString()
    });

    res.status(201).json({ success: true, application, message: 'Rider application submitted successfully.' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/rider-applications/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const { pin } = req.body;
    const applications = await db.getRiderApplications();
    const app = applications.find(item => item.id === req.params.id);

    if (!app) {
      return res.status(404).json({ error: 'Rider application not found.' });
    }

    const driverId = app.driverId || `RDR-${String(app.phone).slice(-4)}`;
    const driverPin = pin || app.pin || String(Math.floor(1000 + Math.random() * 9000));
    const phoneClean = String(app.phone || '').replace(/\D/g, '');

    const existingDrivers = await db.getDrivers();
    const matchedDriver = existingDrivers.find(d => String(d.phone || '').replace(/\D/g, '') === phoneClean);

    const driverPayload = {
      id: matchedDriver?.id || driverId,
      driver_name: app.name,
      phone: phoneClean,
      vehicle_number: app.vehNum || app.vehicle_number || '',
      vehicle_type: app.vehType || app.vehicle_type || 'Bike / Scooter',
      status: 'available',
      rating: matchedDriver?.rating || 4.8,
      pin: driverPin,
      onDuty: true,
      approved_at: new Date().toISOString(),
      created_at: matchedDriver?.created_at || new Date().toISOString()
    };

    if (matchedDriver) {
      await db.updateDriver(matchedDriver.id, driverPayload);
    } else {
      await db.createDriver(driverPayload);
    }

    const updatedApp = await db.updateRiderApplication(app.id, {
      status: 'Approved',
      driverId,
      pin: driverPin,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    res.json({ success: true, application: updatedApp, driver: driverPayload, message: 'Rider approved successfully.' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/rider-applications/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const applications = await db.getRiderApplications();
    const app = applications.find(item => item.id === req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Rider application not found.' });
    }
    const updated = await db.updateRiderApplication(app.id, {
      status: 'Rejected',
      updated_at: new Date().toISOString()
    });
    res.json({ success: true, application: updated, message: 'Rider application rejected.' });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
   OTP ENDPOINTS
   ========================================================================== */
app.post('/api/otp/send', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }
    const result = await otpService.sendOTP(phone);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/otp/verify', (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required.' });
    }
    const result = otpService.verifyOTP(phone, otp);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   BOOKINGS ENDPOINTS
   ========================================================================== */

// 1. Get all bookings (Admin)
app.get('/api/bookings', requireAdmin, async (req, res, next) => {
  try {
    const bookings = await db.getBookings();
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
});

// 2. Track Booking (Customer)
app.get('/api/bookings/track/:idOrPhone', async (req, res, next) => {
  try {
    const booking = await db.getBookingByIdOrPhone(req.params.idOrPhone);
    if (!booking) {
      return res.status(404).json({ error: 'No active booking found matching your ID or Phone number.' });
    }
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

// 3. Create Booking
app.post('/api/bookings', async (req, res, next) => {
  try {
    const body = req.body;
    const name = body.customer_name || body.name;
    const phone = String(body.customer_phone || body.phone || '').replace(/\D/g, '');
    const pickup = body.pickup_address || body.pickup;
    const drop = body.drop_address || body.drop;
    const date = body.shifting_date || body.date;

    if (!name || !phone || phone.length !== 10 || !pickup || !drop || !date) {
      return res.status(400).json({ error: 'Please provide name, phone, pickup, drop and shifting date.' });
    }

    if (body.phone_verified !== true) {
      return res.status(400).json({ error: 'Phone verification is required before booking.' });
    }

    const bookingId = `RB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Normalize amount
    let totalAmt = 0;
    if (body.total_amount !== undefined) totalAmt = Number(body.total_amount);
    else if (body.estimatedTotal) totalAmt = Number(String(body.estimatedTotal).replace(/[^\d.]/g, '')) || 0;

    if (!Number.isFinite(totalAmt) || totalAmt < 0) {
      return res.status(400).json({ error: 'Total amount must be a valid non-negative number.' });
    }

    const bookingPayload = {
      id: bookingId,
      customer_name: name,
      customer_phone: phone,
      customer_email: body.customer_email || body.email || null,
      
      pickup_address: pickup,
      pickup_lat: body.pickup_lat || null,
      pickup_lng: body.pickup_lng || null,
      pickup_floor: body.pickup_floor || body.floors?.pickup?.number || 0,
      pickup_lift: body.pickup_lift ?? (body.floors?.pickup?.lift ?? false),
      
      drop_address: drop,
      drop_lat: body.drop_lat || null,
      drop_lng: body.drop_lng || null,
      drop_floor: body.drop_floor || body.floors?.drop?.number || 0,
      drop_lift: body.drop_lift ?? (body.floors?.drop?.lift ?? false),
      
      distance_km: Number(body.distance_km || body.distanceKm || 25),
      shifting_date: date,
      service_type: body.service_type || 'House Shifting',
      selected_vehicle: body.selected_vehicle || 'Tata Ace / Mini (1.5 Ton)',
      house_type: body.house_type || body.houseType || '1bhk',
      items: body.items || {},
      addons: body.addons || [],
      coupon_applied: body.coupon_applied || body.coupon || null,
      
      base_price: Number(body.base_price || 3500),
      distance_charge: Number(body.distance_charge || 0),
      labor_charge: Number(body.labor_charge || 0),
      addons_charge: Number(body.addons_charge || 0),
      discount_amount: Number(body.discount_amount || 0),
      total_amount: totalAmt,
      payment_status: body.payment_status || 'pending',
      payment_mode: body.payment_mode || 'cash_on_delivery',
      
      status: 'received',
      phone_verified: Boolean(body.phone_verified),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const savedBooking = await db.createBooking(bookingPayload);

    // Send Real-time Telegram Alert to Owner (Non-blocking)
    telegram.sendTelegramMessage(telegram.formatNewBookingAlert(savedBooking)).catch(console.error);

    res.status(201).json({ booking: savedBooking });
  } catch (err) {
    next(err);
  }
});

// 4. Update Booking Status
app.patch('/api/bookings/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const allowed = ['received', 'reviewing', 'confirmed', 'driver_assigned', 'in_transit', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const updated = await db.updateBookingStatus(req.params.id, status, notes);
    if (!updated) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Telegram status alert
    telegram.sendTelegramMessage(telegram.formatStatusUpdateAlert(updated, 'Current', status)).catch(console.error);

    res.json({ booking: updated });
  } catch (err) {
    next(err);
  }
});

// 5. Assign Driver & Vehicle
app.post('/api/bookings/:id/assign', requireAdmin, async (req, res, next) => {
  try {
    const { driver_id, driver_name, driver_phone, vehicle_number } = req.body;
    if (!driver_name || !driver_phone || !vehicle_number) {
      return res.status(400).json({ error: 'Driver name, phone and vehicle number are required.' });
    }

    const updated = await db.assignDriverToBooking(req.params.id, {
      driver_id,
      driver_name,
      driver_phone,
      vehicle_number
    });

    if (!updated) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Telegram Alert for Driver Assignment
    const alertMsg = `🚚 *DRIVER ASSIGNED TO BOOKING*\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `🆔 *Booking ID:* \`${updated.id}\`\n` +
                     `👤 *Customer:* ${updated.customer_name}\n` +
                     `👨‍✈️ *Driver:* ${driver_name} (+91 ${driver_phone})\n` +
                     `🚛 *Vehicle:* ${vehicle_number}\n` +
                     `🔄 *Status:* DRIVER ASSIGNED\n` +
                     `━━━━━━━━━━━━━━━━━━━━`;
    telegram.sendTelegramMessage(alertMsg).catch(console.error);

    res.json({ booking: updated });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
   PARCEL DELIVERY ENDPOINTS (Porter-Style Logistics)
   ========================================================================== */

// 1. Get Parcel Rates Configuration
app.get('/api/parcels/rates', async (req, res, next) => {
  try {
    const config = await db.getConfig();
    res.json({ parcelRates: config.parcelRates || {} });
  } catch (err) {
    next(err);
  }
});

// 2. Get All Parcels (Admin)
app.get('/api/parcels', requireAdmin, async (req, res, next) => {
  try {
    const parcels = await db.getParcels();
    const { status, search } = req.query;
    let filtered = parcels;
    if (status && status !== 'all') {
      filtered = filtered.filter(p => (p.booking_status || p.status) === status);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(p =>
        p.parcel_id?.toLowerCase().includes(q) ||
        p.sender_name?.toLowerCase().includes(q) ||
        p.receiver_name?.toLowerCase().includes(q) ||
        p.sender_phone?.includes(q) ||
        p.receiver_phone?.includes(q)
      );
    }
    res.json({ parcels: filtered });
  } catch (err) {
    next(err);
  }
});

// 3. Track Parcel by ID or Phone (Public)
app.get('/api/parcels/track/:idOrPhone', async (req, res, next) => {
  try {
    const parcel = await db.getParcelByIdOrPhone(req.params.idOrPhone);
    if (!parcel) {
      return res.status(404).json({ error: 'No active parcel found matching this ID or Phone number.' });
    }
    res.json({ parcel });
  } catch (err) {
    next(err);
  }
});

// 4. Create Parcel Booking
app.post('/api/parcels', async (req, res, next) => {
  try {
    const body = req.body;
    const senderName = body.sender_name || body.senderName;
    const senderPhone = String(body.sender_phone || body.senderPhone || '').replace(/\D/g, '');
    const receiverName = body.receiver_name || body.receiverName;
    const receiverPhone = String(body.receiver_phone || body.receiverPhone || '').replace(/\D/g, '');
    const pickupAddress = body.pickup_address || body.pickupAddress;
    const dropAddress = body.drop_address || body.dropAddress;

    if (!senderName || senderPhone.length !== 10 || !receiverName || receiverPhone.length !== 10 || !pickupAddress || !dropAddress) {
      return res.status(400).json({ error: 'Please provide sender name & phone, receiver name & phone, and pickup & drop addresses.' });
    }

    const parcelId = `RP-PCL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const pickupOtp = String(Math.floor(1000 + Math.random() * 9000));
    const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));

    const parcelPayload = {
      id: parcelId,
      parcel_id: parcelId,
      sender_name: senderName,
      sender_phone: senderPhone,
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      pickup_address: pickupAddress,
      pickup_lat: body.pickup_lat || null,
      pickup_lng: body.pickup_lng || null,
      drop_address: dropAddress,
      drop_lat: body.drop_lat || null,
      drop_lng: body.drop_lng || null,
      distance_km: Number(body.distance_km || body.distance || 5),
      estimated_time: body.estimated_time || '35-45 min',
      
      parcel_type: body.parcel_type || 'Package',
      weight_category: body.weight_category || body.weight || '1_5kg',
      package_size: body.package_size || 'Small',
      dimensions: body.dimensions || { length: 0, width: 0, height: 0 },
      vehicle_type: body.vehicle_type || 'bike',
      
      base_fare: Number(body.base_fare || 40),
      distance_fare: Number(body.distance_fare || 25),
      weight_fare: Number(body.weight_fare || 15),
      vehicle_fare: Number(body.vehicle_fare || 0),
      handling_fee: Number(body.handling_fee || 10),
      addons_fee: Number(body.addons_fee || 0),
      addons: body.addons || [],
      discount: Number(body.discount || 0),
      tax: Number(body.tax || 18),
      total_amount: Number(body.total_amount || 108),
      
      payment_method: body.payment_method || 'pay_at_pickup',
      payment_status: body.payment_status || 'pending',
      booking_status: 'searching_driver',
      status: 'searching_driver',
      
      driver_id: null,
      assigned_driver_name: null,
      assigned_driver_phone: null,
      assigned_vehicle_no: null,
      assigned_vehicle_type: null,
      
      pickup_otp: pickupOtp,
      pickup_otp_verified: false,
      delivery_otp: deliveryOtp,
      delivery_otp_verified: false,
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const savedParcel = await db.createParcel(parcelPayload);

    // Send Telegram alert
    const alertMsg = `📦 *NEW PARCEL DELIVERY ORDER* 🛵\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `🆔 *Parcel ID:* \`${savedParcel.parcel_id}\`\n` +
                     `👤 *Sender:* ${savedParcel.sender_name} (+91 ${savedParcel.sender_phone})\n` +
                     `🎯 *Receiver:* ${savedParcel.receiver_name} (+91 ${savedParcel.receiver_phone})\n` +
                     `📍 *From:* ${savedParcel.pickup_address}\n` +
                     `🏁 *To:* ${savedParcel.drop_address}\n` +
                     `⚖️ *Parcel:* ${savedParcel.parcel_type} (${savedParcel.weight_category})\n` +
                     `🛵 *Vehicle:* ${savedParcel.vehicle_type.toUpperCase()}\n` +
                     `💰 *Fare:* ₹${savedParcel.total_amount}\n` +
                     `🔑 *Pickup OTP:* ${savedParcel.pickup_otp} | *Delivery OTP:* ${savedParcel.delivery_otp}\n` +
                     `━━━━━━━━━━━━━━━━━━━━`;
    telegram.sendTelegramMessage(alertMsg).catch(console.error);

    res.status(201).json({ parcel: savedParcel });
  } catch (err) {
    next(err);
  }
});

// 5. Assign Driver to Parcel
app.post('/api/parcels/:id/assign', requireAdmin, async (req, res, next) => {
  try {
    const { driver_id, driver_name, driver_phone, vehicle_number, vehicle_type } = req.body;
    if (!driver_name || !driver_phone) {
      return res.status(400).json({ error: 'Please provide driver name and phone.' });
    }

    const updated = await db.assignParcelDriver(req.params.id, {
      driver_id,
      driver_name,
      driver_phone,
      vehicle_number,
      vehicle_type
    });

    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json({ parcel: updated });
  } catch (err) {
    next(err);
  }
});

// 6. Update Parcel Status
app.patch('/api/parcels/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status, notes, updated_by } = req.body;
    const allowed = ['searching_driver', 'driver_assigned', 'reached_pickup', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const updated = await db.updateParcelStatus(req.params.id, status, updated_by || 'admin', notes || '');
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json({ parcel: updated });
  } catch (err) {
    next(err);
  }
});

// 7. Verify Pickup OTP (Driver reaches sender)
app.post('/api/parcels/:id/verify-pickup-otp', requireAdmin, async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP is required' });
    const updated = await db.verifyParcelOtp(req.params.id, 'pickup', otp);
    res.json({ success: true, parcel: updated, message: 'Pickup OTP verified! Parcel marked as Picked Up.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Verify Delivery OTP (Driver reaches receiver)
app.post('/api/parcels/:id/verify-delivery-otp', requireAdmin, async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP is required' });
    const updated = await db.verifyParcelOtp(req.params.id, 'delivery', otp);
    res.json({ success: true, parcel: updated, message: 'Delivery OTP verified! Parcel marked as Delivered.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================================================
   DRIVERS & FLEET ENDPOINTS
   ========================================================================== */
app.get('/api/drivers/public', async (req, res, next) => {
  try {
    const drivers = await db.getDrivers();
    res.json({ drivers });
  } catch (err) {
    next(err);
  }
});

app.get('/api/drivers', requireAdmin, async (req, res, next) => {
  try {
    const drivers = await db.getDrivers();
    res.json({ drivers });
  } catch (err) {
    next(err);
  }
});

app.get('/api/drivers/lookup/:phone', async (req, res, next) => {
  try {
    const phoneClean = String(req.params.phone || '').replace(/\D/g, '');
    const drivers = await db.getDrivers();
    const driver = drivers.find(item => String(item.phone || '').replace(/\D/g, '') === phoneClean);
    if (!driver) {
      return res.status(404).json({ error: 'No approved driver found for this phone number.' });
    }
    res.json({ driver });
  } catch (err) {
    next(err);
  }
});

app.post('/api/drivers', requireAdmin, async (req, res, next) => {
  try {
    const { driver_name, phone, vehicle_number, vehicle_type } = req.body;
    if (!driver_name || !phone || !vehicle_number) {
      return res.status(400).json({ error: 'Driver name, phone and vehicle number are required.' });
    }
    const created = await db.createDriver({
      driver_name,
      phone: String(phone).replace(/\D/g, ''),
      vehicle_number,
      vehicle_type: vehicle_type || 'Tata Ace / Pickup',
      status: 'available',
      rating: 4.8
    });
    res.status(201).json({ driver: created });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
   FEEDBACK ENDPOINTS
   ========================================================================== */
app.post('/api/feedback', async (req, res, next) => {
  try {
    const { booking_id, customer_name, rating, review } = req.body;
    const numericRating = Number(rating);
    if (!booking_id || !customer_name || !Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating (1-5) is required.' });
    }
    const saved = await db.addFeedback({ booking_id, customer_name, rating: numericRating, review: String(review || '').slice(0, 2000) });
    res.status(201).json({ feedback: saved });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
   CONFIG & FULL CONTROL ENDPOINTS (Rates, Fleet, Coupons, Branding, Theme)
   ========================================================================== */

// 1. Get entire live website configuration
app.get('/api/config', async (req, res, next) => {
  try {
    const config = await db.getConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// 2. Save / Update entire live website configuration
app.post('/api/config', requireAdmin, async (req, res, next) => {
  try {
    const updated = await db.saveConfig(req.body);
    res.json({ success: true, config: updated, message: 'Configuration saved and synced successfully.' });
  } catch (err) {
    next(err);
  }
});

// 3. Add or Update Vehicle in Fleet
app.post('/api/admin/vehicles', requireAdmin, async (req, res, next) => {
  try {
    const { vehicle_key, name, basePrice, perKmRate, icon, cap } = req.body;
    if (!vehicle_key || !name || !basePrice || !perKmRate) {
      return res.status(400).json({ error: 'Vehicle key, name, basePrice, and perKmRate are required.' });
    }

    const currentConfig = await db.getConfig();
    const cleanKey = vehicle_key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    currentConfig.vehicles[cleanKey] = {
      name,
      basePrice: Number(basePrice),
      perKmRate: Number(perKmRate),
      icon: icon || 'fa-truck',
      cap: cap || 'Custom Vehicle'
    };

    const saved = await db.saveConfig(currentConfig);
    res.status(201).json({ success: true, vehicle: currentConfig.vehicles[cleanKey], config: saved });
  } catch (err) {
    next(err);
  }
});

// 4. Delete Vehicle from Fleet
app.delete('/api/admin/vehicles/:key', requireAdmin, async (req, res, next) => {
  try {
    const key = req.params.key;
    const currentConfig = await db.getConfig();

    if (!currentConfig.vehicles[key]) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    delete currentConfig.vehicles[key];
    const saved = await db.saveConfig(currentConfig);
    res.json({ success: true, message: `Vehicle ${key} deleted successfully.`, config: saved });
  } catch (err) {
    next(err);
  }
});

// 5. Add Coupon
app.post('/api/admin/coupons', requireAdmin, async (req, res, next) => {
  try {
    const { code, type, value, description } = req.body;
    if (!code || !type || value === undefined) {
      return res.status(400).json({ error: 'Coupon code, type (percent/fixed), and value are required.' });
    }

    const cleanCode = code.toUpperCase().trim();
    const currentConfig = await db.getConfig();
    
    // Remove if existing
    currentConfig.coupons = (currentConfig.coupons || []).filter(c => c.code !== cleanCode);
    
    currentConfig.coupons.push({
      code: cleanCode,
      type: type === 'percent' ? 'percent' : 'fixed',
      value: Number(value),
      description: description || `${type === 'percent' ? value + '%' : '₹' + value} Discount`
    });

    const saved = await db.saveConfig(currentConfig);
    res.status(201).json({ success: true, coupon: currentConfig.coupons[currentConfig.coupons.length - 1], config: saved });
  } catch (err) {
    next(err);
  }
});

// 6. Delete Coupon
app.delete('/api/admin/coupons/:code', requireAdmin, async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const currentConfig = await db.getConfig();
    currentConfig.coupons = (currentConfig.coupons || []).filter(c => c.code !== code);
    const saved = await db.saveConfig(currentConfig);
    res.json({ success: true, message: `Coupon ${code} removed.`, config: saved });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
   ERROR HANDLER & SERVER LISTEN
   ========================================================================== */
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(port, () => {
  console.log(`\n🚀 Rudraksha Packers Enterprise API running at http://localhost:${port}`);
  console.log(`📦 Supabase Status: ${db.isSupabaseActive() ? 'Connected 🟢' : 'Offline JSON fallback 🟡'}`);
  console.log(`📱 OTP Mode: ${process.env.OTP_MODE || 'dev'}\n`);
});
