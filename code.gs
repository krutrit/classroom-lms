function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

// แปลง value ให้ safe สำหรับ JSON serialization
function safeValue(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (typeof v === 'boolean') return String(v); // false → "false", true → "true"
  if (typeof v === 'object') return String(v);
  return v;
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    var headers = data[0].map(function(h) { return String(h).trim(); });
    return data.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = safeValue(row[i]); });
      return obj;
    });
  } catch(e) { return []; }
}

// ทดสอบการเชื่อมต่อ
function ping() {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets().map(function(s) { return s.getName(); });
    return { ok: true, sheets: sheets };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}

function getNextId(sheet) {
  if (!sheet) return 1;
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return 1;
    var ids = data.slice(1).map(function(r) { return Number(r[0]); })
                           .filter(function(n) { return !isNaN(n) && n > 0; });
    return ids.length ? Math.max.apply(null, ids) + 1 : 1;
  } catch(e) { return 1; }
}

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'index';
  // embed webAppUrl ใน template — client ไม่ต้องเรียก server อีก
  var webAppUrl = ScriptApp.getService().getUrl();

  if (page === 'teacher') {
    var t = HtmlService.createTemplateFromFile('teacher');
    t.webAppUrl = webAppUrl;
    return t.evaluate()
      .setTitle('ครูจัดการคะแนน')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // index — ลอง cache ก่อน (ประหยัดเวลา template processing ~1-2 วิ)
  var cache = CacheService.getScriptCache();
  var cached = cache.get('index_html');
  if (cached) {
    return HtmlService.createHtmlOutput(cached)
      .setTitle('กระดานคะแนนห้องเรียน')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var t2 = HtmlService.createTemplateFromFile('index');
  t2.webAppUrl = webAppUrl;
  var output = t2.evaluate();
  try {
    var html = output.getContent();
    if (html.length < 90000) cache.put('index_html', html, 120); // cache 2 นาที ถ้าไม่เกิน limit
  } catch(e2) {} // CacheService limit 100KB — ถ้า fail แค่ข้ามไป
  return output
    .setTitle('กระดานคะแนนห้องเรียน')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ==================== FOLDER STRUCTURE ที่โคตะระวุ่นวายแก้ 3 รอบละนะ ====================
function getOrCreateMainFolder() {
  var ss       = getSpreadsheet();
  var ssFile   = DriveApp.getFileById(ss.getId());
  var ssName   = ss.getName();          // ใช้ชื่อ sheet เป็นชื่อ main folder

  // parent ปัจจุบันของ sheet
  var parents       = ssFile.getParents();
  var currentParent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  // ถ้า parent ปัจจุบันชื่อตรงกันแล้ว = อยู่ใน main folder แล้ว ไม่ต้องทำอะไร
  if (currentParent.getName() === ssName) {
    try { currentParent.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
    return currentParent;
  }

  // หา main folder ที่มีชื่อตรงใน parent ปัจจุบัน
  var existing = currentParent.getFoldersByName(ssName);
  var mainFolder;
  if (existing.hasNext()) {
    mainFolder = existing.next();
  } else {
    // สร้าง main folder ใหม่
    mainFolder = currentParent.createFolder(ssName);
  }

  // ย้าย sheet เข้า main folder
  try {
    ssFile.moveTo(mainFolder);
  } catch(e) {
    Logger.log('moveTo mainFolder failed: ' + e.toString());
  }

  // แชร์ main folder ให้ anyone with link ดูได้
  try {
    mainFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    Logger.log('setSharing mainFolder failed: ' + e.toString());
  }

  return mainFolder;
}

function getOrCreatePhotoFolder() {
  var mainFolder = getOrCreateMainFolder();

  // หา/สร้าง photo folder (B) ใน main folder (A)
  var existing = mainFolder.getFoldersByName('student_photos');
  var photoFolder = existing.hasNext() ? existing.next() : mainFolder.createFolder('student_photos');

  // แชร์ photo folder ให้ anyone with link ดูได้
  try {
    photoFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    Logger.log('setSharing photoFolder failed: ' + e.toString());
  }

  return photoFolder;
}

// ==================== AUTH ====================
var AUTH_SESSION_TTL_SECONDS = 21600;
var AUTH_MAX_ATTEMPTS = 5;
var AUTH_ATTEMPT_WINDOW_SECONDS = 300;

function hashTeacherPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function secureEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i % Math.max(left.length, 1)) || 0) ^
                (right.charCodeAt(i % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function setupTeacherPassword(password) {
  if (!password || String(password).length < 10) {
    return { success: false, reason: 'PASSWORD_TOO_SHORT' };
  }
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid() + Utilities.getUuid();
  props.setProperties({
    TEACHER_PASSWORD_SALT: salt,
    TEACHER_PASSWORD_HASH: hashTeacherPassword_(password, salt)
  }, false);
  return { success: true };
}

function createTeacherSession(password) {
  var cache = CacheService.getScriptCache();
  var attemptKey = 'LOGIN_ATTEMPTS_GLOBAL';
  var attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= AUTH_MAX_ATTEMPTS) {
    return { success: false, reason: 'RATE_LIMITED' };
  }

  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('TEACHER_PASSWORD_SALT');
  var expected = props.getProperty('TEACHER_PASSWORD_HASH');
  var actual = salt ? hashTeacherPassword_(password, salt) : '';
  if (!salt || !expected || !secureEquals_(actual, expected)) {
    cache.put(attemptKey, String(attempts + 1), AUTH_ATTEMPT_WINDOW_SECONDS);
    return { success: false, reason: 'INVALID_CREDENTIALS' };
  }

  cache.remove(attemptKey);
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('teacher_session_' + token, '1', AUTH_SESSION_TTL_SECONDS);
  return { success: true, token: token, expires_in: AUTH_SESSION_TTL_SECONDS };
}

function requireTeacherSession(token) {
  if (!token || CacheService.getScriptCache().get('teacher_session_' + token) !== '1') {
    throw new Error('UNAUTHORIZED');
  }
  return true;
}

function logoutTeacher(token) {
  if (token) CacheService.getScriptCache().remove('teacher_session_' + token);
  return { success: true };
}

function checkTeacherPassword(password) {
  try {
    var sheet = getSheet('settings');
    if (!sheet) return false;
    var rows = sheetToObjects(sheet);
    var pw = rows.filter(function(r) { return r.key === 'teacher_password'; })[0];
    return pw ? String(pw.value) === String(password) : false;
  } catch(e) { return false; }
}

// cache settings ใน script lifetime (GAS script runs ≤ 6 min)
var _settingsCache = null;

function getSettings() {
  if (_settingsCache) return _settingsCache;
  try {
    var sheet = getSheet('settings');
    var rows = sheetToObjects(sheet);
    var obj = {};
    rows.forEach(function(r) { if (r.key) obj[String(r.key)] = r.value; });
    _settingsCache = obj;
    return obj;
  } catch(e) { return {}; }
}

// เรียกเพื่อ invalidate cache หลัง updateSetting
function _clearSettingsCache() { _settingsCache = null; }

function updateSetting(token, key, value) {
  requireTeacherSession(token);
  return updateSetting_(key, value);
}

function updateSetting_(key, value) {
  try {
    var sheet = getOrCreateSheet('settings', ['key', 'value']);
    var data = sheet.getDataRange().getValues();
    var found = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(key)) found.push(i + 1); // 1-based row
    }
    if (found.length > 0) {
      // ลบ row ซ้ำ (เก็บอันแรก ลบที่เหลือ จากล่างขึ้นบน)
      for (var j = found.length - 1; j >= 1; j--) {
        sheet.deleteRow(found[j]);
      }
      // อัพเดต row แรก (row index อาจเลื่อนหลังลบ ดึงใหม่)
      var data2 = sheet.getDataRange().getValues();
      for (var k = 1; k < data2.length; k++) {
        if (String(data2[k][0]) === String(key)) {
          sheet.getRange(k + 1, 2).setValue(String(value));
          _clearSettingsCache(); // invalidate cache
          return true;
        }
      }
    }
    // setNumberFormat เป็น @ (text) ก่อน append เพื่อป้องกัน Sheets แปลง boolean
    var newRow = sheet.appendRow([key, String(value)]);
    // force text format on value cell
    try {
      var lr = sheet.getLastRow();
      sheet.getRange(lr, 2).setNumberFormat('@');
    } catch(e2) {}
    _clearSettingsCache();
    return true;
  } catch(e) { return false; }
}

