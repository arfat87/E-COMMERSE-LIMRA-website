/**
 * =============================================================================
 * LIMRA RESTAURANT POS — SETTINGS & STAFF RBAC ENGINE (pos/settings-staff.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Role-Based Access Control (RBAC) role normalization & permission checking.
 * 2. Staff directory CRUD synced with database (public.admin_users) & cache.
 * 3. Dynamic UI restriction enforcement for restricted roles.
 * 4. Settings hub subtab navigation & WhatsApp / Google Sheets sync tracking.
 */

import { insforge } from '../lib/insforge.js';
import { posState, posEvents } from './state.js';
import { escapeHtml } from './pos-utils.js';
import { showAdminToast } from './audio-alerts.js';

// ── RBAC Permissions Matrix ───────────────────────────────────────────
export const ROLE_WORKSPACE_PERMISSIONS = {
  owner: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  admin: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  manager: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  cashier: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods'],
  kitchen: ['kitchen'],
  waiter: ['tables', 'orders', 'kitchen'],
  captain: ['tables', 'orders', 'kitchen']
};

/**
 * Normalizes input role string to canonical system role.
 */
export function normalizeStaffRole(role) {
  if (!role) return 'cashier';
  const r = String(role).toLowerCase().trim();
  if (r.includes('owner')) return 'owner';
  if (r.includes('manager')) return 'manager';
  if (r.includes('chef') || r.includes('kitchen') || r.includes('cook')) return 'kitchen';
  if (r.includes('waiter') || r.includes('captain') || r.includes('service')) return 'waiter';
  if (r.includes('cashier') || r.includes('billing')) return 'cashier';
  if (r.includes('admin')) return 'admin';
  return 'cashier';
}

/**
 * Checks whether user has permission to access a workspace or action.
 */
export function hasStaffPermission(workspaceOrAction, userRole = null, currentAdminUser = null) {
  const effectiveUser = currentAdminUser || posState.getCurrentUser();
  const role = normalizeStaffRole(userRole || effectiveUser?.role || 'owner');
  const allowed = ROLE_WORKSPACE_PERMISSIONS[role] || ROLE_WORKSPACE_PERMISSIONS.cashier;
  return allowed.includes(workspaceOrAction);
}

/**
 * Dynamically hides/shows sidebar navigation items and actions according to user role.
 */
export function applyStaffRoleUIRestrictions(currentUser = null) {
  const user = currentUser || posState.getCurrentUser();
  const role = normalizeStaffRole(user?.role || 'owner');
  const allowedWorkspaces = ROLE_WORKSPACE_PERMISSIONS[role] || ROLE_WORKSPACE_PERMISSIONS.cashier;

  // 1. Hide/show workspace buttons in sidebar
  if (typeof document !== 'undefined') {
    document.querySelectorAll('#sidebar .adm-nav .adm-nav-item[data-panel]').forEach(btn => {
      const panel = btn.dataset.panel;
      const isAllowed = allowedWorkspaces.includes(panel);
      btn.classList.toggle('adm-role-restricted', !isAllowed);
      btn.style.display = isAllowed ? '' : 'none';
    });

    // 2. Hide/show action buttons based on privilege
    if (role === 'cashier' || role === 'kitchen' || role === 'waiter') {
      const voidBtn = document.getElementById('btn-open-closed-order-modal');
      if (voidBtn) voidBtn.style.display = 'none';
    }

    // 3. Update header staff identity pill
    const greeting = document.getElementById('admin-greeting');
    if (greeting && user) {
      greeting.innerHTML = `Hello, <strong>${escapeHtml(user.name || 'Staff')}</strong> <span style="font-size:0.75rem;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#b45309;font-weight:800;margin-left:4px;">${role.toUpperCase()}</span>`;
    }
  }
}

// ── Default Staff Baseline ────────────────────────────────────────────
export const DEFAULT_STAFF_MEMBERS = [
  { id: 'st-1', name: 'Salim Khan', role: 'Store Manager', phone: '+91 99887 76655', email: 'salim@limra.com', shift: '10:00 AM - 08:00 PM', status: 'on_duty', is_active: true, notes: 'Master admin & operations' },
  { id: 'st-2', name: 'Rahul Sharma', role: 'Head Chef / Kitchen', phone: '+91 98765 43210', email: 'rahul@limra.com', shift: '11:00 AM - 11:00 PM', status: 'on_duty', is_active: true, notes: 'Main kitchen & Tandoor in-charge' },
  { id: 'st-3', name: 'Imran Ansari', role: 'Service Captain', phone: '+91 98123 45678', email: 'imran@limra.com', shift: '12:00 PM - 11:30 PM', status: 'on_duty', is_active: true, notes: 'Dining hall & QR tables manager' },
  { id: 'st-4', name: 'Danish Ali', role: 'Delivery Rider', phone: '+91 97234 56789', email: 'danish@limra.com', shift: '01:00 PM - 11:00 PM', status: 'on_duty', is_active: true, notes: 'Vehicle DL-3S-8821' },
  { id: 'st-5', name: 'Afzal Qureshi', role: 'POS Cashier', phone: '+91 96345 67890', email: 'afzal@limra.com', shift: '10:00 AM - 07:00 PM', status: 'off_duty', is_active: false, notes: 'Counter billing & settlements' }
];

let dbStaffMembers = [];

/**
 * Loads staff members from public.admin_users with local fallback cache.
 */
