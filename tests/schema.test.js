const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeRange {
  constructor(sheet) { this.sheet = sheet; }
  getValues() { return this.sheet.rows.map(row => [...row]); }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  appendRow(row) { this.rows.push([...row]); return this; }
  getDataRange() { return new FakeRange(this); }
  getLastRow() { return this.rows.length; }
  getRange() { return new FakeRange(this); }
}

function loadServer() {
  const sheets = new Map();
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const sheet = new FakeSheet(name); sheets.set(name, sheet); return sheet; },
  };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: {},
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('code.gs', 'utf8'), context);
  return { server: context, sheets };
}

test('database setup creates the seven sheets with exact headers and safe defaults', () => {
  const { server, sheets } = loadServer();
  const result = server.setupDatabase();

  assert.equal(result.success, true);
  assert.deepEqual([...sheets.keys()].sort(), [
    'assignments', 'indicators', 'minigame', 'minigame_rewards',
    'scores', 'settings', 'students',
  ]);
  assert.deepEqual(sheets.get('students').rows[0], [
    'id', 'student_code', 'title', 'firstname', 'lastname', 'class', 'photo_url', 'status',
  ]);
  assert.deepEqual(sheets.get('assignments').rows[0], [
    'id', 'title', 'description', 'max_score', 'collect_score', 'due_date', 'status', 'indicator_id', 'is_exam',
  ]);
  assert.deepEqual(sheets.get('scores').rows[0], [
    'id', 'student_id', 'assignment_id', 'score', 'submitted', 'update_time',
  ]);
  assert.deepEqual(sheets.get('indicators').rows[0], ['id', 'title', 'description', 'order', 'status']);
  assert.deepEqual(sheets.get('minigame_rewards').rows[0], ['id', 'student_id', 'question_id', 'score', 'claimed_at']);
  assert.equal(sheets.get('minigame').rows[0].includes('blocked_at'), true);
  assert.deepEqual(sheets.get('settings').rows.slice(1), [
    ['school_name', 'กระดานคะแนนห้องเรียน'],
    ['minigame_enabled', 'true'],
    ['mg_interval_days', '1'],
    ['report_enabled', 'true'],
  ]);
});

test('database setup is idempotent', () => {
  const { server, sheets } = loadServer();
  server.setupDatabase();
  server.setupDatabase();
  assert.equal(sheets.get('settings').rows.length, 5);
  assert.equal(sheets.get('students').rows.length, 1);
});