// ==================== DEFAULT SETTINGS ====================
function ensureDefaultSettings() {
  var defaults = {
    'minigame_enabled': 'true',
    'mg_interval_days': '1',
    'report_enabled':   'true'
  };
  var current = getSettings(); // อ่านครั้งเดียว
  Object.keys(defaults).forEach(function(k) {
    if (current[k] === undefined || current[k] === '') updateSetting_(k, defaults[k]);
  });
}

// ==================== STUDENTS ====================
function getStudents() {
  return sheetToObjects(getSheet('students')).filter(function(s) { return s.status === 'active'; });
}

function getAllStudents() {
  return sheetToObjects(getSheet('students'));
}

function addStudent(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getOrCreateSheet('students',
      ['id','student_code','title','firstname','lastname','class','photo_url','status']);
    var id = getNextId(sheet);
    sheet.appendRow([id, data.student_code, data.title, data.firstname,
      data.lastname, data.class, data.photo_url || '', 'active']);
    return { success: true, id: id };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function updateStudent(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getSheet('students');
    if (!sheet) return { success: false };
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 7).setValues([[
          data.student_code, data.title, data.firstname, data.lastname,
          data.class,
          data.photo_url !== undefined ? data.photo_url : rows[i][6],
          data.status || 'active'
        ]]);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function deleteStudent(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getSheet('students');
    if (!sheet) return { success: false };
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, 8).setValue('inactive');
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

// ==================== ASSIGNMENTS ====================
function getAssignments() {
  return sheetToObjects(getSheet('assignments')).filter(function(a) { return a.status === 'active'; });
}

function getAllAssignments() {
  return sheetToObjects(getSheet('assignments'));
}

function addAssignment(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getOrCreateSheet('assignments',
      ['id','title','description','max_score','collect_score','due_date','status','indicator_id','is_exam']);
    var id = getNextId(sheet);
    var indicatorId = data.indicator_id || '';
    var isExam = (!indicatorId || indicatorId === '') ? 'true' : (data.is_exam === 'true' ? 'true' : 'false');
    var collectScore = (data.collect_score !== undefined && data.collect_score !== '') ? data.collect_score : data.max_score;
    sheet.appendRow([id, data.title, data.description || '',
      data.max_score, collectScore, data.due_date || '', 'active', indicatorId, isExam]);
    return { success: true, id: id };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function updateAssignment(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getSheet('assignments');
    if (!sheet) return { success: false };
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0].map(function(h) { return String(h); });
    // migrate: เพิ่ม collect_score ถ้ายังไม่มี
    if (headers.indexOf('collect_score') === -1) {
      var insertAt = headers.indexOf('due_date'); // แทรกก่อน due_date
      if (insertAt === -1) insertAt = 4;
      sheet.insertColumnAfter(insertAt); // insert after max_score (col index 4 = col 5)
      sheet.getRange(1, insertAt + 1).setValue('collect_score');
      // fill existing rows ด้วยค่าเดิมจาก max_score
      for (var ri = 1; ri < rows.length; ri++) {
        sheet.getRange(ri + 1, insertAt + 1).setValue(rows[ri][insertAt - 1]);
      }
      headers.splice(insertAt, 0, 'collect_score');
      rows = sheet.getDataRange().getValues();
    }
    // migrate: เพิ่ม indicator_id, is_exam ถ้ายังไม่มี
    if (headers.indexOf('indicator_id') === -1) {
      sheet.getRange(1, headers.length + 1).setValue('indicator_id');
      sheet.getRange(1, headers.length + 2).setValue('is_exam');
      headers.push('indicator_id'); headers.push('is_exam');
    }
    var indicatorId = data.indicator_id || '';
    var isExam = (!indicatorId || indicatorId === '') ? 'true' : (data.is_exam === 'true' ? 'true' : 'false');
    var collectScore = (data.collect_score !== undefined && data.collect_score !== '') ? data.collect_score : data.max_score;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 8).setValues([[
          data.title, data.description || '', data.max_score, collectScore,
          data.due_date || '', data.status || 'active',
          indicatorId, isExam
        ]]);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function deleteAssignment(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getSheet('assignments');
    if (!sheet) return { success: false };
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0].map(function(h) { return String(h); });
    var statusCol = headers.indexOf('status') + 1; // 1-based
    if (statusCol < 1) statusCol = 7; // fallback
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, statusCol).setValue('inactive');
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

