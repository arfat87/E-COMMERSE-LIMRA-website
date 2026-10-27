// =====================================================================
// ⚙️ LIMRA RESTAURANT — SETTINGS INTERFACE & REPUTATION HUB TEST SUITE
// =====================================================================
// Validates:
// 1. All 8 category navigation tabs and subtab panes exist in admin.html
// 2. All form control IDs for restaurant profile, billing, payments, printer,
//    KOT, staff, WhatsApp, and integrations are preserved
// 3. UI design classes, gold accents, and sticky action bar styles in admin.css
// 4. JavaScript navigation, dirty-state tracking, save/reset routines in admin.js
// 5. Schema persistence mapping for database table `printer_settings`
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf-8');
const adminCss = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.css'), 'utf-8');
const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf-8');
const schemaSql = fs.readFileSync(path.join(rootDir, 'database/schema.sql'), 'utf-8');

console.log('\n⚙️ =========================================================');
console.log('   LIMRA RESTAURANT — SETTINGS HUB INTEGRITY SUITE');
console.log('=========================================================\n');

test('SUITE 1: Settings Navigation & Category Subtabs', async (t) => {
  await t.test('1.1 Settings hub container and header exist in admin.html', () => {
    assert.match(adminHtml, /id="panel-settings"/, 'Missing #panel-settings');
    assert.match(adminHtml, /class="stg-hub"/, 'Missing .stg-hub container');
    assert.match(adminHtml, /Restaurant Settings &amp; Configuration/, 'Missing settings title');
    assert.match(adminHtml, /id="settings-nav-tabs"/, 'Missing #settings-nav-tabs');
  });

  await t.test('1.2 All 8 required settings categories exist in navigation bar', () => {
    const requiredCategories = [
      { key: 'restaurant', name: 'Restaurant Profile' },
      { key: 'billing', name: 'Billing &amp; GST' },
      { key: 'payments', name: 'Payments &amp; Delivery' },
      { key: 'printer', name: 'Thermal Printer' },
      { key: 'kitchen', name: 'Kitchen &amp; KOT' },
      { key: 'staff', name: 'Staff &amp; Permissions' },
      { key: 'whatsapp', name: 'WhatsApp &amp; Audio' },
      { key: 'integrations', name: 'Cloud Integrations' }
    ];

    for (const cat of requiredCategories) {
      const btnRegex = new RegExp(`data-subtab="${cat.key}"`);
      assert.match(adminHtml, btnRegex, `Missing nav button for category: ${cat.key}`);
    }
  });

  await t.test('1.3 All 8 content panes exist in admin.html with stg-pane class', () => {
    const requiredPanes = [
      'settings-subtab-restaurant',
      'settings-subtab-billing',
      'settings-subtab-payments',
      'settings-subtab-printer',
      'settings-subtab-kitchen',
      'settings-subtab-staff',
      'settings-subtab-whatsapp',
      'settings-subtab-integrations'
    ];

    for (const paneId of requiredPanes) {
      const paneRegex = new RegExp(`id="${paneId}"[^>]*class="[^"]*stg-pane`);
      assert.match(adminHtml, paneRegex, `Missing content pane: #${paneId} with .stg-pane`);
    }
  });
});

