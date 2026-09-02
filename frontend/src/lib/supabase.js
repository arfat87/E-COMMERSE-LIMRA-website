import { createClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://ynrtlcasbndkrqeotgzt.supabase.co";
const DEFAULT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlucnRsY2FzYm5ka3JxZW90Z3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMTgyMjEsImV4cCI6MjEwMzg5NDIyMX0.xTeCPhHFhlGz3fm6hcfstN1DPWuhhRSlLJnXtTCOkm4";

const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_INSFORGE_URL) ||
  DEFAULT_URL;

const supabaseAnonKey =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_INSFORGE_ANON_KEY) ||
  DEFAULT_ANON_KEY;

// Initialize Supabase Client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Provide backward-compatible interface (.database and auth aliases)
supabase.database = supabase;

if (supabase.auth) {
  supabase.auth.getCurrentUser = async function () {
    try {
      const { data: sessData } = await supabase.auth.getSession();
      if (sessData?.session?.user) {
        return { data: { user: sessData.session.user }, error: null };
      }
      const { data, error } = await supabase.auth.getUser();
      return { data: { user: data?.user || null }, error };
    } catch (e) {
      return { data: { user: null }, error: e };
    }
  };

  const origSignUp = supabase.auth.signUp.bind(supabase.auth);
  supabase.auth.signUp = async function (params = {}) {
    const { email, password, redirectTo, options = {} } = params;
    const mergedOptions = {
      ...options,
      emailRedirectTo: redirectTo || options.emailRedirectTo || (typeof window !== 'undefined' ? window.location.origin + '/admin-login.html' : undefined)
    };
    return await origSignUp({ email, password, options: mergedOptions });
  };

  const origSignInWithOAuth = supabase.auth.signInWithOAuth.bind(supabase.auth);
  supabase.auth.signInWithOAuth = async function (params = {}) {
    const { provider = "google", redirectTo, options = {} } = params;
    const targetRedirect = redirectTo || options.redirectTo || (typeof window !== 'undefined' ? window.location.origin + '/admin-login.html' : undefined);
    return await origSignInWithOAuth({
      provider,
      options: {
        ...options,
        redirectTo: targetRedirect,
        queryParams: options.queryParams || {
          access_type: "offline",
          prompt: "select_account"
        }
      }
    });
  };

  if (!supabase.auth.verifyEmail) {
    supabase.auth.verifyEmail = async function ({ email, otp }) {
      return await supabase.auth.verifyOtp({ email, token: otp, type: "signup" });
    };
  }

  if (!supabase.auth.resendVerificationEmail) {
    supabase.auth.resendVerificationEmail = async function ({ email, redirectTo }) {
      return await supabase.auth.resend({
        email,
        type: "signup",
        options: {
          emailRedirectTo: redirectTo || (typeof window !== 'undefined' ? window.location.origin + '/admin-login.html' : undefined)
        }
      });
    };
  }
}

if (!supabase.realtime) {
  supabase.realtime = {};
}
supabase.realtime.publish = async function (channelName, event, payload) {
  try {
    const ch = supabase.channel(channelName);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event, payload });
      }
    });
  } catch (e) {
    console.warn("[Realtime Publish Notice]:", e.message);
  }
};

// Aliases for compatibility
export const insforge = supabase;
export const mongodb = supabase;

function formatError(error) {
  if (!error) return "Unknown error";
  return error.message || error.details || error.hint || JSON.stringify(error);
}

/**
 * 1. Place order via Supabase RPC / Backend API fallback
 */
export async function saveOrder({
  customerName,
  customerPhone,
  items,
  notes = "",
  latitude = null,
  longitude = null,
  landmark = null,
  deliveryNotes = null,
  locationVerified = false,
  orderType = "delivery",
  tableNumber = null,
  tableZone = null,
  txnRef = null
}) {
  if (!items || !items.length) {
    throw new Error("Your cart is empty");
  }

  const p_items = items.map(function (item) {
    const isVirtual = typeof item.id === "string" || Number(item.id) >= 9000;
    return {
      menu_item_id: isVirtual ? null : Number(item.id),
      item_name: String(item.name || item.item_name || "Item"),
      quantity: Math.max(1, Number(item.qty || item.quantity) || 1),
      unit_price: Number(item.price || item.unit_price) || 0,
      line_total: (Number(item.price || item.unit_price) || 0) * (Math.max(1, Number(item.qty || item.quantity) || 1))
    };
  });

  try {
    const result = await supabase.rpc("place_order", {
      p_customer_name: (customerName || "Customer").trim(),
      p_customer_phone: (customerPhone || "").trim(),
      p_notes: notes ? notes.trim() : "",
      p_items: p_items,
      p_latitude: latitude,
      p_longitude: longitude,
      p_landmark: landmark,
      p_delivery_notes: deliveryNotes,
      p_location_verified: locationVerified,
      p_order_type: orderType,
      p_table_number: tableNumber,
      p_table_zone: tableZone,
      p_txn_ref: txnRef
    });

    if (!result.error && result.data) return result.data;
  } catch (e) {}

  // Fallback to backend /api/orders
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName,
      customerPhone,
      items: p_items,
      notes,
      latitude,
      longitude,
      landmark,
      deliveryNotes,
      orderType,
      tableNumber,
      tableZone,
      txnRef
    })
  });

  const json = await res.json();
  if (json.success && json.data) return json.data;
  throw new Error(json.error || "Failed to place order");
}