function restoreAssignment(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getSheet('assignments');
    if (!sheet) return { success: false };
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0].map(function(h) { return String(h); });
    var statusCol = headers.indexOf('status') + 1; // 1-based
    if (statusCol < 1) statusCol = 7; // fallback
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, statusCol).setValue('active');
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

// ==================== SCORES ====================
function getScores() {
  return sheetToObjects(getSheet('scores'));
}

function saveScore(token, studentId, assignmentId, score, submitted) {
  requireTeacherSession(token);
  try {
    var sheet = getOrCreateSheet('scores',
      ['id','student_id','assignment_id','score','submitted','update_time']);
    var rows = sheet.getDataRange().getValues();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === String(studentId) &&
          String(rows[i][2]) === String(assignmentId)) {
        sheet.getRange(i + 1, 4, 1, 3).setValues([[score, submitted, now]]);
        return { success: true };
      }
    }
    var id = getNextId(sheet);
    sheet.appendRow([id, studentId, assignmentId, score, submitted, now]);
    return { success: true };
  } catch(e) { return { success: false }; }
}

function saveAllScores(token, scoresArray) {
  requireTeacherSession(token);
  if (!Array.isArray(scoresArray)) return { success: false };
  scoresArray.forEach(function(s) {
    saveScore(token, s.student_id, s.assignment_id, s.score, s.submitted);
  });
  return { success: true };
}

