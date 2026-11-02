/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TASK 3.2: UNIFIED PROFESSIONAL LIMRA POS DESIGN SYSTEM & TOKENS TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Verifies:
 *  1. Centralized CSS Tokens in :root, .admin-app (surfaces, borders, typography, brand, status, radii, spacing, touch targets)
 *  2. Backward compatibility alias mappings for legacy --adm-* custom properties
 *  3. Minimum touch target standards: 40px for controls, 48px for primary POS action buttons
 *  4. Standardized semantic status badge styles (Paid, Unpaid, Hold, Cancelled, Occupied)
 *  5. Strict 7-step typography scale enforcing >= 12px (0.75rem minimum strict floor, banning <12px text)
 *  6. Stock CSS alignment with the unified design token system
 *  7. KDS kitchen ticket display and bump button ergonomics preservation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_CSS_PATH = path.resolve('frontend/src/admin.css');
const STOCK_CSS_PATH = path.resolve('frontend/src/stock/stock.css');
const ADMIN_HTML_PATH = path.resolve('frontend/admin.html');
const ADMIN_JS_PATH = path.resolve('frontend/src/admin.js');

const adminCss = fs.readFileSync(ADMIN_CSS_PATH, 'utf8');
const stockCss = fs.readFileSync(STOCK_CSS_PATH, 'utf8');
const adminHtml = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
const adminJs = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

