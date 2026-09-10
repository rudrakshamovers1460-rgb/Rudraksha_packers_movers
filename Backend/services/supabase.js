const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');

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

// Initial Sample Drivers for local mode
const defaultDrivers = [
  { id: 'drv-101', driver_name: 'Rajesh Kumar', phone: '9876543210', vehicle_number: 'RJ-14-GA-1024', vehicle_type: 'Tata Ace (1.5 Ton)', status: 'available', rating: 4.9 },
  { id: 'drv-102', driver_name: 'Vikram Singh', phone: '9829012345', vehicle_number: 'RJ-14-GB-5521', vehicle_type: 'Eicher 14ft (3.5 Ton)', status: 'available', rating: 4.8 },
  { id: 'drv-103', driver_name: 'Ramesh Meena', phone: '9414098765', vehicle_number: 'RJ-14-GC-8840', vehicle_type: '19ft Container (7 Ton)', status: 'available', rating: 4.7 }
];

const defaultRiderApplications = [
  {
    id: 'app-demo-001',
    name: 'Mukesh Kumar Sharma',
    phone: '9829012345',
    city: 'Jaipur (Mansarovar / Vaishali)',
    shift: 'Full Time (8-10 Hours)',
    vehType: 'Bike / Scooter',
    vehNum: 'RJ14 AB 1234',
    dlNum: 'RJ14 20210012345',
    status: 'Approved',
    driverId: 'RDR-2345',
    pin: '4321',
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    approved_at: new Date(Date.now() - 86400000).toISOString()
  }
];

