const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

function loadServer() {
  const properties = new Map();
  const cache = new Map();
  const context = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || null,
        setProperties: values => Object.entries(values).forEach(([key, value]) => properties.set(key, String(value))),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, String(value)),
        remove: key => cache.delete(key),
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(value).digest()].map(n => n > 127 ? n - 256 : n),
      getUuid: () => crypto.randomUUID(),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('code.gs', 'utf8'), context);
  return context;
}

test('teacher password setup rejects passwords shorter than ten characters', () => {
  const server = loadServer();
  assert.deepEqual(
    JSON.parse(JSON.stringify(server.setupTeacherPassword('short'))),
    { success: false, reason: 'PASSWORD_TOO_SHORT' },
  );
});

test('valid credentials create a session that authorizes and can be revoked', () => {
  const server = loadServer();
  assert.equal(server.setupTeacherPassword('strong-pass-123').success, true);
  const login = server.createTeacherSession('strong-pass-123');
  assert.equal(login.success, true);
  assert.equal(typeof login.token, 'string');
  assert.equal(server.requireTeacherSession(login.token), true);
  assert.equal(server.logoutTeacher(login.token).success, true);
  assert.throws(() => server.requireTeacherSession(login.token), /UNAUTHORIZED/);
});

test('invalid credentials do not create a teacher session', () => {
  const server = loadServer();
  server.setupTeacherPassword('strong-pass-123');
  assert.deepEqual(
    JSON.parse(JSON.stringify(server.createTeacherSession('wrong-pass'))),
    { success: false, reason: 'INVALID_CREDENTIALS' },
  );
});

test('every teacher mutation rejects a missing session before touching storage', () => {
  const server = loadServer();
  const mutations = [
    'updateSetting', 'addStudent', 'updateStudent', 'deleteStudent',
    'restoreStudent', 'importStudents', 'addAssignment', 'updateAssignment',
    'deleteAssignment', 'restoreAssignment', 'saveScore', 'saveAllScores',
    'uploadStudentPhoto', 'addIndicator', 'updateIndicator', 'deleteIndicator',
    'addMinigameQuestion', 'updateMinigameQuestion', 'toggleMinigameQuestion',
    'deleteMinigameQuestion', 'unblockMinigame', 'resetMinigameQuestion',
  ];

  for (const name of mutations) {
    assert.equal(typeof server[name], 'function', `${name} must exist`);
    assert.throws(() => server[name](''), /UNAUTHORIZED/, `${name} must reject an empty token`);
  }
});

test('teacher-only data reads reject a missing session', () => {
  const server = loadServer();
  for (const name of ['getTeacherDataFast', 'getMinigameData', 'getTeacherData', 'exportScoresByIndicator']) {
    assert.throws(() => server[name](''), /UNAUTHORIZED/, `${name} must reject an empty token`);
  }
});
