/**
 * ============================================================================
 * TASK 3.1 TEST SUITE: SIDEBAR NAVIGATION REDESIGN & PERSISTENT HEADER
 * ============================================================================
 *
 * Verifies all requirements and test cases for Task 3.1:
 *  1. Consolidate ~20 navigation items into 9 logical workspaces.
 *  2. Remove duplicate navigation paths without deleting underlying functionality or panels.
 *  3. Consolidate Hold Orders and Closed Orders navigation (integrated into Orders Hub).
 *  4. Consolidate Reports and Catalog/Editor navigation logically (Reports & Sales Hub, Menu & Catalog Hub).
 *  5. Implement a 220px expanded sidebar (currently 244px).
 *  6. Implement a 64px collapsed icon rail (currently hides completely off-screen).
 *  7. Add tooltips and accessible labels in collapsed mode (title, aria-label, hover tooltips).
 *  8. Keep the header visible inside POS Billing (currently hidden via body.pos-mode-active .adm-header { display: none !important; }).
 *  9. Display printer status, queue status, sync status, and notifications in the header during billing.
 * 10. Convert incoming web-order modal (#adm-incoming-order-modal) into a non-blocking top-right alert card.
 * 11. Ensure incoming order notifications never steal cashier keyboard focus.
 * 12. Preserve notification sound (playNewOrderSound()) and acceptance workflows (acceptIncomingOnlineOrder(), rejectIncomingOnlineOrder()).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestEnvironment } from './test-env-guard.mjs';

assertTestEnvironment({ runnerName: 'Task 3.1: Sidebar Navigation Redesign & Persistent Header' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.css'), 'utf8');

describe('TASK 3.1: 9 Logical Workspaces & Sidebar Navigation', () => {
  const expectedWorkspaces = [
    { panel: 'dashboard', label: 'Dashboard', tooltip: 'Dashboard' },
    { panel: 'order-detail', label: 'POS Billing', tooltip: 'POS Billing' },
    { panel: 'orders', label: 'Orders Hub', tooltip: 'Orders Hub' },
    { panel: 'tables', label: 'Tables Floor', tooltip: 'Tables Floor Plan' },
    { panel: 'kitchen', label: 'Kitchen KDS', tooltip: 'Kitchen KDS' },
    { panel: 'foods', label: 'Menu & Catalog', tooltip: 'Menu & Catalog' },
    { panel: 'stock', label: 'Stock & FIFO', tooltip: 'Stock & FIFO Inventory' },
    { panel: 'daily-sales-report', label: 'Reports & Sales', tooltip: 'Reports & Sales' },
    { panel: 'settings', label: 'Settings', tooltip: 'Settings' }
  ];

  it('1. Sidebar navigation exactly defines the 9 logical workspaces in admin.html', () => {
    // Extract nav block from admin.html
    const navMatch = adminHtml.match(/<nav class="adm-nav">([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, '<nav class="adm-nav"> must exist in admin.html');
    const navHtml = navMatch[1];

    // Count top-level data-panel buttons in nav
    const panelButtons = [...navHtml.matchAll(/data-panel="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
    assert.equal(panelButtons.length, 9, `Sidebar nav must contain exactly 9 workspace buttons (found: ${panelButtons.join(', ')})`);

    // Verify all 9 expected workspaces are present
    for (const ws of expectedWorkspaces) {
      assert.ok(panelButtons.includes(ws.panel), `Workspace "${ws.panel}" must be present in sidebar nav`);
      
      // Check data-tooltip, title, and aria-label
      const buttonRegex = new RegExp(`<button[^>]*data-panel="${ws.panel}"[^>]*>`, 'i');
      const btnTag = navHtml.match(buttonRegex)?.[0];
      assert.ok(btnTag, `Button tag for "${ws.panel}" must exist`);
      assert.ok(btnTag.includes('data-tooltip='), `Button "${ws.panel}" must have data-tooltip attribute`);
      assert.ok(btnTag.includes('title='), `Button "${ws.panel}" must have title attribute for accessibility`);
      assert.ok(btnTag.includes('aria-label='), `Button "${ws.panel}" must have aria-label attribute for accessibility`);
    }
  });

  it('2. Badges and operational indicators are placed on appropriate workspaces', () => {
    assert.ok(adminHtml.includes('id="pending-orders-badge"'), 'Orders Hub must have #pending-orders-badge');
    assert.ok(adminHtml.includes('id="pending-hold-badge"'), 'Orders Hub must have #pending-hold-badge');
    assert.ok(adminHtml.includes('id="pending-kitchen-badge"'), 'Kitchen KDS must have #pending-kitchen-badge');
    assert.ok(adminHtml.includes('id="pending-bookings-badge"'), 'Settings Hub must have #pending-bookings-badge');
  });

  it('3. Sidebar footer preserves View Website link and Sign Out button', () => {
    assert.ok(adminHtml.includes('href="/" class="adm-nav-item"'), 'Sidebar footer must have View Website link');
    assert.ok(adminHtml.includes('id="logout-btn"'), 'Sidebar footer must have #logout-btn');
  });
});

describe('TASK 3.1: Consolidated Subnav Bars & Workspace Mapping', () => {
  it('4. Orders Hub subnav bar is present in Live, Hold, and Closed orders panels', () => {
    const ordersSubnavMatches = (adminHtml.match(/data-subnav-panel="orders"/g) || []).length;
    const holdSubnavMatches = (adminHtml.match(/data-subnav-panel="hold-orders"/g) || []).length;
    const closedSubnavMatches = (adminHtml.match(/data-subnav-panel="closed-orders"/g) || []).length;

    assert.ok(ordersSubnavMatches >= 3, 'Live orders subnav button must exist in orders, hold, and closed panels');
    assert.ok(holdSubnavMatches >= 3, 'Hold orders subnav button must exist in orders, hold, and closed panels');
    assert.ok(closedSubnavMatches >= 3, 'Closed orders subnav button must exist in orders, hold, and closed panels');
  });

  it('5. Menu & Catalog subnav bar is present in Dishes, Combos, Coupons, and Places panels', () => {
    const foodsSubnavMatches = (adminHtml.match(/data-subnav-panel="foods"/g) || []).length;
    const combosSubnavMatches = (adminHtml.match(/data-subnav-panel="combos"/g) || []).length;
    const couponsSubnavMatches = (adminHtml.match(/data-subnav-panel="coupons"/g) || []).length;
    const placesSubnavMatches = (adminHtml.match(/data-subnav-panel="places"/g) || []).length;

    assert.ok(foodsSubnavMatches >= 4, 'Foods subnav tab must exist across catalog panels');
    assert.ok(combosSubnavMatches >= 4, 'Combos subnav tab must exist across catalog panels');
    assert.ok(couponsSubnavMatches >= 4, 'Coupons subnav tab must exist across catalog panels');
    assert.ok(placesSubnavMatches >= 4, 'Places subnav tab must exist across catalog panels');
    assert.ok(adminHtml.includes('href="/table/qr-admin.html"'), 'QR Table Admin link must be easily accessible from catalog subnav');
  });

  it('6. Reports & Sales subnav bar is present in Daily Report, Dish Analysis, and Revenue Analytics panels', () => {
    const dailySubnavMatches = (adminHtml.match(/data-subnav-panel="daily-sales-report"/g) || []).length;
    const itemsSubnavMatches = (adminHtml.match(/data-subnav-panel="customer-analysis"/g) || []).length;
    const analyticsSubnavMatches = (adminHtml.match(/data-subnav-panel="analytics"/g) || []).length;

    assert.ok(dailySubnavMatches >= 3, 'Daily report subnav tab must exist across reports panels');
    assert.ok(itemsSubnavMatches >= 3, 'Customer analysis subnav tab must exist across reports panels');
    assert.ok(analyticsSubnavMatches >= 3, 'Analytics subnav tab must exist across reports panels');
  });

  it('7. switchPanel maps child panels to parent workspaces and highlights active subnav tabs', () => {
    assert.ok(adminJs.includes('export function switchPanel') || adminJs.includes('window.switchPanel = switchPanel'), 'switchPanel must be exported or attached to window');
    assert.ok(adminJs.includes('workspaceMap'), 'switchPanel must define workspaceMap mapping child panels to parent workspaces');
    assert.ok(adminJs.includes("'hold-orders': 'orders'"), 'workspaceMap must map hold-orders to orders');
    assert.ok(adminJs.includes("'closed-orders': 'orders'"), 'workspaceMap must map closed-orders to orders');
    assert.ok(adminJs.includes("'combos': 'foods'"), 'workspaceMap must map combos to foods');
    assert.ok(adminJs.includes("'coupons': 'foods'"), 'workspaceMap must map coupons to foods');
    assert.ok(adminJs.includes("'places': 'foods'"), 'workspaceMap must map places to foods');
    assert.ok(adminJs.includes("'customer-analysis': 'daily-sales-report'"), 'workspaceMap must map customer-analysis to daily-sales-report');
    assert.ok(adminJs.includes("'analytics': 'daily-sales-report'"), 'workspaceMap must map analytics to daily-sales-report');
    assert.ok(adminJs.includes('.adm-workspace-subnav-btn'), 'switchPanel must toggle active state on subnav buttons');
  });
});

describe('TASK 3.1: 220px Expanded Sidebar & 64px Collapsed Icon Rail in CSS', () => {
  it('8. Default expanded sidebar width is 220px (reduced from 244px) and main margin is 220px', () => {
    assert.ok(adminCss.includes('width: 220px;'), 'admin.css must define width: 220px for .adm-sidebar');
    assert.ok(adminCss.includes('margin-left: 220px;'), 'admin.css must define margin-left: 220px for .adm-main');
    // Ensure 244px is completely replaced
    assert.ok(!adminCss.includes('width: 244px;'), 'admin.css must not use old 244px width for sidebar');
    assert.ok(!adminCss.includes('margin-left: 244px;'), 'admin.css must not use old 244px margin-left for main');
  });

  it('9. Collapsed state renders a 64px icon rail instead of completely hiding off-screen', () => {
    assert.ok(adminCss.includes('width: 64px !important;'), 'Collapsed sidebar must define width: 64px !important');
    assert.ok(adminCss.includes('margin-left: 64px !important;'), 'Collapsed main content must define margin-left: 64px !important');
    assert.ok(adminCss.includes('.adm-layout.sidebar-collapsed .adm-nav-label'), 'Collapsed state must hide nav labels');
    assert.ok(adminCss.includes('.adm-layout.sidebar-collapsed .adm-nav-item[data-tooltip]:hover::after'), 'Collapsed state must display floating hover tooltips via ::after');
  });

  it('10. Sidebar toggle functionality and localStorage persistence are implemented', () => {
    assert.ok(adminJs.includes('export function toggleSidebar') || adminJs.includes('window.toggleSidebar = toggleSidebar'), 'toggleSidebar must be exported or attached to window');
    assert.ok(adminJs.includes("localStorage.setItem('adm_sidebar_collapsed'"), 'toggleSidebar must persist collapsed preference to localStorage');
    assert.ok(adminJs.includes("localStorage.getItem('adm_sidebar_collapsed')"), 'Sidebar preference must be restored from localStorage on initialization');
    assert.ok(adminJs.includes('Ctrl+B') || adminJs.includes("key === 'b'"), 'Keyboard shortcut Ctrl+B must toggle sidebar state');
  });
});

describe('TASK 3.1: Persistent Header During POS Billing', () => {
  it('11. Header remains visible in POS billing (not hidden via display: none)', () => {
    // Check pos-mode-active .adm-header rule
    const headerPosMatch = adminCss.match(/body\.pos-mode-active\s+\.adm-header\s*\{([^}]*)\}/);
    assert.ok(headerPosMatch, 'CSS rule for body.pos-mode-active .adm-header must exist');
    const headerStyles = headerPosMatch[1];
    assert.ok(headerStyles.includes('display: flex !important'), 'Header must be display: flex !important during POS mode');
    assert.ok(!headerStyles.includes('display: none'), 'Header must NOT be hidden with display: none during POS mode');
    assert.ok(headerStyles.includes('height: 52px !important'), 'Header must define compact 52px height during POS mode');
  });

  it('12. POS content container height is calculated dynamically to account for 52px header', () => {
    const contentPosMatch = adminCss.match(/body\.pos-mode-active\s+\.adm-content\s*\{([^}]*)\}/);
    assert.ok(contentPosMatch, 'CSS rule for body.pos-mode-active .adm-content must exist');
    const contentStyles = contentPosMatch[1];
    assert.ok(contentStyles.includes('calc(100vh - 52px)') || contentStyles.includes('calc(100dvh - 52px)'), 'Content height must be calc(100vh - 52px) in POS mode');
  });

  it('13. Header displays printer status, print queue badge, sync status, and notification bell', () => {
    assert.ok(adminHtml.includes('id="printer-status"'), 'Header must contain #printer-status');
    assert.ok(adminHtml.includes('id="btn-print-queue"'), 'Header must contain #btn-print-queue');
    assert.ok(adminHtml.includes('id="print-queue-badge"'), 'Header must contain #print-queue-badge');
    assert.ok(adminHtml.includes('id="sync-indicator"'), 'Header must contain #sync-indicator');
    assert.ok(adminHtml.includes('id="notification-btn"'), 'Header must contain #notification-btn');
    assert.ok(adminHtml.includes('id="btn-quick-bill-adjust"'), 'Header must contain #btn-quick-bill-adjust');
    assert.ok(adminHtml.includes('id="btn-admin-header-sales-report"'), 'Header must contain #btn-admin-header-sales-report');
  });
});

describe('TASK 3.1: Non-Blocking Incoming Order Alert Card', () => {
  it('14. Incoming order prompt uses top-right non-blocking alert card container', () => {
    assert.ok(adminHtml.includes('id="adm-incoming-order-modal" class="adm-incoming-alert-container"'), 'Incoming order element must use .adm-incoming-alert-container');
    assert.ok(!adminHtml.includes('id="adm-incoming-order-modal" class="adm-hold-modal"'), 'Incoming order element must NOT use full-screen blocking .adm-hold-modal');
  });

  it('15. Alert container is styled with pointer-events: none and card has pointer-events: auto', () => {
    assert.ok(adminCss.includes('.adm-incoming-alert-container'), '.adm-incoming-alert-container class must be styled in CSS');
    assert.ok(adminCss.includes('pointer-events: none; /* Non-blocking'), 'Alert container must have pointer-events: none to prevent blocking clicks');
    assert.ok(adminCss.includes('pointer-events: auto; /* Card content'), 'Alert card must have pointer-events: auto to allow accept/reject interactions');
  });

  it('16. All incoming order elements, actions, and sound chimes are preserved', () => {
    assert.ok(adminHtml.includes('id="incoming-order-modal-title"'), '#incoming-order-modal-title must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-cust-name"'), '#incoming-order-cust-name must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-cust-phone"'), '#incoming-order-cust-phone must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-type-badge"'), '#incoming-order-type-badge must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-items-list"'), '#incoming-order-items-list must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-total-amt"'), '#incoming-order-total-amt must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-accept-btn"'), '#incoming-order-accept-btn must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-reject-btn"'), '#incoming-order-reject-btn must be preserved');
    assert.ok(adminHtml.includes('id="incoming-order-close-btn"'), '#incoming-order-close-btn must be preserved');
    assert.ok(adminJs.includes('playNewOrderSound()'), 'triggerIncomingOrderPrompt must preserve playNewOrderSound()');
    assert.ok(adminJs.includes('acceptIncomingOnlineOrder'), 'acceptIncomingOnlineOrder handler must be preserved');
    assert.ok(adminJs.includes('rejectIncomingOnlineOrder'), 'rejectIncomingOnlineOrder handler must be preserved');
  });

  it('17. triggerIncomingOrderPrompt preserves cashier keyboard focus when alert arrives', () => {
    assert.ok(adminJs.includes('export async function triggerIncomingOrderPrompt'), 'triggerIncomingOrderPrompt must be exported');
    assert.ok(adminJs.includes('document.activeElement'), 'triggerIncomingOrderPrompt must check document.activeElement to prevent stealing focus');
    assert.ok(!adminJs.includes('incomingModal.focus()') && !adminJs.includes('modal.focus()'), 'triggerIncomingOrderPrompt must never force focus onto modal');
  });
});

describe('TASK 3.1: Zero Functional Regressions & Panel Integrity', () => {
  const allExpectedPanels = [
    'dashboard', 'orders', 'tables', 'kitchen', 'hold-orders', 'closed-orders',
    'order-detail', 'customers', 'customer-analysis', 'daily-sales-report',
    'analytics', 'bookings', 'foods', 'coupons', 'combos', 'places',
    'settings', 'stock', 'printer', 'profile'
  ];

  it('18. Every existing panel and template section remains fully accessible', () => {
    for (const panelId of allExpectedPanels) {
      const panelExists = adminHtml.includes(`id="panel-${panelId}"`) || adminHtml.includes(`id="panel-${panelId}-content"`);
      assert.ok(panelExists, `Panel section "panel-${panelId}" must exist in admin.html`);
    }
  });

  it('19. All 9 workspace icons render valid scalable SVG artwork', () => {
    const navMatch = adminHtml.match(/<nav class="adm-nav">([\s\S]*?)<\/nav>/);
    assert.ok(navMatch);
    const svgCount = (navMatch[1].match(/<svg/g) || []).length;
    assert.equal(svgCount, 9, 'Each of the 9 navigation items must contain an SVG icon');
  });
});