const defaultConfig = {
  rates: {
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
  },
  vehicles: {
    'mini_truck': { name: 'Tata Ace / Mini (1.5 Ton)', basePrice: 2500, perKmRate: 35, icon: 'fa-truck-pickup', cap: 'Up to 1 BHK / Studio' },
    'tempo_14ft': { name: '14ft Tempo / Eicher (3.5 Ton)', basePrice: 3500, perKmRate: 45, icon: 'fa-truck', cap: 'Ideal for 1-2 BHK' },
    'truck_19ft': { name: '19ft Container Truck (7 Ton)', basePrice: 5500, perKmRate: 65, icon: 'fa-truck-moving', cap: '3+ BHK / Large Moving' },
    'bike': { name: 'Bike Transport Carrier', basePrice: 1500, perKmRate: 15, icon: 'fa-motorcycle', cap: 'Two-Wheeler Carrier' },
    'car': { name: 'Closed Car Carrier', basePrice: 4500, perKmRate: 35, icon: 'fa-car-side', cap: 'Hydraulic Car Carrier' }
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
    bike: { name: 'Bike', baseFare: 40, perKmRate: 8, baseKm: 2, maxWeightKg: 10, icon: 'fa-motorcycle', desc: 'Up to 10 KG • Fastest Option' },
    auto: { name: 'Auto / 3-Wheeler', baseFare: 120, perKmRate: 14, baseKm: 2, maxWeightKg: 50, icon: 'fa-truck-front', desc: 'Up to 50 KG • Medium Items' },
    mini_truck: { name: 'Mini Truck (Tata Ace)', baseFare: 350, perKmRate: 25, baseKm: 3, maxWeightKg: 1000, icon: 'fa-truck-pickup', desc: 'Up to 1000 KG • Heavy & Bulky' },
    weightSurcharges: {
      'upto_1kg': 0,
      '1_5kg': 15,
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

module.exports = {
  isSupabaseActive: () => Boolean(supabase),

  // BOOKINGS
  async getBookings() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
        console.warn('Supabase bookings read fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase bookings read fallback to local:', err.message);
      }
    }
    return await readLocal(bookingsFile, []);
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
        if (!error && data && data.length > 0) return data[0];
        if (error) console.warn('Supabase booking lookup fallback to local:', error.message);
      } catch (err) {
        console.warn('Supabase booking lookup fallback to local:', err.message);
      }
    }

    const bookings = await readLocal(bookingsFile, []);
    const phoneClean = cleanId.replace(/\D/g, '');
    return bookings.find(b => 
      b.id?.toLowerCase() === cleanId.toLowerCase() || 
      (phoneClean && b.customer_phone?.replace(/\D/g, '') === phoneClean)
    ) || null;
  },

  async createBooking(bookingData) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('bookings').insert([bookingData]).select().single();
        if (!error && data) return data;
        console.warn('Supabase booking insert fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase booking insert fallback to local:', err.message);
      }
    }

    const bookings = await readLocal(bookingsFile, []);
    bookings.unshift(bookingData);
    await writeLocal(bookingsFile, bookings);
    return bookingData;
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
    if (supabase) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(driverInfo.driver_id || '');
      const updatePayload = {
        assigned_driver_id: isUuid ? driverInfo.driver_id : null,
        assigned_driver_name: driverInfo.driver_name,
        assigned_driver_phone: driverInfo.driver_phone,
        assigned_vehicle_no: driverInfo.vehicle_number,
        status: 'driver_assigned',
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('bookings').update(updatePayload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const bookings = await readLocal(bookingsFile, []);
    const index = bookings.findIndex(b => b.id === id);
    if (index === -1) return null;
    bookings[index] = {
      ...bookings[index],
      assigned_driver_id: driverInfo.driver_id || null,
      assigned_driver_name: driverInfo.driver_name,
      assigned_driver_phone: driverInfo.driver_phone,
      assigned_vehicle_no: driverInfo.vehicle_number,
      status: 'driver_assigned',
      updated_at: new Date().toISOString()
    };
    await writeLocal(bookingsFile, bookings);
    return bookings[index];
  },

  // DRIVERS
  async getRiderApplications() {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
        console.warn('Supabase rider applications read fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase rider applications read fallback to local:', err.message);
      }
    }
    return await readLocal(riderApplicationsFile, defaultRiderApplications);
  },

  async createRiderApplication(payload) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').insert([payload]).select().single();
        if (!error && data) return data;
        console.warn('Supabase rider application insert fallback to local:', error?.message || 'empty response');
      } catch (err) {
        console.warn('Supabase rider application insert fallback to local:', err.message);
      }
    }
    const apps = await readLocal(riderApplicationsFile, defaultRiderApplications);
    const newApp = { id: payload.id || `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...payload, created_at: new Date().toISOString() };
    apps.unshift(newApp);
    await writeLocal(riderApplicationsFile, apps);
    return newApp;
  },

  async updateRiderApplication(id, updates) {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('rider_applications').update(updates).eq('id', id).select().single();
        if (!error && data) return data;
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
    if (supabase) {
      const { data, error } = await supabase.from('drivers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
    return await readLocal(driversFile, defaultDrivers);
  },

  async createDriver(driverData) {
    if (supabase) {
      const { data, error } = await supabase.from('drivers').insert([driverData]).select().single();
      if (error) throw error;
      return data;
    }

    const drivers = await readLocal(driversFile, defaultDrivers);
    const newDriver = { id: `drv-${Date.now().toString().slice(-4)}`, ...driverData, created_at: new Date().toISOString() };
    drivers.unshift(newDriver);
    await writeLocal(driversFile, drivers);
    return newDriver;
  },

  async updateDriver(id, driverData) {
    if (supabase) {
      const { data, error } = await supabase.from('drivers').update(driverData).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const drivers = await readLocal(driversFile, defaultDrivers);
    const index = drivers.findIndex(d => d.id === id);
    if (index === -1) return null;
    drivers[index] = { ...drivers[index], ...driverData };
    await writeLocal(driversFile, drivers);
    return drivers[index];
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

  async updateParcelStatus(id, status, updatedBy = 'system', notes = '') {
    const updatePayload = {
      booking_status: status,
      status: status,
      updated_at: new Date().toISOString()
    };
    if (status === 'picked_up') updatePayload.pickup_time = new Date().toISOString();
    if (status === 'delivered') updatePayload.delivery_time = new Date().toISOString();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('parcel_bookings')
          .update(updatePayload)
          .or(`parcel_id.eq.${id},id.eq.${id}`)
          .select()
          .single();
        if (!error && data) return data;
      } catch {}
    }

    const parcels = await readLocal(parcelsFile, []);
    const index = parcels.findIndex(p => p.parcel_id === id || p.id === id);
    if (index === -1) return null;
    parcels[index] = { ...parcels[index], ...updatePayload };
    await writeLocal(parcelsFile, parcels);
    return parcels[index];
  },

  async assignParcelDriver(id, driverInfo) {
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

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('parcel_bookings')
          .update(payload)
          .or(`parcel_id.eq.${id},id.eq.${id}`)
          .select()
          .single();
        if (!error && data) return data;
      } catch {}
    }

    const parcels = await readLocal(parcelsFile, []);
    const index = parcels.findIndex(p => p.parcel_id === id || p.id === id);
    if (index === -1) return null;
    parcels[index] = { ...parcels[index], ...payload };
    await writeLocal(parcelsFile, parcels);
    return parcels[index];
  },

  async verifyParcelOtp(id, otpType, enteredOtp) {
    const parcels = await this.getParcels();
    const parcel = parcels.find(p => p.parcel_id === id || p.id === id);
    if (!parcel) throw new Error('Parcel not found');

    const cleanEntered = String(enteredOtp).trim();
    if (otpType === 'pickup') {
      if (parcel.pickup_otp_verified) throw new Error('Pickup OTP has already been verified.');
      if (String(parcel.pickup_otp) !== cleanEntered) {
        throw new Error('Invalid Pickup OTP. Please check with the sender.');
      }
      const updated = await this.updateParcelStatus(id, 'picked_up', 'driver', 'Pickup OTP verified successfully');
      return this.markParcelOtpVerified(updated, 'pickup');
    } else if (otpType === 'delivery') {
      if (!parcel.pickup_otp_verified) throw new Error('Pickup OTP must be verified first.');
      if (parcel.delivery_otp_verified) throw new Error('Delivery OTP has already been verified.');
      if (String(parcel.delivery_otp) !== cleanEntered) {
        throw new Error('Invalid Delivery OTP. Please check with the receiver.');
      }
      const updated = await this.updateParcelStatus(id, 'delivered', 'driver', 'Delivery OTP verified successfully');
      return this.markParcelOtpVerified(updated, 'delivery');
    }
    throw new Error('Invalid OTP type');
  },

  async markParcelOtpVerified(parcel, otpType) {
    const field = otpType === 'pickup' ? 'pickup_otp_verified' : 'delivery_otp_verified';
    if (supabase) {
      try {
        const { data, error } = await supabase.from('parcel_bookings').update({ [field]: true }).or(`parcel_id.eq.${parcel.parcel_id},id.eq.${parcel.id}`).select().single();
        if (!error && data) return data;
      } catch {}
    }
    const parcels = await readLocal(parcelsFile, []);
    const index = parcels.findIndex(p => p.parcel_id === parcel.parcel_id || p.id === parcel.id);
    if (index === -1) return parcel;
    parcels[index] = { ...parcels[index], [field]: true, updated_at: new Date().toISOString() };
    await writeLocal(parcelsFile, parcels);
    return parcels[index];
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
  }
};
