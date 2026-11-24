// ===== data.gs : أدوات الجداول والصلاحيات والملفات =====
function sheet_(name) { return ss_().getSheetByName(name); }

function headers_(name) {
  const sh = sheet_(name);
  if (!sh || sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function colIndex_(name, col) { return headers_(name).indexOf(col) + 1; }

function todayDate_() { return new Date().toISOString().slice(0, 10); }

function baghdadNow_() {
  const now = new Date();
  const date = Utilities.formatDate(now, 'Asia/Baghdad', 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, 'Asia/Baghdad', 'HH:mm:ss');
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(3, 5));
  return { date: date, time: time, minutes: hh * 60 + mm };
}

function sheetTz_() {
  try {
    const s = ss_();
    if (s && s.getSpreadsheetTimeZone) return s.getSpreadsheetTimeZone() || 'Asia/Baghdad';
  } catch (_) {}
  return 'Asia/Baghdad';
}

function asDateStr_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, sheetTz_(), 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function asTimeStr_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, sheetTz_(), 'HH:mm:ss');
  }
  return String(v).trim();
}

function asHHMMStr_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, sheetTz_(), 'HH:mm');
  }
  const s = String(v).trim();
  const ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|ص|م)$/i.exec(s);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2];
    const suf = ampm[3].toUpperCase();
    if ((suf === 'PM' || suf === 'م') && h < 12) h += 12;
    if ((suf === 'AM' || suf === 'ص') && h === 12) h = 0;
    return ('0' + h).slice(-2) + ':' + m;
  }
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (hm) return ('0' + Number(hm[1])).slice(-2) + ':' + hm[2];
  const jsDate = /\b(\d{2}):(\d{2}):\d{2}\s+GMT/.exec(s);
  if (jsDate) return jsDate[1] + ':' + jsDate[2];
  return s;
}

function parseTimeMinutes_(hhmm) {
  const norm = asHHMMStr_(hhmm);
  const m = /^(\d{1,2}):(\d{2})$/.exec(norm);
  if (!m) throw new Error('INVALID_TIME_FORMAT');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('INVALID_TIME_FORMAT');
  return h * 60 + min;
}

function getScheduleFromConfig_(cfg) {
  const startRaw = asHHMMStr_(cfg.attendance_start_time);
  const endRaw = asHHMMStr_(cfg.attendance_end_time);
  return {
    attendance_start_time: /^\d{2}:\d{2}$/.test(startRaw) ? startRaw : '08:00',
    attendance_end_time: /^\d{2}:\d{2}$/.test(endRaw) ? endRaw : '13:30',
    attendance_grace_minutes: Math.max(0, Math.min(180, Number(cfg.attendance_grace_minutes || 15))),
    attendance_workdays: cfg.attendance_workdays || '0,1,2,3,4'
  };
}

