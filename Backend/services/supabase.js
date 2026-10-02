const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase Client Connected Successfully.');
} else {
  console.log('ℹ️ Supabase credentials not provided. Using Local JSON Fallback mode.');
}

const dataDir = path.join(__dirname, '..', 'data');
const bookingsFile = path.join(dataDir, 'bookings.json');
const parcelsFile = path.join(dataDir, 'parcels.json');
const driversFile = path.join(dataDir, 'drivers.json');
const riderApplicationsFile = path.join(dataDir, 'rider_applications.json');
const feedbackFile = path.join(dataDir, 'feedback.json');
const configFile = path.join(dataDir, 'config.json');
const payoutRequestsFile = path.join(dataDir, 'payout_requests.json');

async function readLocal(file, defaultData = []) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeLocal(file, defaultData);
      return defaultData;
    }
    return defaultData;
  }
}

async function writeLocal(file, data) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Initial Sample Drivers for local mode (empty by default - only real approved drivers)
const defaultDrivers = [];

const defaultRiderApplications = [];

const defaultConfig = {
  rates: {
    baseRate: 2200,
    perKmRate: 25,
    floorNoLiftRate: 250,
    houseSizeRates: {
      '1rk': 0,
      '1bhk': 800,
      '2bhk': 2300,
      '3bhk': 4000,
      'villa': 7300
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
  },
  vehicles: {
    'mini_truck': { name: 'Tata Ace (Chota Hathi 750kg)', basePrice: 2200, perKmRate: 25, icon: 'fa-truck-pickup', cap: '1 BHK / Partial Household' },
    'tempo_14ft': { name: 'Canter 14ft / Tempo (3.5 Ton)', basePrice: 3500, perKmRate: 30, icon: 'fa-truck', cap: 'Ideal for 2-3 BHK Shifting' },
    'truck_19ft': { name: 'Tata 407 / 19ft Container (7 Ton)', basePrice: 5500, perKmRate: 50, icon: 'fa-truck-moving', cap: '3+ BHK / Industrial Moving' },
    'bike': { name: 'Bike Carrier (Up to 150cc)', basePrice: 2500, perKmRate: 15, icon: 'fa-motorcycle', cap: 'Two-Wheeler Dedicated Carrier' },
    'car': { name: 'Closed Car Carrier Trailer', basePrice: 6000, perKmRate: 25, icon: 'fa-car-side', cap: 'Hydraulic Closed Car Carrier' }
  },
  coupons: [
    { code: 'FIRST500', type: 'fixed', value: 500, description: '₹500 flat off on first relocation' },
    { code: 'RELOCATE10', type: 'percent', value: 10, description: '10% discount on house shifting' },
    { code: 'FESTIVE15', type: 'percent', value: 15, description: '15% festive seasonal off' }
  ],
  company: {
    name: 'Rudraksha Packers & Movers',
    phone: '7296831460',
    whatsapp: '7296831460',
    email: 'support@rudrakshapackers.com',
    address: 'Near SNM Hospital, Gandhipath (West), Jaipur, RJ',
    gstin: '08AAACR1234F1Z5'
  },
  parcelRates: {
    bike: { name: 'Bike Express', baseFare: 48, perKmRate: 10, baseKm: 1, maxWeightKg: 20, icon: 'fa-motorcycle', desc: 'Up to 20 KG • Docs & Small Parcels' },
    auto: { name: 'Auto / 3-Wheeler', baseFare: 135, perKmRate: 14, baseKm: 2, maxWeightKg: 500, icon: 'fa-truck-front', desc: 'Up to 500 KG • Wholesale & 1 RK' },
    mini_truck: { name: 'Tata Ace (Chota Hathi)', baseFare: 220, perKmRate: 25, baseKm: 3, maxWeightKg: 750, icon: 'fa-truck-pickup', desc: 'Up to 750 KG • Heavy Relocation' },
    weightSurcharges: {
      'upto_1kg': 0,
      '1_5kg': 20,
      '5_10kg': 30,
      '10_20kg': 60,
      '20_50kg': 120,
      '50kg_plus': 250
    },
    addons: {
      fragile: 25,
      packaging: 40,
      insurance: 49,
      express: 50
    },
    handlingFee: 10,
    gstPercent: 18
  },
  theme: {
    primaryColor: '#f97316',
    secondaryColor: '#1e293b',
    accentColor: '#06b6d4'
  }
};

function generateRandom4DigitPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getOrGenerateBookingPins(b) {
  const notesPickup = b.notes && b.notes.match(/PICKUP_PIN:(\d{4})/)?.[1];
  const notesDelivery = b.notes && b.notes.match(/DELIVERY_PIN:(\d{4})/)?.[1];

  let p = b.pickup_otp || notesPickup;
  let d = b.delivery_otp || notesDelivery;

  if (!p || p === '3821') {
    p = generateRandom4DigitPin();
  }
  if (!d || d === '7192' || d === p) {
    do {
      d = generateRandom4DigitPin();
    } while (d === p);
  }
  return { pickup_otp: p, delivery_otp: d };
}

function sanitizeForSupabaseBooking(data) {
  if (!data || typeof data !== 'object') return data;
  const { pickup_otp, delivery_otp, pickup_otp_verified, delivery_otp_verified, ...safe } = data;
  return safe;
}

module.exports = {
  isSupabaseActive: () => Boolean(supabase),

  // BOOKINGS
  async getBookings() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          return data.map(b => {
            const pins = getOrGenerateBookingPins(b);
            return {
              ...b,
              pickup_otp: pins.pickup_otp,
              delivery_otp: pins.delivery_otp,
              pickup_otp_verified: Boolean(b.pickup_otp_verified || ['in_transit', 'delivered', 'completed'].includes(String(b.status).toLowerCase())),
              delivery_otp_verified: Boolean(b.delivery_otp_verified || ['delivered', 'completed'].includes(String(b.status).toLowerCase()))
            };
          });
        }
        console.warn('Supabase bookings read fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase bookings read fallback to local:', err.message);
      }
    }
    const local = await readLocal(bookingsFile, []);
    return local.map(b => {
      const pins = getOrGenerateBookingPins(b);
      return {
        ...b,
        pickup_otp: pins.pickup_otp,
        delivery_otp: pins.delivery_otp,
        pickup_otp_verified: Boolean(b.pickup_otp_verified || ['in_transit', 'delivered', 'completed'].includes(String(b.status).toLowerCase())),
        delivery_otp_verified: Boolean(b.delivery_otp_verified || ['delivered', 'completed'].includes(String(b.status).toLowerCase()))
      };
    });
  },

  async getBookingByIdOrPhone(identifier) {
    const cleanId = String(identifier).trim();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*, drivers(*)')
          .or(`id.eq.${cleanId},customer_phone.eq.${cleanId}`)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!error && data && data.length > 0) {
          const b = data[0];
          const pins = getOrGenerateBookingPins(b);
          b.pickup_otp = pins.pickup_otp;
          b.delivery_otp = pins.delivery_otp;
          b.pickup_otp_verified = Boolean(b.pickup_otp_verified || ['in_transit', 'delivered', 'completed'].includes(String(b.status).toLowerCase()));
          b.delivery_otp_verified = Boolean(b.delivery_otp_verified || ['delivered', 'completed'].includes(String(b.status).toLowerCase()));
          return b;
        }
        if (error) console.warn('Supabase booking lookup fallback to local:', error.message);
      } catch (err) {
        console.warn('Supabase booking lookup fallback to local:', err.message);
      }
    }

    const bookings = await readLocal(bookingsFile, []);
    const phoneClean = cleanId.replace(/\D/g, '');
    const found = bookings.find(b => 
      b.id?.toLowerCase() === cleanId.toLowerCase() || 
      (phoneClean && b.customer_phone?.replace(/\D/g, '') === phoneClean)
    );
    if (found) {
      const pins = getOrGenerateBookingPins(found);
      found.pickup_otp = pins.pickup_otp;
      found.delivery_otp = pins.delivery_otp;
      found.pickup_otp_verified = Boolean(found.pickup_otp_verified || ['in_transit', 'delivered', 'completed'].includes(String(found.status).toLowerCase()));
      found.delivery_otp_verified = Boolean(found.delivery_otp_verified || ['delivered', 'completed'].includes(String(found.status).toLowerCase()));
    }
    return found || null;
  },

  async createBooking(bookingData) {
    const pickupOtp = bookingData.pickup_otp || String(Math.floor(1000 + Math.random() * 9000));
    const deliveryOtp = bookingData.delivery_otp || String(Math.floor(1000 + Math.random() * 9000));
    bookingData.pickup_otp = pickupOtp;
    bookingData.delivery_otp = deliveryOtp;
    bookingData.pickup_otp_verified = false;
    bookingData.delivery_otp_verified = false;
    bookingData.notes = bookingData.notes ? `${bookingData.notes} | PICKUP_PIN:${pickupOtp} | DELIVERY_PIN:${deliveryOtp}` : `PICKUP_PIN:${pickupOtp} | DELIVERY_PIN:${deliveryOtp}`;

    if (supabase) {
      try {
        const dbData = sanitizeForSupabaseBooking(bookingData);
        const { data, error } = await supabase.from('bookings').insert([dbData]).select().single();
        if (!error && data) {
          data.pickup_otp = pickupOtp;
          data.delivery_otp = deliveryOtp;
          data.pickup_otp_verified = false;
          data.delivery_otp_verified = false;
          return data;
        }
        if (error) console.error('Supabase booking insert error:', error.message);
      } catch (err) {
        console.warn('Supabase booking insert fallback to local:', err.message);
      }
    }

    const bookings = await readLocal(bookingsFile, []);
    bookings.unshift(bookingData);
    await writeLocal(bookingsFile, bookings);
    return bookingData;
  },

  async deleteBooking(id) {
    if (supabase) {
      try {
        await supabase.from('bookings').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase delete booking error:', err.message);
      }
    }
    const bookings = await readLocal(bookingsFile, []);
    const filtered = bookings.filter(b => b.id !== id);
    await writeLocal(bookingsFile, filtered);
    return true;
  },

  async clearAllBookings() {
    if (supabase) {
      try {
        await supabase.from('bookings').delete().neq('id', 'NONE');
      } catch (err) {
        console.warn('Supabase clear bookings error:', err.message);
      }
    }
    await writeLocal(bookingsFile, []);
    return true;
  },

  async updateBookingStatus(id, status, notes = '') {
    if (supabase) {
      const updatePayload = { status, updated_at: new Date().toISOString() };
      if (notes) updatePayload.notes = notes;
      const { data, error } = await supabase.from('bookings').update(updatePayload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const bookings = await readLocal(bookingsFile, []);
    const index = bookings.findIndex(b => b.id === id);
    if (index === -1) return null;
    bookings[index].status = status;
    if (notes) bookings[index].notes = notes;
    bookings[index].updated_at = new Date().toISOString();
    await writeLocal(bookingsFile, bookings);
    return bookings[index];
  },

  async assignDriverToBooking(id, driverInfo) {
    const existing = await this.getBookingByIdOrPhone(id);
    const pickupOtp = driverInfo.pickup_otp || existing?.pickup_otp || String(Math.floor(1000 + Math.random() * 9000));
    const deliveryOtp = driverInfo.delivery_otp || existing?.delivery_otp || String(Math.floor(1000 + Math.random() * 9000));

    const updatePayload = {
      assigned_driver_name: driverInfo.driver_name,
      assigned_driver_phone: driverInfo.driver_phone,
      assigned_vehicle_no: driverInfo.vehicle_number,
      pickup_otp: pickupOtp,
      delivery_otp: deliveryOtp,
      notes: `PICKUP_PIN:${pickupOtp} | DELIVERY_PIN:${deliveryOtp}`,
      status: 'driver_assigned',
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(driverInfo.driver_id || '');
        const dbPayload = sanitizeForSupabaseBooking({
          ...updatePayload,
          assigned_driver_id: isUuid ? driverInfo.driver_id : null
        });
        const { data, error } = await supabase.from('bookings').update(dbPayload).eq('id', id).select().single();
        if (!error && data) return data;
      } catch (err) {}
    }

    const bookings = await readLocal(bookingsFile, []);
    const index = bookings.findIndex(b => b.id === id);
    if (index === -1) return null;
    bookings[index] = {
      ...bookings[index],
      ...updatePayload,
      assigned_driver_id: driverInfo.driver_id || null
    };
    await writeLocal(bookingsFile, bookings);
    return bookings[index];
  },

  async assignBookingOtps(id, pickupOtp, deliveryOtp) {
    const pOtp = String(pickupOtp || Math.floor(1000 + Math.random() * 9000));
    const dOtp = String(deliveryOtp || Math.floor(1000 + Math.random() * 9000));
    const payload = {
      notes: `PICKUP_PIN:${pOtp} | DELIVERY_PIN:${dOtp}`,
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      try {
        const dbPayload = sanitizeForSupabaseBooking(payload);
        await supabase.from('bookings').update(dbPayload).eq('id', id);
      } catch (err) {}
    }
    const bookings = await readLocal(bookingsFile, []);
    const idx = bookings.findIndex(b => b.id === id);
    if (idx !== -1) {
      bookings[idx] = { ...bookings[idx], pickup_otp: pOtp, delivery_otp: dOtp, notes: payload.notes };
      await writeLocal(bookingsFile, bookings);
      return bookings[idx];
    }
    return null;
  },

  async verifyBookingOtp(id, otpType, enteredOtp) {
    const cleanId = String(id || '').trim();
    let booking = await this.getBookingByIdOrPhone(cleanId);
    if (!booking) {
      const all = await this.getBookings();
      booking = all.find(b => b.id?.toLowerCase() === cleanId.toLowerCase());
    }
    if (!booking) throw new Error(`Booking not found with ID: ${id}`);

    const cleanEntered = String(enteredOtp || '').replace(/\D/g, '').trim();
    if (!cleanEntered || cleanEntered.length < 4) {
      throw new Error('Please enter a valid 4-digit PIN.');
    }

    const pins = getOrGenerateBookingPins(booking);

    if (otpType === 'pickup') {
      const expected = String(pins.pickup_otp || '').trim();
      if (expected && cleanEntered !== expected) {
        throw new Error('Invalid Pickup PIN. Please check with customer/sender.');
      }
      const updatePayload = {
        status: 'in_transit',
        pickup_otp_verified: true,
        updated_at: new Date().toISOString()
      };
      if (supabase) {
        try {
          const dbPayload = sanitizeForSupabaseBooking(updatePayload);
          await supabase.from('bookings').update(dbPayload).eq('id', booking.id);
        } catch (e) {}
      }
      const bookings = await readLocal(bookingsFile, []);
      const idx = bookings.findIndex(b => b.id === booking.id);
      if (idx !== -1) {
        bookings[idx] = { ...bookings[idx], ...updatePayload };
        await writeLocal(bookingsFile, bookings);
        return bookings[idx];
      }
      return { ...booking, ...updatePayload };
    } else if (otpType === 'delivery') {
      const expected = String(pins.delivery_otp || '').trim();
      if (expected && cleanEntered !== expected) {
        throw new Error('Invalid Delivery PIN. Please check with customer/receiver.');
      }
      const updatePayload = {
        status: 'delivered',
        pickup_otp_verified: true,
        delivery_otp_verified: true,
        payment_status: 'completed',
        updated_at: new Date().toISOString()
      };
      if (supabase) {
        try {
          const dbPayload = sanitizeForSupabaseBooking(updatePayload);
          await supabase.from('bookings').update(dbPayload).eq('id', booking.id);
        } catch (e) {}
      }
      const bookings = await readLocal(bookingsFile, []);
      const idx = bookings.findIndex(b => b.id === booking.id);
      if (idx !== -1) {
        bookings[idx] = { ...bookings[idx], ...updatePayload };
        await writeLocal(bookingsFile, bookings);
        return bookings[idx];
      }
      return { ...booking, ...updatePayload };
    }
    throw new Error('Invalid OTP type');
  },

  // DRIVERS
  async getRiderApplications() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          return data.map(r => ({
            ...r,
            avatar_url: r.avatar_url || null,
            vehType: r.vehtype || r.vehType || 'Bike / Scooter',
            vehNum: r.vehnum || r.vehNum || '',
            dlNum: r.dlnum || r.dlNum || '',
            driverId: r.driverid || r.driverId || r.driver_id
          }));
        }
        console.warn('Supabase rider applications read fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase rider applications read fallback to local:', err.message);
      }
    }
    const localApps = await readLocal(riderApplicationsFile, defaultRiderApplications);
    return localApps.map(r => ({ ...r, avatar_url: r.avatar_url || null }));
  },

  async createRiderApplication(payload) {
    const dbPayload = {
      id: payload.id || `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: payload.name,
      phone: String(payload.phone || '').replace(/\D/g, ''),
      city: payload.city,
      shift: payload.shift || 'Full Time (8-10 Hours)',
      vehtype: payload.vehType || payload.vehtype || 'Bike / Scooter',
      vehnum: payload.vehNum || payload.vehnum || '',
      dlnum: payload.dlNum || payload.dlnum || '',
      status: payload.status || 'Pending',
      driverid: payload.driverId || payload.driverid || null,
      pin: payload.pin || null,
      date: payload.date || new Date().toISOString(),
      created_at: payload.created_at || new Date().toISOString()
    };

    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').insert([dbPayload]).select().single();
        if (!error && data) {
          return {
            ...data,
            vehType: data.vehtype,
            vehNum: data.vehnum,
            dlNum: data.dlnum,
            driverId: data.driverid
          };
        }
        console.warn('Supabase rider application insert fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase rider application insert fallback to local:', err.message);
      }
    }
    const apps = await readLocal(riderApplicationsFile, defaultRiderApplications);
    const newApp = { ...dbPayload, vehType: dbPayload.vehtype, vehNum: dbPayload.vehnum, dlNum: dbPayload.dlnum };
    apps.unshift(newApp);
    await writeLocal(riderApplicationsFile, apps);
    return newApp;
  },

  async updateRiderApplication(id, updates) {
    const dbUpdates = { ...updates };
    if ('vehType' in updates) { dbUpdates.vehtype = updates.vehType; delete dbUpdates.vehType; }
    if ('vehNum' in updates) { dbUpdates.vehnum = updates.vehNum; delete dbUpdates.vehNum; }
    if ('dlNum' in updates) { dbUpdates.dlnum = updates.dlNum; delete dbUpdates.dlNum; }
    if ('driverId' in updates) { dbUpdates.driverid = updates.driverId; delete dbUpdates.driverId; }

    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').update(dbUpdates).eq('id', id).select().single();
        if (!error && data) {
          return {
            ...data,
            vehType: data.vehtype,
            vehNum: data.vehnum,
            dlNum: data.dlnum,
            driverId: data.driverid
          };
        }
        console.warn('Supabase rider application update fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase rider application update fallback to local:', err.message);
      }
    }
    const apps = await readLocal(riderApplicationsFile, defaultRiderApplications);
    const index = apps.findIndex(app => app.id === id);
    if (index === -1) return null;
    apps[index] = { ...apps[index], ...updates, updated_at: new Date().toISOString() };
    await writeLocal(riderApplicationsFile, apps);
    return apps[index];
  },

  async getDrivers() {
    let list = [];
    if (supabase) {
      try {
        const { data, error } = await supabase.from('drivers').select('*').order('created_at', { ascending: false });
        if (!error && Array.isArray(data)) list = data;
      } catch (err) {
        console.warn('Supabase getDrivers warning:', err.message);
      }
    }

    // Always merge local file drivers as fallback or local additions
    try {
      const localDrivers = await readLocal(driversFile, defaultDrivers);
      for (const ld of localDrivers) {
        const lPhone = String(ld.phone || '').replace(/\D/g, '');
        if (lPhone && !list.some(d => String(d.phone || '').replace(/\D/g, '') === lPhone)) {
          list.push(ld);
        }
      }
    } catch {}

    // Auto-merge any Approved applications into active drivers list if not already present
    try {
      const apps = await this.getRiderApplications();
      const approvedApps = apps.filter(a => String(a.status || '').toLowerCase() === 'approved');

      for (const app of approvedApps) {
        const aPhone = String(app.phone || '').replace(/\D/g, '');
        if (!aPhone) continue;
        const exists = list.some(d => String(d.phone || '').replace(/\D/g, '') === aPhone);
        if (!exists) {
          const autoDriver = {
            id: app.id || app.driverId || app.driverid || `RDR-${aPhone.slice(-4)}`,
            driver_name: app.name || 'Rider Partner',
            phone: aPhone,
            vehicle_number: app.vehNum || app.vehnum || app.vehicle_number || '',
            vehicle_type: app.vehType || app.vehtype || app.vehicle_type || 'Bike / Scooter',
            status: 'available',
            rating: 4.9,
            pin: app.pin || '1234',
            onDuty: true,
            created_at: app.created_at || new Date().toISOString(),
            updated_at: app.updated_at || new Date().toISOString()
          };
          list.push(autoDriver);

          // Asynchronously provision to Supabase drivers table if connected
          if (supabase) {
            supabase.from('drivers').insert([{
              id: crypto.randomUUID(),
              driver_name: autoDriver.driver_name,
              phone: aPhone,
              vehicle_number: autoDriver.vehicle_number,
              vehicle_type: autoDriver.vehicle_type,
              status: 'available',
              rating: 4.9,
              created_at: autoDriver.created_at,
              updated_at: autoDriver.updated_at
            }]).then(() => {}).catch(() => {});
          }
        }
      }

      // Enrich driver list with security PIN, approval date, vehicle type, and onDuty status
      list = list.map(d => {
        const dPhone = String(d.phone || '').replace(/\D/g, '');
        const matchedApp = apps.find(a => String(a.phone || '').replace(/\D/g, '') === dPhone);
        return {
          ...d,
          driver_name: d.driver_name || matchedApp?.name || 'Rider Partner',
          pin: matchedApp?.pin || d.pin || '1234',
          onDuty: d.onDuty !== undefined ? d.onDuty : (d.status !== 'off_duty'),
          approved_at: matchedApp?.approved_at || d.approved_at || d.created_at,
          vehicle_number: d.vehicle_number || matchedApp?.vehNum || matchedApp?.vehnum || '',
          vehicle_type: d.vehicle_type || matchedApp?.vehType || matchedApp?.vehtype || 'Bike / Scooter'
        };
      });
    } catch (err) {
      console.warn('Enrich drivers error:', err.message);
    }

    return list;
  },

  async createDriver(driverData) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const dbPayload = {
      id: (driverData.id && isUuid.test(driverData.id)) ? driverData.id : crypto.randomUUID(),
      driver_name: driverData.driver_name || driverData.name || 'Rider Partner',
      phone: String(driverData.phone || '').replace(/\D/g, ''),
      vehicle_number: driverData.vehicle_number || driverData.vehNum || '',
      vehicle_type: driverData.vehicle_type || driverData.vehType || 'Bike / Scooter',
      status: driverData.status || 'available',
      avatar_url: driverData.avatar_url || null,
      current_location: driverData.current_location || null,
      rating: Number(driverData.rating || 4.8),
      created_at: driverData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const { data, error } = await supabase.from('drivers').insert([dbPayload]).select().single();
        if (!error && data) {
          return { ...driverData, ...data };
        }
        console.warn('Supabase create driver warning:', error?.message);
      } catch (err) {
        console.warn('Supabase create driver error:', err.message);
      }
    }

    const drivers = await readLocal(driversFile, defaultDrivers);
    const newDriver = { ...driverData, ...dbPayload };
    drivers.unshift(newDriver);
    await writeLocal(driversFile, drivers);
    return newDriver;
  },

  async updateDriver(id, driverData) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const allowed = ['driver_name', 'phone', 'vehicle_number', 'vehicle_type', 'status', 'avatar_url', 'current_location', 'rating', 'updated_at'];
    const dbUpdates = {};
    for (const key of allowed) {
      if (key in driverData && driverData[key] !== undefined) dbUpdates[key] = driverData[key];
    }
    dbUpdates.updated_at = new Date().toISOString();

    if (supabase && id && isUuid.test(id)) {
      try {
        const { data, error } = await supabase.from('drivers').update(dbUpdates).eq('id', id).select().single();
        if (!error && data) {
          return { ...driverData, ...data };
        }
        console.warn('Supabase update driver warning:', error?.message);
      } catch (err) {
        console.warn('Supabase update driver error:', err.message);
      }
    }

    const drivers = await readLocal(driversFile, defaultDrivers);
    const index = drivers.findIndex(d => d.id === id || String(d.phone || '').replace(/\D/g, '') === String(driverData.phone || '').replace(/\D/g, ''));
    if (index === -1) return null;
    drivers[index] = { ...drivers[index], ...driverData, ...dbUpdates };
    await writeLocal(driversFile, drivers);
    return drivers[index];
  },

  async getDriverById(id) {
    let result = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.from('drivers').select('*').eq('id', id).single();
        if (!error && data) result = data;
      } catch {}
    }
    const drivers = await readLocal(driversFile, defaultDrivers);
    const local = drivers.find(d => d.id === id);
    if (!result) return local || null;
    return { ...local, ...result, avatar_url: local?.avatar_url || result?.avatar_url || null };
  },

  async getDriverByPhone(phone) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    let result = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.from('drivers').select('*').limit(100);
        if (!error && Array.isArray(data)) {
          const found = data.find(d => String(d.phone || '').replace(/\D/g, '') === cleanPhone);
          if (found) result = found;
        }
      } catch {}
    }
    const drivers = await readLocal(driversFile, defaultDrivers);
    const local = drivers.find(d => String(d.phone || '').replace(/\D/g, '') === cleanPhone);
    if (!result) return local || null;
    return { ...local, ...result, avatar_url: local?.avatar_url || result?.avatar_url || null };
  },

  // PAYOUT REQUESTS
  async getPayoutRequests(driverId = null) {
    if (supabase) {
      try {
        let query = supabase.from('payout_requests').select('*').order('created_at', { ascending: false });
        if (driverId) query = query.eq('driver_id', driverId);
        const { data, error } = await query;
        if (!error && data) return data;
      } catch {}
    }
    const list = await readLocal(payoutRequestsFile, []);
    if (driverId) {
      return list.filter(item => item.driver_id === driverId);
    }
    return list;
  },

  async createPayoutRequest(payload) {
    const item = {
      id: `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...payload
    };
    if (supabase) {
      try {
        const { data, error } = await supabase.from('payout_requests').insert([item]).select().single();
        if (!error && data) return data;
      } catch {}
    }
    const list = await readLocal(payoutRequestsFile, []);
    list.unshift(item);
    await writeLocal(payoutRequestsFile, list);
    return item;
  },

  async updatePayoutStatus(id, status, notes = '') {
    const updatePayload = {
      status,
      notes: notes || '',
      updated_at: new Date().toISOString()
    };
    if (supabase) {
      try {
        const { data, error } = await supabase.from('payout_requests').update(updatePayload).eq('id', id).select().single();
        if (!error && data) return data;
      } catch {}
    }
    const list = await readLocal(payoutRequestsFile, []);
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updatePayload };
    await writeLocal(payoutRequestsFile, list);
    return list[idx];
  },

  // FEEDBACK
  async addFeedback(feedbackData) {
    if (supabase) {
      const { data, error } = await supabase.from('feedback').insert([feedbackData]).select().single();
      if (error) throw error;
      return data;
    }
    const feedbackList = await readLocal(feedbackFile, []);
    feedbackList.unshift({ id: `fb-${Date.now().toString().slice(-4)}`, ...feedbackData, created_at: new Date().toISOString() });
    await writeLocal(feedbackFile, feedbackList);
    return feedbackList[0];
  },

  // PARCELS MANAGEMENT (Porter-style on-demand delivery)
  async getParcels() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('parcel_bookings').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch {}
    }
    return await readLocal(parcelsFile, []);
  },

  async getParcelByIdOrPhone(identifier) {
    const cleanId = String(identifier).trim();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('parcel_bookings')
          .select('*')
          .or(`parcel_id.ilike.%${cleanId}%,sender_phone.eq.${cleanId},receiver_phone.eq.${cleanId}`)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!error && data && data.length > 0) return data[0];
      } catch {}
    }

    const parcels = await readLocal(parcelsFile, []);
    const phoneClean = cleanId.replace(/\D/g, '');
    return parcels.find(p => 
      (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) ||
      (p.id && p.id.toLowerCase() === cleanId.toLowerCase()) ||
      (phoneClean && p.sender_phone && p.sender_phone.replace(/\D/g, '') === phoneClean) ||
      (phoneClean && p.receiver_phone && p.receiver_phone.replace(/\D/g, '') === phoneClean)
    ) || null;
  },

  async createParcel(parcelData) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('parcel_bookings').insert([parcelData]).select().single();
        if (!error && data) return data;
      } catch (err) {
        console.warn('Supabase parcel insert fallback to local:', err.message);
      }
    }

    const parcels = await readLocal(parcelsFile, []);
    parcels.unshift(parcelData);
    await writeLocal(parcelsFile, parcels);
    return parcelData;
  },

  async _saveParcelUpdate(parcel, updatePayload) {
    const parcelKey = parcel.parcel_id || parcel.id;
    let updatedParcel = null;

    // 1. Supabase database update
    if (supabase && parcelKey) {
      try {
        const { data, error } = await supabase
          .from('parcel_bookings')
          .update(updatePayload)
          .or(`parcel_id.eq.${parcelKey},id.eq.${parcelKey}`)
          .select()
          .single();
        if (!error && data) {
          updatedParcel = data;
        } else if (error) {
          console.warn('[Supabase] parcel update notice:', error.message);
        }
      } catch (err) {
        console.warn('[Supabase] parcel update exception:', err.message);
      }
    }

    // 2. Always sync with local data storage (Backend/data/parcels.json)
    try {
      const parcels = await readLocal(parcelsFile, []);
      const index = parcels.findIndex(p => 
        (p.parcel_id && String(p.parcel_id).toLowerCase() === String(parcelKey).toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === String(parcelKey).toLowerCase())
      );
      if (index !== -1) {
        parcels[index] = { ...parcels[index], ...updatePayload };
        await writeLocal(parcelsFile, parcels);
        if (!updatedParcel) updatedParcel = parcels[index];
      } else {
        const merged = { ...parcel, ...updatePayload };
        parcels.unshift(merged);
        await writeLocal(parcelsFile, parcels);
        if (!updatedParcel) updatedParcel = merged;
      }
    } catch (localErr) {
      console.warn('[Local] parcels save notice:', localErr.message);
    }

    return updatedParcel || { ...parcel, ...updatePayload };
  },

  async updateParcelStatus(id, status, updatedBy = 'system', notes = '') {
    const cleanId = String(id || '').trim();
    let parcel = await this.getParcelByIdOrPhone(cleanId);
    if (!parcel) {
      const parcels = await this.getParcels();
      parcel = parcels.find(p => 
        (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === cleanId.toLowerCase())
      );
    }
    if (!parcel) parcel = { parcel_id: cleanId, id: cleanId };

    const updatePayload = {
      booking_status: status,
      status: status,
      updated_at: new Date().toISOString()
    };
    if (notes) updatePayload.notes = notes;
    if (status === 'picked_up') {
      updatePayload.pickup_time = new Date().toISOString();
      updatePayload.pickup_otp_verified = true;
    }
    if (status === 'delivered') {
      updatePayload.delivery_time = new Date().toISOString();
      updatePayload.delivery_otp_verified = true;
      updatePayload.pickup_otp_verified = true;
      updatePayload.payment_status = 'completed';
    }

    return await this._saveParcelUpdate(parcel, updatePayload);
  },

  async assignParcelDriver(id, driverInfo) {
    const cleanId = String(id || '').trim();
    let parcel = await this.getParcelByIdOrPhone(cleanId);
    if (!parcel) {
      const parcels = await this.getParcels();
      parcel = parcels.find(p => 
        (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === cleanId.toLowerCase())
      );
    }
    if (!parcel) parcel = { parcel_id: cleanId, id: cleanId };

    const payload = {
      driver_id: driverInfo.driver_id || driverInfo.id,
      assigned_driver_name: driverInfo.driver_name || driverInfo.name,
      assigned_driver_phone: driverInfo.driver_phone || driverInfo.phone,
      assigned_vehicle_no: driverInfo.vehicle_number || driverInfo.vehicleNo,
      assigned_vehicle_type: driverInfo.vehicle_type || driverInfo.vehicleType,
      booking_status: 'driver_assigned',
      status: 'driver_assigned',
      updated_at: new Date().toISOString()
    };

    if (driverInfo.pickup_otp) payload.pickup_otp = driverInfo.pickup_otp;
    if (driverInfo.delivery_otp) payload.delivery_otp = driverInfo.delivery_otp;

    return await this._saveParcelUpdate(parcel, payload);
  },

  async declineParcelDriver(id, driverInfo) {
    const cleanId = String(id || '').trim();
    let parcel = await this.getParcelByIdOrPhone(cleanId);
    if (!parcel) {
      const parcels = await this.getParcels();
      parcel = parcels.find(p => 
        (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === cleanId.toLowerCase())
      );
    }
    if (!parcel) parcel = { parcel_id: cleanId, id: cleanId };

    const prevDriverId = driverInfo.driver_id || parcel.driver_id || '';
    const prevDriverName = driverInfo.driver_name || parcel.assigned_driver_name || 'Driver';
    const prevDriverPhone = driverInfo.driver_phone || parcel.assigned_driver_phone || '';

    // Maintain history of drivers who declined this parcel
    const declinedList = Array.isArray(parcel.declined_driver_ids) ? [...parcel.declined_driver_ids] : [];
    if (prevDriverId && !declinedList.includes(String(prevDriverId))) {
      declinedList.push(String(prevDriverId));
    }
    if (prevDriverPhone && !declinedList.includes(String(prevDriverPhone))) {
      declinedList.push(String(prevDriverPhone));
    }

    const payload = {
      driver_id: null,
      assigned_driver_name: null,
      assigned_driver_phone: null,
      assigned_vehicle_no: null,
      assigned_vehicle_type: null,
      booking_status: 'driver_declined',
      status: 'driver_declined',
      declined_driver_id: prevDriverId,
      declined_driver_name: prevDriverName,
      declined_driver_phone: prevDriverPhone,
      declined_driver_ids: declinedList,
      declined_at: new Date().toISOString(),
      decline_reason: driverInfo.reason || 'Driver declined via app notification',
      updated_at: new Date().toISOString()
    };

    return await this._saveParcelUpdate(parcel, payload);
  },

  async assignParcelOtps(id, pickupOtp, deliveryOtp) {
    const cleanId = String(id || '').trim();
    let parcel = await this.getParcelByIdOrPhone(cleanId);
    if (!parcel) {
      const parcels = await this.getParcels();
      parcel = parcels.find(p => 
        (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === cleanId.toLowerCase())
      );
    }
    if (!parcel) parcel = { parcel_id: cleanId, id: cleanId };

    const payload = {
      pickup_otp: String(pickupOtp || '').trim(),
      delivery_otp: String(deliveryOtp || '').trim(),
      updated_at: new Date().toISOString()
    };

    return await this._saveParcelUpdate(parcel, payload);
  },

  async verifyParcelOtp(id, otpType, enteredOtp) {
    const cleanId = String(id || '').trim();
    let parcel = await this.getParcelByIdOrPhone(cleanId);
    if (!parcel) {
      const parcels = await this.getParcels();
      parcel = parcels.find(p => 
        (p.parcel_id && p.parcel_id.toLowerCase() === cleanId.toLowerCase()) || 
        (p.id && String(p.id).toLowerCase() === cleanId.toLowerCase())
      );
    }
    if (!parcel) throw new Error(`Parcel not found with ID: ${id}`);

    const cleanEntered = String(enteredOtp || '').replace(/\D/g, '').trim();
    if (!cleanEntered || cleanEntered.length < 4) {
      throw new Error('Please enter a valid 4-digit PIN.');
    }

    if (otpType === 'pickup') {
      if (parcel.pickup_otp_verified && (parcel.booking_status === 'picked_up' || parcel.status === 'picked_up')) {
        throw new Error('Pickup OTP has already been verified.');
      }
      const expectedPickup = String(parcel.pickup_otp || '').replace(/\D/g, '').trim();
      if (expectedPickup && cleanEntered !== expectedPickup) {
        throw new Error('Invalid Pickup OTP. Please check with the sender.');
      }

      const updatePayload = {
        booking_status: 'picked_up',
        status: 'picked_up',
        pickup_otp_verified: true,
        pickup_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return await this._saveParcelUpdate(parcel, updatePayload);

    } else if (otpType === 'delivery') {
      if (parcel.delivery_otp_verified && (parcel.booking_status === 'delivered' || parcel.status === 'delivered')) {
        throw new Error('Delivery OTP has already been verified. Parcel is already delivered.');
      }
      const expectedDelivery = String(parcel.delivery_otp || '').replace(/\D/g, '').trim();
      if (expectedDelivery && cleanEntered !== expectedDelivery) {
        throw new Error('Invalid Delivery OTP. Please check with the receiver.');
      }

      // Mark delivered, mark both delivery and pickup OTP verified, and complete payment atomically
      const updatePayload = {
        booking_status: 'delivered',
        status: 'delivered',
        pickup_otp_verified: true,
        delivery_otp_verified: true,
        payment_status: 'completed',
        delivery_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return await this._saveParcelUpdate(parcel, updatePayload);
    }

    throw new Error('Invalid OTP type');
  },

  async markParcelOtpVerified(parcel, otpType) {
    const field = otpType === 'pickup' ? 'pickup_otp_verified' : 'delivery_otp_verified';
    return await this._saveParcelUpdate(parcel, {
      [field]: true,
      updated_at: new Date().toISOString()
    });
  },

  // CONFIGURATION & FULL CONTROL
  async getConfig() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('system_config').select('*').limit(1);
        if (!error && data && data.length > 0 && data[0].config) {
          return { ...defaultConfig, ...data[0].config };
        }
      } catch (err) {
        console.warn('Supabase system_config table not found, using local fallback:', err.message);
      }
    }
    return await readLocal(configFile, defaultConfig);
  },

  async saveConfig(newConfig) {
    const current = await this.getConfig();
    const merged = { ...current, ...newConfig, updated_at: new Date().toISOString() };

    if (supabase) {
      try {
        await supabase.from('system_config').upsert([{ id: 1, config: merged, updated_at: new Date().toISOString() }]);
      } catch (err) {
        console.warn('Supabase config sync skipped:', err.message);
      }
    }

    await writeLocal(configFile, merged);
    return merged;
  },

  // ==========================================================================
  // STORAGE: DRIVER AVATAR UPLOAD (Supabase 'driver-avatars' Public Bucket)
  // ==========================================================================
  async uploadDriverAvatar(phone, base64OrDataUrl) {
    if (!phone || !base64OrDataUrl) return base64OrDataUrl;

    // If already hosted URL, return as-is
    if (typeof base64OrDataUrl === 'string' && (base64OrDataUrl.startsWith('http://') || base64OrDataUrl.startsWith('https://'))) {
      return base64OrDataUrl;
    }

    if (!supabase) {
      console.log('ℹ️ Supabase not initialized, skipping cloud storage upload.');
      return base64OrDataUrl;
    }

    try {
      let mimeType = 'image/jpeg';
      let base64String = base64OrDataUrl;

      const matches = String(base64OrDataUrl).match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64String = matches[2];
      }

      const buffer = Buffer.from(base64String, 'base64');
      const cleanPhone = String(phone).replace(/\D/g, '');
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
      const fileName = `rider_${cleanPhone}.${ext}`;

      const { data, error } = await supabase.storage
        .from('driver-avatars')
        .upload(fileName, buffer, {
          contentType: mimeType,
          upsert: true
        });

      if (error) {
        console.warn('⚠️ Supabase storage upload warning:', error.message);
        return base64OrDataUrl;
      }

      const { data: publicData } = supabase.storage
        .from('driver-avatars')
        .getPublicUrl(fileName);

      if (publicData && publicData.publicUrl) {
        const publicUrl = `${publicData.publicUrl}?t=${Date.now()}`;
        console.log(`✅ Driver avatar successfully uploaded to Supabase Storage: ${publicUrl}`);
        return publicUrl;
      }
    } catch (err) {
      console.warn('⚠️ uploadDriverAvatar exception:', err.message);
    }

    return base64OrDataUrl;
  }
};
