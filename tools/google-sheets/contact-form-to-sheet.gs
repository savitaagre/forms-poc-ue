/**
 * Google Apps Script that saves Contact Form block submissions to this Google Sheet.
 *
 * Setup: in the Google Sheet open Extensions > Apps Script, replace the sample code
 * with this file, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). Paste the Web app URL (ends in /exec)
 * into the Contact Form block's "Spreadsheet URL" setting in Universal Editor.
 *
 * Each form ("Contact form", "migrated-contactUs") gets its own tab. Column headers
 * are created automatically; new fields are added as new columns.
 */

function json(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// stop visitor input like "=IMPORTXML(...)" from running as a formula
function safe(value) {
  const text = String(value == null ? '' : value).slice(0, 5000);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const answers = data && Array.isArray(data.answers) ? data.answers : [];
    if (!answers.length) return json({ result: 'error', error: 'No answers in the submission' });
    const tabName = String(data.form || 'Submissions').replace(/[[\]*?/\\:]/g, ' ').slice(0, 90);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

    const lastColumn = sheet.getLastColumn();
    const headers = lastColumn
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String)
      : ['Submitted at', 'Page'];
    answers.forEach((a) => {
      if (a && a.label && !headers.includes(String(a.label))) headers.push(String(a.label));
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);

    const values = { 'Submitted at': new Date(), Page: safe(data.page) };
    answers.forEach((a) => { if (a && a.label) values[String(a.label)] = safe(a.value); });
    sheet.appendRow(headers.map((h) => (h in values ? values[h] : '')));

    return json({ result: 'success' });
  } catch (err) {
    return json({ result: 'error', error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
