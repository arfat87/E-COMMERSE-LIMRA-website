/**
 * LIMRA Restaurant — Apply Security Fix Migration
 * Uses the InsForge admin API key to call migrations via the correct endpoints.
 * Usage: node scripts/apply-security-fix.mjs
 */
import { createAdminClient } from '@insforge/sdk';

const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

// Admin client — uses API key, bypasses anon RLS
const admin = createAdminClient({ baseUrl: BASE_URL, apiKey: API_KEY });

// ── Helper: run raw SQL via the /api/database/sql endpoint ─────────────────
async function runSQL(label, sql) {
  const res = await fetch(`${BASE_URL}/api/database/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ sql }),
  });

  const body = await res.text();

  if (!res.ok) {
    // Try alternative endpoint
    const res2 = await fetch(`${BASE_URL}/api/migrations/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ sql }),
    });
    const body2 = await res2.text();
    if (!res2.ok) {
      throw new Error(`${res.status}/${res2.status}: ${body.slice(0,200)}`);
    }
    return body2;
  }
  return body;
}

// ── SQL Blocks ──────────────────────────────────────────────────────────────
const BLOCKS = [
  {
    label: 'Block 1 — Remove anon INSERT on order_items',
    sql: `
DROP POLICY IF EXISTS "Public can create order items" ON public.order_items;
CREATE POLICY "Admins can insert order items"
  ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
    `.trim(),
  },
  {
    label: 'Block 2 — Fix is_admin() search_path',
    sql: `
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid()));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
    `.trim(),
  },
  {
    label: 'Block 3 — Fix place_order() search_path',
    sql: `
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text, p_customer_phone text,
  p_notes text DEFAULT NULL, p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  jsonb;
  v_total numeric := 0;
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Order must have at least one item'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;
  INSERT INTO public.orders (customer_name, customer_phone, total_amount, notes, status)
  VALUES (trim(p_customer_name), trim(p_customer_phone), v_total, NULLIF(trim(COALESCE(p_notes,'')), ''), 'pending')
  RETURNING * INTO v_order;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity, unit_price, line_total)
    VALUES (
      v_order.id,
      CASE WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL THEN (v_item->>'menu_item_id')::integer ELSE NULL END,
      v_item->>'item_name', GREATEST((v_item->>'quantity')::integer, 1),
      (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric
    );
  END LOOP;
  RETURN jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'total_amount', v_order.total_amount, 'status', v_order.status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb) TO anon, authenticated;
    `.trim(),
  },
  {
    label: 'Block 4 — Fix place_booking() search_path',
    sql: `
CREATE OR REPLACE FUNCTION public.place_booking(
  p_type text, p_customer_name text, p_customer_phone text,
  p_booking_date date DEFAULT NULL, p_booking_time text DEFAULT NULL,
  p_guests integer DEFAULT NULL, p_preference text DEFAULT NULL,
  p_seat_label text DEFAULT NULL, p_event_type text DEFAULT NULL,
  p_budget text DEFAULT NULL, p_catering text DEFAULT NULL,
  p_venue text DEFAULT NULL, p_message text DEFAULT NULL, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
  INSERT INTO public.bookings (type, customer_name, customer_phone, booking_date, booking_time, guests, preference, seat_label, event_type, budget, catering, venue, message, notes, status)
  VALUES (p_type, trim(p_customer_name), trim(p_customer_phone), p_booking_date, p_booking_time, p_guests, p_preference, p_seat_label, p_event_type, p_budget, p_catering, p_venue, p_message, p_notes, 'pending')
  RETURNING * INTO v_booking;
  RETURN jsonb_build_object('id', v_booking.id, 'booking_number', v_booking.booking_number, 'status', v_booking.status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) TO anon, authenticated;
    `.trim(),
  },
  {
    label: 'Block 5 — Fix get_customer_bookings() search_path',
    sql: `
CREATE OR REPLACE FUNCTION public.get_customer_bookings(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC) FROM (
      SELECT booking_number, type, customer_name, booking_date, booking_time, guests, seat_label, status, created_at
      FROM public.bookings
      WHERE regexp_replace(customer_phone, '\\D', '', 'g') = v_phone
         OR regexp_replace(customer_phone, '\\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(customer_phone, '\\D', '', 'g')
      ORDER BY created_at DESC LIMIT 20
    ) t
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_customer_bookings(text) TO anon, authenticated;
    `.trim(),
  },
  {
    label: 'Block 6 — Fix get_customer_orders() search_path',
    sql: `
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC) FROM (
      SELECT o.order_number, o.customer_name, o.total_amount, o.status, o.created_at,
        (SELECT jsonb_agg(jsonb_build_object('item_name', oi.item_name, 'quantity', oi.quantity, 'line_total', oi.line_total) ORDER BY oi.item_name)
         FROM public.order_items oi WHERE oi.order_id = o.id) AS items
      FROM public.orders o
      WHERE regexp_replace(o.customer_phone, '\\D', '', 'g') = v_phone
         OR regexp_replace(o.customer_phone, '\\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(o.customer_phone, '\\D', '', 'g')
      ORDER BY o.created_at DESC LIMIT 20
    ) t
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;
    `.trim(),
  },
];

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' LIMRA Restaurant — Security Fix Migration');
  console.log('═══════════════════════════════════════════════════\n');

  // First, probe which SQL endpoints exist
  console.log('Probing available SQL endpoints...');
  const probeEndpoints = [
    '/api/database/sql',
    '/api/migrations/run',
    '/api/sql',
    '/api/v1/database/sql',
  ];

  let workingEndpoint = null;
  for (const ep of probeEndpoints) {
    try {
      const r = await fetch(`${BASE_URL}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ sql: 'SELECT 1;' }),
      });
      const body = await r.text();
      console.log(`  ${ep} → ${r.status} ${body.slice(0, 60)}`);
      if (r.status !== 404) {
        workingEndpoint = ep;
      }
    } catch (e) {
      console.log(`  ${ep} → ERROR: ${e.message}`);
    }
  }

  if (!workingEndpoint) {
    console.log('\n⚠️  No direct SQL endpoint found.');
    console.log('The migration SQL is saved at: migrations/20260530_fix-security-issues.sql');
    console.log('Please run it manually via the InsForge SQL Editor at:');
    console.log('https://vb9ucr22.us-east.insforge.app/dashboard\n');
    return;
  }

  console.log(`\nUsing endpoint: ${workingEndpoint}\n`);

  let passed = 0;
  let failed = 0;

  for (const block of BLOCKS) {
    process.stdout.write(`▶ ${block.label} ... `);
    try {
      const r = await fetch(`${BASE_URL}${workingEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ sql: block.sql }),
      });
      const body = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 150)}`);
      console.log('✅ OK');
      passed++;
    } catch (err) {
      console.log(`❌ FAILED → ${err.message}`);
      failed++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(` Result: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