export async function loadStaffMembersFromDB() {
  try {
    const { data, error } = await insforge.database
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) {
      dbStaffMembers = data.map(s => ({
        id: s.id,
        user_id: s.user_id,
        name: s.name || (s.email ? s.email.split('@')[0] : 'Staff'),
        role: s.role || 'cashier',
        status: s.status || (s.is_active ? 'on_duty' : 'off_duty'),
        is_active: typeof s.is_active === 'boolean' ? s.is_active : s.status === 'on_duty',
        phone: s.phone || '',
        email: s.email || '',
        shift: s.shift || '10:00 AM - 08:00 PM',
        notes: s.notes || ''
      }));
      try {
        localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[Staff DB Load Notice]:', err.message);
    try {
      const cached = localStorage.getItem('limra_staff_members_cache');
      if (cached) dbStaffMembers = JSON.parse(cached);
    } catch (e) {}
  }
  if (!dbStaffMembers || dbStaffMembers.length === 0) {
    dbStaffMembers = [...DEFAULT_STAFF_MEMBERS];
  }
  return dbStaffMembers;
}

export function getStaffList() {
  return (Array.isArray(dbStaffMembers) && dbStaffMembers.length > 0) ? dbStaffMembers : DEFAULT_STAFF_MEMBERS;
}

/**
 * Creates or updates a staff member record in public.admin_users.
 */
export async function saveStaffMemberToDB(staffData) {
  const { id, name, role, status, phone, email, shift, notes } = staffData;
  const normalizedRole = normalizeStaffRole(role);
  const isActive = status === 'on_duty';

  if (id && !String(id).startsWith('st-')) {
    // Existing DB record
    const { error } = await insforge.database
      .from('admin_users')
      .update({
        name,
        role: normalizedRole,
        status,
        is_active: isActive,
        phone,
        email: email || undefined,
        shift,
        notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    if (error) throw error;
  } else {
    // New DB record
    const cleanEmail = email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff' + Date.now()}@limra.pos`;
    const { error } = await insforge.database
      .from('admin_users')
      .insert([{
        name,
        role: normalizedRole,
        status,
        is_active: isActive,
        phone,
        email: cleanEmail,
        shift: shift || '10:00 AM - 08:00 PM',
        notes
      }]);
    if (error) throw error;
  }
  await loadStaffMembersFromDB();
}

/**
 * Deletes a staff member record from public.admin_users.
 */
export async function deleteStaffMemberFromDB(staffId) {
  if (!staffId) return;
  if (!String(staffId).startsWith('st-')) {
    const { error } = await insforge.database
      .from('admin_users')
      .delete()
      .eq('id', staffId);
    if (error) throw error;
  }
  dbStaffMembers = dbStaffMembers.filter(s => String(s.id) !== String(staffId));
  try {
    localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
  } catch (e) {}
  await loadStaffMembersFromDB();
}

/**
 * Toggles a staff member's duty status (on_duty vs off_duty).
 */
export async function toggleStaffStatusInDB(staffId, newStatus) {
  const isActive = newStatus === 'on_duty';
  if (staffId && !String(staffId).startsWith('st-')) {
    const { error } = await insforge.database
      .from('admin_users')
      .update({
        status: newStatus,
        is_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', staffId);
    if (error) throw error;
  }
  const target = dbStaffMembers.find(s => String(s.id) === String(staffId));
  if (target) {
    target.status = newStatus;
    target.is_active = isActive;
  }
  try {
    localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
  } catch (e) {}
}

/**
 * Renders staff directory table into DOM container.
 */
export function renderStaffList(staffMembers = null, tbodyId = 'staff-table-body') {
  if (typeof document === 'undefined') return;
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const list = staffMembers || getStaffList();
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--adm-muted);">No staff members found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => {
    const isOnDuty = s.status === 'on_duty';
    const roleKey = normalizeStaffRole(s.role);
    const badgeColor = roleKey === 'owner' ? '#ef4444' : roleKey === 'manager' ? '#8b5cf6' : roleKey === 'kitchen' ? '#f59e0b' : '#3b82f6';

    return `
      <tr data-staff-id="${s.id}">
        <td style="font-weight:700;color:var(--adm-text-primary);">${escapeHtml(s.name)}</td>
        <td>
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:${badgeColor}15;color:${badgeColor};border:1px solid ${badgeColor}30;">
            ${escapeHtml(s.role)}
          </span>
        </td>
        <td style="color:var(--adm-muted);">${escapeHtml(s.phone || '—')}</td>
        <td style="color:var(--adm-muted);">${escapeHtml(s.shift || '10:00 AM - 08:00 PM')}</td>
        <td>
          <span class="adm-badge ${isOnDuty ? 'adm-badge-success' : 'adm-badge-secondary'}" style="cursor:pointer;" onclick="window.toggleStaffStatusInDB && window.toggleStaffStatusInDB('${s.id}', '${isOnDuty ? 'off_duty' : 'on_duty'}')">
            ● ${isOnDuty ? 'On Duty' : 'Off Duty'}
          </span>
        </td>
        <td style="color:var(--adm-muted);font-size:0.8rem;">${escapeHtml(s.notes || '—')}</td>
        <td style="text-align:right;">
          <button class="adm-btn adm-btn-outline adm-btn-sm" onclick="window.openStaffModal && window.openStaffModal('${s.id}')" style="margin-right:4px;">Edit</button>
          <button class="adm-btn adm-btn-danger adm-btn-sm" onclick="window.deleteStaffMemberFromDB && window.deleteStaffMemberFromDB('${s.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}