// แปลงคะแนน raw → คะแนนเก็บจริง (Math.round)
function convertScore(rawScore, maxRaw, collectMax) {
  var raw = Number(rawScore || 0);
  var maxR = Number(maxRaw || 0);
  var col = Number(collectMax || maxR);
  if (maxR <= 0 || col <= 0) return raw;
  return Math.round((raw / maxR) * col);
}

// ==================== AGGREGATES ====================
function getAllData() {
  try {
    ensureDefaultSettings(); // ให้แน่ใจว่า settings มีค่า default ครบ
    var students    = getStudents()    || [];
    var assignments = getAssignments() || [];
    var scores      = getScores()      || [];
    var settings    = getSettings()    || {};
    var mgRewards   = getMinigameRewards() || [];

    // คะแนนรวม minigame per student
    var mgBonusMap = {};
    mgRewards.forEach(function(r) {
      var sid = String(r.student_id);
      mgBonusMap[sid] = (mgBonusMap[sid] || 0) + Number(r.score || 0);
    });

    // precompute max_possible ครั้งเดียว (ใช้ collect_score ไม่ใช่ max_score)
    var maxPossible = assignments.reduce(function(sum, a) {
      return sum + Number(a.collect_score || a.max_score || 0);
    }, 0);

    // precompute assignment lookup: id → assignment (for score conversion)
    var assignMap = {};
    assignments.forEach(function(a) { assignMap[String(a.id)] = a; });

    // precompute score lookup map + แปลงคะแนน raw → collect
    var scoreMap = {};
    scores.forEach(function(sc) {
      var sid = String(sc.student_id);
      if (!scoreMap[sid]) scoreMap[sid] = [];
      var a = assignMap[String(sc.assignment_id)];
      var converted = a ? convertScore(sc.score, a.max_score, a.collect_score) : Number(sc.score || 0);
      scoreMap[sid].push({ assignment_id: sc.assignment_id, score: converted, raw_score: sc.score, submitted: sc.submitted, update_time: sc.update_time });
    });

    students.forEach(function(st) {
      var myScores = scoreMap[String(st.id)] || [];
      var normalScore = myScores.reduce(function(sum, sc) {
        return sum + Number(sc.score || 0);
      }, 0);
      var mgBonus = mgBonusMap[String(st.id)] || 0;
      st.total_score  = normalScore + mgBonus;
      st.mg_bonus     = mgBonus; // เก็บไว้ให้ client ดูได้
      st.max_possible = maxPossible;
      st.submitted_count = myScores.filter(function(sc) {
        return sc.submitted === 'yes';
      }).length;

      var submitTimes = myScores
        .filter(function(sc) { return sc.submitted === 'yes' && sc.update_time; })
        .map(function(sc) { return String(sc.update_time); })
        .sort();
      st._lastSubmitTime = submitTimes.length > 0 ? submitTimes[submitTimes.length - 1] : '9999-99-99';
    });

    students.sort(function(a, b) {
      if (b.total_score !== a.total_score) return b.total_score - a.total_score;
      if (b.submitted_count !== a.submitted_count) return b.submitted_count - a.submitted_count;
      if (a._lastSubmitTime < b._lastSubmitTime) return -1;
      if (a._lastSubmitTime > b._lastSubmitTime) return 1;
      return 0;
    });

    students.forEach(function(st, i) {
      if (i === 0) {
        st.rank = 1;
      } else {
        var prev = students[i - 1];
        var sameScore = st.total_score === prev.total_score;
        var sameCount = st.submitted_count === prev.submitted_count;
        var sameTime  = st._lastSubmitTime === prev._lastSubmitTime;
        st.rank = (sameScore && sameCount && sameTime) ? prev.rank : i + 1;
      }
    });

    // แปลง scores array เป็น converted scores สำหรับส่งให้ client
    var convertedScores = scores.map(function(sc) {
      var a = assignMap[String(sc.assignment_id)];
      var converted = a ? convertScore(sc.score, a.max_score, a.collect_score) : Number(sc.score || 0);
      return {
        id: sc.id, student_id: sc.student_id, assignment_id: sc.assignment_id,
        score: converted, raw_score: sc.score,
        submitted: sc.submitted, update_time: sc.update_time
      };
    });

    return { students: students, assignments: assignments, scores: convertedScores, settings: settings };

  } catch(e) {
    Logger.log('getAllData error: ' + e.toString());
    return { students: [], assignments: [], scores: [], settings: {} };
  }
}

