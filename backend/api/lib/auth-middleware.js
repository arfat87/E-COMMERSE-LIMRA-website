import { supabase } from "./supabase.js";

/**
 * Extract Bearer token from request headers or query params
 */
export function extractBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && typeof authHeader === "string") {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      return parts[1];
    }
    // Handle bare token in authorization header
    if (parts.length === 1 && parts[0].length > 20) {
      return parts[0];
    }
  }

  if (req.headers?.["x-access-token"]) {
    return String(req.headers["x-access-token"]).trim();
  }

  if (req.query?.access_token) {
    return String(req.query.access_token).trim();
  }

  return null;
}

/**
 * Authenticate request via Supabase Auth token and identify user role.
 * 
 * Supported staff roles:
 * - 'owner': Full administrative and system control
 * - 'manager': Operations, inventory, pricing, analytics, orders
 * - 'cashier': POS, billing, orders, tables, payments
 * - 'kitchen': Orders viewing, status updates (preparing/ready), prep stock deductions
 * - 'customer': Verified or authenticated end customer
 * 
 * @param {object} req - HTTP request object
 * @returns {Promise<{ user: object|null, role: string|null, error: string|null }>}
 */
export async function authenticateUser(req) {
  if (req.user) {
    return { user: req.user, role: req.role || req.userRole || req.user.role || "customer", error: null };
  }

  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, role: null, error: "Missing authorization token" };
  }

  try {
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return { user: null, role: null, error: authErr?.message || "Invalid or expired token" };
    }

    const user = authData.user;
    const cleanEmail = (user.email || "").toLowerCase().trim();

    // Check admin_users table for assigned role
    let role = "customer";
    try {
      const { data: adminRows } = await supabase
        .from("admin_users")
        .select("role, email, user_id")
        .or(`user_id.eq.${user.id},email.eq.${cleanEmail}`)
        .limit(1);

      if (adminRows && adminRows.length > 0) {
        role = (adminRows[0].role || "admin").toLowerCase().trim();
      }
    } catch (dbErr) {
      console.warn("[Auth Middleware Role Lookup Notice]:", dbErr.message);
    }

    return { user, role, error: null };
  } catch (err) {
    return { user: null, role: null, error: err.message || "Authentication error" };
  }
}

/**
 * Require valid authenticated user. Responds with 401 if unauthenticated.
 */
export async function requireAuth(req, res) {
  const auth = await authenticateUser(req);
  if (!auth.user) {
    res.status(401).json({
      success: false,
      error: auth.error || "Unauthorized. Valid authentication credentials required."
    });
    return null;
  }
  return auth;
}

/**
 * Role hierarchy evaluation:
 * - 'owner' satisfies all roles
 * - 'manager' / 'admin' satisfies manager, cashier, kitchen
 * - 'cashier' satisfies cashier
 * - 'kitchen' satisfies kitchen
 */
export function hasRequiredRole(userRole, allowedRoles) {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false;
  const role = userRole.toLowerCase().trim();
  const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase().trim());

  if (role === "owner") return true;

  if (role === "admin" || role === "manager") {
    if (normalizedAllowed.includes("admin") || normalizedAllowed.includes("manager")) return true;
    if (normalizedAllowed.includes("cashier") || normalizedAllowed.includes("kitchen")) return true;
    return false;
  }

  if (role === "cashier") {
    return normalizedAllowed.includes("cashier");
  }

  if (role === "kitchen") {
    return normalizedAllowed.includes("kitchen");
  }

  return normalizedAllowed.includes(role);
}

/**
 * Require user to possess one of the allowed roles.
 * Responds with 401 if unauthenticated, 403 if role insufficient.
 * 
 * @param {object} req 
 * @param {object} res 
 * @param {string[]} allowedRoles 
 * @returns {Promise<{ user: object, role: string }|null>}
 */
export async function requireRole(req, res, allowedRoles = []) {
  const auth = await authenticateUser(req);
  if (!auth.user) {
    res.status(401).json({
      success: false,
      error: auth.error || "Unauthorized. Please log in to perform this action."
    });
    return null;
  }

  if (allowedRoles.length > 0 && !hasRequiredRole(auth.role, allowedRoles)) {
    res.status(403).json({
      success: false,
      error: `Forbidden. Role '${auth.role}' is not authorized to access this resource. Allowed roles: [${allowedRoles.join(", ")}]`
    });
    return null;
  }

  return auth;
}
