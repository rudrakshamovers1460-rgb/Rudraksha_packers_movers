-- ==============================================================================
-- RUDRAKSHA PACKERS & MOVERS - SUPABASE DATABASE SCHEMA
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- ==============================================================================

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. DRIVERS & FLEET TABLE
CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) NOT NULL UNIQUE,
    vehicle_number VARCHAR(20) NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT 'Tata Ace / Pickup', -- Tata Ace, Eicher 14ft, 19ft Container, etc.
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'on_trip', 'off_duty')),
    current_location VARCHAR(255),
    rating NUMERIC(2,1) DEFAULT 4.8,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS public.bookings (
    id VARCHAR(20) PRIMARY KEY, -- e.g. RB-A1B2C3D4
    customer_name VARCHAR(120) NOT NULL,
    customer_phone VARCHAR(15) NOT NULL,
    customer_email VARCHAR(120),
    
    -- Location Details
    pickup_address TEXT NOT NULL,
    pickup_lat NUMERIC(10, 7),
    pickup_lng NUMERIC(10, 7),
    pickup_floor INT DEFAULT 0,
    pickup_lift BOOLEAN DEFAULT FALSE,
    
    drop_address TEXT NOT NULL,
    drop_lat NUMERIC(10, 7),
    drop_lng NUMERIC(10, 7),
    drop_floor INT DEFAULT 0,
    drop_lift BOOLEAN DEFAULT FALSE,
    
    distance_km NUMERIC(8, 2) DEFAULT 0,
    shifting_date DATE NOT NULL,
    
    -- Relocation Details
    service_type VARCHAR(100) DEFAULT 'House Shifting',
    selected_vehicle VARCHAR(100) DEFAULT 'Tata Ace / Mini (1.5 Ton)',
    house_type VARCHAR(50) DEFAULT '1bhk',
    items JSONB DEFAULT '{}'::jsonb,
    addons JSONB DEFAULT '[]'::jsonb,
    coupon_applied VARCHAR(50),
    
    -- Financials
    base_price NUMERIC(10, 2) DEFAULT 0,
    distance_charge NUMERIC(10, 2) DEFAULT 0,
    labor_charge NUMERIC(10, 2) DEFAULT 0,
    addons_charge NUMERIC(10, 2) DEFAULT 0,
    discount_amount NUMERIC(10, 2) DEFAULT 0,
    total_amount NUMERIC(10, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'advance_paid', 'paid', 'refunded')),
    payment_mode VARCHAR(30) DEFAULT 'cash_on_delivery', -- upi, cash_on_delivery, netbanking, card
    
    -- Lifecycle & Driver Assignment
    status VARCHAR(30) DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'confirmed', 'driver_assigned', 'in_transit', 'delivered', 'cancelled')),
    assigned_driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
    assigned_driver_name VARCHAR(100),
    assigned_driver_phone VARCHAR(15),
    assigned_vehicle_no VARCHAR(20),
    
    -- Verification & Notes
    phone_verified BOOLEAN DEFAULT FALSE,
    otp_verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure newly added columns exist if table was previously created
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_type VARCHAR(100) DEFAULT 'House Shifting';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS selected_vehicle VARCHAR(100) DEFAULT 'Tata Ace / Mini (1.5 Ton)';

