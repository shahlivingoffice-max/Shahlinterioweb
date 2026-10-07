/**
 * SECUREX by Shah Interio - Customer Support Form
 *
 * Flow:
 *   1. Customer picks a Query Type (Enquiry or Complaint).
 *   2. Both types ask: Unique Code, Store Name, City, Your Query.
 *   3. Complaint additionally REQUIRES at least 1 photo; extra photos,
 *      videos and a voice note are optional on both types.
 *
 * Attachments upload in chunks into a DRAFT folder on Drive while the customer
 * fills the form; on submit that folder is renamed to the ticket id and the
 * file links are written back to the sheet.
 */

// ==================== CONFIGURATION ====================
const CONFIG = {
  BRAND: 'SECUREX by Shah Interio',
  TAGLINE: 'Customer Support',
  SHEET_NAME: 'Support Tickets',
  SPREADSHEET_ID: '',          // blank = the sheet this script is bound to
  DRIVE_FOLDER_ID: '',         // blank = auto-created "... - Support Attachments"
  ADMIN_EMAILS: '',            // e.g. 'support@shahinterio.com,owner@gmail.com'
  SUPPORT_PHONE: '',
  TICKET_PREFIX: 'SX',
  ASK_PHONE: false,            // true = also show an optional Mobile Number field

  MAX_IMAGES: 10,
  MAX_VIDEOS: 3,
  MAX_IMAGE_MB: 12,
  MAX_VIDEO_MB: 40,
  MAX_AUDIO_MB: 15,
  VOICE_NOTE_MAX_SECONDS: 180,
  SHARE_LINKS: true            // false = only people with Drive access can open files
};

const QUERY_TYPES = [
  {
    id: 'enquiry',
    label: 'Enquiry / Question',
    hint: 'Product, price, order status, dispatch, installation or billing',
    photoRequired: false
  },
  {
    id: 'complaint',
    label: 'Complaint',
    hint: 'Damage, defect, wrong item or service issue - photo required',
    photoRequired: true
  }
];

const HEADERS = [
  'Ticket ID',
  'Timestamp',
  'Query Type',
  'Unique Code',
  'Store Name',
  'City',
  'Mobile',
  'Your Query',
  'Images',
  'Videos',
  'Voice Note',
  'Attachments Folder',
  'Status',
  'Assigned To',
  'Resolved On',
  'Remarks'
];

const COL = {
  TICKET: 1, TIMESTAMP: 2, TYPE: 3, CODE: 4, STORE: 5, CITY: 6, PHONE: 7,
  QUERY: 8, IMAGES: 9, VIDEOS: 10, VOICE: 11, FOLDER: 12,
  STATUS: 13, ASSIGNED: 14, RESOLVED: 15, REMARKS: 16
};

const STATUS_OPTIONS = ['New', 'In Progress', 'Waiting for Customer', 'Resolved', 'Closed'];

const DRAFT_PREFIX = 'DRAFT-';
const PARTS_FOLDER = '_parts';

// ==================== WEB APP ENTRY ====================
/**
 * Two front doors:
 *   - shahinterio.com/support/ posts JSON here (doPost) - the live form.
 *   - Opening the /exec URL in a browser serves the built-in form as a backup.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return jsonOut_(handleApi_({ action: e.parameter.action }));
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.BRAND + ' | ' + CONFIG.TAGLINE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * JSON API for the page hosted on shahinterio.com.
 * The browser sends Content-Type: text/plain so that it stays a "simple
 * request" - Apps Script cannot answer a CORS preflight (OPTIONS).
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ success: false, message: 'Could not read the request.' });
  }
  return jsonOut_(handleApi_(body));
}

function handleApi_(body) {
  try {
    switch (body.action) {
      case 'config':
        return { success: true, config: getFormConfig() };
      case 'draft':
        return { success: true, draftId: createDraft().draftId };
      case 'chunk':
        return { success: true, result: uploadChunk(body.draftId, body.chunk) };
      case 'discard':
        return discardAttachment(body.draftId, body.fileId);
      case 'submit':
        return submitTicket(body.payload);
      default:
        return { success: false, message: 'Unknown action.' };
    }
  } catch (err) {
    console.error(err);
    return { success: false, message: err.message || 'Request failed.' };
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Run once from the editor: creates the sheet tab and the attachments folder. */
function setup() {
  getSheet_();
  const folder = getParentFolder_();
  SpreadsheetApp.flush();
  Logger.log('Sheet ready. Attachments folder: ' + folder.getName() + ' (' + folder.getId() + ')');
}