// โหลดเฉพาะข้อมูลสำคัญสำหรับ tab แรก (เร็วกว่า getTeacherData)
function getTeacherDataFast(token) {
  requireTeacherSession(token);
  try {
    var assignments = getAllAssignments() || [];
    var rawScores   = getScores()        || [];
    var assignMap = {};
    assignments.forEach(function(a) { assignMap[String(a.id)] = a; });
    var convertedScores = rawScores.map(function(sc) {
      var a = assignMap[String(sc.assignment_id)];
      var converted = a ? convertScore(sc.score, a.max_score, a.collect_score) : Number(sc.score || 0);
      return { id: sc.id, student_id: sc.student_id, assignment_id: sc.assignment_id,
               score: converted, raw_score: sc.score, submitted: sc.submitted, update_time: sc.update_time };
    });
    return {
      students:    getAllStudents()    || [],
      assignments: assignments,
      scores:      convertedScores,
      settings:    getSettings()      || {},
      indicators:  getIndicators()    || [],
      // ยังไม่โหลด minigame + mg_rewards → ค่าว่าง
      minigame:    [],
      mg_rewards:  [],
      _partial:    true  // flag บอกว่ายังไม่ครบ
    };
  } catch(e) {
    Logger.log('getTeacherDataFast error: ' + e.toString());
    return { students:[], assignments:[], scores:[], settings:{}, indicators:[], minigame:[], mg_rewards:[], _partial:true };
  }
}

// โหลดเฉพาะ minigame + mg_rewards (lazy)
function getMinigameData(token) {
  requireTeacherSession(token);
  try {
    return {
      minigame:   getMinigameQuestions() || [],
      mg_rewards: getMinigameRewards()   || []
    };
  } catch(e) { return { minigame:[], mg_rewards:[] }; }
}

function getTeacherData(token) {
  requireTeacherSession(token);
  try {
    var assignments = getAllAssignments() || [];
    var rawScores   = getScores()        || [];

    // build assignMap สำหรับแปลงคะแนน
    var assignMap = {};
    assignments.forEach(function(a) { assignMap[String(a.id)] = a; });

    // แปลง raw scores → converted (เหมือน getAllData)
    var convertedScores = rawScores.map(function(sc) {
      var a = assignMap[String(sc.assignment_id)];
      var converted = a ? convertScore(sc.score, a.max_score, a.collect_score) : Number(sc.score || 0);
      return {
        id: sc.id, student_id: sc.student_id, assignment_id: sc.assignment_id,
        score: converted, raw_score: sc.score,
        submitted: sc.submitted, update_time: sc.update_time
      };
    });

    return {
      students:    getAllStudents()        || [],
      assignments: assignments,
      scores:      convertedScores,
      settings:    getSettings()          || {},
      minigame:    getMinigameQuestions() || [],
      mg_rewards:  getMinigameRewards()   || [],
      indicators:  getIndicators()        || []
    };
  } catch(e) {
    Logger.log('getTeacherData error: ' + e.toString());
    return { students: [], assignments: [], scores: [], settings: {}, minigame: [], mg_rewards: [], indicators: [] };
  }
}

// ==================== PHOTO UPLOAD ====================
function uploadStudentPhoto(token, base64Data, mimeType, filename) {
  requireTeacherSession(token);
  try {
    var folder  = getOrCreatePhotoFolder();
    var decoded = Utilities.base64Decode(base64Data);
    var blob    = Utilities.newBlob(decoded, mimeType, filename);
    var file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch(e) {
    throw new Error('อัพโหลดรูปไม่สำเร็จ: ' + e.toString());
  }
}

//switch inact กับ act
function restoreStudent(token, id) {
  requireTeacherSession(token);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('students');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 8).setValue('active');
      break;
    }
  }
}

function importStudents(token, students) {
  requireTeacherSession(token);
  var sheet = getOrCreateSheet('students',
    ['id','student_code','title','firstname','lastname','class','photo_url','status']);
  students.forEach(function(st) {
    var id = getNextId(sheet);
    sheet.appendRow([id, st.student_code, st.title, st.firstname,
                     st.lastname, st.class, st.photo_url || '', 'active']);
  });
}
// ==================== MINIGAME ====================

function getMinigameSheet() {
  var sheet = getOrCreateSheet('minigame', [
    'id','question','choice_a','choice_b','choice_c','choice_d',
    'answer','bonus_score','status','show_date','claimed_by','claimed_at','blocked_at'
  ]);
  // migrate: เพิ่ม blocked_at column ถ้ายังไม่มี
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('blocked_at') === -1) {
      var nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue('blocked_at');
    }
  } catch(e) {}
  return sheet;
}

function getMinigameRewardsSheet() {
  return getOrCreateSheet('minigame_rewards', [
    'id','student_id','question_id','score','claimed_at'
  ]);
}

// ดึงคำถามทั้งหมด (สำหรับ teacher)
function getMinigameQuestions() {
  try {
    return sheetToObjects(getMinigameSheet());
  } catch(e) { return []; }
}