-- 4. COUPONS TABLE
CREATE TABLE IF NOT EXISTS public.coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_type VARCHAR(20) DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
    value NUMERIC(10,2) NOT NULL,
    min_amount NUMERIC(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SETTINGS / RATE CONFIG TABLE
CREATE TABLE IF NOT EXISTS public.system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. APPLICATION CONFIGURATION USED BY THE API
CREATE TABLE IF NOT EXISTS public.system_config (
    id INTEGER PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. PARCEL DELIVERY ORDERS
CREATE TABLE IF NOT EXISTS public.parcel_bookings (
    id VARCHAR(30) PRIMARY KEY,
    parcel_id VARCHAR(30) UNIQUE NOT NULL,
    sender_name VARCHAR(120) NOT NULL,
    sender_phone VARCHAR(15) NOT NULL,
    receiver_name VARCHAR(120) NOT NULL,
    receiver_phone VARCHAR(15) NOT NULL,
    pickup_address TEXT NOT NULL,
    pickup_lat NUMERIC(10, 7),
    pickup_lng NUMERIC(10, 7),
    drop_address TEXT NOT NULL,
    drop_lat NUMERIC(10, 7),
    drop_lng NUMERIC(10, 7),
    distance_km NUMERIC(8, 2) DEFAULT 0,
    estimated_time VARCHAR(50),
    parcel_type VARCHAR(80),
    weight_category VARCHAR(50),
    package_size VARCHAR(50),
    dimensions JSONB DEFAULT '{}'::jsonb,
    vehicle_type VARCHAR(50),
    base_fare NUMERIC(10, 2) DEFAULT 0,
    distance_fare NUMERIC(10, 2) DEFAULT 0,
    weight_fare NUMERIC(10, 2) DEFAULT 0,
    vehicle_fare NUMERIC(10, 2) DEFAULT 0,
    handling_fee NUMERIC(10, 2) DEFAULT 0,
    addons_fee NUMERIC(10, 2) DEFAULT 0,
    addons JSONB DEFAULT '[]'::jsonb,
    discount NUMERIC(10, 2) DEFAULT 0,
    tax NUMERIC(10, 2) DEFAULT 0,
    total_amount NUMERIC(10, 2) NOT NULL,
    payment_method VARCHAR(40) DEFAULT 'pay_at_pickup',
    payment_status VARCHAR(20) DEFAULT 'pending',
    booking_status VARCHAR(30) DEFAULT 'searching_driver',
    status VARCHAR(30) DEFAULT 'searching_driver',
    driver_id VARCHAR(80),
    assigned_driver_name VARCHAR(120),
    assigned_driver_phone VARCHAR(15),
    assigned_vehicle_no VARCHAR(30),
    assigned_vehicle_type VARCHAR(50),
    pickup_otp VARCHAR(6) NOT NULL,
    pickup_otp_verified BOOLEAN DEFAULT FALSE,
    delivery_otp VARCHAR(6) NOT NULL,
    delivery_otp_verified BOOLEAN DEFAULT FALSE,
    pickup_time TIMESTAMPTZ,
    delivery_time TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CUSTOMER FEEDBACK & REVIEWS
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id VARCHAR(20) REFERENCES public.bookings(id) ON DELETE CASCADE,
    customer_name VARCHAR(120),
    rating INT CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. INITIAL SAMPLE DATA SEEDING
INSERT INTO public.coupons (code, discount_type, value, min_amount, is_active)
VALUES 
    ('RUDRAKSHA10', 'percent', 10, 3000, true),
    ('WELCOME500', 'fixed', 500, 2000, true),
    ('FESTIVE15', 'percent', 15, 5000, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.drivers (driver_name, phone, vehicle_number, vehicle_type, status, rating)
VALUES 
    ('Rajesh Kumar', '9876543210', 'RJ-14-GA-1024', 'Tata Ace (1.5 Ton)', 'available', 4.9),
    ('Vikram Singh', '9829012345', 'RJ-14-GB-5521', 'Eicher 14ft (3.5 Ton)', 'available', 4.8),
    ('Ramesh Meena', '9414098765', 'RJ-14-GC-8840', '19ft Container (7 Ton)', 'available', 4.7)
ON CONFLICT (phone) DO NOTHING;

-- 10. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_bookings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow public insert to bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow public read for tracking" ON public.bookings;
DROP POLICY IF EXISTS "Allow full access for bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow public read active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow full access for coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow public feedback insert" ON public.feedback;
DROP POLICY IF EXISTS "Allow public feedback read" ON public.feedback;
DROP POLICY IF EXISTS "Allow full access for feedback" ON public.feedback;
DROP POLICY IF EXISTS "Allow full access for parcel bookings" ON public.parcel_bookings;
DROP POLICY IF EXISTS "Allow public read drivers" ON public.drivers;
DROP POLICY IF EXISTS "Allow full access for drivers" ON public.drivers;

-- No public policies are created. The backend uses SUPABASE_SERVICE_ROLE_KEY
-- and the browser must never connect directly to these operational tables.