test('SUITE 2: Preservation of Essential Settings Input IDs', async (t) => {
  await t.test('2.1 Restaurant Profile inputs are preserved', () => {
    assert.match(adminHtml, /id="bill-restaurant-name"/, 'Missing #bill-restaurant-name');
    assert.match(adminHtml, /id="bill-phone"/, 'Missing #bill-phone');
    assert.match(adminHtml, /id="bill-address"/, 'Missing #bill-address');
    assert.match(adminHtml, /id="bill-fssai"/, 'Missing #bill-fssai');
    assert.match(adminHtml, /id="bill-show-logo"/, 'Missing #bill-show-logo');
    assert.match(adminHtml, /id="bill-logo-url"/, 'Missing #bill-logo-url');
  });

  await t.test('2.2 Billing & GST inputs are preserved', () => {
    assert.match(adminHtml, /id="bill-gstin"/, 'Missing #bill-gstin');
    assert.match(adminHtml, /id="bill-cgst-rate"/, 'Missing #bill-cgst-rate');
    assert.match(adminHtml, /id="bill-sgst-rate"/, 'Missing #bill-sgst-rate');
    assert.match(adminHtml, /id="bill-toggle-show-place"/, 'Missing #bill-toggle-show-place');
    assert.match(adminHtml, /id="bill-toggle-show-table"/, 'Missing #bill-toggle-show-table');
    assert.match(adminHtml, /id="bill-toggle-compact-header"/, 'Missing #bill-toggle-compact-header');
    assert.match(adminHtml, /id="bill-footer-msg"/, 'Missing #bill-footer-msg');
  });

  await t.test('2.3 Payments & UPI inputs are preserved', () => {
    assert.match(adminHtml, /id="bill-upi-id"/, 'Missing #bill-upi-id');
    assert.match(adminHtml, /id="bill-upi-payee-name"/, 'Missing #bill-upi-payee-name');
    assert.match(adminHtml, /id="bill-qr-size-select"/, 'Missing #bill-qr-size-select');
  });

  await t.test('2.4 Thermal Printer hardware & layout controls are preserved', () => {
    assert.match(adminHtml, /id="printer-model-select"/, 'Missing #printer-model-select');
    assert.match(adminHtml, /id="printer-connection-mode"/, 'Missing #printer-connection-mode');
    assert.match(adminHtml, /id="bill-custom-width"/, 'Missing #bill-custom-width');
    assert.match(adminHtml, /id="bill-auto-cut"/, 'Missing #bill-auto-cut');
    assert.match(adminHtml, /id="bill-side-gap"/, 'Missing #bill-side-gap');
    assert.match(adminHtml, /id="bill-bottom-feed"/, 'Missing #bill-bottom-feed');
    assert.match(adminHtml, /id="thermal-live-preview-container"/, 'Missing #thermal-live-preview-container');
    assert.match(adminHtml, /id="printer-save-db-btn"/, 'Missing #printer-save-db-btn');
    assert.match(adminHtml, /id="printer-test-hardware-btn"/, 'Missing #printer-test-hardware-btn');
  });

  await t.test('2.5 Kitchen KOT controls are preserved', () => {
    assert.match(adminHtml, /id="kot-custom-width"/, 'Missing #kot-custom-width');
    assert.match(adminHtml, /id="kot-auto-cut"/, 'Missing #kot-auto-cut');
    assert.match(adminHtml, /id="kot-side-gap"/, 'Missing #kot-side-gap');
    assert.match(adminHtml, /id="kot-bottom-feed"/, 'Missing #kot-bottom-feed');
    assert.match(adminHtml, /id="kot-toggle-table"/, 'Missing #kot-toggle-table');
    assert.match(adminHtml, /id="kot-toggle-order-type"/, 'Missing #kot-toggle-order-type');
  });

  await t.test('2.6 Staff, WhatsApp, and Google Integrations controls are preserved', () => {
    assert.match(adminHtml, /id="staff-add-btn"/, 'Missing #staff-add-btn');
    assert.match(adminHtml, /id="staff-cards-grid"/, 'Missing #staff-cards-grid');
    assert.match(adminHtml, /id="wa-biz-phone"/, 'Missing #wa-biz-phone');
    assert.match(adminHtml, /id="wa-auto-confirm"/, 'Missing #wa-auto-confirm');
    assert.match(adminHtml, /id="gbiz-name"/, 'Missing #gbiz-name');
    assert.match(adminHtml, /id="gbiz-review-url"/, 'Missing #gbiz-review-url');
    assert.match(adminHtml, /id="settings-subtab-sheets"/, 'Missing #settings-subtab-sheets');
  });
});

