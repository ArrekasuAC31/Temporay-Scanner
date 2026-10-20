/**
 * J&A emergency warehouse logger v1 — 2026-10-19
 * Bind to the existing private Google Sheet. Replaces the old Code.gs but
 * PRESERVES the previous SCAN HERE!B5 onEdit path and log columns.
 *
 * Configure script property BRIDGE_SECRET (different from operator password).
 * Optional script property SPREADSHEET_ID if the script is not container bound.
 * Deploy Web app: Execute as Me, Access Anyone (backend secret required).
 * NEVER share the bridge secret or deployment URL publicly.
 */
const JA_CFG = Object.freeze({
  inputSheet: 'SCAN HERE', logSheet: 'SCAN LOG',
  input: 'B5', operator: 'B7', shop: 'B8', courier: 'B9',
  result: 'F5', lastNumber: 'F6', lastTime: 'F7',
  timezone: 'Asia/Manila',
});

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No bound spreadsheet. Set SPREADSHEET_ID.');
  return ss;
}
function normalizeWaybill_(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}
function safeSheetText_(input, max) {
  const str = String(input == null ? '' : input)
    .replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
  // Disallow formula interpretation from manual operator/shop input.
  return /^[=+@-]/.test(str) ? "'" + str : str;
}
function findOrSave_(payload) {
  const waybill = normalizeWaybill_(payload.waybill);
  if (!/^[A-Z0-9-]{8,45}$/.test(waybill)) {
    return { status: 'invalid' };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(12000)) return { status: 'error', reason: 'busy' };
  try {
    const log = sheet_().getSheetByName(JA_CFG.logSheet);
    if (!log) throw new Error('SCAN LOG sheet is missing');
    const lastRow = log.getLastRow();
    const duplicate = lastRow > 1 && log.getRange(2, 2, lastRow - 1, 1)
      .createTextFinder(waybill).matchCase(false).matchEntireCell(true).findNext();
    if (duplicate) return { status: 'duplicate' };
    const now = Utilities.formatDate(new Date(), JA_CFG.timezone, 'yyyy-MM-dd HH:mm:ss');
    const eventId = Utilities.getUuid();
    // Original 14-column layout retained to support later reconciliation.
    // Force text format for the waybill before writing; preserve leading zeroes.
    const nextRow = lastRow + 1;
    log.getRange(nextRow, 2).setNumberFormat('@');
    log.getRange(nextRow, 1, 1, 14).setValues([[
      now, waybill, 'SCAN_OUT',
      safeSheetText_(payload.shop || 'JA Enterprises', 40),
      safeSheetText_(payload.operator, 60),
      safeSheetText_(payload.courier, 25),
      '', '', '', '', 'PENDING', '', eventId, ''
    ]]);
    SpreadsheetApp.flush();
    return { status: 'saved', timestampPH: now };
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  let result;
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    const req = JSON.parse(e && e.postData && e.postData.contents || '{}');
    if (!secret || secret.length < 24 || String(req.secret || '') !== secret) {
      result = { status: 'error' };
    } else {
      result = findOrSave_({
        waybill: req.waybill,
        operator: req.operator,
        shop: 'JA Enterprises',
        courier: req.courier,
      });
    }
  } catch (err) {
    console.error('Scan save failed:', err);
    result = { status: 'error' };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Retained desktop SCAN HERE!B5 workflow (no Web App needed for this path).
function onEdit(e) {
  if (!e || !e.range) return;
  const page = e.range.getSheet();
  if (page.getName() !== JA_CFG.inputSheet ||
      e.range.getA1Notation() !== JA_CFG.input ||
      e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const value = e.value === undefined ? e.range.getDisplayValue() : e.value;
  const waybill = normalizeWaybill_(value);
  if (!waybill) return;
  let result;
  try {
    result = findOrSave_({
      waybill,
      operator: page.getRange(JA_CFG.operator).getDisplayValue(),
      shop: page.getRange(JA_CFG.shop).getDisplayValue() || 'JA Enterprises',
      courier: page.getRange(JA_CFG.courier).getDisplayValue(),
    });
  } catch (err) {
    console.error(err);
    result = { status: 'error' };
  }
  const messages = {
    saved: ['SAVED - SCAN OUT', '#e2f3eb'],
    duplicate: ['DUPLICATE - NOT SAVED', '#fff0d9'],
    invalid: ['INVALID WAYBILL', '#fce8e6'],
    error: ['SAVE FAILED - RETRY', '#fce8e6'],
  };
  const [msg, color] = messages[result.status] || messages.error;
  page.getRange(JA_CFG.result).setValue(msg).setBackground(color);
  page.getRange(JA_CFG.lastNumber).setValue(waybill);
  if (result.timestampPH) page.getRange(JA_CFG.lastTime).setValue(result.timestampPH);
  if (result.status === 'saved' || result.status === 'duplicate') {
    page.getRange(JA_CFG.input).clearContent();
  }
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('J&A Scan Out')
    .addItem('Go to Scan Entry', 'openScanEntry').addToUi();
}
function openScanEntry() {
  const ss = sheet_(), page = ss.getSheetByName(JA_CFG.inputSheet);
  if (!page) throw new Error('SCAN HERE tab not found');
  ss.setActiveSheet(page);
  page.getRange(JA_CFG.input).activate();
}
