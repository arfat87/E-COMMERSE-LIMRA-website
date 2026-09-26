/**
 * Limra POS - Google Apps Script Web App Backend (Code.gs)
 * 
 * Receives batch offline bills from the POS frontend and appends them
 * cleanly into Google Sheets.
 * 
 * Setup Instructions:
 * 1. Open Google Sheets -> Create a new spreadsheet (or use existing).
 * 2. Click "Extensions" -> "Apps Script".
 * 3. Delete any default code and paste this entire Code.gs file.
 * 4. Click "Deploy" (top right) -> "New deployment".
 * 5. Select type: "Web app".
 * 6. Configuration:
 *    - Description: "Limra POS Offline Sync API"
 *    - Execute as: "Me" (your email)
 *    - Who has access: "Anyone" (allows the POS browser client to POST)
 * 7. Click "Deploy" -> Authorize access if prompted.
 * 8. Copy the "Web app URL" (ends with /exec) and paste it into your POS settings!
 */

// Target sheet tab name
const SHEET_NAME = "POS_Bills";

// Default column headers
const HEADERS = [
  "Bill ID",
  "Date & Time",
  "Table No",
  "Items Summary",
  "Subtotal (₹)",
  "Tax (₹)",
  "Grand Total (₹)",
  "Payment Mode",
  "Payment Status",
  "Customer Info",
  "Synced At"
];

/**
 * HTTP POST Handler - Receives JSON payload of bills
 */
function doPost(e) {
  // Concurrency lock: ensures simultaneous syncs do not overwrite each other
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(20000); // Wait up to 20 seconds

  if (!hasLock) {
    return createJsonResponse({
      status: "error",
      message: "Server is currently busy processing another sync batch. Please retry in a moment."
    }, 429);
  }

  try {
    // 1. Verify and parse incoming request data
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        status: "error",
        message: "No request body provided"
      }, 400);
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({
        status: "error",
        message: "Invalid JSON body: " + parseErr.message
      }, 400);
    }

    // Support both batch payload { bills: [...] } and single bill payload { ... }
    const bills = Array.isArray(payload.bills) 
      ? payload.bills 
      : (Array.isArray(payload) ? payload : [payload]);

    if (bills.length === 0) {
      return createJsonResponse({
        status: "success",
        syncedCount: 0,
        message: "No bills to process"
      });
    }

    // 2. Open or create the target spreadsheet sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      initializeSheetHeaders(sheet);
    } else if (sheet.getLastRow() === 0) {
      initializeSheetHeaders(sheet);
    }

    // 3. Prevent duplicate bill insertions using existing Bill IDs
    const lastRow = sheet.getLastRow();
    const existingBillIds = new Set();
    if (lastRow > 1) {
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      idValues.forEach(row => {
        if (row[0]) existingBillIds.add(String(row[0]).trim());
      });
    }

    // 4. Map each bill to a row array
    const rowsToAppend = [];
    const nowIso = new Date().toISOString();

    for (const bill of bills) {
      const billId = String(bill.billNumber || bill.localId || bill.id || "").trim();

      // Skip duplicates if already synced earlier
      if (billId && existingBillIds.has(billId)) {
        continue;
      }

      // Format Date & Time for IST
      let formattedDate = bill.createdAt || nowIso;
      try {
        const d = new Date(bill.createdAt || nowIso);
        formattedDate = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
      } catch (err) {
        // Fallback to raw string
      }

      // Format Items Summary: e.g. "Chicken Biryani (x2), Butter Naan (x4)"
      let itemsText = bill.itemsSummary || "";
      if (!itemsText && Array.isArray(bill.items)) {
        itemsText = bill.items
          .map(it => `${it.name || 'Item'} (x${it.quantity || it.qty || 1})`)
          .join(", ");
      }

      const subtotal = Number(bill.subtotal ?? bill.totalAmount ?? 0);
      const tax = Number(bill.tax ?? 0);
      const grandTotal = Number(bill.totalAmount ?? (subtotal + tax));
      const paymentMode = String(bill.paymentMode || "cash").toUpperCase();
      const paymentStatus = String(bill.paymentStatus || "paid").toUpperCase();
      const customerInfo = [bill.customerName, bill.customerPhone].filter(Boolean).join(" - ");

      rowsToAppend.push([
        billId,
        formattedDate,
        bill.tableNo || "Counter",
        itemsText,
        subtotal,
        tax,
        grandTotal,
        paymentMode,
        paymentStatus,
        customerInfo,
        nowIso
      ]);

      if (billId) existingBillIds.add(billId);
    }

    // 5. Append rows in bulk for maximum speed
    if (rowsToAppend.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      const range = sheet.getRange(startRow, 1, rowsToAppend.length, HEADERS.length);
      range.setValues(rowsToAppend);

      // Format currency columns (Subtotal: col 5, Tax: col 6, Total: col 7)
      sheet.getRange(startRow, 5, rowsToAppend.length, 3).setNumberFormat("₹#,##0.00");
    }

    // Return clean JSON response
    return createJsonResponse({
      status: "success",
      syncedCount: rowsToAppend.length,
      skippedDuplicates: bills.length - rowsToAppend.length,
      message: `Successfully synchronized ${rowsToAppend.length} bill(s) to Google Sheets.`
    });

  } catch (globalErr) {
    console.error("Sync error in Code.gs:", globalErr);
    return createJsonResponse({
      status: "error",
      message: globalErr.message || "An unexpected server error occurred"
    }, 500);

  } finally {
    lock.releaseLock();
  }
}

/**
 * HTTP GET Handler - Health Check & Diagnostics
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const totalBills = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;

  return createJsonResponse({
    status: "online",
    service: "Limra POS Google Sheets Sync Web App",
    sheetName: SHEET_NAME,
    totalBillsRecorded: totalBills,
    timestamp: new Date().toISOString()
  });
}

/**
 * Initializes header styles for a new sheet tab
 */
function initializeSheetHeaders(sheet) {
  sheet.appendRow(HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#242724");
  headerRange.setFontColor("#ffffff");
  sheet.setFrozenRows(1);

  // Auto-fit column widths
  for (let i = 1; i <= HEADERS.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

/**
 * Helper to build JSON responses for Google Apps Script
 */
function createJsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