test('SUITE 3: Visual Design System & Tasteful Gold Accents', async (t) => {
  await t.test('3.1 admin.css contains professional .stg- CSS design architecture', () => {
    assert.match(adminCss, /\.stg-hub\b/, 'Missing .stg-hub rule');
    assert.match(adminCss, /\.stg-layout\b/, 'Missing .stg-layout rule');
    assert.match(adminCss, /\.stg-nav\b/, 'Missing .stg-nav rule');
    assert.match(adminCss, /\.stg-nav-btn\.active\b/, 'Missing .stg-nav-btn.active gold styling');
    assert.match(adminCss, /\.stg-card\b/, 'Missing .stg-card rule');
    assert.match(adminCss, /\.stg-card-gold-accent\b/, 'Missing .stg-card-gold-accent rule');
    assert.match(adminCss, /\.stg-btn-gold\b/, 'Missing .stg-btn-gold rule');
    assert.match(adminCss, /\.stg-action-bar\b/, 'Missing .stg-action-bar rule');
    assert.match(adminCss, /\.stg-dirty-badge\b/, 'Missing .stg-dirty-badge rule');
  });

  await t.test('3.2 Sticky Action Bar buttons and dirty state indicators exist', () => {
    assert.match(adminHtml, /id="stg-save-btn"/, 'Missing bottom #stg-save-btn');
    assert.match(adminHtml, /id="stg-top-save-btn"/, 'Missing header #stg-top-save-btn');
    assert.match(adminHtml, /id="stg-reset-btn"/, 'Missing discard #stg-reset-btn');
    assert.match(adminHtml, /id="stg-dirty-badge"/, 'Missing #stg-dirty-badge');
    assert.match(adminHtml, /id="stg-bottom-dirty-badge"/, 'Missing #stg-bottom-dirty-badge');
  });
});

test('SUITE 4: JavaScript Settings Engine & Dirty State Tracking', async (t) => {
  await t.test('4.1 admin.js defines switchSettingsSubtab supporting all categories and aliases', () => {
    assert.match(adminJs, /function switchSettingsSubtab\(tabName\)/, 'Missing switchSettingsSubtab');
    assert.match(adminJs, /targetTab === 'profile' \|\| targetTab === 'sheets'/, 'Missing profile/sheets alias redirection');
    assert.match(adminJs, /renderStaffList\(\)/, 'Staff rendering on tab switch');
    assert.match(adminJs, /renderWhatsAppManagerUI\(\)/, 'WhatsApp rendering on tab switch');
    assert.match(adminJs, /initPrinterPanel\(\)/, 'Printer initialization on tab switch');
  });

  await t.test('4.2 admin.js defines unified saveAllRestaurantSettings and resetAllRestaurantSettings', () => {
    assert.match(adminJs, /async function saveAllRestaurantSettings\(\)/, 'Missing saveAllRestaurantSettings');
    assert.match(adminJs, /async function resetAllRestaurantSettings\(\)/, 'Missing resetAllRestaurantSettings');
    assert.match(adminJs, /await savePrinterSettingsToDB\(\)/, 'Missing savePrinterSettingsToDB call in saveAllRestaurantSettings');
    assert.match(adminJs, /await loadPrinterSettingsFromDB\(\)/, 'Missing loadPrinterSettingsFromDB in reset');
  });

  await t.test('4.3 admin.js tracks dirty state and prevents accidental data loss', () => {
    assert.match(adminJs, /let isSettingsDirty = false;/, 'Missing isSettingsDirty state variable');
    assert.match(adminJs, /function setSettingsDirtyState\(dirty\)/, 'Missing setSettingsDirtyState function');
    assert.match(adminJs, /window\.addEventListener\('beforeunload'/, 'Missing beforeunload guard for unsaved changes');
  });

  await t.test('4.4 database schema contains printer_settings table with required columns', () => {
    assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS public\.printer_settings/i, 'Missing printer_settings table definition');
    assert.match(schemaSql, /restaurant_name text/i, 'Missing restaurant_name column');
    assert.match(schemaSql, /restaurant_gstin text/i, 'Missing restaurant_gstin column');
    assert.match(schemaSql, /bill_upi_id text/i, 'Missing bill_upi_id column');
    assert.match(schemaSql, /printer_model text/i, 'Missing printer_model column');
  });
});
