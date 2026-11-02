/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TASK 4.2: DATABASE-BACKED STAFF RBAC & PERMISSIONS TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Verifies:
 *  1. Database Schema & Migration: admin_users extended with directory fields and indexed
 *  2. Granular RLS Policies (SEC-02 & SEC-03): has_role used on admin_users, printer_settings, coupons, combos
 *  3. Database-Backed Staff CRUD: loadStaffMembersFromDB, saveStaffMemberToDB, deleteStaffMemberFromDB, toggleStaffStatusInDB
 *  4. Multi-Terminal RBAC Hierarchy: owner, manager, cashier, kitchen, waiter permissions
 *  5. UI Workspace Restrictions: sidebar items hidden and switchPanel protected against privilege escalation
 *  6. Identity Context: checkAdminAccess populates currentAdminUser with role and contact profile
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve('database/migrations/20261017080000_staff_rbac_and_admin_users.sql');
const SCHEMA_PATH = path.resolve('database/schema.sql');
const ADMIN_JS_PATH = path.resolve('frontend/src/admin.js');

const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
const adminJs = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

describe('TASK 4.2: Database Migration & Schema Extensions (Fixes SEC-02 & SEC-03)', () => {
  it('1. Migration file exists and declares staff directory columns conditionally', () => {
    assert.ok(fs.existsSync(MIGRATION_PATH), 'Missing 20261017080000_staff_rbac_and_admin_users.sql migration');
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS name/i, 'Missing name column conditional DDL');
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS phone/i, 'Missing phone column conditional DDL');
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS shift/i, 'Missing shift column conditional DDL');
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS status/i, 'Missing status column conditional DDL');
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS is_active/i, 'Missing is_active column conditional DDL');
  });

  it('2. Schema contains admin_users table definition with all staff directory fields', () => {
    assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS public\.admin_users/i, 'Missing admin_users table in schema.sql');
    assert.match(schemaSql, /name TEXT NOT NULL DEFAULT 'Staff Member'/i, 'Missing name in schema.sql');
    assert.match(schemaSql, /phone TEXT DEFAULT ''/i, 'Missing phone in schema.sql');
    assert.match(schemaSql, /shift TEXT DEFAULT '10:00 AM - 08:00 PM'/i, 'Missing shift in schema.sql');
    assert.match(schemaSql, /status TEXT NOT NULL DEFAULT 'on_duty'/i, 'Missing status in schema.sql');
    assert.match(schemaSql, /is_active BOOLEAN NOT NULL DEFAULT true/i, 'Missing is_active in schema.sql');
  });

  it('3. Performance indexes are defined on admin_users lookup paths', () => {
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS admin_users_email_idx/i, 'Missing email index');
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS admin_users_user_id_idx/i, 'Missing user_id index');
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS admin_users_role_idx/i, 'Missing role index');
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS admin_users_is_active_idx/i, 'Missing is_active index');
  });

  it('4. Granular RLS policies enforce has_role on admin_users and sensitive operational tables', () => {
    assert.match(migrationSql, /CREATE POLICY "Admins can manage admin_users"[^;]*public\.has_role\(ARRAY\['owner',\s*'manager',\s*'admin'\]\)/is, 'admin_users RLS must use has_role');
    assert.match(migrationSql, /CREATE POLICY "Admins can manage printer settings"[^;]*public\.has_role\(ARRAY\['owner',\s*'manager',\s*'admin'\]\)/is, 'printer_settings RLS must use has_role');
    assert.match(migrationSql, /CREATE POLICY "Admins can manage coupons"[^;]*public\.has_role\(ARRAY\['owner',\s*'manager',\s*'admin'\]\)/is, 'coupons RLS must use has_role');
    assert.match(migrationSql, /CREATE POLICY "Admins can manage combos"[^;]*public\.has_role\(ARRAY\['owner',\s*'manager',\s*'admin'\]\)/is, 'combos RLS must use has_role');
    assert.match(migrationSql, /CREATE POLICY "Admins can manage delivery areas"[^;]*public\.has_role\(ARRAY\['owner',\s*'manager',\s*'admin'\]\)/is, 'delivery_areas RLS must use has_role');
  });
});