/**
 * 2. Save Dine-In Round via Supabase RPC
 */
export async function saveTableRound({
  tableNumber,
  customerName,
  customerPhone,
  items,
  notes = "",
  tableZone = "indoor",
  roundNumber = 1
}) {
  if (!items || !items.length) {
    throw new Error("Cannot place an empty round");
  }

  const p_items = items.map(function (item) {
    const isVirtual = typeof item.id === "string" || Number(item.id) >= 9000;
    return {
      menu_item_id: isVirtual ? null : Number(item.id),
      item_name: String(item.name || item.item_name || "Item"),
      quantity: Math.max(1, Number(item.qty || item.quantity) || 1),
      unit_price: Number(item.price || item.unit_price) || 0,
      line_total: (Number(item.price || item.unit_price) || 0) * (Math.max(1, Number(item.qty || item.quantity) || 1))
    };
  });

  try {
    const result = await supabase.rpc("place_table_round", {
      p_table_number: Number(tableNumber) || 1,
      p_customer_name: (customerName || "Table Customer").trim(),
      p_customer_phone: (customerPhone || "").trim(),
      p_table_zone: tableZone,
      p_round_number: Number(roundNumber) || 1,
      p_notes: notes ? notes.trim() : "",
      p_items: p_items
    });

    if (!result.error && result.data) return result.data;
  } catch (e) {}

  // Fallback to /api/db rpc
  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "rpc",
      rpc: "place_table_round",
      params: {
        p_table_number: Number(tableNumber) || 1,
        p_customer_name: (customerName || "Table Customer").trim(),
        p_customer_phone: (customerPhone || "").trim(),
        p_table_zone: tableZone,
        p_round_number: Number(roundNumber) || 1,
        p_notes: notes ? notes.trim() : "",
        p_items: p_items
      }
    })
  });

  const json = await res.json();
  if (json.data) return json.data;
  throw new Error(json.error?.message || "Failed to place table round");
}

/**
 * 3. Save Booking via Supabase RPC
 */
export async function saveBooking(booking) {
  if (!booking.customer_name || !booking.customer_phone) {
    throw new Error("Name and phone are required");
  }

  const payload = {
    p_type: booking.type || "table",
    p_customer_name: booking.customer_name,
    p_customer_phone: booking.customer_phone,
    p_booking_date: booking.booking_date || null,
    p_booking_time: booking.booking_time || null,
    p_guests: booking.guests !== undefined ? booking.guests : null,
    p_preference: booking.preference || null,
    p_seat_label: booking.seat_label || null,
    p_event_type: booking.event_type || null,
    p_budget: booking.budget || null,
    p_catering: booking.catering || null,
    p_venue: booking.venue || null,
    p_message: booking.message || null,
    p_notes: booking.notes || null
  };

  try {
    const result = await supabase.rpc("place_booking", payload);
    if (!result.error && result.data) return result.data;
  } catch (e) {}

  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rpc", rpc: "place_booking", params: payload })
  });
  const json = await res.json();
  if (json.data) return json.data;
  throw new Error(json.error?.message || "Failed to save booking");
}

function normalizeRpcList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [data];
}

export async function getCustomerBookings(phone) {
  try {
    const result = await supabase.rpc("get_customer_bookings", {
      p_phone: String(phone).trim()
    });
    if (!result.error && result.data) return normalizeRpcList(result.data);
  } catch (e) {}

  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rpc", rpc: "get_customer_bookings", params: { p_phone: String(phone).trim() } })
  });
  const json = await res.json();
  return normalizeRpcList(json.data);
}

export async function getCustomerOrders(phone) {
  try {
    const result = await supabase.rpc("get_customer_orders", {
      p_phone: String(phone).trim()
    });
    if (!result.error && result.data) return normalizeRpcList(result.data);
  } catch (e) {}

  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rpc", rpc: "get_customer_orders", params: { p_phone: String(phone).trim() } })
  });
  const json = await res.json();
  return normalizeRpcList(json.data);
}

export async function getMenuOverrides() {
  const { data, error } = await supabase.from("menu_overrides").select("*");
  if (!error && data) return data;

  const res = await fetch("/api/menu");
  const json = await res.json();
  return json.data || [];
}