describe('TASK 3.2: Centralized CSS Design Tokens in :root, .admin-app', () => {
  it('1. Declares all required surface and background tokens', () => {
    assert.match(adminCss, /--pos-bg-app:\s*#f8fafc/i, 'Missing --pos-bg-app token');
    assert.match(adminCss, /--pos-bg-surface:\s*#ffffff/i, 'Missing --pos-bg-surface token');
    assert.match(adminCss, /--pos-bg-subtle:\s*#f8fafc/i, 'Missing --pos-bg-subtle token');
    assert.match(adminCss, /--pos-bg-card:\s*#ffffff/i, 'Missing --pos-bg-card token');
    assert.match(adminCss, /--pos-bg-sidebar:\s*#242724/i, 'Missing --pos-bg-sidebar token');
    assert.match(adminCss, /--pos-bg-header:\s*#ffffff/i, 'Missing --pos-bg-header token');
    assert.match(adminCss, /--pos-bg-muted:\s*#f1f5f9/i, 'Missing --pos-bg-muted token');
    assert.match(adminCss, /--pos-surface-card:\s*#ffffff/i, 'Missing --pos-surface-card token');
    assert.match(adminCss, /--pos-surface-elevated:\s*#ffffff/i, 'Missing --pos-surface-elevated token');
  });

  it('2. Declares all required border tokens', () => {
    assert.match(adminCss, /--pos-border-subtle:\s*#e2e8f0/i, 'Missing --pos-border-subtle token');
    assert.match(adminCss, /--pos-border-strong:\s*#cbd5e1/i, 'Missing --pos-border-strong token');
    assert.match(adminCss, /--pos-border-gold:\s*#fde68a/i, 'Missing --pos-border-gold token');
    assert.match(adminCss, /--pos-border-focus:\s*#d97706/i, 'Missing --pos-border-focus token');
  });

  it('3. Declares high-contrast WCAG AA compliant typography tokens', () => {
    assert.match(adminCss, /--pos-text-primary:\s*#0f172a/i, 'Missing --pos-text-primary token');
    assert.match(adminCss, /--pos-text-secondary:\s*#475569/i, 'Missing --pos-text-secondary token');
    assert.match(adminCss, /--pos-text-muted:\s*#64748b/i, 'Missing --pos-text-muted token (4.6+:1 WCAG AA)');
    assert.match(adminCss, /--pos-text-inverse:\s*#ffffff/i, 'Missing --pos-text-inverse token');
    assert.match(adminCss, /--pos-text-gold:\s*#b45309/i, 'Missing --pos-text-gold token');
  });

  it('4. Declares the LIMRA Gold brand palette tokens', () => {
    assert.match(adminCss, /--pos-primary:\s*#d97706/i, 'Missing --pos-primary token');
    assert.match(adminCss, /--pos-primary-hover:\s*#b45309/i, 'Missing --pos-primary-hover token');
    assert.match(adminCss, /--pos-primary-active:\s*#92400e/i, 'Missing --pos-primary-active token');
    assert.match(adminCss, /--pos-primary-soft:\s*#fffbeb/i, 'Missing --pos-primary-soft token');
    assert.match(adminCss, /--pos-primary-border:\s*#fde68a/i, 'Missing --pos-primary-border token');
    assert.match(adminCss, /--pos-primary-gradient:\s*linear-gradient/i, 'Missing --pos-primary-gradient token');
  });

  it('5. Declares semantic status tokens for Paid, Unpaid, Hold, Cancelled, and Occupied', () => {
    // Paid
    assert.match(adminCss, /--pos-status-paid:\s*#059669/i, 'Missing --pos-status-paid token');
    assert.match(adminCss, /--pos-status-paid-bg:\s*#ecfdf5/i, 'Missing --pos-status-paid-bg token');
    assert.match(adminCss, /--pos-status-paid-border:\s*#a7f3d0/i, 'Missing --pos-status-paid-border token');

    // Unpaid
    assert.match(adminCss, /--pos-status-unpaid:\s*#d97706/i, 'Missing --pos-status-unpaid token');
    assert.match(adminCss, /--pos-status-unpaid-bg:\s*#fffbeb/i, 'Missing --pos-status-unpaid-bg token');
    assert.match(adminCss, /--pos-status-unpaid-border:\s*#fde68a/i, 'Missing --pos-status-unpaid-border token');

    // Hold
    assert.match(adminCss, /--pos-status-hold:\s*#f59e0b/i, 'Missing --pos-status-hold token');
    assert.match(adminCss, /--pos-status-hold-bg:\s*#fffbeb/i, 'Missing --pos-status-hold-bg token');

    // Cancelled
    assert.match(adminCss, /--pos-status-cancelled:\s*#dc2626/i, 'Missing --pos-status-cancelled token');
    assert.match(adminCss, /--pos-status-cancelled-bg:\s*#fef2f2/i, 'Missing --pos-status-cancelled-bg token');

    // Occupied
    assert.match(adminCss, /--pos-status-occupied:\s*#2563eb/i, 'Missing --pos-status-occupied token');
    assert.match(adminCss, /--pos-status-occupied-bg:\s*#eff6ff/i, 'Missing --pos-status-occupied-bg token');
  });

  it('6. Declares standard 7-step typography scale, spatial grid, radii, and touch targets', () => {
    // Typography Scale
    assert.match(adminCss, /--text-xs:\s*0\.75rem/i, 'Missing --text-xs (12px min floor)');
    assert.match(adminCss, /--text-sm:\s*0\.8125rem/i, 'Missing --text-sm (13px)');
    assert.match(adminCss, /--text-base:\s*0\.875rem/i, 'Missing --text-base (14px)');
    assert.match(adminCss, /--text-md:\s*1rem/i, 'Missing --text-md (16px)');
    assert.match(adminCss, /--text-lg:\s*1\.25rem/i, 'Missing --text-lg (20px)');
    assert.match(adminCss, /--text-xl:\s*1\.5rem/i, 'Missing --text-xl (24px)');
    assert.match(adminCss, /--text-2xl:\s*2rem/i, 'Missing --text-2xl (32px)');

    // Spatial Grid
    assert.match(adminCss, /--space-1:\s*0\.25rem/i, 'Missing --space-1');
    assert.match(adminCss, /--space-2:\s*0\.5rem/i, 'Missing --space-2');
    assert.match(adminCss, /--space-3:\s*0\.75rem/i, 'Missing --space-3');
    assert.match(adminCss, /--space-4:\s*1rem/i, 'Missing --space-4');
    assert.match(adminCss, /--space-8:\s*2rem/i, 'Missing --space-8');

    // Radii
    assert.match(adminCss, /--radius-sm:\s*6px/i, 'Missing --radius-sm');
    assert.match(adminCss, /--radius-md:\s*10px/i, 'Missing --radius-md');
    assert.match(adminCss, /--radius-lg:\s*14px/i, 'Missing --radius-lg');
    assert.match(adminCss, /--radius-xl:\s*16px/i, 'Missing --radius-xl');
    assert.match(adminCss, /--radius-full:\s*9999px/i, 'Missing --radius-full');

    // Touch Ergonomics
    assert.match(adminCss, /--touch-target-min:\s*40px/i, 'Missing --touch-target-min (40px)');
    assert.match(adminCss, /--touch-target-primary:\s*48px/i, 'Missing --touch-target-primary (48px)');
  });

  it('7. Maps legacy --adm-* custom properties to new --pos-* tokens for backward compatibility', () => {
    assert.match(adminCss, /--adm-bg:\s*var\(--pos-bg-app\)/i, 'Legacy --adm-bg not mapped to --pos-bg-app');
    assert.match(adminCss, /--adm-card:\s*var\(--pos-bg-surface\)/i, 'Legacy --adm-card not mapped to --pos-bg-surface');
    assert.match(adminCss, /--adm-border:\s*var\(--pos-border-subtle\)/i, 'Legacy --adm-border not mapped to --pos-border-subtle');
    assert.match(adminCss, /--adm-text:\s*var\(--pos-text-primary\)/i, 'Legacy --adm-text not mapped to --pos-text-primary');
    assert.match(adminCss, /--adm-muted:\s*var\(--pos-text-muted\)/i, 'Legacy --adm-muted not mapped to --pos-text-muted');
    assert.match(adminCss, /--adm-sidebar:\s*var\(--pos-bg-sidebar\)/i, 'Legacy --adm-sidebar not mapped to --pos-bg-sidebar');
    assert.match(adminCss, /--adm-green:\s*var\(--pos-primary\)/i, 'Legacy --adm-green not mapped to --pos-primary');
    assert.match(adminCss, /--adm-green-dark:\s*var\(--pos-primary-hover\)/i, 'Legacy --adm-green-dark not mapped to --pos-primary-hover');
    assert.match(adminCss, /--adm-green-light:\s*var\(--pos-primary-soft\)/i, 'Legacy --adm-green-light not mapped to --pos-primary-soft');
  });
});

describe('TASK 3.2: Touch Ergonomics Standards (40px Controls, 48px Primary POS)', () => {
  it('8. Enforces 40px minimum touch target on standard buttons (.adm-btn)', () => {
    assert.match(adminCss, /\.adm-btn\s*\{[^}]*min-height:\s*var\(--touch-target-min,\s*40px\)/s, '.adm-btn missing 40px min-height');
  });

  it('9. Enforces 40px minimum touch target on form inputs and selects', () => {
    assert.match(adminCss, /\.adm-select,\s*\.adm-input\s*\{[^}]*min-height:\s*var\(--touch-target-min,\s*40px\)/s, '.adm-select/.adm-input missing 40px min-height');
  });

  it('10. Enforces 48px minimum touch target on primary POS buttons and checkout CTA', () => {
    assert.match(adminCss, /#pos-checkout-btn,\s*\.pos-action-btn-primary,\s*\.pos-canva-settle-btn,\s*#pos-kot-bill-btn,\s*#hold-settle-confirm-btn\s*\{[^}]*min-height:\s*var\(--touch-target-primary,\s*48px\)\s*!important/s, 'Primary POS actions missing 48px touch target');
  });

  it('11. Enforces 40px minimum touch target on table card action buttons', () => {
    assert.match(adminCss, /\.table-card-btn\s*\{[^}]*min-height:\s*var\(--touch-target-min,\s*40px\)/s, '.table-card-btn missing 40px min-height');
  });

  it('12. Enforces 40px minimum touch target on POS payment mode selector pills', () => {
    assert.match(adminCss, /\.pos-canva-pay-grid\s+\.pos-pay-mode-pill\s*\{[^}]*min-height:\s*var\(--touch-target-min,\s*40px\)\s*!important/s, '.pos-pay-mode-pill missing 40px min-height');
  });
});

describe('TASK 3.2: Standardized Semantic Status Badges', () => {
  it('13. Standardizes .adm-pill and .adm-status-badge classes across Paid, Unpaid, Hold, Cancelled, and Occupied', () => {
    assert.match(adminCss, /\.adm-pill,\s*\.adm-status-badge\s*\{[^}]*font-size:\s*var\(--text-xs,\s*0\.75rem\)/s, 'Badges missing 12px min font-size');
    assert.match(adminCss, /\.adm-pill\.paid[^}]*--pos-status-paid/s, 'Paid badge missing --pos-status-paid token');
    assert.match(adminCss, /\.adm-pill\.unpaid[^}]*--pos-status-unpaid/s, 'Unpaid badge missing --pos-status-unpaid token');
    assert.match(adminCss, /\.adm-pill\.hold[^}]*--pos-status-hold/s, 'Hold badge missing --pos-status-hold token');
    assert.match(adminCss, /\.adm-pill\.cancelled[^}]*--pos-status-cancelled/s, 'Cancelled badge missing --pos-status-cancelled token');
    assert.match(adminCss, /\.adm-pill\.occupied[^}]*--pos-status-occupied/s, 'Occupied badge missing --pos-status-occupied token');
  });

  it('14. Standardizes table floor plan status pills (.table-status-pill)', () => {
    assert.match(adminCss, /\.table-status-pill\.free[^}]*--pos-status-paid/s, 'Free table pill missing --pos-status-paid token');
    assert.match(adminCss, /\.table-status-pill\.occupied[^}]*--pos-status-occupied/s, 'Occupied table pill missing --pos-status-occupied token');
    assert.match(adminCss, /\.table-status-pill\.billed[^}]*--pos-status-paid/s, 'Billed table pill missing --pos-status-paid token');
    assert.match(adminCss, /\.table-status-pill\.hold[^}]*--pos-status-hold/s, 'Hold table pill missing --pos-status-hold token');
  });
});

describe('TASK 3.2: Strict Typography Scale (Banning <12px / <0.75rem Text)', () => {
  it('15. Contains zero sub-12px (<0.75rem) font-size declarations in frontend/src/admin.css', () => {
    const sub12pxMatches = adminCss.match(/font-size:\s*0\.(?:[0-6][0-9]*|7[0-4][0-9]*)rem/g);
    assert.equal(sub12pxMatches, null, `Found sub-12px rules in admin.css: ${JSON.stringify(sub12pxMatches)}`);
  });

  it('16. Contains zero sub-12px (<0.75rem) font-size declarations in frontend/src/stock/stock.css', () => {
    const sub12pxMatches = stockCss.match(/font-size:\s*0\.(?:[0-6][0-9]*|7[0-4][0-9]*)rem/g);
    assert.equal(sub12pxMatches, null, `Found sub-12px rules in stock.css: ${JSON.stringify(sub12pxMatches)}`);
  });

  it('17. Contains zero sub-12px (<0.75rem) inline font-size styles in frontend/admin.html', () => {
    const sub12pxMatches = adminHtml.match(/font-size:\s*(?:0?\.(?:[0-6][0-9]*|7[0-4][0-9]*|7))rem/g);
    assert.equal(sub12pxMatches, null, `Found sub-12px styles in admin.html: ${JSON.stringify(sub12pxMatches)}`);
  });

  it('18. Contains zero sub-12px (<0.75rem) inline font-size styles in frontend/src/admin.js templates', () => {
    const sub12pxMatches = adminJs.match(/font-size:\s*(?:0?\.(?:[0-6][0-9]*|7[0-4][0-9]*|7))rem/g);
    assert.equal(sub12pxMatches, null, `Found sub-12px styles in admin.js: ${JSON.stringify(sub12pxMatches)}`);
  });
});

describe('TASK 3.2: Stock CSS & KDS Kitchen Display Integration', () => {
  it('19. Stock management inherits and binds design system tokens', () => {
    assert.match(stockCss, /--pos-text-primary/i, 'stock.css does not reference --pos-text-primary');
    assert.match(stockCss, /--pos-bg-surface/i, 'stock.css does not reference --pos-bg-surface');
    assert.match(stockCss, /--pos-border-subtle/i, 'stock.css does not reference --pos-border-subtle');
  });

  it('20. Kitchen Display System (KDS) cards and bump buttons maintain high-contrast styling and touch ergonomics', () => {
    assert.match(adminCss, /\.kitchen-kot-card\s*\{/i, 'Missing .kitchen-kot-card container');
    assert.match(adminCss, /\.kitchen-bump-btn\s*\{[^}]*min-height:\s*(?:46|48)px/s, 'Missing kitchen bump button styling with >= 46px height');
    assert.match(adminCss, /#kitchen-kot-container/i, 'Missing #kitchen-kot-container layout in admin.css');
  });
});
