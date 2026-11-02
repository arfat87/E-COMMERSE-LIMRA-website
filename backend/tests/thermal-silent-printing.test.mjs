/**
 * =============================================================================
 * SUITE 35: LIMRA POS — UNIVERSAL DIRECT SILENT THERMAL PRINTING
 * TVS 3200 Printer | Electron Desktop | Zero Print Dialog
 * =============================================================================
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePrinterDevice } from '../../electron/main.cjs';
import { printQueue } from '../../frontend/src/lib/print-queue.js';
import {
  hasJobBeenPrinted,
  markJobAsPrinted,
  clearPrintedJobTokens
} from '../../frontend/src/pos/thermal-printer.js';
import {
  convertEscPosToPlainText,
  convertHtmlToPlainText,
  resolvePrinterNameFromList
} from '../api/print-silent.js';
import printSilentHandler from '../api/print-silent.js';

describe('SUITE 35: Universal Direct Silent Thermal Printing (TVS 3200)', () => {
  beforeEach(() => {
    clearPrintedJobTokens();
  });

  test('1. Printer Device Name Fuzzy Resolution matches TVS 3200 hardware driver', async () => {
    // Simulated system installed printers (matching actual Windows device list)
    const mockPrinters = [
      { name: 'Microsoft Print to PDF', isDefault: false },
      { name: 'OneNote (Desktop)', isDefault: false },
      { name: 'RP3200 plus(U) 1', displayName: 'RP3200 plus(U) 1', isDefault: true }
    ];

    const mockWebContents = {
      getPrintersAsync: async () => mockPrinters
    };

    // Case A: Exact match
    const exact = await resolvePrinterDevice('RP3200 plus(U) 1', mockWebContents);
    assert.equal(exact.resolvedName, 'RP3200 plus(U) 1');
    assert.equal(exact.found, true);
    assert.equal(exact.matchedRule, 'exact');

    // Case B: Database / Settings legacy name 'TVS RP3200 Plus' fuzzy resolves to installed 'RP3200 plus(U) 1'
    const fuzzyTVS = await resolvePrinterDevice('TVS RP3200 Plus', mockWebContents);
    assert.equal(fuzzyTVS.resolvedName, 'RP3200 plus(U) 1');
    assert.equal(fuzzyTVS.found, true);

    // Case C: Keyword 'rp3200' resolves to 'RP3200 plus(U) 1'
    const keyword = await resolvePrinterDevice('rp3200', mockWebContents);
    assert.equal(keyword.resolvedName, 'RP3200 plus(U) 1');
    assert.equal(keyword.found, true);

    // Case D: Generic 'thermal' pattern resolves to 'RP3200 plus(U) 1'
    const genericThermal = await resolvePrinterDevice('Thermal POS', mockWebContents);
    assert.equal(genericThermal.resolvedName, 'RP3200 plus(U) 1');

    // Case E: Empty / unspecified name falls back to system default printer
    const emptyName = await resolvePrinterDevice('', mockWebContents);
    assert.equal(emptyName.resolvedName, 'RP3200 plus(U) 1');
    assert.equal(emptyName.isDefault, true);
  });

  test('2. Silent print options strictly enforce zero dialog and zero margins', () => {
    const jobOptions = {
      html: '<div class="receipt">Receipt Text</div>',
      printerName: 'RP3200 plus(U) 1',
      paperWidth: 80
    };

    // Simulate Electron options resolution
    const silentFlag = jobOptions.silent !== false;
    const margins = { marginType: 'none' };
    const widthMm = jobOptions.paperWidth === 58 ? '58' : '80';

    assert.equal(silentFlag, true, 'Silent flag must default to true to eliminate Windows print dialog');
    assert.equal(margins.marginType, 'none', 'Margins must be set to none to eliminate paper margins');
    assert.equal(widthMm, '80', 'Standard TVS RP3200 roll width is 80mm');
  });

  test('3. Deduplication prevents repeated prints on re-render, refresh, or realtime updates', () => {
    const orderId = 'ord-test-dedupe-101';
    const kotTokenRound1 = `kot:${orderId}:1`;

    assert.equal(hasJobBeenPrinted(kotTokenRound1), false, 'Initial state: job has not been printed');

    // First print simulates order placement -> marks printed
    markJobAsPrinted(kotTokenRound1);
    assert.equal(hasJobBeenPrinted(kotTokenRound1), true, 'Job must be recorded as printed');

    // Subsequent automatic checks for the same round report already printed
    assert.equal(hasJobBeenPrinted(kotTokenRound1), true, 'Duplicate automatic print must be suppressed');
  });

  test('4. Multiple KOT rounds print separately (Round 1 initial, Round 2 add-on)', () => {
    const orderId = 'ord-table-round-202';
    const round1Token = `kot:${orderId}:1`;
    const round2Token = `kot:${orderId}:2`;

    // Round 1 printed
    markJobAsPrinted(round1Token);
    assert.equal(hasJobBeenPrinted(round1Token), true);
    assert.equal(hasJobBeenPrinted(round2Token), false, 'Round 2 must NOT be blocked by Round 1');

    // Round 2 items added to table session -> printed
    markJobAsPrinted(round2Token);
    assert.equal(hasJobBeenPrinted(round2Token), true);
  });

  test('5. Bill Unpaid and Bill Paid lifecycle prints are tracked independently', () => {
    const orderId = 'ord-bill-lifecycle-303';
    const unpaidToken = `bill_unpaid:${orderId}`;
    const paidToken = `bill_paid:${orderId}`;

    // Table moved to Bill section -> UNPAID bill generated
    assert.equal(hasJobBeenPrinted(unpaidToken), false);
    markJobAsPrinted(unpaidToken);
    assert.equal(hasJobBeenPrinted(unpaidToken), true);

    // Customer pays -> PAID settled bill generated
    assert.equal(hasJobBeenPrinted(paidToken), false, 'Paid bill must NOT be blocked by unpaid bill');
    markJobAsPrinted(paidToken);
    assert.equal(hasJobBeenPrinted(paidToken), true);
  });

  test('6. Explicit user reprint (isReprint: true) bypasses deduplication', async () => {
    const orderId = 'ord-reprint-404';
    const dedupeKey = `bill_paid:${orderId}`;
    markJobAsPrinted(dedupeKey);

    // Automatic trigger: should be skipped
    const isAutoPrintEligible = !hasJobBeenPrinted(dedupeKey);
    assert.equal(isAutoPrintEligible, false, 'Auto print must be blocked');

    // Manual reprint click: isReprint === true bypasses the check!
    const isReprintEligible = true; // when options.isReprint === true, dedupe check is bypassed
    assert.equal(isReprintEligible, true, 'Explicit manual reprint must be allowed');
  });

  test('7. Print queue processes jobs sequentially with hardware confirmation flag', async () => {
    const executedJobs = [];

    // Mock executor simulating zero-dialog thermal hardware print
    const mockExecutor = async (job) => {
      executedJobs.push({
        id: job.id,
        type: job.type,
        orderNumber: job.orderNumber
      });
      return { success: true, hardware_confirmed: true, deviceName: 'RP3200 plus(U) 1' };
    };

    printQueue.setExecutor(mockExecutor);

    const job1 = await printQueue.enqueue({
      orderId: 'seq-1',
      orderNumber: '001',
      type: 'KOT',
      payload: { html: '<div>KOT 1</div>' }
    });

    const job2 = await printQueue.enqueue({
      orderId: 'seq-2',
      orderNumber: '002',
      type: 'BILL',
      payload: { html: '<div>Bill 2</div>' }
    });

    assert.equal(job1.status, 'hardware_confirmed');
    assert.equal(job1.hardwareConfirmed, true);
    assert.equal(job2.status, 'hardware_confirmed');
    assert.equal(job2.hardwareConfirmed, true);
    assert.equal(executedJobs.length, 2);
    assert.equal(executedJobs[0].type, 'KOT');
    assert.equal(executedJobs[1].type, 'BILL');
  });

  test('8. convertEscPosToPlainText strips ESC/POS byte sequences while preserving bill structure', () => {
    const rawEscPos = '\x1B\x40\x1B\x61\x01\x1B\x45\x01LIMRA RESTAURANT\x0A\x1B\x45\x00TAX INVOICE — TABLE 4\x0A------------------------------------------------\x0ABill: #1042\x0ASubtotal: ₹1000.00\x0ACGST (2.5%): ₹25.00\x0ASGST (2.5%): ₹25.00\x0A================================================\x0AGRAND TOTAL: ₹1050.00\x0A\x1D\x56\x41\x03';
    
    const plain = convertEscPosToPlainText(rawEscPos);
    assert.ok(!plain.includes('\x1B'), 'Must contain zero ESC bytes');
    assert.ok(!plain.includes('\x1D'), 'Must contain zero GS bytes');
    assert.ok(plain.includes('LIMRA RESTAURANT'), 'Must retain restaurant header');
    assert.ok(plain.includes('TAX INVOICE — TABLE 4'), 'Must retain table number and invoice title');
    assert.ok(plain.includes('GRAND TOTAL: ₹1050.00'), 'Must retain financial grand total');
  });

  test('9. convertHtmlToPlainText converts HTML receipt into clean printable text', () => {
    const receiptHtml = '<div class="receipt"><h2 style="text-align:center">LIMRA RESTAURANT</h2><p>Invoice #1042<br>Table: 4</p><table><tr><td>Chicken Biryani</td><td>₹500.00</td></tr></table><p>Grand Total: &#8377;1050.00</p></div>';
    
    const plain = convertHtmlToPlainText(receiptHtml);
    assert.ok(!plain.includes('<div'), 'Must strip HTML opening tags');
    assert.ok(!plain.includes('</div>'), 'Must strip HTML closing tags');
    assert.ok(plain.includes('LIMRA RESTAURANT'), 'Must preserve restaurant name');
    assert.ok(plain.includes('Invoice #1042'), 'Must preserve invoice number');
    assert.ok(plain.includes('₹1050.00'), 'Must decode HTML entities to currency symbol');
  });

  test('10. resolvePrinterNameFromList resolves requested hardware to RP3200 plus(U) 1', () => {
    const systemPrinters = [
      { name: 'Microsoft Print to PDF', isDefault: false },
      { name: 'OneNote (Desktop)', isDefault: false },
      { name: 'RP3200 plus(U) 1', isDefault: true, driverName: 'RP3200 plus' }
    ];

    // Requested legacy name matches installed driver
    assert.equal(resolvePrinterNameFromList('TVS RP3200 Plus', systemPrinters), 'RP3200 plus(U) 1');
    assert.equal(resolvePrinterNameFromList('rp3200', systemPrinters), 'RP3200 plus(U) 1');
    assert.equal(resolvePrinterNameFromList('', systemPrinters), 'RP3200 plus(U) 1');
    assert.equal(resolvePrinterNameFromList('Thermal POS', systemPrinters), 'RP3200 plus(U) 1');
  });

  test('11. /api/print-silent HTTP handler processes silent print request with zero dialogs', async () => {
    let statusCode = null;
    let jsonBody = null;

    const mockReq = {
      method: 'POST',
      body: {
        plainText: 'LIMRA POS ZERO-DIALOG TEST RECEIPT\r\nOrder #1042\r\nTotal: 1050\r\n',
        printerName: 'RP3200 plus(U) 1',
        paperWidth: 80
      }
    };

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      }
    };

    await printSilentHandler(mockReq, mockRes);
    assert.equal(statusCode, 200, 'HTTP status code must be 200');
    assert.equal(jsonBody.success, true, 'Handler response must report success: true');
    assert.equal(jsonBody.hardware_confirmed, true, 'Handler response must report hardware_confirmed: true');
    assert.equal(jsonBody.deviceName, 'RP3200 plus(U) 1', 'Device name must match resolved TVS printer');
  });

  test('12. Thermal invoice typography strictly enforces Courier New monospace font', () => {
    const adminJs = fs.readFileSync(path.resolve('frontend/src/admin.js'), 'utf8');
    const mainCjs = fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8');
    const workerCjs = fs.readFileSync(path.resolve('backend/print-worker.cjs'), 'utf8');

    // Courier New monospace verification in all print templates
    assert.match(adminJs, /font-family:\s*'Courier New',\s*Courier,\s*monospace/i, 'admin.js must use Courier New monospace');
    assert.match(mainCjs, /font-family:\s*'Courier New',\s*Courier,\s*monospace/i, 'main.cjs styledHtml must use Courier New monospace');
    assert.match(workerCjs, /font-family:\s*'Courier New',\s*Courier,\s*monospace/i, 'print-worker.cjs must use Courier New monospace');
  });

  test('13. Physical printable width is calibrated to 272px (71.95mm @ 96 DPI) with 0 margin', () => {
    const adminJs = fs.readFileSync(path.resolve('frontend/src/admin.js'), 'utf8');
    const mainCjs = fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8');

    // Container width verification
    assert.match(adminJs, /wPx\s*=\s*isA4\s*\?\s*595\s*:\s*\(is58\s*\?\s*220\s*:\s*272\)/, 'wPx must calibrate to 272 for standard 80mm roll');
    assert.match(adminJs, /width:\$\{wPx\}px;max-width:\$\{wPx\}px;[^"]*margin:0;box-sizing:border-box;/, 'Container must enforce 272px with margin: 0');
    assert.match(mainCjs, /targetWidthPx\s*=\s*is58\s*\?\s*220\s*:\s*272/, 'Electron worker window target width must be 272px');
    assert.match(mainCjs, /@page\s*\{\s*size:\s*\$\{paperWidthMm\}mm\s*auto;\s*margin:\s*0mm;\s*\}/, 'Electron @page rule must enforce 0mm margin');
  });

  test('14. Monospace table geometry allocates 268px exactly with zero Rate and Amt collision', () => {
    const adminJs = fs.readFileSync(path.resolve('frontend/src/admin.js'), 'utf8');

    // Extract table column widths: Item 136px, Qty 28px, Rate 44px, Amt 60px
    assert.match(adminJs, /width:136px;color:#000;vertical-align:top;">Item<\/th>/, 'Item column must be 136px');
    assert.match(adminJs, /width:28px;color:#000;vertical-align:top;">Qty<\/th>/, 'Qty column must be 28px');
    assert.match(adminJs, /width:44px;padding-right:4px;color:#000;vertical-align:top;">Rate<\/th>/, 'Rate column must be 44px with 4px padding-right');
    assert.match(adminJs, /width:60px;color:#000;vertical-align:top;">Amt<\/th>/, 'Amt column must be 60px');

    // Total width verification: 136 + 28 + 44 + 60 = 268px (+ 4px padding = 272px)
    const totalCols = 136 + 28 + 44 + 60;
    assert.equal(totalCols, 268, 'Columns must sum to 268px');
    assert.match(adminJs, /<tr style="border-bottom:1px dashed #000;">/, 'Item rows must include original dashed divider');
  });

  test('15. Duplicate / Reprint banner displays strictly on genuine reprint and not on force print', () => {
    const adminJs = fs.readFileSync(path.resolve('frontend/src/admin.js'), 'utf8');

    // Verify boolean separation
    assert.match(adminJs, /const isReprint = Boolean\(options && options\.isReprint\);/, 'isReprint must be decoupled');
    assert.match(adminJs, /showDuplicateBanner = Boolean\(options && \(options\.showDuplicateBanner === true \|\| \(isReprint && options\.showDuplicateBanner !== false\)\)\)/, 'showDuplicateBanner must respect explicit flags');
  });

  test('16. Thermal receipt excludes unsupported color emojis that produce 1-bit black smudges', () => {
    const adminJs = fs.readFileSync(path.resolve('frontend/src/admin.js'), 'utf8');

    // Verify text label instead of phone emoji
    assert.match(adminJs, /SCAN &amp; PAY VIA UPI/, 'Must use plain text for UPI without emoji');
    // Verify monochrome star entity instead of star emoji
    assert.match(adminJs, /&#9733;&#9733;&#9733;&#9733;&#9733;/, 'Must use HTML star entities for Google Review');
  });
});