// เพิ่มคำถาม
function addMinigameQuestion(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var id = getNextId(sheet);
    sheet.appendRow([
      id, data.question,
      data.choice_a, data.choice_b, data.choice_c, data.choice_d,
      data.answer, Number(data.bonus_score) || 1,
      data.status || 'active', '', '', ''
    ]);
    return { success: true, id: id };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// แก้ไขคำถาม
function updateMinigameQuestion(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 8).setValues([[
          data.question,
          data.choice_a, data.choice_b, data.choice_c, data.choice_d,
          data.answer, Number(data.bonus_score) || 1,
          data.status || 'active'
        ]]);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ซ่อน/แสดงคำถาม
function toggleMinigameQuestion(token, id, status) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, 9).setValue(status); // col 9 = status
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

// ลบคำถาม (ลบ row จริง เพราะยังไม่มี score ผูกอยู่)
function deleteMinigameQuestion(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

// ฝั่ง index: เช็คว่าวันนี้มีคำถามที่ยังไม่ถูก claim หรือไม่
function checkDailyMinigame() {
  try {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var sheet = getMinigameSheet();
    var rows  = sheetToObjects(sheet);

    // ถ้าวันนี้มีคำถามที่ถูก claim แล้ว (ตอบถูก) = จบแล้ว ไม่มีอีก
    var claimedToday = rows.filter(function(r) {
      return r.show_date === today && r.claimed_by;
    });
    if (claimedToday.length > 0) return { has_question: false, reason: 'claimed' };

    // ถ้าวันนี้มีคำถามที่ถูก block (ตอบผิด) = จบแล้ว ไม่มีอีก
    var blockedToday = rows.filter(function(r) {
      return r.show_date === today && r.blocked_at;
    });
    if (blockedToday.length > 0) return { has_question: false, reason: 'blocked' };

    // ถ้าวันนี้มีคำถามที่กำลังแสดงอยู่ (ยังไม่มีใครตอบ) = ใช้อันนั้น ไม่สุ่มใหม่
    var todayQ = rows.filter(function(r) {
      return r.show_date === today && r.status === 'active' && !r.claimed_by && !r.blocked_at;
    });
    if (todayQ.length > 0) {
      var q = todayQ[0];
      return {
        has_question: true,
        id: q.id, question: q.question,
        choice_a: q.choice_a, choice_b: q.choice_b,
        choice_c: q.choice_c, choice_d: q.choice_d,
        bonus_score: q.bonus_score
      };
    }

    // ยังไม่มีคำถามวันนี้เลย — ตรวจว่าครบ interval แล้วหรือยัง
    // หาวันที่ล่าสุดที่มีคำถาม (ไม่ว่าจะ claimed หรือ blocked)
    var usedDates = rows
      .filter(function(r) { return r.show_date && (r.claimed_by || r.blocked_at); })
      .map(function(r) { return r.show_date; })
      .sort();
    var lastUsed = usedDates.length > 0 ? usedDates[usedDates.length - 1] : null;

    if (lastUsed) {
      var _s = getSettings();
      var intervalDays = parseInt(_s.mg_interval_days || '1') || 1;
      var last = new Date(lastUsed);
      var todayDate = new Date(today);
      var diffDays = Math.floor((todayDate - last) / 86400000);
      if (diffDays < intervalDays) {
        return { has_question: false, reason: 'interval', days_left: intervalDays - diffDays };
      }
    }

    // ครบ interval แล้ว — สุ่ม 1 ข้อ + เขียน show_date วันนี้
    var available = rows.filter(function(r) {
      return r.status === 'active' && !r.show_date && !r.claimed_by && !r.blocked_at;
    });
    // ถ้าหมดแล้วให้ reset (เวียนซ้ำ)
    if (available.length === 0) {
      available = rows.filter(function(r) { return r.status === 'active'; });
      if (available.length === 0) return { has_question: false };
    }

    // สุ่ม 1 ข้อ + เขียน show_date วันนี้
    var pick = available[Math.floor(Math.random() * available.length)];
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var blockedColIdx = headers.indexOf('blocked_at');
    for (var i = 1; i < allRows.length; i++) {
      if (String(allRows[i][0]) === String(pick.id)) {
        // เขียน show_date, ล้าง claimed_by, claimed_at, blocked_at
        sheet.getRange(i + 1, 10).setValue(today);       // show_date
        sheet.getRange(i + 1, 11).setValue('');           // claimed_by
        sheet.getRange(i + 1, 12).setValue('');           // claimed_at
        if (blockedColIdx >= 0) sheet.getRange(i + 1, blockedColIdx + 1).setValue(''); // blocked_at
        break;
      }
    }
    return {
      has_question: true,
      id: pick.id, question: pick.question,
      choice_a: pick.choice_a, choice_b: pick.choice_b,
      choice_c: pick.choice_c, choice_d: pick.choice_d,
      bonus_score: pick.bonus_score
    };
  } catch(e) {
    return { has_question: false, error: e.toString() };
  }
}

// ฝั่ง index: ตรวจคำตอบ (ไม่บันทึกยังจนกว่าจะกรอกรหัส)
function checkMinigameAnswer(questionId, chosenAnswer) {
  try {
    var sheet = getMinigameSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(questionId)) {
        if (rows[i][10]) return { ok: false, reason: 'claimed' };
        var correct = String(rows[i][6]).trim().toLowerCase();
        var chosen  = String(chosenAnswer).trim().toLowerCase();
        return chosen === correct
          ? { ok: true }
          : { ok: false, reason: 'wrong', correct: correct };
      }
    }
    return { ok: false, reason: 'not_found' };
  } catch(e) { return { ok: false, reason: 'error' }; }
}