export async function saveMenuOverride(override) {
  const payload = {
    id: override.id,
    price: override.price,
    available: override.available,
    featured: override.featured,
    mrp: override.mrp,
    description: override.description,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase.from("menu_overrides").upsert(payload).select();
  if (error) throw new Error(formatError(error));
  return data;
}

export async function getCoupons() {
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(formatError(error));
  return data || [];
}

export async function deleteCoupon(code) {
  const cleanCode = String(code).trim().toUpperCase();
  const { data, error } = await supabase.from("coupons").delete().eq("code", cleanCode);
  if (error) throw new Error(formatError(error));
  return data;
}

export async function saveCoupon(coupon) {
  const cleanCode = String(coupon.code).trim().toUpperCase();

  if (coupon.is_auto_send) {
    await supabase.from("coupons").update({ is_auto_send: false }).eq("is_auto_send", true);
  }

  const payload = {
    code: cleanCode,
    discount_pct: parseInt(coupon.discount_pct || coupon.discount_value, 10) || 10,
    max_uses: parseInt(coupon.max_uses || coupon.usage_limit, 10) || 100,
    expiry_date: coupon.expiry_date || coupon.valid_until,
    min_bill: parseFloat(coupon.min_bill || coupon.min_order) || 0,
    active: coupon.active !== false && coupon.is_active !== false,
    is_auto_send: coupon.is_auto_send === true
  };

  const { data, error } = await supabase.from("coupons").upsert(payload).select();
  if (error) throw new Error(formatError(error));
  return data;
}

export async function validateCouponCode(code, subtotal = 0, phone = null) {
  if (!code) return { valid: false, message: "Coupon code is required" };
  const cleanCode = String(code).trim().toUpperCase();

  const { data: list, error } = await supabase
    .from("coupons")
    .select("*")
    .eq("code", cleanCode)
    .eq("active", true);

  if (error || !list || list.length === 0) {
    return { valid: false, message: "Invalid or inactive coupon code" };
  }

  const coupon = list[0];

  if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
    return { valid: false, message: "Coupon code has expired" };
  }

  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return { valid: false, message: "Coupon usage limit reached" };
  }

  if (coupon.min_bill && subtotal < parseFloat(coupon.min_bill)) {
    return { valid: false, message: `Minimum bill of ₹${parseFloat(coupon.min_bill).toFixed(2)} required` };
  }

  if (phone && String(phone).trim()) {
    const cleanPhone = String(phone).trim();
    const { data: usage } = await supabase
      .from("coupon_usage")
      .select("id")
      .eq("coupon_code", cleanCode)
      .eq("customer_phone", cleanPhone);

    if (usage && usage.length > 0) {
      return { valid: false, message: "You have already used this coupon" };
    }
  }

  const discountPct = Number(coupon.discount_pct || coupon.discount_value) || 0;
  const discountAmount = Math.round(((subtotal * discountPct) / 100) * 100) / 100;
  const finalAmount = Math.max(0, subtotal - discountAmount);

  return {
    valid: true,
    coupon,
    discountAmount,
    finalAmount
  };
}

export async function redeemCoupon(code, phone, orderId) {
  const cleanCode = String(code).trim().toUpperCase();
  const cleanPhone = phone ? String(phone).trim() : null;

  await supabase.from("coupon_usage").insert([
    {
      coupon_code: cleanCode,
      customer_phone: cleanPhone,
      order_id: orderId || null
    }
  ]);

  const { data: current } = await supabase.from("coupons").select("used_count").eq("code", cleanCode);

  const newCount = (current && current[0] ? current[0].used_count : 0) + 1;
  await supabase.from("coupons").update({ used_count: newCount }).eq("code", cleanCode);

  return true;
}

export async function recordCouponUsage(couponCode, orderId, discountAmount, customerPhone) {
  return await redeemCoupon(couponCode, customerPhone, orderId);
}

export async function getCombos() {
  const { data, error } = await supabase
    .from("combos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(formatError(error));
  return data || [];
}

export async function deleteCombo(id) {
  const { data, error } = await supabase.from("combos").delete().eq("id", Number(id));
  if (error) throw new Error(formatError(error));
  return data;
}

export async function saveCombo(combo) {
  const payload = {
    name: combo.name.trim(),
    description: combo.description ? combo.description.trim() : "",
    price: parseFloat(combo.price) || 0,
    mrp: combo.mrp ? parseFloat(combo.mrp) : null,
    items: combo.items,
    available: combo.available !== false,
    image_url: combo.image_url || null
  };

  if (combo.id) {
    payload.id = Number(combo.id);
  }

  const { data, error } = await supabase.from("combos").upsert(payload).select();
  if (error) throw new Error(formatError(error));
  return data;
}

export async function deleteOrder(orderId) {
  if (!orderId) throw new Error("Order ID is required");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(orderId));

  // 1. Delete associated order items
  if (isUuid) {
    await supabase.from("order_items").delete().eq("order_id", orderId);
  }

  // 2. Delete order row
  let q = supabase.from("orders").delete();
  if (isUuid) {
    q = q.eq("id", orderId);
  } else {
    q = q.eq("order_number", Number(orderId));
  }

  const { data, error } = await q.select();
  if (error) throw new Error(formatError(error));
  return data;
}

export default supabase;