function readAll_(name) {
  const sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  return values.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function readRow_(name, row) {
  const head = headers_(name);
  const vals = sheet_(name).getRange(row, 1, 1, head.length).getValues()[0];
  return Object.fromEntries(head.map((h, i) => [h, vals[i]]));
}

function findRow_(name, col, value) {
  const sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return 0;
  const idx = colIndex_(name, col);
  if (idx < 1) return 0;
  const n = sh.getLastRow() - 1;
  const cell = sh.getRange(2, idx, n, 1)
    .createTextFinder(String(value)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function appendObj_(name, obj, asText) {
  const head = headers_(name);
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, head.length);
  if (asText) range.setNumberFormat('@');
  range.setValues([head.map(h => obj[h] === undefined ? '' : obj[h])]);
}

function updateRowObj_(name, row, obj, asText) {
  const head = headers_(name);
  const range = sheet_(name).getRange(row, 1, 1, head.length);
  if (asText) range.setNumberFormat('@');
  range.setValues([head.map(h => obj[h] === undefined ? '' : obj[h])]);
}

function cached_(key, ttl, loader) {
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const val = loader();
  const s = JSON.stringify(val);
  if (s.length < 90000) c.put(key, s, ttl);
  return val;
}

function clearCache_(keys) {
  const expanded = [];
  keys.forEach(k => {
    expanded.push(k);
    if (k === 'cfg') {
      expanded.push('cfg_v2');
      expanded.push('cfg_v3');
    }
  });
  CacheService.getScriptCache().removeAll(expanded);
}

function config_() {
  return cached_('cfg_v3', 120, () => {
    const o = {};
    const sh = sheet_('Config');
    if (!sh || sh.getLastRow() < 2) return o;
    const rng = sh.getDataRange();
    const vals = rng.getValues();
    const disp = rng.getDisplayValues();
    const head = vals[0];
    const kIdx = head.indexOf('key');
    const vIdx = head.indexOf('value');
    if (kIdx < 0 || vIdx < 0) return o;
    for (let i = 1; i < vals.length; i++) {
      const k = String(vals[i][kIdx] || '').trim();
      if (!k) continue;
      const raw = vals[i][vIdx];
      const shown = String(disp[i][vIdx] || '').trim();
      if (k === 'attendance_start_time' || k === 'attendance_end_time') {
        const dTime = asHHMMStr_(shown);
        const rTime = asHHMMStr_(raw);
        o[k] = /^\d{2}:\d{2}$/.test(dTime)
          ? dTime
          : (/^\d{2}:\d{2}$/.test(rTime) ? rTime : (k === 'attendance_start_time' ? '08:00' : '13:30'));
      } else if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
        o[k] = asDateStr_(raw);
      } else if (k === 'education_access_code' || k === 'attendance_workdays' || k === 'attendance_grace_minutes' || k === 'pass_mark') {
        o[k] = shown !== '' ? shown : String(raw === undefined || raw === null ? '' : raw);
      } else {
        o[k] = String(raw === undefined || raw === null ? '' : raw);
      }
    }
    return o;
  });
}

function relation_(ctx, targetId) {
  if (ctx.role === 'admin' || ctx.role === 'education') return 'admin';
  if (ctx.role !== 'guest' && ctx.id === targetId) return 'self';
  return ctx.role;
}

function allowedFields_(entity, rel) {
  const rows = cached_('perm', 300, () => readAll_('Permissions'));
  return rows.filter(r => r.entity === entity && Number(r[rel]) === 1).map(r => r.field);
}

function pick_(rec, fields) {
  const o = {};
  fields.forEach(f => { if (f in rec) o[f] = rec[f]; });
  return o;
}

function teacherHasClass_(teacherId, classId) {
  return readAll_('Assignments').some(a => String(a.teacher_id) === String(teacherId) && String(a.class_id) === String(classId));
}

function saveDrivePhoto_(dataUrl, prefix) {
  if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) return '';
  const folderId = PropertiesService.getScriptProperties().getProperty('PHOTOS_FOLDER_ID');
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('INVALID_PHOTO_FORMAT');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 2 * 1024 * 1024) throw new Error('PHOTO_TOO_LARGE');
  const blob = Utilities.newBlob(bytes, m[1], (prefix || 'photo_') + Utilities.getUuid());
  const file = folderId ? DriveApp.getFolderById(folderId).createFile(blob) : DriveApp.createFile(blob);
  return file.getId();
}

