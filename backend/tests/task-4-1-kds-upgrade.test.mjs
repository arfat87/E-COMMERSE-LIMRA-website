/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TASK 4.1: KITCHEN DISPLAY SYSTEM (KDS) UPGRADE TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Verifies:
 *  1. Single Source of Truth: #panel-kitchen is the definitive KDS; duplicate #orders-kitchen-subview is removed
 *  2. Per-Item Tap-to-Strike Checkoff: interactive item rows, checkmark state, and localStorage persistence
 *  3. All-Day Batch Production Summary Rail: aggregates required dish portions across open tickets
 *  4. Recall Last Bumped Ticket: history stack tracking and 1-click status reversal
 *  5. Urgency Metrics Strip: live counters for >20m (red), 10-20m (amber), and <10m (blue) tickets
 *  6. Fullscreen & High-Contrast Dark KDS Mode: dark theme tokens, glare reduction, and fullscreen API
 *  7. Touch Ergonomics: full-width 48px primary bump action buttons
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_HTML_PATH = path.resolve('frontend/admin.html');
const ADMIN_JS_PATH = path.resolve('frontend/src/admin.js');
const ADMIN_CSS_PATH = path.resolve('frontend/src/admin.css');

const adminHtml = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
const adminJs = fs.readFileSync(ADMIN_JS_PATH, 'utf8');
const adminCss = fs.readFileSync(ADMIN_CSS_PATH, 'utf8');

describe('TASK 4.1: Single Source of Truth & Zero Duplicate KDS Views', () => {
  it('1. #panel-kitchen contains semantic workspace layout and container elements', () => {
    assert.ok(adminHtml.includes('id="panel-kitchen"'), 'Missing #panel-kitchen element');
    assert.ok(adminHtml.includes('class="kitchen-workspace-layout"'), 'Missing .kitchen-workspace-layout container');
    assert.ok(adminHtml.includes('class="kitchen-main-column"'), 'Missing .kitchen-main-column container');
    assert.ok(adminHtml.includes('id="kitchen-kot-container"'), 'Missing #kitchen-kot-container grid');
    assert.ok(adminHtml.includes('id="kitchen-production-tally-rail"'), 'Missing #kitchen-production-tally-rail');
  });

  it('2. Zero duplicate #orders-kitchen-subview exists in HTML or JS', () => {
    assert.strictEqual(adminHtml.includes('id="orders-kitchen-subview"'), false, 'Found lingering #orders-kitchen-subview in admin.html');
    assert.strictEqual(adminJs.includes('orders-kitchen-subview'), false, 'Found lingering orders-kitchen-subview in admin.js');
  });

  it('3. Kitchen filter tabs support All, Pending, Preparing, and Ready stages', () => {
    assert.ok(adminHtml.includes('data-kitchen-filter="all"'), 'Missing All filter tab');
    assert.ok(adminHtml.includes('data-kitchen-filter="pending"'), 'Missing Pending filter tab');
    assert.ok(adminHtml.includes('data-kitchen-filter="preparing"'), 'Missing Preparing filter tab');
    assert.ok(adminHtml.includes('data-kitchen-filter="ready"'), 'Missing Ready filter tab');
  });
});

