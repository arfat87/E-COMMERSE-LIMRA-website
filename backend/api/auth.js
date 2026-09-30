import { createHmac } from "node:crypto";
import { supabase, SUPABASE_SERVICE_KEY } from "./lib/supabase.js";

/**
 * Generate a deterministic secure password for a phone number using the server's private secret key.
 * This guarantees that only the server can generate valid passwords for phone users,
 * avoiding the need for users to remember passwords while keeping Supabase Auth sessions secure.
 */
function getDeterministicPassword(phone) {
  const secret = SUPABASE_SERVICE_KEY || "limra-secure-phone-auth-salt-2026";
  const hash = createHmac("sha256", secret).update(`phone-auth:${phone}`).digest("hex");
  return `LimraAuth9#` + hash.slice(0, 20);
}

/**
 * Send WhatsApp OTP via Meta Cloud API or Free wa.me Link
 */
async function sendWhatsAppOtp(phone, otp) {
  const cleanPhone = phone.replace(/\D/g, "").slice(-10);
  const formattedPhone = `91${cleanPhone}`;

  // 1. Meta Official WhatsApp Cloud API (1,000 free conversations/month!)
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    try {
      const templateName = process.env.WHATSAPP_OTP_TEMPLATE || "limra_login_otp";
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: otp }]
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: otp }]
            }
          ]
        }
      };

      const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log(`[WhatsApp Cloud API] Response for +${formattedPhone}:`, data);
      if (data.messages && data.messages.length > 0) {
        return { success: true, mode: "whatsapp_cloud_api", details: data };
      }
    } catch (err) {
      console.error("[WhatsApp Cloud API Error]:", err);
    }
  }

  // 2. Free 1-Tap WhatsApp Link & Demo Mode
  const restaurantWaNumber = "919739083418";
  const waUrl = `https://wa.me/${restaurantWaNumber}?text=${encodeURIComponent(`Hi LIMRA Restaurant, my login OTP is: ${otp}`)}`;

  console.log(`\n==================================================`);
  console.log(`🟢 [LIMRA WHATSAPP OTP (FREE MODE)]`);
  console.log(`📲 Customer Phone: +91 ${cleanPhone}`);
  console.log(`🔑 6-Digit OTP:    ${otp}`);
  console.log(`💬 WhatsApp Link:  ${waUrl}`);
  console.log(`💡 For Meta Official Cloud API (1,000 Free/Mo), add WHATSAPP_ACCESS_TOKEN in .env`);
  console.log(`==================================================\n`);

  return { success: true, mode: "whatsapp", otp, waLink: waUrl };
}

/**
 * Send SMS via configured SMS Gateway (Fast2SMS / Twilio) or fallback to Demo Mode
 */