function readDrivePhotoDataUrl_(fileId) {
  if (!fileId) return '';
  return cached_('ph:' + fileId, 21600, () => {
    const blob = DriveApp.getFileById(String(fileId)).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
}

function schoolPublic_() {
  const cfg = config_();
  const adm = readAll_('Admin')[0];
  const anns = readAll_('Announcements').filter(a => Number(a.active) === 1);
  const students = readAll_('Students');
  const teachers = readAll_('Teachers');
  const classes = readAll_('Classes');
  const ids = readAll_('IDs');
  const unusedCount = ids.filter(i => i.status === 'unused').length;
  const setupKey = PropertiesService.getScriptProperties().getProperty('SETUP_KEY');

  let logoDataUrl = '';
  if (cfg.logo_file_id) {
    try { logoDataUrl = readDrivePhotoDataUrl_(cfg.logo_file_id); } catch (_) {}
  }

  const schedule = getScheduleFromConfig_(cfg);
  return {
    initialized: Boolean(adm),
    setupKeyRequired: Boolean(setupKey),
    educationEnabled: Boolean(cfg.education_access_code && String(cfg.education_access_code).trim() !== ''),
    school_name: cfg.school_name || 'نظام base المدرسي',
    founded_date: cfg.founded_date || '',
    school_type: cfg.school_type || 'middle',
    shift_type: cfg.shift_type || 'morning',
    map_url: cfg.map_url || '',
    about: cfg.about || '',
    logo_file_id: logoDataUrl,
    academic_year: cfg.academic_year || '2026-2027',
    teacher_profile_visibility: cfg.teacher_profile_visibility || 'all',
    student_profile_visibility: cfg.student_profile_visibility || 'all',
    guest_student_list: cfg.guest_student_list || 'full',
    require_teacher_pin: cfg.require_teacher_pin === 'TRUE',
    allow_student_self_edit: cfg.allow_student_self_edit === 'TRUE',
    pass_mark: Number(cfg.pass_mark || 50),
    attendance_start_time: schedule.attendance_start_time,
    attendance_end_time: schedule.attendance_end_time,
    attendance_grace_minutes: schedule.attendance_grace_minutes,
    attendance_workdays: schedule.attendance_workdays,
    admin_name: adm ? String(adm.full_name) : '',
    announcements: anns,
    stats: {
      students_count: students.length,
      teachers_count: teachers.length,
      classes_count: classes.length,
      unused_ids_count: unusedCount
    }
  };
}

function getStudent_(req, ctx) {
  const cfg = config_();
  if (ctx.role === 'guest' && (cfg.student_profile_visibility === 'members_only' || cfg.guest_student_list === 'off' || cfg.guest_student_list === 'stats_only')) {
    throw new Error('FORBIDDEN');
  }
  const targetId = String(req.student_id || (ctx.role === 'student' ? ctx.id : '')).replace(/\D/g, '');
  const rec = readAll_('Students').find(s => String(s.student_id) === targetId);
  if (!rec) throw new Error('NOT_FOUND');
  if (ctx.role === 'student' && ctx.id !== String(rec.student_id)) throw new Error('FORBIDDEN');
  if (ctx.role === 'teacher' && !teacherHasClass_(ctx.id, rec.class_id)) throw new Error('FORBIDDEN');

  const cls = readAll_('Classes').find(c => c.class_id === rec.class_id) || {};
  const stg = readAll_('Stages').find(s => s.stage_id === cls.stage_id) || {};
  const enriched = Object.assign({}, rec, { class_label: cls.label || '', stage_id: cls.stage_id || '', stage_name: stg.name_ar || '' });

  const fields = allowedFields_('student', relation_(ctx, String(rec.student_id)));
  const out = pick_(enriched, fields.concat(['class_label', 'stage_id', 'stage_name']));
  if (ctx.role === 'guest' && cfg.guest_student_list === 'first_names' && typeof out.full_name === 'string') {
    out.full_name = out.full_name.split(' ')[0];
  }
  return out;
}

function listStudents_(req, ctx) {
  const cfg = config_();
  if (ctx.role === 'student') throw new Error('FORBIDDEN');
  const classes = readAll_('Classes');
  const stages = readAll_('Stages');
  let rows = readAll_('Students');

  if (ctx.role === 'guest') {
    if (cfg.student_profile_visibility === 'members_only' || cfg.guest_student_list === 'off') {
      return { mode: 'off', items: [] };
    }
    if (cfg.guest_student_list === 'stats_only') {
      const stats = classes.map(c => ({
        class_id: c.class_id,
        label: c.label,
        count: rows.filter(s => s.class_id === c.class_id).length
      }));
      return { mode: 'stats_only', items: [], stats: stats };
    }
  }

  if (ctx.role === 'teacher') {
    rows = rows.filter(r => teacherHasClass_(ctx.id, r.class_id));
  }
  if (req.class_id) {
    rows = rows.filter(r => r.class_id === String(req.class_id));
  }

  const permRel = ctx.role === 'education' ? 'admin' : ctx.role;
  const fields = allowedFields_('student', permRel);
  const items = rows.map(rec => {
    const cls = classes.find(c => c.class_id === rec.class_id) || {};
    const stg = stages.find(s => s.stage_id === cls.stage_id) || {};
    const enriched = Object.assign({}, rec, { class_label: cls.label || '', stage_id: cls.stage_id || '', stage_name: stg.name_ar || '' });
    const out = pick_(enriched, fields.concat(['student_id', 'class_id', 'class_label', 'stage_id', 'stage_name']));
    if (fields.indexOf('student_id') < 0 && ctx.role === 'guest') delete out.student_id;
    if (ctx.role === 'guest' && cfg.guest_student_list === 'first_names' && typeof out.full_name === 'string') {
      out.full_name = out.full_name.split(' ')[0];
    }
    return out;
  });

  return { mode: ctx.role === 'guest' ? cfg.guest_student_list : 'full', items: items };
}

function registerStudent_(req, ctx) {
  const row = findRow_('IDs', 'id', ctx.id);
  if (!row) throw new Error('NOT_FOUND');
  const idRec = readRow_('IDs', row);
  if (idRec.status === 'registered') throw new Error('ALREADY_REGISTERED');
  const p = req.profile || {};
  ['full_name', 'birth_date', 'guardian_phone'].forEach(k => {
    if (!p[k]) throw new Error('MISSING_FIELD');
  });
  let photoId = '';
  if (p.photo_data_url) photoId = saveDrivePhoto_(p.photo_data_url, 'st_' + ctx.id + '_');

  appendObj_('Students', {
    student_id: ctx.id,
    full_name: String(p.full_name).trim(),
    mother_name: p.mother_name || '',
    gender: p.gender || 'ذكر',
    birth_date: p.birth_date,
    address: p.address || '',
    guardian_name: p.guardian_name || '',
    guardian_phone: String(p.guardian_phone),
    photo_file_id: photoId,
    prev_school: p.prev_school || '',
    prev_stage: p.prev_stage || '',
    prev_average: p.prev_average || '',
    reg_reason: p.reg_reason || 'جديد',
    failed_years: Number(p.failed_years || 0),
    dropout_years: Number(p.dropout_years || 0),
    enroll_date: todayDate_(),
    health_note: '',
    class_id: idRec.class_id,
    enroll_status: 'official',
    status_note: '',
    notes: '',
    updated_at: new Date().toISOString()
  }, true);

  sheet_('IDs').getRange(row, colIndex_('IDs', 'status')).setValue('registered');
  sheet_('IDs').getRange(row, colIndex_('IDs', 'registered_at')).setValue(new Date().toISOString());
  audit_('student', ctx.id, 'student.register', ctx.id, 'ok');
  return true;
}

function studentSelfUpdate_(req, ctx) {
  if (config_().allow_student_self_edit !== 'TRUE') throw new Error('FORBIDDEN');
  const row = findRow_('Students', 'student_id', ctx.id);
  if (!row) throw new Error('NOT_FOUND');
  const cur = readRow_('Students', row);
  const p = req.profile || {};
  if (p.address !== undefined) cur.address = String(p.address);
  if (p.guardian_phone !== undefined) cur.guardian_phone = String(p.guardian_phone);
  if (p.photo_data_url) cur.photo_file_id = saveDrivePhoto_(p.photo_data_url, 'st_' + ctx.id + '_');
  cur.updated_at = new Date().toISOString();
  updateRowObj_('Students', row, cur, true);
  audit_('student', ctx.id, 'student.selfUpdate', ctx.id, 'ok');
  return true;
}

function getTeacher_(req, ctx) {
  const cfg = config_();
  const targetId = String(req.teacher_id || (ctx.role === 'teacher' ? ctx.id : '')).replace(/\D/g, '');
  if (cfg.teacher_profile_visibility === 'admin_only' && ctx.role !== 'admin' && ctx.id !== targetId) {
    throw new Error('FORBIDDEN');
  }
  const rec = readAll_('Teachers').find(t => String(t.teacher_id) === targetId);
  if (!rec) throw new Error('NOT_FOUND');
  return pick_(rec, allowedFields_('teacher', relation_(ctx, String(rec.teacher_id))));
}

function listTeachers_(req, ctx) {
  if (config_().teacher_profile_visibility === 'admin_only' && ctx.role !== 'admin') return [];
  return readAll_('Teachers').map(rec => {
    const fields = allowedFields_('teacher', relation_(ctx, String(rec.teacher_id)));
    return pick_(rec, fields.concat(['teacher_id']));
  });
}

function registerTeacher_(req, ctx) {
  const row = findRow_('IDs', 'id', ctx.id);
  if (!row) throw new Error('NOT_FOUND');
  const idRec = readRow_('IDs', row);
  if (idRec.status === 'registered') throw new Error('ALREADY_REGISTERED');
  const p = req.profile || {};
  if (!p.full_name) throw new Error('MISSING_FIELD');

  let photoId = '';
  if (p.photo_data_url) photoId = saveDrivePhoto_(p.photo_data_url, 'tr_' + ctx.id + '_');
  const pinHash = p.pin && /^\d{4}$/.test(String(p.pin)) ? sha256_(String(p.pin)) : '';

  appendObj_('Teachers', {
    teacher_id: ctx.id,
    full_name: String(p.full_name).trim(),
    mother_name: p.mother_name || '',
    gender: p.gender || 'ذكر',
    birth_date: p.birth_date || '',
    degree: p.degree || 'بكالوريوس',
    specialty: p.specialty || '',
    university: p.university || '',
    college: p.college || '',
    grad_year: p.grad_year || '',
    job_title: p.job_title || 'مدرس',
    hire_date: p.hire_date || '',
    start_date: p.start_date || todayDate_(),
    bio_cv: p.bio_cv || '',
    subjects: p.subjects || '',
    phone: p.phone || '',
    whatsapp: p.whatsapp || '',
    email: p.email || '',
    address: p.address || '',
    photo_file_id: photoId,
    status: 'active',
    updated_at: new Date().toISOString()
  }, true);

  sheet_('IDs').getRange(row, colIndex_('IDs', 'status')).setValue('registered');
  sheet_('IDs').getRange(row, colIndex_('IDs', 'registered_at')).setValue(new Date().toISOString());
  if (pinHash) sheet_('IDs').getRange(row, colIndex_('IDs', 'pin_hash')).setValue(pinHash);
  audit_('teacher', ctx.id, 'teacher.register', ctx.id, 'ok');
  return true;
}

function getPhoto_(req, ctx) {
  const cfg = config_();
  const entity = req.entity === 'teacher' ? 'teacher' : 'student';
  const targetId = String(req.id || '').replace(/\D/g, '');
  if (entity === 'student' && ctx.role === 'guest') {
    if (cfg.student_profile_visibility === 'members_only' || cfg.guest_student_list !== 'full') {
      throw new Error('FORBIDDEN');
    }
  }
  if (entity === 'teacher' && ctx.role !== 'admin' && cfg.teacher_profile_visibility === 'admin_only' && ctx.id !== targetId) {
    throw new Error('FORBIDDEN');
  }
  const rec = readAll_(entity === 'teacher' ? 'Teachers' : 'Students')
    .find(r => String(r[entity + '_id']) === targetId);
  if (!rec) throw new Error('NOT_FOUND');
  if (entity === 'student' && ctx.role === 'teacher' && !teacherHasClass_(ctx.id, rec.class_id)) throw new Error('FORBIDDEN');
  if (entity === 'student' && ctx.role === 'student' && ctx.id !== targetId) throw new Error('FORBIDDEN');
  if (allowedFields_(entity, relation_(ctx, targetId)).indexOf('photo_file_id') < 0) throw new Error('FORBIDDEN');
  return readDrivePhotoDataUrl_(rec.photo_file_id);
}

function normalizeAttRow_(r) {
  return Object.assign({}, r, {
    teacher_id: String(r.teacher_id || ''),
    att_date: asDateStr_(r.att_date),
    check_in_time: asTimeStr_(r.check_in_time),
    check_out_time: asTimeStr_(r.check_out_time),
    late_minutes: Number(r.late_minutes || 0)
  });
}

function attendancePunch_(req, ctx) {
  if (!ctx.id) throw new Error('FORBIDDEN');
  const teacher = readAll_('Teachers').find(t => String(t.teacher_id) === String(ctx.id));
  if (!teacher) throw new Error('NOT_FOUND');

  const punchType = req.type === 'out' ? 'out' : 'in';
  const method = req.method === 'webauthn' ? 'webauthn' : 'fingerprint_digital';
  const deviceNote = String(req.device_note || '').slice(0, 140);

  const cfg = config_();
  const schedule = getScheduleFromConfig_(cfg);
  const startMinutes = parseTimeMinutes_(schedule.attendance_start_time);
  const deadlineMinutes = startMinutes + schedule.attendance_grace_minutes;
  const baghdad = baghdadNow_();
  const today = baghdad.date;
  const nowTime = baghdad.time;
  const nowMinutes = baghdad.minutes;
  const now = new Date().toISOString();

  const all = readAll_('Attendance');
  const idx = all.findIndex(r => String(r.teacher_id) === String(ctx.id) && asDateStr_(r.att_date) === today);

  if (punchType === 'in') {
    if (idx >= 0) throw new Error('ALREADY_CHECKED_IN');
    const isLate = nowMinutes > deadlineMinutes;
    const status = isLate ? 'late' : 'on_time';
    const lateMinutes = isLate ? Math.max(1, nowMinutes - startMinutes) : 0;
    const attId = 'Att-' + today.replace(/-/g, '') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    const obj = {
      att_id: attId,
      teacher_id: String(teacher.teacher_id),
      teacher_name: teacher.full_name,
      att_date: today,
      check_in_time: nowTime,
      check_out_time: '',
      method: method,
      status: status,
      late_minutes: lateMinutes,
      device_note: deviceNote,
      created_at: now,
      updated_at: now
    };
    appendObj_('Attendance', obj, true);
    audit_('teacher', ctx.id, 'attendance.punch', 'in:' + status + ':' + lateMinutes + 'm', 'ok');
    return obj;
  }

  if (idx < 0) throw new Error('NOT_CHECKED_IN');
  const sheetRow = idx + 2;
  const existing = normalizeAttRow_(all[idx]);
  if (existing.check_out_time) throw new Error('ALREADY_CHECKED_OUT');

  existing.check_out_time = nowTime;
  existing.updated_at = now;
  updateRowObj_('Attendance', sheetRow, existing, true);
  audit_('teacher', ctx.id, 'attendance.punch', 'out:' + today, 'ok');
  return existing;
}

function attendanceMine_(req, ctx) {
  if (!ctx.id) throw new Error('FORBIDDEN');
  const cfg = config_();
  const schedule = getScheduleFromConfig_(cfg);
  const today = baghdadNow_().date;

  const records = readAll_('Attendance')
    .map(normalizeAttRow_)
    .filter(r => r.teacher_id === String(ctx.id))
    .sort((a, b) => (b.att_date + ' ' + b.check_in_time).localeCompare(a.att_date + ' ' + a.check_in_time))
    .slice(0, 120);

  const todayRecord = records.find(r => r.att_date === today) || null;
  const onTimeDays = records.filter(r => r.status === 'on_time').length;
  const lateDays = records.filter(r => r.status === 'late').length;
  const totalLateMinutes = records.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0);

  return {
    todayDate: today,
    todayRecord: todayRecord,
    schedule: schedule,
    summary: {
      totalDays: records.length,
      onTimeDays: onTimeDays,
      lateDays: lateDays,
      totalLateMinutes: totalLateMinutes
    },
    records: records
  };
}

function attendanceList_(req) {
  const cfg = config_();
  const schedule = getScheduleFromConfig_(cfg);
  const today = baghdadNow_().date;
  let rows = readAll_('Attendance')
    .map(normalizeAttRow_)
    .sort((a, b) => (b.att_date + ' ' + b.check_in_time).localeCompare(a.att_date + ' ' + a.check_in_time))
    .slice(0, 500);

  if (req.teacher_id) {
    const tid = String(req.teacher_id).replace(/\D/g, '');
    rows = rows.filter(r => r.teacher_id === tid);
  }
  if (req.att_date) rows = rows.filter(r => r.att_date === String(req.att_date));
  if (req.status) rows = rows.filter(r => r.status === String(req.status));

  return { todayDate: today, schedule: schedule, records: rows };
}

function normalizeComplaintRow_(r) {
  return Object.assign({}, r, {
    student_id: String(r.student_id || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || '')
  });
}

function complaintsCreate_(req, ctx) {
  if (!ctx.id) throw new Error('FORBIDDEN');
  if (!req.title || !req.details) throw new Error('MISSING_FIELD');
  const student = readAll_('Students').find(s => String(s.student_id) === String(ctx.id));
  if (!student) throw new Error('NOT_FOUND');
  const cls = readAll_('Classes').find(c => c.class_id === student.class_id) || {};

  const id = 'Cmp-' + Utilities.getUuid().slice(0, 6).toUpperCase();
  const now = new Date().toISOString();
  const obj = {
    complaint_id: id,
    student_id: String(student.student_id),
    student_name: student.full_name,
    class_label: cls.label || '',
    category: String(req.category || 'أخرى').trim().slice(0, 60),
    title: String(req.title).trim().slice(0, 140),
    details: String(req.details).trim().slice(0, 1500),
    status: 'open',
    admin_reply: '',
    created_at: now,
    updated_at: now
  };
  appendObj_('Complaints', obj, true);
  audit_('student', ctx.id, 'complaints.create', id, 'ok');
  return obj;
}

function complaintsMine_(req, ctx) {
  if (!ctx.id) throw new Error('FORBIDDEN');
  return readAll_('Complaints')
    .map(normalizeComplaintRow_)
    .filter(c => c.student_id === String(ctx.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function complaintsList_(req) {
  let rows = readAll_('Complaints')
    .map(normalizeComplaintRow_)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 400);
  if (req.status) rows = rows.filter(c => c.status === String(req.status));
  return rows;
}

function complaintsUpdateStatus_(req, ctx) {
  const id = String(req.complaint_id || '');
  if (!id) throw new Error('MISSING_FIELD');
  const row = findRow_('Complaints', 'complaint_id', id);
  if (!row) throw new Error('NOT_FOUND');
  const cur = normalizeComplaintRow_(readRow_('Complaints', row));
  const status = String(req.status || cur.status);
  if (['open', 'in_review', 'resolved'].indexOf(status) < 0) throw new Error('INVALID_STATUS');
  cur.status = status;
  cur.admin_reply = String(req.admin_reply !== undefined ? req.admin_reply : (cur.admin_reply || '')).slice(0, 1500);
  cur.updated_at = new Date().toISOString();
  updateRowObj_('Complaints', row, cur, true);
  audit_('admin', ctx.id, 'complaints.updateStatus', id + ':' + status, 'ok');
  return cur;
}

function educationDashboard_() {
  const cfg = config_();
  const schedule = getScheduleFromConfig_(cfg);
  const passMark = Number(cfg.pass_mark || 50);
  const adm = readAll_('Admin')[0];

  const stages = readAll_('Stages').sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const classes = readAll_('Classes');
  const subjects = readAll_('Subjects');
  const students = readAll_('Students').sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  const teachers = readAll_('Teachers').sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  const grades = readAll_('Grades').filter(g => String(g.year) === String(cfg.academic_year) && g.final !== '' && g.final !== null && g.final !== undefined);
  const attendanceRows = readAll_('Attendance')
    .map(normalizeAttRow_)
    .sort((a, b) => (b.att_date + ' ' + b.check_in_time).localeCompare(a.att_date + ' ' + a.check_in_time))
    .slice(0, 500);
  const complaints = readAll_('Complaints')
    .map(normalizeComplaintRow_)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 400);

  const classMap = {};
  classes.forEach(c => classMap[c.class_id] = c);
  const stageMap = {};
  stages.forEach(s => stageMap[s.stage_id] = s);

  const male = students.filter(s => s.gender === 'ذكر').length;
  const female = students.filter(s => s.gender === 'أنثى').length;
  const official = students.filter(s => s.enroll_status === 'official').length;
  const transferred = students.filter(s => s.enroll_status === 'transferred').length;
  const expelled = students.filter(s => s.enroll_status === 'expelled').length;
  const graduated = students.filter(s => s.enroll_status === 'graduated').length;

  const byStageCount = stages.map(st => {
    const clsIds = {};
    classes.filter(c => c.stage_id === st.stage_id).forEach(c => clsIds[c.class_id] = true);
    return {
      stage_id: st.stage_id,
      stage_name: st.name_ar,
      count: students.filter(s => Boolean(clsIds[s.class_id])).length
    };
  });

  const byClassCount = classes.map(c => ({
    class_id: c.class_id,
    label: c.label,
    count: students.filter(s => s.class_id === c.class_id).length,
    capacity: Number(c.capacity || 35)
  }));

  const studentDirectory = students.map(s => {
    const cls = classMap[s.class_id] || {};
    const stg = cls.stage_id ? (stageMap[cls.stage_id] || {}) : {};
    return {
      student_id: String(s.student_id),
      full_name: s.full_name,
      gender: s.gender,
      class_label: cls.label || s.class_id,
      stage_name: stg.name_ar || '',
      enroll_status: s.enroll_status
    };
  });

  const evalScores = grades.map(g => Number(g.final));
  const gradesPassed = evalScores.filter(v => v >= passMark).length;
  const gradesFailed = evalScores.length - gradesPassed;
  const overallAverage = evalScores.length > 0
    ? Math.round((evalScores.reduce((a, b) => a + b, 0) / evalScores.length) * 10) / 10
    : null;

  const gradesByStudent = {};
  grades.forEach(g => {
    const sid = String(g.student_id);
    if (!gradesByStudent[sid]) gradesByStudent[sid] = [];
    gradesByStudent[sid].push(Number(g.final));
  });
  let passedStudents = 0, failedStudents = 0, evaluatedStudents = 0;
  Object.keys(gradesByStudent).forEach(sid => {
    evaluatedStudents++;
    if (gradesByStudent[sid].every(v => v >= passMark)) passedStudents++;
    else failedStudents++;
  });

  const studentMap = {};
  students.forEach(s => studentMap[String(s.student_id)] = s);

  const academicByStage = stages.map(st => {
    const clsIds = {};
    classes.filter(c => c.stage_id === st.stage_id).forEach(c => clsIds[c.class_id] = true);
    const stGrades = grades.filter(g => {
      const stu = studentMap[String(g.student_id)];
      return stu && Boolean(clsIds[stu.class_id]);
    });
    const passed = stGrades.filter(g => Number(g.final) >= passMark).length;
    const avgScore = stGrades.length > 0
      ? Math.round((stGrades.reduce((a, g) => a + Number(g.final), 0) / stGrades.length) * 10) / 10
      : null;
    return {
      stage_id: st.stage_id,
      stage_name: st.name_ar,
      evaluated: stGrades.length,
      passed: passed,
      failed: stGrades.length - passed,
      avgScore: avgScore
    };
  });

  const academicBySubject = subjects.map(sub => {
    const subGrades = grades.filter(g => g.subject_id === sub.subject_id);
    const passed = subGrades.filter(g => Number(g.final) >= passMark).length;
    const avgScore = subGrades.length > 0
      ? Math.round((subGrades.reduce((a, g) => a + Number(g.final), 0) / subGrades.length) * 10) / 10
      : null;
    return {
      subject_id: sub.subject_id,
      subject_name: sub.name_ar,
      stage_name: (stageMap[sub.stage_id] || {}).name_ar || '',
      evaluated: subGrades.length,
      passed: passed,
      failed: subGrades.length - passed,
      avgScore: avgScore
    };
  });

  const today = baghdadNow_().date;
  const todayRows = attendanceRows.filter(r => r.att_date === today);
  const todayOnTime = todayRows.filter(r => r.status === 'on_time').length;
  const todayLate = todayRows.filter(r => r.status === 'late').length;
  const todayPresent = todayRows.length;
  const todayAbsent = Math.max(0, teachers.length - todayPresent);

  const onTimeRecords = attendanceRows.filter(r => r.status === 'on_time').length;
  const lateRecords = attendanceRows.filter(r => r.status === 'late').length;
  const totalLateMinutes = attendanceRows.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0);

  const dateMap = {};
  attendanceRows.forEach(r => {
    if (!dateMap[r.att_date]) dateMap[r.att_date] = { on_time: 0, late: 0 };
    if (r.status === 'late') dateMap[r.att_date].late++;
    else dateMap[r.att_date].on_time++;
  });
  const dailyTrend = Object.keys(dateMap)
    .sort()
    .slice(-14)
    .map(d => ({ date: d, on_time: dateMap[d].on_time, late: dateMap[d].late, total: dateMap[d].on_time + dateMap[d].late }));

  const byTeacher = teachers.map(t => {
    const tid = String(t.teacher_id);
    const recs = attendanceRows.filter(r => r.teacher_id === tid);
    const todayRec = recs.find(r => r.att_date === today);
    return {
      teacher_id: tid,
      teacher_name: t.full_name,
      specialty: t.specialty,
      total_days: recs.length,
      on_time_days: recs.filter(r => r.status === 'on_time').length,
      late_days: recs.filter(r => r.status === 'late').length,
      total_late_minutes: recs.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0),
      today_status: todayRec ? todayRec.status : 'absent',
      today_check_in: todayRec ? todayRec.check_in_time : '',
      today_check_out: todayRec ? todayRec.check_out_time : ''
    };
  });

  const openCount = complaints.filter(c => c.status === 'open').length;
  const inReviewCount = complaints.filter(c => c.status === 'in_review').length;
  const resolvedCount = complaints.filter(c => c.status === 'resolved').length;
  const catCounts = {};
  complaints.forEach(c => {
    const cat = c.category || 'أخرى';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const byCategory = Object.keys(catCounts).map(cat => ({ category: cat, count: catCounts[cat] }));

  return {
    school: {
      school_name: cfg.school_name || 'نظام base المدرسي',
      school_type: cfg.school_type || 'middle',
      shift_type: cfg.shift_type || 'morning',
      founded_date: cfg.founded_date || '',
      academic_year: cfg.academic_year || '2026-2027',
      admin_name: adm ? String(adm.full_name) : '',
      pass_mark: passMark,
      about: cfg.about || '',
      schedule: schedule
    },
    students: {
      total: students.length,
      official: official,
      transferred: transferred,
      expelled: expelled,
      graduated: graduated,
      byGender: { male: male, female: female },
      byStage: byStageCount,
      byClass: byClassCount,
      directory: studentDirectory
    },
    teachers: {
      total: teachers.length,
      directory: teachers.map(t => ({
        teacher_id: String(t.teacher_id),
        full_name: t.full_name,
        job_title: t.job_title,
        degree: t.degree,
        specialty: t.specialty,
        subjects: t.subjects,
        status: t.status
      }))
    },
    academics: {
      gradesEvaluated: evalScores.length,
      gradesPassed: gradesPassed,
      gradesFailed: gradesFailed,
      evaluatedStudents: evaluatedStudents,
      passedStudents: passedStudents,
      failedStudents: failedStudents,
      overallAverage: overallAverage,
      byStage: academicByStage,
      bySubject: academicBySubject
    },
    attendance: {
      todayDate: today,
      totalTeachers: teachers.length,
      todayPresent: todayPresent,
      todayOnTime: todayOnTime,
      todayLate: todayLate,
      todayAbsent: todayAbsent,
      totalRecords: attendanceRows.length,
      onTimeRecords: onTimeRecords,
      lateRecords: lateRecords,
      totalLateMinutes: totalLateMinutes,
      dailyTrend: dailyTrend,
      byTeacher: byTeacher,
      records: attendanceRows
    },
    complaints: {
      total: complaints.length,
      open: openCount,
      in_review: inReviewCount,
      resolved: resolvedCount,
      byCategory: byCategory,
      items: complaints
    }
  };
}
