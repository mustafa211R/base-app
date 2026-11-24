// ===== data.gs : أدوات الجداول والصلاحيات والملفات =====
function sheet_(name) { return SS.getSheetByName(name); }

function headers_(name) {
  const sh = sheet_(name);
  if (!sh || sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function colIndex_(name, col) { return headers_(name).indexOf(col) + 1; }

function todayDate_() { return new Date().toISOString().slice(0, 10); }

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
  CacheService.getScriptCache().removeAll(keys);
}

function config_() {
  return cached_('cfg', 120, () => {
    const o = {};
    readAll_('Config').forEach(r => o[r.key] = String(r.value));
    return o;
  });
}

function relation_(ctx, targetId) {
  if (ctx.role === 'admin') return 'admin';
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

  return {
    initialized: Boolean(adm),
    setupKeyRequired: Boolean(setupKey),
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

  const fields = allowedFields_('student', ctx.role);
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