function getFormConfig() {
  return {
    brand: CONFIG.BRAND,
    tagline: CONFIG.TAGLINE,
    queryTypes: QUERY_TYPES,
    supportPhone: CONFIG.SUPPORT_PHONE,
    askPhone: CONFIG.ASK_PHONE,
    limits: {
      maxImages: CONFIG.MAX_IMAGES,
      maxVideos: CONFIG.MAX_VIDEOS,
      maxImageMb: CONFIG.MAX_IMAGE_MB,
      maxVideoMb: CONFIG.MAX_VIDEO_MB,
      maxAudioMb: CONFIG.MAX_AUDIO_MB,
      voiceSeconds: CONFIG.VOICE_NOTE_MAX_SECONDS
    }
  };
}

// ==================== SHEET ====================
function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet found. Set CONFIG.SPREADSHEET_ID.');
  return ss;
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold')
      .setBackground('#621119')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(COL.QUERY, 360);
    sheet.setColumnWidth(COL.IMAGES, 220);
    sheet.setColumnWidth(COL.VIDEOS, 200);
    sheet.setColumnWidth(COL.VOICE, 200);
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUS_OPTIONS, true)
      .build();
    sheet.getRange(2, COL.STATUS, 1000, 1).setDataValidation(statusRule);
  }
  return sheet;
}

// ==================== DRIVE ====================
function getParentFolder_() {
  if (CONFIG.DRIVE_FOLDER_ID) return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);

  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('ATTACH_FOLDER_ID');
  if (saved) {
    try {
      return DriveApp.getFolderById(saved);
    } catch (e) {
      // folder was deleted - fall through and make a new one
    }
  }
  const name = CONFIG.BRAND + ' - Support Attachments';
  const existing = DriveApp.getFoldersByName(name);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(name);
  props.setProperty('ATTACH_FOLDER_ID', folder.getId());
  return folder;
}

/** Called by the form before its first upload. Returns the draft folder id. */
function createDraft() {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const folder = getParentFolder_()
    .createFolder(DRAFT_PREFIX + stamp + '-' + Utilities.getUuid().substring(0, 6));
  return { draftId: folder.getId() };
}

function getDraftFolder_(draftId) {
  if (!draftId) throw new Error('Upload session missing. Please reload and try again.');
  let folder;
  try {
    folder = DriveApp.getFolderById(String(draftId));
  } catch (e) {
    throw new Error('Upload session expired. Please reload and try again.');
  }
  if (folder.getName().indexOf(DRAFT_PREFIX) !== 0) throw new Error('Invalid upload session.');
  const parentId = getParentFolder_().getId();
  const parents = folder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === parentId) return folder;
  }
  throw new Error('Invalid upload session.');
}

function getPartsFolder_(draftFolder) {
  const it = draftFolder.getFoldersByName(PARTS_FOLDER);
  return it.hasNext() ? it.next() : draftFolder.createFolder(PARTS_FOLDER);
}

/**
 * Receives one chunk of one attachment.
 * chunk = { uploadId, name, mimeType, kind, index, total, data (base64) }
 * Every non-final chunk must hold a multiple of 3 bytes so that the base64
 * pieces can be concatenated before decoding.
 */