// ฝั่ง index: นักเรียนส่งคำตอบ + รหัสนักเรียน
function claimMinigame(questionId, chosenAnswer, studentCode) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(5000)) {
      return { ok: false, reason: 'busy' };
    }

    var sheet = getMinigameSheet();
    var rows  = sheet.getDataRange().getValues();
    var qRow  = -1;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(questionId)) { qRow = i; break; }
    }
    if (qRow === -1) return { ok: false, reason: 'not_found' };

    // double-check: ถูก claim ไปแล้วหรือยัง
    if (rows[qRow][10]) { // col 11 = claimed_by (index 10)
      return { ok: false, reason: 'claimed' };
    }

    var correctAnswer = String(rows[qRow][6]).trim().toLowerCase(); // col 7 = answer
    var chosen        = String(chosenAnswer).trim().toLowerCase();
    var bonusScore    = Number(rows[qRow][7]) || 1; // col 8 = bonus_score

    if (chosen !== correctAnswer) {
      // mark blocked_at เพื่อปิดคำถามทั้งวันสำหรับทุกคน
      var now2 = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      var allRows2 = sheet.getDataRange().getValues();
      // หา column index ของ blocked_at จาก header row
      var blockedColIdx = allRows2[0].indexOf('blocked_at');
      if (blockedColIdx === -1) blockedColIdx = 12; // fallback col 13 (0-based = 12)
      for (var bi = 1; bi < allRows2.length; bi++) {
        if (String(allRows2[bi][0]) === String(questionId)) {
          sheet.getRange(bi + 1, blockedColIdx + 1).setValue(now2);
          break;
        }
      }
      return { ok: false, reason: 'wrong' };
    }

    // หา student id จาก student_code
    var students = sheetToObjects(getSheet('students'));
    var student  = students.filter(function(s) {
      return String(s.student_code) === String(studentCode) && s.status === 'active';
    })[0];
    if (!student) return { ok: false, reason: 'student_not_found' };

    // บันทึก claimed
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(qRow + 1, 11, 1, 2).setValues([[studentCode, now]]); // col 11,12

    // บันทึก reward
    var rewardSheet = getMinigameRewardsSheet();
    var rid = getNextId(rewardSheet);
    rewardSheet.appendRow([rid, student.id, questionId, bonusScore, now]);

    return {
      ok: true,
      student_name: student.title + student.firstname + ' ' + student.lastname,
      bonus_score: bonusScore
    };

  } catch(e) {
    return { ok: false, reason: 'error', error: e.toString() };
  } finally {
    try { lock.releaseLock(); } catch(e2) {}
  }
}

// ครูเปิดคำถามใหม่ในวันนี้ (ล้าง blocked_at)
function unblockMinigame(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var rows = sheet.getDataRange().getValues();
    var blockedColIdx = rows[0].indexOf('blocked_at');
    if (blockedColIdx === -1) blockedColIdx = 12;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, blockedColIdx + 1).setValue('');
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

