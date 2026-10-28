// Term 2 Planner — read-only page for teachers.
// Paste this file into the sheet's Extensions → Apps Script, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). The page itself is loaded from GitHub, so updates need no re-paste.
var PAGE_URL = 'https://raw.githubusercontent.com/Wahedroh/vscode_ipad/main/term2-planner/viewer/index.html';
var CACHE_SECONDS = 300;

function doGet() {
  var cache = CacheService.getScriptCache();
  var html = cache.get('page');
  if (!html) {
    html = UrlFetchApp.fetch(PAGE_URL).getContentText();
    cache.put('page', html, CACHE_SECONDS);
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('เนื้อหาคณิตเทอม 2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called from the page with google.script.run. Returns each tab's rows as displayed, header removed.
function getData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function rows(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('ไม่พบแท็บ "' + name + '" ในไฟล์ชีต');
    return sheet.getDataRange().getDisplayValues().slice(1);
  }
  return { classes: rows('ห้องเรียน'), topics: rows('เรื่อง'), sequences: rows('ลำดับมาตรฐาน') };
}