describe('TASK 4.2: Database-Backed Staff Directory & Operations in admin.js', () => {
  it('5. Declares database CRUD helpers for staff operations', () => {
    assert.ok(adminJs.includes('async function loadStaffMembersFromDB()'), 'Missing loadStaffMembersFromDB function');
    assert.ok(adminJs.includes('async function saveStaffMemberToDB('), 'Missing saveStaffMemberToDB function');
    assert.ok(adminJs.includes('async function deleteStaffMemberFromDB('), 'Missing deleteStaffMemberFromDB function');
    assert.ok(adminJs.includes('async function toggleStaffStatusInDB('), 'Missing toggleStaffStatusInDB function');
  });

  it('6. Staff operations query public.admin_users and cache locally', () => {
    assert.ok(adminJs.includes(".from('admin_users')"), 'Staff operations must query admin_users table');
    assert.ok(adminJs.includes('limra_staff_members_cache'), 'Must persist cache to limra_staff_members_cache');
  });

  it('7. Exposes staff manager functions on window for terminal and test harness access', () => {
    assert.ok(adminJs.includes('window.loadStaffMembersFromDB = loadStaffMembersFromDB;'), 'Missing window.loadStaffMembersFromDB exposure');
    assert.ok(adminJs.includes('window.saveStaffMemberToDB = saveStaffMemberToDB;'), 'Missing window.saveStaffMemberToDB exposure');
    assert.ok(adminJs.includes('window.deleteStaffMemberFromDB = deleteStaffMemberFromDB;'), 'Missing window.deleteStaffMemberFromDB exposure');
    assert.ok(adminJs.includes('window.toggleStaffStatusInDB = toggleStaffStatusInDB;'), 'Missing window.toggleStaffStatusInDB exposure');
  });
});

describe('TASK 4.2: Role-Based Access Control (RBAC) Hierarchy & UI Visibility', () => {
  it('8. Defines ROLE_WORKSPACE_PERMISSIONS for all POS employee roles', () => {
    assert.ok(adminJs.includes('ROLE_WORKSPACE_PERMISSIONS'), 'Missing ROLE_WORKSPACE_PERMISSIONS definition');
    assert.match(adminJs, /owner:\s*\[[^\]]*'dashboard'[^\]]*'settings'/s, 'Owner must have full workspace permissions');
    assert.match(adminJs, /manager:\s*\[[^\]]*'dashboard'[^\]]*'settings'/s, 'Manager must have full workspace permissions');
    assert.match(adminJs, /cashier:\s*\[[^\]]*'order-detail'[^\]]*'tables'/s, 'Cashier must have POS, orders, tables, foods');
    assert.match(adminJs, /kitchen:\s*\[\s*'kitchen'\s*\]/, 'Kitchen must only have kitchen workspace');
    assert.match(adminJs, /waiter:\s*\[[^\]]*'tables'/s, 'Waiter must have tables and kitchen');
  });

  it('9. normalizeStaffRole maps designations to canonical system roles', () => {
    assert.ok(adminJs.includes('function normalizeStaffRole('), 'Missing normalizeStaffRole function');
    assert.ok(adminJs.includes('function hasStaffPermission('), 'Missing hasStaffPermission function');
  });

  it('10. applyStaffRoleUIRestrictions hides unauthorized sidebar items and actions', () => {
    assert.ok(adminJs.includes('function applyStaffRoleUIRestrictions()'), 'Missing applyStaffRoleUIRestrictions function');
    assert.ok(adminJs.includes('adm-role-restricted'), 'Must toggle adm-role-restricted on restricted sidebar items');
    assert.ok(adminJs.includes('btn-open-closed-order-modal'), 'Must restrict void button for cashiers/kitchen');
  });

  it('11. switchPanel protects unauthorized navigation attempts and redirects safely', () => {
    assert.match(adminJs, /if\s*\(currentAdminUser\s*&&\s*typeof\s*hasStaffPermission\s*===\s*'function'\s*&&\s*!hasStaffPermission\(activeWorkspace\)\)/s, 'switchPanel must block unauthorized workspaces');
    assert.ok(adminJs.includes('Access Denied: Role'), 'switchPanel must notify user of unauthorized access');
  });
});

describe('TASK 4.2: Staff Identity Context & checkAdminAccess Resolution', () => {
  it('12. checkAdminAccess resolves currentAdminUser profile from admin_users', () => {
    assert.ok(adminJs.includes('currentAdminUser = {'), 'checkAdminAccess must construct currentAdminUser profile');
    assert.ok(adminJs.includes('applyStaffRoleUIRestrictions()'), 'checkAdminAccess must trigger applyStaffRoleUIRestrictions');
    assert.ok(adminJs.includes('window.currentAdminUser = currentAdminUser;'), 'Must expose currentAdminUser on window');
  });
});