// ครูรีเซ็ตคำถาม (ล้าง show_date + claimed ให้สุ่มใหม่วันหน้า)
function resetMinigameQuestion(token, id) {
  requireTeacherSession(token);
  try {
    var sheet = getMinigameSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.getRange(i + 1, 10, 1, 3).setValues([['', '', '']]);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

function getIndicatorSheet() {
  return getOrCreateSheet('indicators',
    ['id','title','description','order','status']);
}

function getIndicators() {
  try {
    return sheetToObjects(getIndicatorSheet());
  } catch(e) { return []; }
}

function addIndicator(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getIndicatorSheet();
    var id = getNextId(sheet);
    var order = Number(data.order) || (sheet.getLastRow());
    sheet.appendRow([id, data.title, data.description || '', order, 'active']);
    return { success: true, id: id };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function updateIndicator(token, data) {
  requireTeacherSession(token);
  try {
    var sheet = getIndicatorSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 4).setValues([[
          data.title, data.description || '',
          Number(data.order) || i, data.status || 'active'
        ]]);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

function deleteIndicator(token, id) {
  requireTeacherSession(token);
  try {
    // ตรวจว่ามีงานผูกอยู่ไหม
    var assignments = sheetToObjects(getSheet('assignments')) || [];
    var linked = assignments.filter(function(a) {
      return String(a.indicator_id) === String(id) && a.status === 'active';
    });
    if (linked.length > 0) {
      return { success: false, reason: 'has_assignments', count: linked.length };
    }
    var sheet = getIndicatorSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function exportScoresByIndicator(token, filterClass) {
  requireTeacherSession(token);
  try {
    var students    = getAllStudents().filter(function(s) {
      return s.status === 'active' &&
             (!filterClass || filterClass === 'all' || s.class === filterClass);
    }).sort(function(a, b) {
      if ((a.class||'') !== (b.class||'')) return (a.class||'') < (b.class||'') ? -1 : 1;
      return (a.student_code||'') < (b.student_code||'') ? -1 : 1;
    });
    var assignments = getAllAssignments().filter(function(a) { return a.status === 'active'; });
    var indicators  = getIndicators().filter(function(ind) { return ind.status === 'active'; })
                        .sort(function(a, b) { return Number(a.order||0) - Number(b.order||0); });
    var scores      = getScores();
    var mgRewards   = getMinigameRewards();

    // สร้าง map: student_id → { indicatorId: totalScore, exam: totalScore, mg: bonus }
    var studentMap = {};
    students.forEach(function(st) {
      var row = { exam: 0, mg: 0 };
      indicators.forEach(function(ind) { row[String(ind.id)] = 0; });
      studentMap[String(st.id)] = row;
    });

    assignments.forEach(function(a) {
      scores.filter(function(sc) {
        return String(sc.assignment_id) === String(a.id) && sc.submitted === 'yes';
      }).forEach(function(sc) {
        var row = studentMap[String(sc.student_id)];
        if (!row) return;
        var val = Number(sc.score || 0);
        if (a.is_exam === 'true' || !a.indicator_id || a.indicator_id === '') {
          row.exam += val;
        } else {
          row[String(a.indicator_id)] = (row[String(a.indicator_id)] || 0) + val;
        }
      });
    });

    mgRewards.forEach(function(r) {
      var row = studentMap[String(r.student_id)];
      if (row) row.mg += Number(r.score || 0);
    });

    // สร้าง result array
    var result = students.map(function(st) {
      var row = studentMap[String(st.id)];
      var indScores = indicators.map(function(ind) { return row[String(ind.id)] || 0; });
      var indTotal  = indScores.reduce(function(s, v) { return s + v; }, 0);
      var examScore = row.exam || 0;
      var subtotal  = indTotal + examScore;
      var mgBonus   = row.mg || 0;
      var obj = {
        student_code: st.student_code,
        name: st.title + st.firstname + ' ' + st.lastname,
        class: st.class || ''
      };
      indicators.forEach(function(ind, i) { obj['ind_' + ind.id] = indScores[i]; });
      obj.exam     = examScore;
      obj.subtotal = subtotal;
      obj.mg       = mgBonus;
      obj.total    = subtotal + mgBonus;
      return obj;
    });

    return {
      success: true,
      indicators: indicators,
      rows: result
    };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// getTeacherData รวม minigame_rewards ด้วย
function getMinigameRewards() {
  try { return sheetToObjects(getMinigameRewardsSheet()); } catch(e) { return []; }
}

function setupDatabase() {
  var definitions = {
    settings: ['key', 'value'],
    students: ['id', 'student_code', 'title', 'firstname', 'lastname', 'class', 'photo_url', 'status'],
    assignments: ['id', 'title', 'description', 'max_score', 'collect_score', 'due_date', 'status', 'indicator_id', 'is_exam'],
    scores: ['id', 'student_id', 'assignment_id', 'score', 'submitted', 'update_time'],
    indicators: ['id', 'title', 'description', 'order', 'status'],
    minigame: ['id', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'answer', 'bonus_score', 'status', 'show_date', 'claimed_by', 'claimed_at', 'blocked_at'],
    minigame_rewards: ['id', 'student_id', 'question_id', 'score', 'claimed_at']
  };
  Object.keys(definitions).forEach(function(name) {
    getOrCreateSheet(name, definitions[name]);
  });

  var defaults = {
    school_name: 'กระดานคะแนนห้องเรียน',
    minigame_enabled: 'true',
    mg_interval_days: '1',
    report_enabled: 'true'
  };
  _clearSettingsCache();
  var current = getSettings();
  Object.keys(defaults).forEach(function(key) {
    if (current[key] === undefined || current[key] === '') updateSetting_(key, defaults[key]);
  });
  return { success: true, sheets: Object.keys(definitions) };
}
