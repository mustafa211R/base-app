// ===== auth.gs : الدخول والجلسات =====
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function luhnValid_(num) {
  if (!/^\d+$/.test(num) || num.length < 2) return false;
  let sum = 0;
  for (let i = num.length - 2, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(num[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(num[num.length - 1]);
}

function luhnCheckDigit_(body) {
  let total = 0;
  for (let i = body.length - 1, idx = 0; i >= 0; i--, idx++) {
    let d = Number(body[i]);
    if (idx % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    total += d;
  }
  return String((10 - (total % 10)) % 10);
}

function getContext_(token) {
  if (!token) return { role: 'guest', id: null };
  const raw = CacheService.getScriptCache().get('sess:' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  return JSON.parse(raw);
}

function authLogin_(req) {
  const role = String(req.role || '');
  if (['admin', 'student', 'teacher', 'education'].indexOf(role) < 0) {
    throw new Error('INVALID_CREDENTIALS');
  }
  const cache = CacheService.getScriptCache();
  const ident = role === 'admin'
    ? String(req.username || '').trim()
    : role === 'education'
      ? 'education'
      : String(req.id || '').replace(/\D/g, '');
  const key = 'try:' + role + ':' + ident;
  const tries = Number(cache.get(key) || 0);
  if (tries >= 5) throw new Error('TOO_MANY_ATTEMPTS');

  let ctx = null;
  if (role === 'admin') ctx = checkAdmin_(ident, req.password);
  else if (role === 'education') ctx = checkEducation_(req.access_code);
  else ctx = checkId_(role, ident, req.pin);

  if (!ctx) {
    cache.put(key, String(tries + 1), 900);
    audit_(role, ident || '-', 'auth.login', '-', 'fail');
    throw new Error('INVALID_CREDENTIALS');
  }
  cache.remove(key);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  cache.put('sess:' + token, JSON.stringify(ctx), 21600);
  audit_(ctx.role, ctx.id, 'auth.login', '-', 'ok');
  return { token: token, role: ctx.role, id: ctx.id, registered: ctx.registered };
}

function authLogout_(req) {
  if (req.token) CacheService.getScriptCache().remove('sess:' + req.token);
  return true;
}

// حالات القيد المسموح لها بالدخول: رسمي، منتسب، استضافة، محمّل
// الممنوعة: مفصول، منقول، متخرج
var ENROLL_ALLOWED_ = ['official', 'affiliated', 'hosted', 'carried'];

function isEnrollAllowed_(status) {
  return ENROLL_ALLOWED_.indexOf(String(status || 'official')) >= 0;
}

// مزامنة هوية الطالب مع حالة قيده: تعطيل عند الفصل/النقل/التخرج وتفعيل عند غيرها
function syncStudentId_(studentId) {
  const stRow = findRow_('Students', 'student_id', studentId);
  const idRow = findRow_('IDs', 'id', studentId);
  if (!stRow || !idRow) return;
  const st = readRow_('Students', stRow);
  sheet_('IDs').getRange(idRow, colIndex_('IDs', 'status')).setValue(isEnrollAllowed_(st.enroll_status) ? 'registered' : 'disabled');
  if (isEnrollAllowed_(st.enroll_status)) {
    sheet_('IDs').getRange(idRow, colIndex_('IDs', 'class_id')).setValue(st.class_id);
  }
}

function checkId_(role, id, pin) {
  const len = role === 'student' ? 16 : 8;
  if (id.length !== len || !luhnValid_(id)) return null;
  const row = findRow_('IDs', 'id', id);
  if (!row) return null;
  const rec = readRow_('IDs', row);
  if (rec.kind !== role) return null;
  let hasProfile = false;
  if (role === 'student') {
    const stRow = findRow_('Students', 'student_id', id);
    if (stRow) {
      hasProfile = true;
      // الدخول يتبع حالة القيد فقط (رسمي/منتسب/استضافة/محمّل)
      if (!isEnrollAllowed_(readRow_('Students', stRow).enroll_status)) return null;
      if (rec.status === 'disabled') {
        sheet_('IDs').getRange(row, colIndex_('IDs', 'status')).setValue('registered');
        rec.status = 'registered';
      }
    } else if (rec.status === 'disabled') {
      return null;
    }
  } else if (rec.status === 'disabled') {
    return null;
  }
  if (role === 'teacher' && config_().require_teacher_pin === 'TRUE' && rec.pin_hash) {
    if (sha256_(String(pin || '')) !== String(rec.pin_hash)) return null;
  }
  sheet_('IDs').getRange(row, colIndex_('IDs', 'last_login')).setValue(new Date().toISOString());
  return { role: role, id: id, registered: hasProfile || rec.status === 'registered' };
}

function checkAdmin_(username, password) {
  const a = readAll_('Admin')[0];
  if (!a || String(a.username) !== username) return null;
  if (sha256_(String(a.salt) + String(password)) !== String(a.pass_hash)) return null;
  return { role: 'admin', id: 'admin', registered: true };
}

function checkEducation_(accessCode) {
  const stored = String(config_().education_access_code || '').trim();
  if (!stored) throw new Error('EDUCATION_DISABLED');
  const input = String(accessCode || '').trim();
  if (!input || sha256_(input) !== sha256_(stored)) return null;
  return { role: 'education', id: 'education', registered: true };
}

function adminSetup_(req) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('SETUP_KEY');
  if (key && req.setup_key !== key) throw new Error('FORBIDDEN');
  const sh = ss_().getSheetByName('Admin');
  if (sh && sh.getLastRow() > 1) throw new Error('ALREADY_SETUP');

  const username = String(req.username || '').trim();
  const password = String(req.password || '');
  if (username.length < 4) throw new Error('INVALID_USERNAME');
  if (password.length < 8) throw new Error('WEAK_PASSWORD');

  const salt = Utilities.getUuid();
  const secAns = String(req.sec_answer || '').trim().toLowerCase();
  appendObj_('Admin', {
    admin_id: 'admin',
    full_name: String(req.full_name || '').trim(),
    certificate: String(req.certificate || 'بكالوريوس'),
    specialty: String(req.specialty || ''),
    start_date: String(req.start_date || todayDate_()),
    phone: String(req.phone || ''),
    whatsapp: String(req.whatsapp || ''),
    username: username,
    salt: salt,
    pass_hash: sha256_(salt + password),
    sec_question: String(req.sec_question || ''),
    sec_answer_hash: secAns ? sha256_(secAns) : '',
    updated_at: new Date().toISOString()
  }, true);

  if (req.school_name) {
    adminSchoolSave_(req, { role: 'admin', id: 'admin' });
  } else if (readAll_('Stages').length === 0) {
    stageApplyDefaults_({ school_type: config_().school_type || 'middle' }, { role: 'admin', id: 'admin' });
  }

  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const ctx = { role: 'admin', id: 'admin', registered: true };
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify(ctx), 21600);
  audit_('admin', 'admin', 'admin.setup', username, 'ok');
  return { token: token, role: 'admin', id: 'admin', registered: true };
}