function uploadChunk(draftId, chunk) {
  const folder = getDraftFolder_(draftId);
  const index = Number(chunk.index);
  const total = Number(chunk.total);

  if (total === 1) return storeAttachment_(folder, chunk, chunk.data);

  const parts = getPartsFolder_(folder);
  const partName = chunk.uploadId + '.' + ('0000' + index).slice(-5);
  parts.createFile(Utilities.newBlob(chunk.data, 'text/plain', partName));

  if (index < total - 1) return { status: 'chunk', index: index };

  const collected = [];
  const it = parts.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(chunk.uploadId + '.') === 0) collected.push(f);
  }
  if (collected.length !== total) {
    cleanupParts_(collected);
    throw new Error('Upload incomplete (' + collected.length + ' of ' + total + ' parts). Please retry.');
  }
  collected.sort(function (a, b) {
    return a.getName() < b.getName() ? -1 : 1;
  });

  let base64 = '';
  for (let i = 0; i < collected.length; i++) {
    base64 += collected[i].getBlob().getDataAsString();
  }
  cleanupParts_(collected);
  return storeAttachment_(folder, chunk, base64);
}

function cleanupParts_(files) {
  for (let i = 0; i < files.length; i++) {
    try {
      files[i].setTrashed(true);
    } catch (e) {
      // ignore
    }
  }
}

function storeAttachment_(folder, meta, base64) {
  // Recorders report things like "audio/webm;codecs=opus" - Drive wants the bare type.
  const mimeType = clean_(meta.mimeType, 100).split(';')[0].trim() || 'application/octet-stream';
  const kind = kindFor_(mimeType, meta.kind);
  const bytes = Utilities.base64Decode(base64);
  const sizeMb = bytes.length / (1024 * 1024);

  const cap = kind === 'video' ? CONFIG.MAX_VIDEO_MB
    : kind === 'audio' ? CONFIG.MAX_AUDIO_MB
      : CONFIG.MAX_IMAGE_MB;
  if (sizeMb > cap) {
    throw new Error('File is ' + sizeMb.toFixed(1) + ' MB. Limit for a ' + kind + ' is ' + cap + ' MB.');
  }

  const name = safeFileName_(meta.name, kind, mimeType);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, name));
  if (CONFIG.SHARE_LINKS) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.warn('Could not share file: ' + e.message);
    }
  }
  return {
    status: 'done',
    fileId: file.getId(),
    url: file.getUrl(),
    name: name,
    kind: kind,
    sizeKb: Math.round(bytes.length / 1024)
  };
}

function kindFor_(mimeType, declared) {
  if (mimeType.indexOf('image/') === 0) return 'image';
  if (mimeType.indexOf('video/') === 0) return 'video';
  if (mimeType.indexOf('audio/') === 0) return 'audio';
  if (declared === 'image' || declared === 'video' || declared === 'audio') return declared;
  return 'file';
}

function safeFileName_(raw, kind, mimeType) {
  let base = clean_(raw, 80).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  if (!base) base = kind;
  if (base.indexOf('.') === -1) base += '.' + extensionFor_(mimeType, kind);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmmss');
  const dot = base.lastIndexOf('.');
  return base.substring(0, dot) + '_' + stamp + base.substring(dot);
}

function extensionFor_(mimeType, kind) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
    'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a'
  };
  if (map[mimeType]) return map[mimeType];
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'm4a' : 'jpg';
}

/** Removes an attachment the customer deleted before submitting. */
function discardAttachment(draftId, fileId) {
  try {
    const folder = getDraftFolder_(draftId);
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.getId() === String(fileId)) {
        f.setTrashed(true);
        return { success: true };
      }
    }
    return { success: false };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function listDraftAttachments_(folder) {
  const out = { image: [], video: [], audio: [], file: [] };
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const kind = kindFor_(f.getMimeType(), '');
    out[kind].push({ name: f.getName(), url: f.getUrl() });
  }
  return out;
}