describe('TASK 4.1: Per-Item Tap-to-Strike Checkoff & Persistence', () => {
  it('4. Declares item checkoff helpers and persistence functions in admin.js', () => {
    assert.ok(adminJs.includes('function getKitchenCheckedItems()'), 'Missing getKitchenCheckedItems helper');
    assert.ok(adminJs.includes('function saveKitchenCheckedItems('), 'Missing saveKitchenCheckedItems helper');
    assert.ok(adminJs.includes('function isKitchenItemChecked('), 'Missing isKitchenItemChecked helper');
    assert.ok(adminJs.includes('function toggleKitchenItemCheckoff('), 'Missing toggleKitchenItemCheckoff handler');
    assert.ok(adminJs.includes('function toggleAllKitchenItems('), 'Missing toggleAllKitchenItems handler');
    assert.ok(adminJs.includes('function cleanKitchenCheckedItemsForClosedOrders('), 'Missing cleanKitchenCheckedItemsForClosedOrders helper');
  });

  it('5. Generates interactive item rows with tap-to-strike checkoff markup', () => {
    assert.ok(adminJs.includes('class="kot-item-row'), 'Missing kot-item-row markup in card renderer');
    assert.ok(adminJs.includes('class="kot-item-checkbox'), 'Missing kot-item-checkbox markup');
    assert.ok(adminJs.includes('class="kot-qty-pill'), 'Missing kot-qty-pill quantity indicator');
    assert.ok(adminJs.includes('class="kot-item-name'), 'Missing kot-item-name dish title');
    assert.ok(adminJs.includes('kitchen-toggle-all-items-btn'), 'Missing toggle-all items action button');
  });

  it('6. CSS provides clear visual strike-through and checkbox feedback for checked items', () => {
    assert.match(adminCss, /\.kot-item-row\.kot-item-struck/i, 'Missing .kot-item-row.kot-item-struck CSS rule');
    assert.match(adminCss, /text-decoration:\s*line-through/i, 'Missing text-decoration: line-through rule');
    assert.match(adminCss, /\.kot-item-checkbox\.checked/i, 'Missing .kot-item-checkbox.checked CSS rule');
    assert.match(adminCss, /background:\s*#16a34a/i, 'Missing green background for checked items');
  });
});

describe('TASK 4.1: All-Day Batch Production Summary Rail', () => {
  it('7. Production summary rail markup contains header, total count, search, and list container', () => {
    assert.ok(adminHtml.includes('id="kitchen-production-tally-rail"'), 'Missing tally rail markup');
    assert.ok(adminHtml.includes('id="kitchen-tally-total-qty"'), 'Missing total portions badge');
    assert.ok(adminHtml.includes('id="kitchen-tally-search"'), 'Missing dish filter input');
    assert.ok(adminHtml.includes('id="kitchen-tally-list"'), 'Missing tally list container');
  });

  it('8. renderKitchenProductionTally aggregates dishes across active cooking tickets', () => {
    assert.ok(adminJs.includes('function renderKitchenProductionTally()'), 'Missing renderKitchenProductionTally function');
    assert.ok(adminJs.includes('dishTally'), 'Missing dish tally calculation logic');
    assert.ok(adminJs.includes('grandRemainingQty'), 'Missing remaining portion calculation');
    assert.ok(adminJs.includes('kdsTallySearchTerm'), 'Missing search term filtering in production tally');
  });

  it('9. CSS styles production tally rail, rows, high-volume badges, and sticky viewport placement', () => {
    assert.match(adminCss, /\.kitchen-tally-rail/i, 'Missing .kitchen-tally-rail rule');
    assert.match(adminCss, /\.kitchen-tally-row/i, 'Missing .kitchen-tally-row rule');
    assert.match(adminCss, /\.kitchen-tally-qty-badge/i, 'Missing .kitchen-tally-qty-badge rule');
    assert.match(adminCss, /\.kitchen-tally-qty-badge\.high-volume/i, 'Missing high-volume badge styling');
  });
});

describe('TASK 4.1: Recall Last Bumped Ticket Workflow', () => {
  it('10. Contains #btn-kitchen-recall in HTML and wire handler in admin.js', () => {
    assert.ok(adminHtml.includes('id="btn-kitchen-recall"'), 'Missing #btn-kitchen-recall in admin.html');
    assert.ok(adminJs.includes('recallLastBumpedKitchenOrder'), 'Missing recallLastBumpedKitchenOrder function');
    assert.ok(adminJs.includes('kdsBumpHistory'), 'Missing kdsBumpHistory stack');
  });

  it('11. Bump actions record previousStatus and enable recall button', () => {
    assert.ok(adminJs.includes('kdsBumpHistory.push'), 'Bump action must push to history stack');
    assert.ok(adminJs.includes('previousStatus'), 'History stack must store previousStatus');
    assert.ok(adminJs.includes('recallBtn.disabled ='), 'renderKitchenPanel must manage recallBtn disabled state');
  });

  it('12. recallLastBumpedKitchenOrder updates order status in database and refreshes panels', () => {
    assert.ok(adminJs.includes('kdsBumpHistory.pop()'), 'Recall must pop latest bumped entry');
    assert.ok(adminJs.includes('update({ status: targetStatus'), 'Recall must persist targetStatus to orders table');
  });
});

describe('TASK 4.1: Urgency Metrics & Fullscreen / Dark KDS Mode', () => {
  it('13. Urgency metrics strip tracks live counts for >20m, 10-20m, and <10m', () => {
    assert.ok(adminHtml.includes('id="kitchen-urgent-count"'), 'Missing #kitchen-urgent-count element');
    assert.ok(adminHtml.includes('id="kitchen-warning-count"'), 'Missing #kitchen-warning-count element');
    assert.ok(adminHtml.includes('id="kitchen-fresh-count"'), 'Missing #kitchen-fresh-count element');
    assert.ok(adminJs.includes('urgentCount'), 'admin.js must compute urgentCount');
    assert.ok(adminJs.includes('warningCount'), 'admin.js must compute warningCount');
    assert.ok(adminJs.includes('freshCount'), 'admin.js must compute freshCount');
  });

  it('14. Fullscreen and Dark KDS toggle buttons exist in admin.html', () => {
    assert.ok(adminHtml.includes('id="btn-kitchen-dark-mode"'), 'Missing #btn-kitchen-dark-mode button');
    assert.ok(adminHtml.includes('id="btn-kitchen-fullscreen"'), 'Missing #btn-kitchen-fullscreen button');
    assert.ok(adminHtml.includes('id="btn-kitchen-tally-toggle"'), 'Missing #btn-kitchen-tally-toggle button');
  });

  it('15. toggleKitchenDarkMode persists to localStorage and toggles .dark-kds class', () => {
    assert.ok(adminJs.includes('function toggleKitchenDarkMode('), 'Missing toggleKitchenDarkMode function');
    assert.ok(adminJs.includes('panel.classList.toggle(\'dark-kds\''), 'Must toggle dark-kds class on panel');
    assert.ok(adminJs.includes('limra_kds_dark_mode'), 'Must persist dark mode preference to localStorage');
  });

  it('16. toggleKitchenFullscreen invokes requestFullscreen and exitFullscreen', () => {
    assert.ok(adminJs.includes('function toggleKitchenFullscreen()'), 'Missing toggleKitchenFullscreen function');
    assert.ok(adminJs.includes('requestFullscreen'), 'Must call requestFullscreen API');
    assert.ok(adminJs.includes('exitFullscreen'), 'Must call exitFullscreen API');
  });

  it('17. CSS includes full dark theme styles for cards, text, tally rail, and inputs', () => {
    assert.match(adminCss, /#panel-kitchen\.dark-kds\s*\{[^}]*background:\s*#0f172a/i, 'Missing dark-kds slate-900 background');
    assert.match(adminCss, /#panel-kitchen\.dark-kds\s+\.kitchen-kot-card\s*\{[^}]*background:\s*#1e293b/i, 'Missing dark card background #1e293b');
    assert.match(adminCss, /#panel-kitchen\.dark-kds\s+\.kitchen-tally-rail\s*\{[^}]*background:\s*#1e293b/i, 'Missing dark tally rail background #1e293b');
    assert.match(adminCss, /#panel-kitchen:fullscreen/i, 'Missing #panel-kitchen:fullscreen CSS rule');
  });

  it('18. Primary bump buttons enforce 100% width and 48px touch target standard', () => {
    assert.match(adminCss, /\.kitchen-bump-btn\s*\{[^}]*min-height:\s*48px\s*!important/i, 'Bump button must be 48px min-height');
    assert.match(adminCss, /\.kitchen-bump-btn\s*\{[^}]*width:\s*100%/i, 'Bump button must span 100% card width');
  });
});