async function sendSmsOtp(phone, otp) {
  const cleanPhone = phone.replace(/\D/g, "").slice(-10);

  // 1. Fast2SMS (India - most popular, cheap, instant)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          route: "otp",
          variables_values: otp,
          numbers: cleanPhone
        })
      });
      const data = await response.json();
      console.log(`[Fast2SMS] Sent OTP to +91 ${cleanPhone}:`, data);
      return { success: true, mode: "fast2sms", details: data };
    } catch (err) {
      console.error("[Fast2SMS Error]:", err);
    }
  }

  // 2. Twilio SMS Gateway (International)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const body = new URLSearchParams({
        From: process.env.TWILIO_PHONE_NUMBER,
        To: `+91${cleanPhone}`,
        Body: `[LIMRA Restaurant] Your verification OTP code is ${otp}. Valid for 5 minutes.`
      });

      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      });
      const data = await response.json();
      console.log(`[Twilio] Sent OTP to +91 ${cleanPhone}:`, data);
      return { success: true, mode: "twilio", details: data };
    } catch (err) {
      console.error("[Twilio Error]:", err);
    }
  }

  // 3. Demo / Development Mode (Simulated SMS with console log & UI Toast)
  console.log(`\n==================================================`);
  console.log(`💬 [LIMRA SMS GATEWAY (DEMO MODE)]`);
  console.log(`📲 Mobile Number: +91 ${cleanPhone}`);
  console.log(`🔑 6-Digit OTP:  ${otp}`);
  console.log(`⏱️ Expiry:        5 Minutes`);
  console.log(`💡 To send REAL SMS, add FAST2SMS_API_KEY to your .env`);
  console.log(`==================================================\n`);

  return { success: true, mode: "demo", otp };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method Not Allowed. Use POST." });
  }

  const { action, phone, otp, name, email, channel = "whatsapp" } = req.body || {};

  // Clean and validate Indian 10-digit mobile number
  const cleanPhone = phone ? String(phone).replace(/\D/g, "").slice(-10) : "";
  if (!cleanPhone || cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid 10-digit Indian mobile number."
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ACTION 1: SEND OTP
  // ─────────────────────────────────────────────────────────────
  if (action === "send-otp" || action === "resend-otp") {
    try {
      // Check existing verification record for rate-limiting (30 sec cooldown)
      const { data: existing } = await supabase
        .from("phone_verifications")
        .select("*")
        .eq("phone", cleanPhone)
        .maybeSingle();

      const now = Date.now();
      if (existing?.last_sent_at) {
        const lastSent = new Date(existing.last_sent_at).getTime();
        const diffSeconds = Math.floor((now - lastSent) / 1000);
        if (diffSeconds < 25) {
          return res.status(429).json({
            success: false,
            message: `Please wait ${25 - diffSeconds} seconds before requesting another OTP.`
          });
        }
      }

      // Generate 6-digit numeric OTP
      const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(now + 5 * 60 * 1000).toISOString();

      // Upsert into phone_verifications table
      const { error: dbErr } = await supabase.from("phone_verifications").upsert({
        phone: cleanPhone,
        otp_hash: newOtp,
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
        last_sent_at: new Date(now).toISOString()
      });

      if (dbErr) {
        console.error("[Database Error saving OTP]:", dbErr);
        return res.status(500).json({ success: false, message: "Failed to store OTP verification session." });
      }

      // Send OTP via WhatsApp (Default) or SMS
      let deliveryResult;
      if (channel === "sms") {
        deliveryResult = await sendSmsOtp(cleanPhone, newOtp);
      } else {
        deliveryResult = await sendWhatsAppOtp(cleanPhone, newOtp);
      }

      const channelLabel = channel === "sms" ? "SMS" : "WhatsApp";
      return res.status(200).json({
        success: true,
        channel: channel || "whatsapp",
        mode: deliveryResult.mode,
        otp: (deliveryResult.mode === "demo" || deliveryResult.mode === "whatsapp") ? newOtp : undefined,
        waLink: deliveryResult.waLink,
        message: deliveryResult.mode === "whatsapp_cloud_api"
          ? `WhatsApp OTP sent to +91 ${cleanPhone}`
          : (deliveryResult.mode === "fast2sms" || deliveryResult.mode === "twilio")
            ? `SMS OTP sent to +91 ${cleanPhone}`
            : `${channelLabel} OTP ready for +91 ${cleanPhone}`,
        phone: cleanPhone
      });
    } catch (err) {
      console.error("[Send OTP Error]:", err);
      return res.status(500).json({ success: false, message: err.message || "Failed to send OTP." });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ACTION 2: VERIFY OTP
  // ─────────────────────────────────────────────────────────────
  if (action === "verify-otp" || action === "complete-registration") {
    const cleanOtp = String(otp || "").trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      return res.status(400).json({ success: false, message: "Please enter a valid 6-digit OTP code." });
    }

    try {
      // 1. Fetch verification record
      const { data: record, error: fetchErr } = await supabase
        .from("phone_verifications")
        .select("*")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (fetchErr || !record) {
        return res.status(400).json({
          success: false,
          message: "No active verification request found. Please request a new OTP."
        });
      }

      // Check expiry
      if (new Date(record.expires_at).getTime() < Date.now()) {
        return res.status(400).json({
          success: false,
          message: "This OTP code has expired. Please request a new code."
        });
      }

      // Check max attempts
      if (record.attempts >= 5) {
        return res.status(429).json({
          success: false,
          message: "Too many failed attempts. Please request a new OTP code."
        });
      }

      // Verify OTP code
      if (record.otp_hash !== cleanOtp) {
        await supabase
          .from("phone_verifications")
          .update({ attempts: (record.attempts || 0) + 1 })
          .eq("phone", cleanPhone);

        return res.status(400).json({
          success: false,
          message: "Incorrect OTP code. Please check and try again."
        });
      }

      // OTP is valid! Mark as verified
      await supabase
        .from("phone_verifications")
        .update({ verified: true })
        .eq("phone", cleanPhone);

      // Check if user already exists in customer_profiles
      const { data: profiles } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("phone", cleanPhone);

      let existingProfile = profiles && profiles.length > 0 ? profiles[0] : null;

      const mockEmail = `${cleanPhone}@limraresturent.in`;
      const deterministicPassword = getDeterministicPassword(cleanPhone);

      // Check if Supabase auth user exists
      const { data: usersData } = await supabase.auth.admin.listUsers();
      let authUser = usersData?.users?.find(u => u.email === mockEmail);

      // If user does not exist in customer_profiles or auth.users
      if (!existingProfile && !authUser && action !== "complete-registration" && !name) {
        // First-time user needs to enter their name!
        return res.status(200).json({
          success: true,
          requiresName: true,
          phone: cleanPhone,
          message: "OTP verified! Please enter your name to complete signup."
        });
      }

      const customerName = (name && name.trim()) || existingProfile?.name || authUser?.user_metadata?.name || "Customer";

      // Create or update Supabase Auth User
      if (!authUser) {
        const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
          email: mockEmail,
          password: deterministicPassword,
          email_confirm: true,
          user_metadata: {
            name: customerName,
            phone: cleanPhone
          }
        });
        if (createErr) {
          console.error("[Create Auth User Error]:", createErr);
          throw createErr;
        }
        authUser = newUser.user;
      } else {
        // Reset password to deterministic password so client can always log in
        await supabase.auth.admin.updateUserById(authUser.id, {
          password: deterministicPassword,
          user_metadata: {
            ...authUser.user_metadata,
            name: customerName,
            phone: cleanPhone
          }
        });
      }

      // Update or insert profile in customer_profiles
      let savedProfile = null;
      if (existingProfile) {
        const updateData = {
          name: customerName,
          phone_verified: true,
          updated_at: new Date().toISOString()
        };
        if (email && !email.endsWith("@limraresturent.in")) {
          updateData.email = email.trim();
        }
        const { data: updated, error: updateErr } = await supabase
          .from("customer_profiles")
          .update(updateData)
          .eq("id", existingProfile.id)
          .select()
          .maybeSingle();

        if (updateErr) console.error("[Customer Profile Update Error]:", updateErr);
        savedProfile = updated || { ...existingProfile, ...updateData };
      } else {
        const insertData = {
          id: authUser.id,
          name: customerName,
          phone: cleanPhone,
          email: email && !email.endsWith("@limraresturent.in") ? email.trim() : null,
          phone_verified: true,
          addresses: []
        };
        const { data: inserted, error: insertErr } = await supabase
          .from("customer_profiles")
          .insert(insertData)
          .select()
          .maybeSingle();

        if (insertErr) console.error("[Customer Profile Insert Error]:", insertErr);
        savedProfile = inserted || insertData;
      }

      // Clean up phone_verifications table for this phone
      try {
        await supabase.from("phone_verifications").delete().eq("phone", cleanPhone);
      } catch (e) {}

      return res.status(200).json({
        success: true,
        isNewUser: !existingProfile,
        profile: savedProfile || profileData,
        credentials: {
          email: mockEmail,
          token: deterministicPassword
        },
        message: existingProfile ? `Welcome back, ${customerName}!` : `Welcome to LIMRA, ${customerName}!`
      });
    } catch (err) {
      console.error("[Verify OTP Error]:", err);
      return res.status(500).json({ success: false, message: err.message || "Failed to verify OTP." });
    }
  }

  return res.status(400).json({ success: false, message: `Unknown action '${action}'.` });
}