// ==================== HELPERS ====================
function clean_(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .substring(0, max || 200);
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function queryTypeById_(id) {
  for (let i = 0; i < QUERY_TYPES.length; i++) {
    if (QUERY_TYPES[i].id === id) return QUERY_TYPES[i];
  }
  return null;
}

function generateTicketId_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  let counter = Number(props.getProperty('TICKET_COUNTER') || 0);
  if (props.getProperty('LAST_TICKET_DAY') !== today) {
    counter = 0;
    props.setProperty('LAST_TICKET_DAY', today);
  }
  counter += 1;
  props.setProperty('TICKET_COUNTER', String(counter));
  return CONFIG.TICKET_PREFIX + '-' + today + '-' + ('000' + counter).slice(-3);
}

function validate_(d, type) {
  if (d.website) return 'Invalid submission.';
  if (!type) return 'Please select a query type.';
  if (d.uniqueCode.length < 3) return 'Please enter the unique code printed on your product or invoice.';
  if (d.storeName.length < 2) return 'Please enter the store name.';
  if (d.city.length < 2) return 'Please enter your city.';
  if (d.message.length < 5) return 'Please describe your query.';
  if (CONFIG.ASK_PHONE && d.phone && !/^[6-9]\d{9}$/.test(d.phone)) {
    return 'Please enter a valid 10-digit mobile number.';
  }
  return '';
}

// ==================== SUBMIT ====================
function submitTicket(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (e) {
    return { success: false, message: 'Server is busy. Please try again in a moment.' };
  }

  try {
    const d = {
      website: clean_(payload && payload.website, 50),
      queryType: clean_(payload && payload.queryType, 40),
      uniqueCode: clean_(payload && payload.uniqueCode, 60),
      storeName: clean_(payload && payload.storeName, 120),
      city: clean_(payload && payload.city, 80),
      phone: clean_(payload && payload.phone, 20).replace(/\D/g, '').slice(-10),
      message: clean_(payload && payload.message, 3000),
      draftId: clean_(payload && payload.draftId, 80)
    };

    const type = queryTypeById_(d.queryType);
    const error = validate_(d, type);
    if (error) return { success: false, message: error };

    let folder = null;
    let media = { image: [], video: [], audio: [], file: [] };
    if (d.draftId) {
      folder = getDraftFolder_(d.draftId);
      media = listDraftAttachments_(folder);
    }

    if (type.photoRequired && media.image.length === 0) {
      return { success: false, message: 'Please attach at least 1 photo of the issue.' };
    }
    if (media.image.length > CONFIG.MAX_IMAGES) {
      return { success: false, message: 'Maximum ' + CONFIG.MAX_IMAGES + ' photos allowed.' };
    }
    if (media.video.length > CONFIG.MAX_VIDEOS) {
      return { success: false, message: 'Maximum ' + CONFIG.MAX_VIDEOS + ' videos allowed.' };
    }

    const ticketId = generateTicketId_();
    const now = new Date();
    let folderUrl = '';

    if (folder) {
      const parts = folder.getFoldersByName(PARTS_FOLDER);
      while (parts.hasNext()) parts.next().setTrashed(true);
      folder.setName(ticketId + ' - ' + (d.storeName || 'Store').replace(/[\\/]+/g, '-'));
      if (CONFIG.SHARE_LINKS) {
        try {
          folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e) {
          // ignore - individual files are already shared
        }
      }
      folderUrl = folder.getUrl();
    }

    const sheet = getSheet_();
    sheet.appendRow([
      ticketId,
      now,
      type.label,
      d.uniqueCode,
      d.storeName,
      d.city,
      d.phone ? "'" + d.phone : '',
      d.message,
      urlList_(media.image),
      urlList_(media.video),
      urlList_(media.audio),
      folderUrl,
      'New',
      '',
      '',
      ''
    ]);
    const row = sheet.getLastRow();
    sheet.getRange(row, COL.TIMESTAMP).setNumberFormat('dd-mmm-yyyy hh:mm');
    sheet.getRange(row, COL.PHONE).setNumberFormat('@');
    if (d.phone) sheet.getRange(row, COL.PHONE).setValue(d.phone);
    sheet.getRange(row, COL.STATUS).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_OPTIONS, true).build()
    );
    sheet.getRange(row, COL.IMAGES, 1, 3).setWrap(true);

    sendAdminEmail_(ticketId, d, type, media, folderUrl, now);

    return {
      success: true,
      ticketId: ticketId,
      attachments: {
        images: media.image.length,
        videos: media.video.length,
        voiceNotes: media.audio.length
      }
    };
  } catch (err) {
    console.error(err);
    return { success: false, message: err.message || 'Something went wrong. Please try again.' };
  } finally {
    lock.releaseLock();
  }
}

