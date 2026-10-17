/**
 * LIMRA Restaurant — Startup Environment & Secret Configuration Validator
 * 
 * Verifies environment configuration at startup without ever exposing or printing
 * secret values. Emits clear, actionable diagnostics for local dev and production.
 */

export function validateStartupConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  const diagnostics = [];
  const errors = [];
  const warnings = [];

  function record(category, key, isSecret, validator) {
    const rawVal = process.env[key];
    const isPresent = Boolean(rawVal && String(rawVal).trim());

    if (!isPresent) {
      const res = validator(null, isProduction);
      diagnostics.push({
        category,
        key,
        status: res.required ? "MISSING (REQUIRED)" : "UNCONFIGURED (OPTIONAL)",
        level: res.required ? "ERROR" : "INFO",
        notes: res.notes
      });
      if (res.required) errors.push(`${key}: ${res.notes}`);
      else if (res.warning) warnings.push(`${key}: ${res.notes}`);
      return;
    }

    const res = validator(String(rawVal).trim(), isProduction);
    diagnostics.push({
      category,
      key,
      status: res.valid ? "CONFIGURED" : "CONFIGURED (WARNING)",
      level: res.valid ? "OK" : "WARN",
      notes: res.notes
    });
    if (!res.valid && res.warning) {
      warnings.push(`${key}: ${res.notes}`);
    }
  }

  // 1. Supabase PostgreSQL Configuration
  record("Database", "SUPABASE_URL", false, (val, prod) => {
    if (!val) return { required: true, notes: "Backend cannot connect to database without Supabase URL." };
    if (val.includes("<your-project") || val.includes("your-project.supabase.co")) {
      return { valid: false, warning: true, notes: "Placeholder URL detected. Update with your real project URL." };
    }
    if (!val.startsWith("https://")) {
      return { valid: false, warning: true, notes: "URL should use secure HTTPS protocol." };
    }
    return { valid: true, notes: "Valid Supabase endpoint format." };
  });

  record("Database", "SUPABASE_ANON_KEY", true, (val, prod) => {
    if (!val) return { required: true, notes: "Supabase anon/public key is required for API access." };
    if (!val.startsWith("eyJ")) {
      return { valid: false, warning: true, notes: "Key does not appear to be standard Supabase JWT format." };
    }
    return { valid: true, notes: "Valid JWT token format." };
  });

  record("Database", "SUPABASE_SERVICE_ROLE_KEY", true, (val, prod) => {
    if (!val) {
      return {
        required: false,
        warning: true,
        notes: "Missing service-role key. Server falls back to anon key; privileged operations may be blocked by RLS."
      };
    }
    if (!val.startsWith("eyJ")) {
      return { valid: false, warning: true, notes: "Key does not appear to be standard Supabase JWT format." };
    }
    return { valid: true, notes: "Server admin service-role key is loaded." };
  });

  // 2. Razorpay Payment Gateway Configuration
  record("Payments", "RAZORPAY_KEY_ID", false, (val, prod) => {
    if (!val) return { required: prod, warning: !prod, notes: "Required for online Razorpay payments." };
    if (prod && val.startsWith("rzp_test_")) {
      return { valid: false, warning: true, notes: "Test-mode key (rzp_test_*) is active in production environment." };
    }
    return { valid: true, notes: val.startsWith("rzp_live_") ? "Live production key active." : "Test mode key active." };
  });

  record("Payments", "RAZORPAY_KEY_SECRET", true, (val, prod) => {
    if (!val) return { required: prod, warning: !prod, notes: "Required on server for HMAC payment signature verification." };
    if (val.length < 10) return { valid: false, warning: true, notes: "Secret appears unusually short." };
    return { valid: true, notes: "Payment secret loaded securely on server." };
  });

  record("Payments", "RAZORPAY_WEBHOOK_SECRET", true, (val, prod) => {
    if (!val) return { required: false, warning: prod, notes: "Recommended for verifying asynchronous payment webhook events." };
    return { valid: true, notes: "Webhook verification secret loaded." };
  });

  // 3. Notification & SMS Gateways (Optional)
  record("SMS/Messaging", "FAST2SMS_API_KEY", true, (val) => {
    if (!val) return { required: false, notes: "Optional: Fast2SMS API key for Indian SMS delivery." };
    return { valid: true, notes: "Fast2SMS gateway active." };
  });

  record("SMS/Messaging", "WHATSAPP_ACCESS_TOKEN", true, (val) => {
    if (!val) return { required: false, notes: "Optional: Meta WhatsApp Cloud API access token." };
    return { valid: true, notes: "WhatsApp Cloud API active." };
  });

  // Print startup audit banner
  console.log("--------------------------------------------------");
  console.log("🛡️  LIMRA CONFIGURATION & SECRET AUDIT (STARTUP)");
  console.log(`🌍 Environment: ${isProduction ? "PRODUCTION" : "DEVELOPMENT"}`);
  console.log("--------------------------------------------------");

  for (const diag of diagnostics) {
    const icon = diag.level === "OK" ? "✅" : (diag.level === "WARN" ? "⚠️ " : "❌");
    console.log(`${icon} [${diag.category}] ${diag.key}: ${diag.status}`);
    if (diag.level !== "OK") {
      console.log(`   └─ Notice: ${diag.notes}`);
    }
  }

  console.log("--------------------------------------------------");

  if (errors.length > 0) {
    console.error(`🚨 Startup Configuration Errors (${errors.length}):`);
    errors.forEach(e => console.error(`   - ${e}`));
  }

  if (warnings.length > 0) {
    console.warn(`💡 Startup Configuration Notices (${warnings.length}):`);
    warnings.forEach(w => console.warn(`   - ${w}`));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    diagnostics
  };
}
