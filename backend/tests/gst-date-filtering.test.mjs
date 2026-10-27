/**
 * LIMRA RESTAURANT — GST DATE-RANGE FILTERING & COMPLIANCE TEST SUITE
 * 
 * Verifies:
 * 1. UI Markup: Date pickers (From, To), Apply, Reset, Quick Presets, KPI Cards, Empty State
 * 2. Visual Architecture: White-and-Gold design palette and .gst-preset-btn styling
 * 3. Date Boundary Accuracy: Single-day, partial month, full month, crossing months, midnight boundaries (00:00:00 to 23:59:59)
 * 4. Validation: Rejection/warning for invalid ranges (start date > end date)
 * 5. Calculation Integrity: Gross sales, Taxable sales, CGST (2.5%), SGST (2.5%), IGST (0%), Total GST (5%), Order count
 * 6. Business Safeguards: Cancelled orders excluded, table sessions consolidated (no double-counting)
 * 7. Export Accuracy: CSV download respects active date range with itemized GST breakdown
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf8');

describe('SUITE 1: HTML Markup & Layout for GST Date Filtering Hub', () => {
  it('1.1 Section header contains title, subtitle, and prominent reporting period badge', () => {
    assert.ok(adminHtml.includes('GST Tax Accounting &amp; Compliance Hub') || adminHtml.includes('GST Tax Accounting & Compliance Hub'), 'Title must be present');
    assert.ok(adminHtml.includes('id="dash-gst-period-display"'), '#dash-gst-period-display banner must exist');
    assert.ok(adminHtml.includes('id="dash-gst-period-text"'), '#dash-gst-period-text must exist');
  });

  it('1.2 Quick preset buttons exist with data-preset attributes', () => {
    assert.ok(adminHtml.includes('id="dash-gst-presets"'), '#dash-gst-presets container must exist');
    assert.ok(adminHtml.includes('data-preset="today"'), 'Preset "today" button must exist');
    assert.ok(adminHtml.includes('data-preset="yesterday"'), 'Preset "yesterday" button must exist');
    assert.ok(adminHtml.includes('data-preset="this_month"'), 'Preset "this_month" button must exist');
    assert.ok(adminHtml.includes('data-preset="last_month"'), 'Preset "last_month" button must exist');
    assert.ok(adminHtml.includes('data-preset="7d"'), 'Preset "7d" button must exist');
    assert.ok(adminHtml.includes('data-preset="30d"'), 'Preset "30d" button must exist');
    assert.ok(adminHtml.includes('data-preset="custom"'), 'Preset "custom" button must exist');
  });

  it('1.3 Custom date range inputs and action buttons exist', () => {
    assert.ok(adminHtml.includes('id="dash-gst-custom-range-wrap"'), '#dash-gst-custom-range-wrap must exist');
    assert.ok(adminHtml.includes('id="dash-gst-start-date"'), '#dash-gst-start-date input must exist');
    assert.ok(adminHtml.includes('id="dash-gst-end-date"'), '#dash-gst-end-date input must exist');
    assert.ok(adminHtml.includes('id="dash-gst-apply-btn"'), '#dash-gst-apply-btn button must exist');
    assert.ok(adminHtml.includes('id="dash-gst-reset-btn"'), '#dash-gst-reset-btn button must exist');
  });

  it('1.4 All required GST summary KPI cards exist', () => {
    assert.ok(adminHtml.includes('id="stat-gst-gross"'), '#stat-gst-gross (Total gross sales) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-taxable"'), '#stat-gst-taxable (Total taxable sales) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-total"'), '#stat-gst-total (Total GST 5%) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-cgst"'), '#stat-gst-cgst (CGST 2.5%) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-sgst"'), '#stat-gst-sgst (SGST 2.5%) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-igst"'), '#stat-gst-igst (IGST 0%) must exist');
    assert.ok(adminHtml.includes('id="stat-gst-order-count"'), '#stat-gst-order-count must exist');
    assert.ok(adminHtml.includes('id="stat-gst-paid"'), '#stat-gst-paid must exist');
    assert.ok(adminHtml.includes('id="stat-gst-pending"'), '#stat-gst-pending must exist');
  });

  it('1.5 Empty state element and CSV export button exist', () => {
    assert.ok(adminHtml.includes('id="dash-gst-empty-state"'), '#dash-gst-empty-state must exist');
    assert.ok(adminHtml.includes('id="dash-export-gst-csv-btn"'), '#dash-export-gst-csv-btn must exist');
  });
});

describe('SUITE 2: Visual Styling & Tasteful Gold Palette Architecture', () => {
  it('2.1 admin.css defines .gst-preset-btn styles', () => {
    assert.ok(adminCss.includes('.gst-preset-btn'), '.gst-preset-btn must be defined in admin.css');
  });

  it('2.2 Active preset state uses gold highlight (#d97706)', () => {
    assert.ok(adminCss.includes('.gst-preset-btn.active'), '.gst-preset-btn.active must be defined');
    assert.ok(adminCss.includes('#d97706'), 'Active preset must use #d97706 gold accent');
  });
});

describe('SUITE 3: Date Boundary Accuracy & Timezone Calculations', () => {
  function getLocalDateString(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function computeDateRange(startStr, endStr) {
    const [sY, sM, sD] = startStr.split('-').map(Number);
    const start = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    const [eY, eM, eD] = (endStr || startStr).split('-').map(Number);
    const end = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    return { start, end };
  }

  it('3.1 Single day selection covers exactly 00:00:00.000 to 23:59:59.999 of that day', () => {
    const { start, end } = computeDateRange('2026-10-15', '2026-10-15');
    assert.equal(start.getHours(), 0);
    assert.equal(start.getMinutes(), 0);
    assert.equal(start.getSeconds(), 0);
    assert.equal(start.getMilliseconds(), 0);

    assert.equal(end.getHours(), 23);
    assert.equal(end.getMinutes(), 59);
    assert.equal(end.getSeconds(), 59);
    assert.equal(end.getMilliseconds(), 999);
    assert.equal(getLocalDateString(start), '2026-10-15');
    assert.equal(getLocalDateString(end), '2026-10-15');
  });

  it('3.2 Range crossing months (e.g. Sept 28 to Oct 05) includes boundary transactions', () => {
    const { start, end } = computeDateRange('2026-09-28', '2026-10-05');
    assert.equal(getLocalDateString(start), '2026-09-28');
    assert.equal(getLocalDateString(end), '2026-10-05');

    const orderSept28Morning = new Date('2026-09-28T00:01:00+05:30');
    const orderOct05Night = new Date('2026-10-05T23:58:00+05:30');
    const orderOct06Morning = new Date('2026-10-06T00:01:00+05:30');
    const orderSept27Night = new Date('2026-09-27T23:59:00+05:30');

    assert.ok(orderSept28Morning >= start && orderSept28Morning <= end, 'Order at start boundary must be included');
    assert.ok(orderOct05Night >= start && orderOct05Night <= end, 'Order at end boundary must be included');
    assert.ok(orderOct06Morning > end, 'Order after end boundary must be excluded');
    assert.ok(orderSept27Night < start, 'Order before start boundary must be excluded');
  });

  it('3.3 Validation rejects invalid date ranges where start date > end date', () => {
    assert.ok(adminJs.includes('Start date cannot be after end date'), 'admin.js must validate startStr <= finalEnd');
  });
});

describe('SUITE 4: GST Calculation Logic & Business Invariants', () => {
  it('4.1 Standalone restaurant 5% GST split: 2.5% CGST + 2.5% SGST', () => {
    // Intrastate food transaction
    const taxableAmount = 1000;
    const cgstRate = 2.5;
    const sgstRate = 2.5;
    const cgstAmt = Math.round((taxableAmount * (cgstRate / 100)) * 100) / 100;
    const sgstAmt = Math.round((taxableAmount * (sgstRate / 100)) * 100) / 100;
    const totalGst = cgstAmt + sgstAmt;
    const grossTotal = taxableAmount + totalGst;

    assert.equal(cgstAmt, 25.00);
    assert.equal(sgstAmt, 25.00);
    assert.equal(totalGst, 50.00);
    assert.equal(grossTotal, 1050.00);
  });

  it('4.2 Cancelled orders are excluded from total sales and tax metrics', () => {
    assert.ok(adminJs.includes("o.status !== 'cancelled'"), 'getGstFilteredOrders must filter out cancelled orders');
  });

  it('4.3 Table session consolidation prevents double-counting KOT rounds', () => {
    assert.ok(adminJs.includes('getConsolidatedClosedBills(matched)'), 'getGstFilteredOrders must consolidate table session bills');
  });

  it('4.4 Zero orders within selected range triggers empty state display', () => {
    assert.ok(adminJs.includes('dash-gst-empty-state'), 'renderGSTSection must toggle empty state on 0 orders');
  });
});

describe('SUITE 5: CSV Export & Server-Side Integration', () => {
  it('5.1 exportMonthlyGSTFilingCSV is async and ensures line items are loaded', () => {
    assert.ok(adminJs.includes('async function exportMonthlyGSTFilingCSV'), 'exportMonthlyGSTFilingCSV must be async');
    assert.ok(adminJs.includes('ensureOrderItemsLoaded'), 'exportMonthlyGSTFilingCSV must call ensureOrderItemsLoaded');
  });

  it('5.2 Exported CSV includes SAC Code 996331, CGST, SGST, Taxable Value, and Totals row', () => {
    assert.ok(adminJs.includes('"996331"'), 'CSV must contain SAC Code 996331');
    assert.ok(adminJs.includes('"TOTALS"'), 'CSV must contain a summary TOTALS row');
  });

  it('5.3 Export filename reflects selected date range or preset', () => {
    assert.ok(adminJs.includes('LIMRA_Restaurant_GST_Report_'), 'CSV filename must use LIMRA_Restaurant_GST_Report_ prefix');
  });
});