function urlList_(items) {
  return items.map(function (i) {
    return i.url;
  }).join('\n');
}

// ==================== EMAIL ====================
function sendAdminEmail_(ticketId, d, type, media, folderUrl, now) {
  if (!CONFIG.ADMIN_EMAILS) return;
  const when = Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd MMM yyyy, hh:mm a');

  const rows = [
    ['Ticket ID', ticketId],
    ['Received', when],
    ['Query Type', type.label],
    ['Unique Code', d.uniqueCode],
    ['Store Name', d.storeName],
    ['City', d.city]
  ];
  if (CONFIG.ASK_PHONE) rows.push(['Mobile', d.phone || '-']);

  const tableRows = rows.map(function (r) {
    return '<tr><td style="padding:8px 12px;border:1px solid #d9c4c6;background:#f8f2f2;font-weight:600;">' +
      escapeHtml_(r[0]) + '</td><td style="padding:8px 12px;border:1px solid #d9c4c6;">' +
      escapeHtml_(r[1]) + '</td></tr>';
  }).join('');

  const linkBlock = function (title, items) {
    if (!items.length) return '';
    const list = items.map(function (i, n) {
      return '<li><a href="' + escapeHtml_(i.url) + '">' +
        escapeHtml_(i.name || (title + ' ' + (n + 1))) + '</a></li>';
    }).join('');
    return '<h3 style="color:#621119;margin:16px 0 6px;">' + escapeHtml_(title) +
      ' (' + items.length + ')</h3><ul style="margin:0;padding-left:20px;font-size:14px;">' +
      list + '</ul>';
  };

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:620px;">' +
    '<h2 style="color:#621119;margin:0 0 12px;">New ' + escapeHtml_(type.label) +
    ' - ' + escapeHtml_(ticketId) + '</h2>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;">' + tableRows + '</table>' +
    '<h3 style="color:#621119;margin:16px 0 6px;">Query</h3>' +
    '<div style="padding:12px;border:1px solid #d9c4c6;border-radius:6px;white-space:pre-wrap;font-size:14px;">' +
    escapeHtml_(d.message) + '</div>' +
    linkBlock('Photos', media.image) +
    linkBlock('Videos', media.video) +
    linkBlock('Voice notes', media.audio) +
    (folderUrl ? '<p style="margin:16px 0 0;font-size:14px;">All attachments: <a href="' +
      escapeHtml_(folderUrl) + '">open Drive folder</a></p>' : '') +
    '</div>';

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAILS,
    subject: '[' + CONFIG.BRAND + '] ' + type.label + ' ' + ticketId + ' - ' + d.storeName,
    htmlBody: html,
    name: CONFIG.BRAND + ' Support'
  });
}

// ==================== SHEET AUTOMATION ====================
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;
    if (e.range.getColumn() !== COL.STATUS || e.range.getRow() < 2) return;
    const status = e.range.getValue();
    const resolvedCell = sheet.getRange(e.range.getRow(), COL.RESOLVED);
    if (status === 'Resolved' || status === 'Closed') {
      if (!resolvedCell.getValue()) {
        resolvedCell.setValue(new Date()).setNumberFormat('dd-mmm-yyyy hh:mm');
      }
    } else {
      resolvedCell.clearContent();
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Deletes DRAFT folders left behind by abandoned forms.
 * Optional: add a daily time-driven trigger for this function.
 */
function cleanupDrafts() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const it = getParentFolder_().getFolders();
  let removed = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(DRAFT_PREFIX) === 0 && f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  }
  Logger.log('Draft folders removed: ' + removed);
}
