// ===== admin.gs : تهيئة الأوراق الـ 16 والعمليات الإدارية =====
function schemaHeaders_() {
  return {
    Config: ['key', 'value'],
    Admin: ['admin_id', 'full_name', 'certificate', 'specialty', 'start_date', 'phone', 'whatsapp', 'username', 'salt', 'pass_hash', 'sec_question', 'sec_answer_hash', 'updated_at'],
    Stages: ['stage_id', 'name_ar', 'level_type', 'sort_order', 'track'],
    Classes: ['class_id', 'stage_id', 'section', 'label', 'capacity', 'status'],
    Subjects: ['subject_id', 'name_ar', 'stage_id', 'weekly_periods', 'active'],
    IDs: ['id', 'kind', 'class_id', 'status', 'pin_hash', 'generated_at', 'registered_at', 'last_login', 'card_printed'],
    Students: ['student_id', 'full_name', 'mother_name', 'gender', 'birth_date', 'address', 'guardian_name', 'guardian_phone', 'photo_file_id', 'prev_school', 'prev_stage', 'prev_average', 'reg_reason', 'failed_years', 'dropout_years', 'enroll_date', 'health_note', 'class_id', 'enroll_status', 'status_note', 'notes', 'updated_at'],
    Teachers: ['teacher_id', 'full_name', 'mother_name', 'gender', 'birth_date', 'degree', 'specialty', 'university', 'college', 'grad_year', 'job_title', 'hire_date', 'start_date', 'bio_cv', 'subjects', 'phone', 'whatsapp', 'email', 'address', 'photo_file_id', 'status', 'updated_at'],
    Assignments: ['assign_id', 'teacher_id', 'subject_id', 'class_id', 'year'],
    Grades: ['grade_key', 'student_id', 'subject_id', 'year', 'm1', 'm2', 'avg_t1', 'mid_year', 'm3', 'm4', 'avg_t2', 'annual_effort', 'final_exam', 'final', 'round', 'entered_by', 'updated_at'],
    Permissions: ['id', 'entity', 'field', 'label_ar', 'admin', 'self', 'teacher', 'student', 'guest'],
    Announcements: ['ann_id', 'title', 'body', 'audience', 'publish_date', 'expire_date', 'active'],
    Audit_Log: ['timestamp', 'role', 'actor_id', 'action', 'target', 'result', 'detail'],
    Archive_Grades: ['grade_key', 'student_id', 'subject_id', 'year', 'm1', 'm2', 'avg_t1', 'mid_year', 'm3', 'm4', 'avg_t2', 'annual_effort', 'final_exam', 'final', 'round', 'entered_by', 'updated_at', 'archived_at', 'stage_at_time', 'class_at_time'],
    Attendance: ['att_id', 'teacher_id', 'teacher_name', 'att_date', 'check_in_time', 'check_out_time', 'method', 'status', 'late_minutes', 'device_note', 'created_at', 'updated_at'],
    Complaints: ['complaint_id', 'student_id', 'student_name', 'class_label', 'category', 'title', 'details', 'status', 'admin_reply', 'created_at', 'updated_at']
  };
}

function ensureSchemaIfNeeded_() {
  const ss = ss_();
  if (
    !ss.getSheetByName('Config') ||
    !ss.getSheetByName('Admin') ||
    !ss.getSheetByName('Permissions') ||
    !ss.getSheetByName('Attendance') ||
    !ss.getSheetByName('Complaints')
  ) {
    withLock_(function() { initSchema_(); });
  }
}

function initSchema_() {
  const ss = ss_();
  const headers = schemaHeaders_();
  Object.keys(headers).forEach(function(name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      const cols = headers[name];
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      if (['Config', 'IDs', 'Students', 'Teachers', 'Admin', 'Attendance', 'Complaints'].indexOf(name) >= 0) {
        sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
      }
    }
  });

  const defaults = [
    ['school_name', 'مدرسة النخبة النموذجية'],
    ['founded_date', '2018-09-01'],
    ['school_type', 'middle'],
    ['shift_type', 'morning'],
    ['map_url', ''],
    ['about', 'منصة مدرسية متكاملة لمتابعة شؤون الطلبة، الدرجات، والهيئة التدريسية.'],
    ['logo_file_id', ''],
    ['academic_year', '2026-2027'],
    ['teacher_profile_visibility', 'all'],
    ['student_profile_visibility', 'all'],
    ['guest_student_list', 'full'],
    ['require_teacher_pin', 'FALSE'],
    ['allow_student_self_edit', 'FALSE'],
    ['pass_mark', '50'],
    ['annual_effort_formula', 'iraqi_avg'],
    ['final_score_formula', 'avg_effort_final'],
    ['education_access_code', ''],
    ['attendance_start_time', '08:00'],
    ['attendance_end_time', '13:30'],
    ['attendance_grace_minutes', '15'],
    ['attendance_workdays', '0,1,2,3,4'],
    ['attendance_locks', '{}'],
    ['schema_version', '2']
  ];
  const existingCfg = readAll_('Config');
  if (existingCfg.length === 0) {
    const cfgRange = sheet_('Config').getRange(2, 1, defaults.length, 2);
    cfgRange.setNumberFormat('@');
    cfgRange.setValues(defaults);
  } else {
    const existingKeys = new Set(existingCfg.map(r => String(r.key)));
    defaults.forEach(pair => {
      if (!existingKeys.has(pair[0])) {
        appendObj_('Config', { key: pair[0], value: pair[1] }, true);
      }
    });
  }

  if (readAll_('Permissions').length === 0) {
    const perms = [
      [1,'student','student_id','رقم الهوية',1,1,1,0,0],
      [2,'student','full_name','الاسم الرباعي',1,1,1,0,1],
      [3,'student','mother_name','اسم الأم',1,1,0,0,0],
      [4,'student','gender','الجنس',1,1,1,0,1],
      [5,'student','class_id','الصف والشعبة',1,1,1,0,1],
      [6,'student','photo_file_id','الصورة الشخصية',1,1,1,0,1],
      [7,'student','enroll_status','حالة القيد',1,1,1,0,0],
      [8,'student','birth_date','تاريخ الميلاد',1,1,0,0,0],
      [9,'student','address','العنوان',1,1,0,0,0],
      [10,'student','guardian_name','اسم ولي الأمر',1,1,1,0,0],
      [11,'student','guardian_phone','هاتف ولي الأمر',1,1,1,0,0],
      [12,'student','prev_school','المدرسة السابقة والمعدل',1,1,0,0,0],
      [13,'student','health_note','الملاحظات الصحية',1,0,1,0,0],
      [14,'student','notes','الملاحظات والتحذيرات',1,0,1,0,0],
      [15,'student','grades','الدرجات',1,1,1,0,0],
      [16,'teacher','teacher_id','رقم الهوية',1,1,0,0,0],
      [17,'teacher','full_name','الاسم الكامل',1,1,1,1,1],
      [18,'teacher','photo_file_id','الصورة الشخصية',1,1,1,1,1],
      [19,'teacher','job_title','العنوان الوظيفي',1,1,1,1,1],
      [20,'teacher','degree','الشهادة',1,1,1,1,1],
      [21,'teacher','specialty','التخصص',1,1,1,1,1],
      [22,'teacher','subjects','المواد التي يدرّسها',1,1,1,1,1],
      [23,'teacher','bio_cv','السيرة الذاتية',1,1,1,1,1],
      [24,'teacher','university','الجامعة والكلية وسنة التخرج',1,1,0,0,0],
      [25,'teacher','phone','رقم الهاتف',1,1,0,0,0],
      [26,'teacher','whatsapp','الواتساب',1,1,0,0,0],
      [27,'teacher','email','البريد الإلكتروني',1,1,0,0,0],
      [28,'teacher','address','العنوان السكني',1,1,0,0,0],
      [29,'teacher','hire_date','تاريخ التعيين والمباشرة',1,1,0,0,0]
    ];
    sheet_('Permissions').getRange(2, 1, perms.length, 9).setValues(perms);
  }
  clearCache_(['cfg', 'perm']);
  return { initialized: true, sheets: 16 };
}

function adminDashboard_() {
  const cfg = config_();
  const students = readAll_('Students');
  const teachers = readAll_('Teachers');
  const classes = readAll_('Classes');
  const stages = readAll_('Stages');
  const subjects = readAll_('Subjects');
  const ids = readAll_('IDs');
  const passMark = Number(cfg.pass_mark || 50);
  const grades = readAll_('Grades').filter(g => String(g.year) === cfg.academic_year && g.final !== '' && g.final !== null);
  const passed = grades.filter(g => Number(g.final) >= passMark).length;
  return {
    config: cfg,
    counts: {
      studentsCount: students.length,
      teachersCount: teachers.length,
      classesCount: classes.length,
      stagesCount: stages.length,
      subjectsCount: subjects.length,
      totalIds: ids.length,
      unusedIds: ids.filter(i => i.status === 'unused').length,
      registeredIds: ids.filter(i => i.status === 'registered').length,
      disabledIds: ids.filter(i => i.status === 'disabled').length,
      gradesEvaluated: grades.length,
      passed: passed,
      failed: grades.length - passed
    }
  };
}

function adminProfileGet_() {
  const a = readAll_('Admin')[0];
  if (!a) return null;
  const copy = Object.assign({}, a);
  copy.full_name = String(copy.full_name || '');
  copy.certificate = String(copy.certificate || 'بكالوريوس');
  copy.specialty = String(copy.specialty || '');
  copy.start_date = asDateStr_(copy.start_date);
  copy.phone = String(copy.phone || '');
  copy.whatsapp = String(copy.whatsapp || '');
  copy.username = String(copy.username || '');
  copy.sec_question = String(copy.sec_question || '');
  delete copy.salt; delete copy.pass_hash; delete copy.sec_answer_hash;
  return copy;
}

function adminProfileSave_(req, ctx) {
  const cur = readAll_('Admin')[0];
  if (!cur) throw new Error('NOT_FOUND');
  if (req.new_password) {
    if (sha256_(String(cur.salt) + String(req.old_password || '')) !== String(cur.pass_hash)) {
      throw new Error('INVALID_CREDENTIALS');
    }
    if (String(req.new_password).length < 8) throw new Error('WEAK_PASSWORD');
    cur.salt = Utilities.getUuid();
    cur.pass_hash = sha256_(cur.salt + String(req.new_password));
  }
  if (req.sec_answer) cur.sec_answer_hash = sha256_(String(req.sec_answer).trim().toLowerCase());
  cur.full_name = String(req.full_name || cur.full_name);
  cur.certificate = String(req.certificate || cur.certificate);
  cur.specialty = String(req.specialty !== undefined ? req.specialty : cur.specialty);
  cur.start_date = String(req.start_date || asDateStr_(cur.start_date));
  cur.phone = String(req.phone !== undefined ? req.phone : cur.phone);
  cur.whatsapp = String(req.whatsapp !== undefined ? req.whatsapp : cur.whatsapp);
  cur.username = String(req.username || cur.username);
  cur.sec_question = String(req.sec_question !== undefined ? req.sec_question : cur.sec_question);
  cur.updated_at = new Date().toISOString();
  updateRowObj_('Admin', 2, cur, true);
  audit_('admin', ctx.id, 'admin.profileSave', cur.username, 'ok');
  return adminProfileGet_();
}

function adminSchoolSave_(req, ctx) {
  const cfg = config_();
  const attStart = req.attendance_start_time !== undefined
    ? asHHMMStr_(req.attendance_start_time)
    : (asHHMMStr_(cfg.attendance_start_time) || '08:00');
  const attEnd = req.attendance_end_time !== undefined
    ? asHHMMStr_(req.attendance_end_time)
    : (asHHMMStr_(cfg.attendance_end_time) || '13:30');
  parseTimeMinutes_(attStart);
  parseTimeMinutes_(attEnd);

  const graceRaw = req.attendance_grace_minutes !== undefined
    ? Number(req.attendance_grace_minutes)
    : Number(cfg.attendance_grace_minutes || 15);
  const graceMinutes = String(Math.max(0, Math.min(180, isFinite(graceRaw) ? Math.round(graceRaw) : 15)));

  let logoId = cfg.logo_file_id || '';
  if (req.logo_data_url && String(req.logo_data_url).indexOf('data:image/') === 0) {
    logoId = saveDrivePhoto_(req.logo_data_url, 'school_logo_');
  } else if (req.logo_data_url === '') {
    logoId = '';
  }

  const keys = [
    'school_name','founded_date','school_type','shift_type','map_url','about','academic_year',
    'teacher_profile_visibility','student_profile_visibility','guest_student_list',
    'require_teacher_pin','allow_student_self_edit','pass_mark','annual_effort_formula','final_score_formula',
    'education_access_code','attendance_workdays'
  ];
  const overrides = {
    attendance_start_time: attStart,
    attendance_end_time: attEnd,
    attendance_grace_minutes: graceMinutes,
    education_access_code: req.education_access_code !== undefined ? String(req.education_access_code).trim() : String(cfg.education_access_code || ''),
    attendance_workdays: req.attendance_workdays !== undefined ? String(req.attendance_workdays).trim() : String(cfg.attendance_workdays || '0,1,2,3,4')
  };

  keys.concat(['attendance_start_time','attendance_end_time','attendance_grace_minutes']).forEach(k => {
    const val = overrides[k] !== undefined
      ? overrides[k]
      : (req[k] !== undefined ? String(req[k]) : String(cfg[k] || ''));
    const row = findRow_('Config', 'key', k);
    if (row) {
      const cell = sheet_('Config').getRange(row, 2);
      cell.setNumberFormat('@');
      cell.setValue(val);
    } else {
      appendObj_('Config', { key: k, value: val }, true);
    }
  });
  const logoRow = findRow_('Config', 'key', 'logo_file_id');
  if (logoRow) {
    const cell = sheet_('Config').getRange(logoRow, 2);
    cell.setNumberFormat('@');
    cell.setValue(logoId);
  } else {
    appendObj_('Config', { key: 'logo_file_id', value: logoId }, true);
  }

  SpreadsheetApp.flush();
  clearCache_(['cfg']);
  if (readAll_('Stages').length === 0) stageApplyDefaults_({ school_type: req.school_type || cfg.school_type }, ctx);
  audit_('admin', ctx.id, 'admin.schoolSave', String(req.school_name || cfg.school_name), 'ok');
  return config_();
}

function stagesList_() {
  return readAll_('Stages').sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
}

function stageApplyDefaults_(req, ctx) {
  const t = String(req.school_type || config_().school_type || 'middle');
  const map = {
    primary: [['Stg-P1','الأول الابتدائي','primary',1,''],['Stg-P2','الثاني الابتدائي','primary',2,''],['Stg-P3','الثالث الابتدائي','primary',3,''],['Stg-P4','الرابع الابتدائي','primary',4,''],['Stg-P5','الخامس الابتدائي','primary',5,''],['Stg-P6','السادس الابتدائي','primary',6,'']],
    middle: [['Stg-M1','الأول المتوسط','middle',1,''],['Stg-M2','الثاني المتوسط','middle',2,''],['Stg-M3','الثالث المتوسط','middle',3,'']],
    prep: [['Stg-Pr4S','الرابع الإعدادي (علمي)','prep',1,'علمي'],['Stg-Pr4L','الرابع الإعدادي (أدبي)','prep',2,'أدبي'],['Stg-Pr5S','الخامس الإعدادي (علمي)','prep',3,'علمي'],['Stg-Pr5L','الخامس الإعدادي (أدبي)','prep',4,'أدبي'],['Stg-Pr6S','السادس الإعدادي (علمي)','prep',5,'علمي'],['Stg-Pr6L','السادس الإعدادي (أدبي)','prep',6,'أدبي']],
    secondary: [['Stg-M1','الأول المتوسط','middle',1,''],['Stg-M2','الثاني المتوسط','middle',2,''],['Stg-M3','الثالث المتوسط','middle',3,''],['Stg-Pr4S','الرابع الإعدادي (علمي)','prep',4,'علمي'],['Stg-Pr5S','الخامس الإعدادي (علمي)','prep',5,'علمي'],['Stg-Pr6S','السادس الإعدادي (علمي)','prep',6,'علمي']],
    vocational: [['Stg-V1','الأول المهني (صناعي)','vocational',1,'صناعي'],['Stg-V2','الثاني المهني (صناعي)','vocational',2,'صناعي'],['Stg-V3','الثالث المهني (صناعي)','vocational',3,'صناعي']]
  };
  const existing = readAll_('Stages').map(s => s.stage_id);
  (map[t] || map.middle).forEach(arr => {
    if (existing.indexOf(arr[0]) < 0) {
      appendObj_('Stages', { stage_id: arr[0], name_ar: arr[1], level_type: arr[2], sort_order: arr[3], track: arr[4] }, false);
    }
  });
  audit_('admin', ctx.id, 'admin.stageApplyDefaults', t, 'ok');
  return stagesList_();
}

function stageUpsert_(req, ctx) {
  const id = req.stage_id || ('Stg-' + Utilities.getUuid().slice(0, 6).toUpperCase());
  const row = findRow_('Stages', 'stage_id', id);
  const obj = { stage_id: id, name_ar: req.name_ar, level_type: req.level_type || 'middle', sort_order: Number(req.sort_order || 1), track: req.track || '' };
  if (row) updateRowObj_('Stages', row, obj, false);
  else appendObj_('Stages', obj, false);
  audit_('admin', ctx.id, 'admin.stageUpsert', id, 'ok');
  return stagesList_();
}

function stageDelete_(req, ctx) {
  if (readAll_('Classes').some(c => c.stage_id === req.stage_id)) throw new Error('STAGE_HAS_CLASSES');
  const row = findRow_('Stages', 'stage_id', req.stage_id);
  if (row) sheet_('Stages').deleteRow(row);
  audit_('admin', ctx.id, 'admin.stageDelete', req.stage_id, 'ok');
  return true;
}

function classesList_() {
  const stages = readAll_('Stages');
  const students = readAll_('Students');
  return readAll_('Classes').map(c => {
    const stg = stages.find(s => s.stage_id === c.stage_id) || {};
    return Object.assign({}, c, {
      stage_name: stg.name_ar || '',
      students_count: students.filter(s => s.class_id === c.class_id).length
    });
  });
}

function classUpsert_(req, ctx) {
  const stg = readAll_('Stages').find(s => s.stage_id === req.stage_id);
  if (!stg) throw new Error('NOT_FOUND');
  const section = String(req.section || '').trim();
  if (!req.class_id && readAll_('Classes').some(c => c.stage_id === req.stage_id && c.section === section)) {
    throw new Error('DUPLICATE_SECTION');
  }
  const classId = req.class_id || ('Cls-' + req.stage_id.replace('Stg-', '') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase());
  const obj = { class_id: classId, stage_id: req.stage_id, section: section, label: req.label || (stg.name_ar + ' / شعبة ' + section), capacity: Number(req.capacity || 35), status: req.status || 'active' };
  const row = findRow_('Classes', 'class_id', classId);
  if (row) updateRowObj_('Classes', row, obj, false);
  else appendObj_('Classes', obj, false);
  audit_('admin', ctx.id, 'admin.classUpsert', classId, 'ok');
  return classesList_();
}

function classDelete_(req, ctx) {
  if (readAll_('IDs').some(i => i.class_id === req.class_id) || readAll_('Students').some(s => s.class_id === req.class_id)) {
    throw new Error('CLASS_IN_USE');
  }
  const row = findRow_('Classes', 'class_id', req.class_id);
  if (row) sheet_('Classes').deleteRow(row);
  audit_('admin', ctx.id, 'admin.classDelete', req.class_id, 'ok');
  return true;
}

function subjectsList_() {
  const stages = readAll_('Stages');
  return readAll_('Subjects').map(sub => {
    const stg = stages.find(s => s.stage_id === sub.stage_id) || {};
    return Object.assign({}, sub, { stage_name: stg.name_ar || '' });
  });
}

function subjectUpsert_(req, ctx) {
  if (!req.subject_id && readAll_('Subjects').some(s => s.stage_id === req.stage_id && s.name_ar === req.name_ar)) {
    throw new Error('DUPLICATE_SUBJECT');
  }
  const id = req.subject_id || ('Sub-' + Utilities.getUuid().slice(0, 6).toUpperCase());
  const obj = { subject_id: id, name_ar: String(req.name_ar).trim(), stage_id: req.stage_id, weekly_periods: Number(req.weekly_periods || 4), active: req.active === undefined ? 1 : Number(req.active) };
  const row = findRow_('Subjects', 'subject_id', id);
  if (row) updateRowObj_('Subjects', row, obj, false);
  else appendObj_('Subjects', obj, false);
  audit_('admin', ctx.id, 'admin.subjectUpsert', obj.name_ar, 'ok');
  return subjectsList_();
}

function assignmentsList_(req, ctx) {
  const year = config_().academic_year;
  const subs = readAll_('Subjects');
  const cls = readAll_('Classes');
  const trs = readAll_('Teachers');
  let list = readAll_('Assignments').filter(a => String(a.year) === year);
  if (ctx.role === 'teacher') list = list.filter(a => String(a.teacher_id) === ctx.id);
  return list.map(a => Object.assign({}, a, {
    subject_name: (subs.find(s => s.subject_id === a.subject_id) || {}).name_ar || '',
    class_label: (cls.find(c => c.class_id === a.class_id) || {}).label || '',
    teacher_name: (trs.find(t => String(t.teacher_id) === String(a.teacher_id)) || {}).full_name || ''
  }));
}

function assignmentUpsert_(req, ctx) {
  const year = String(req.year || config_().academic_year);
  const tid = String(req.teacher_id).replace(/\D/g, '');
  if (readAll_('Assignments').some(a => String(a.teacher_id) === tid && a.subject_id === req.subject_id && a.class_id === req.class_id && String(a.year) === year)) {
    throw new Error('DUPLICATE_ASSIGNMENT');
  }
  const id = 'Asg-' + Utilities.getUuid().slice(0, 6).toUpperCase();
  appendObj_('Assignments', { assign_id: id, teacher_id: tid, subject_id: req.subject_id, class_id: req.class_id, year: year }, true);
  audit_('admin', ctx.id, 'admin.assignmentUpsert', tid + '->' + req.class_id, 'ok');
  return assignmentsList_(req, { role: 'admin', id: 'admin' });
}

function assignmentDelete_(req, ctx) {
  const row = findRow_('Assignments', 'assign_id', req.assign_id);
  if (row) sheet_('Assignments').deleteRow(row);
  audit_('admin', ctx.id, 'admin.assignmentDelete', req.assign_id, 'ok');
  return true;
}

function makeIdsBatch_(count, length) {
  const existing = new Set(readAll_('IDs').map(r => String(r.id)));
  const out = [];
  while (out.length < count) {
    let body = '';
    for (let i = 0; i < length - 1; i++) body += String(Math.floor(Math.random() * 10));
    const full = body + luhnCheckDigit_(body);
    if (!existing.has(full)) { existing.add(full); out.push(full); }
  }
  return out;
}

function idsGenerate_(req, ctx) {
  const kind = req.kind === 'teacher' ? 'teacher' : 'student';
  const count = Math.min(Math.max(Number(req.count || 1), 1), 500);
  const classId = kind === 'student' ? String(req.class_id || '') : '';
  const created = makeIdsBatch_(count, kind === 'student' ? 16 : 8);
  const now = new Date().toISOString();
  const sh = sheet_('IDs');
  const startRow = sh.getLastRow() + 1;
  const rows = created.map(id => [id, kind, classId, 'unused', '', now, '', '', 'FALSE']);
  const range = sh.getRange(startRow, 1, rows.length, 9);
  range.setNumberFormat('@');
  range.setValues(rows);
  audit_('admin', ctx.id, 'ids.generate', kind + ':' + count, 'ok');
  return created;
}

function idsList_(req) {
  const cls = readAll_('Classes');
  const sts = readAll_('Students');
  const trs = readAll_('Teachers');
  return readAll_('IDs').map(i => {
    const c = cls.find(x => x.class_id === i.class_id) || {};
    const p = i.kind === 'student'
      ? sts.find(x => String(x.student_id) === String(i.id))
      : trs.find(x => String(x.teacher_id) === String(i.id));
    return Object.assign({}, i, { class_label: c.label || '', person_name: p ? p.full_name : '' });
  });
}

function idsMarkPrinted_(req, ctx) {
  (req.ids || []).forEach(id => {
    const row = findRow_('IDs', 'id', String(id));
    if (row) sheet_('IDs').getRange(row, colIndex_('IDs', 'card_printed')).setValue('TRUE');
  });
  audit_('admin', ctx.id, 'ids.markPrinted', String((req.ids || []).length), 'ok');
  return true;
}

function idsDisable_(req, ctx) {
  const row = findRow_('IDs', 'id', String(req.id));
  if (row) sheet_('IDs').getRange(row, colIndex_('IDs', 'status')).setValue('disabled');
  audit_('admin', ctx.id, 'ids.disable', String(req.id), 'ok');
  return true;
}

function idsReplace_(req, ctx) {
  const oldId = String(req.old_id || '').replace(/\D/g, '');
  const row = findRow_('IDs', 'id', oldId);
  if (!row) throw new Error('NOT_FOUND');
  const oldRec = readRow_('IDs', row);
  const newId = makeIdsBatch_(1, oldRec.kind === 'student' ? 16 : 8)[0];
  const now = new Date().toISOString();
  sheet_('IDs').getRange(row, colIndex_('IDs', 'status')).setValue('disabled');
  appendObj_('IDs', {
    id: newId, kind: oldRec.kind, class_id: oldRec.class_id,
    status: oldRec.status === 'registered' ? 'registered' : 'unused',
    pin_hash: '', generated_at: now, registered_at: oldRec.status === 'registered' ? now : '', last_login: '', card_printed: 'FALSE'
  }, true);

  if (oldRec.kind === 'student') {
    const stRow = findRow_('Students', 'student_id', oldId);
    if (stRow) sheet_('Students').getRange(stRow, colIndex_('Students', 'student_id')).setValue(newId);
    readAll_('Grades').forEach((g, idx) => {
      if (String(g.student_id) === oldId) {
        const gRow = idx + 2;
        sheet_('Grades').getRange(gRow, colIndex_('Grades', 'student_id')).setValue(newId);
        sheet_('Grades').getRange(gRow, colIndex_('Grades', 'grade_key')).setValue(newId + '|' + g.subject_id + '|' + g.year);
      }
    });
  } else {
    const tRow = findRow_('Teachers', 'teacher_id', oldId);
    if (tRow) sheet_('Teachers').getRange(tRow, colIndex_('Teachers', 'teacher_id')).setValue(newId);
  }
  audit_('admin', ctx.id, 'ids.replace', oldId + '->' + newId, 'ok');
  return { old_id: oldId, new_id: newId };
}

function idsPrefillStudents_(req, ctx) {
  const list = req.students || [];
  const ids = makeIdsBatch_(list.length, 16);
  const now = new Date().toISOString();
  const created = [];
  list.forEach((s, i) => {
    if (!s.full_name) return;
    const id = ids[i];
    appendObj_('IDs', { id: id, kind: 'student', class_id: req.class_id, status: 'registered', pin_hash: '', generated_at: now, registered_at: now, last_login: '', card_printed: 'FALSE' }, true);
    appendObj_('Students', {
      student_id: id, full_name: String(s.full_name).trim(), mother_name: s.mother_name || '', gender: s.gender || 'ذكر',
      birth_date: s.birth_date || '2012-01-01', address: '', guardian_name: s.guardian_name || '', guardian_phone: String(s.guardian_phone || ''),
      photo_file_id: '', prev_school: '', prev_stage: '', prev_average: '', reg_reason: 'جديد', failed_years: 0, dropout_years: 0,
      enroll_date: todayDate_(), health_note: '', class_id: req.class_id, enroll_status: 'official', status_note: '', notes: '', updated_at: now
    }, true);
    created.push({ student_id: id, full_name: s.full_name });
  });
  audit_('admin', ctx.id, 'ids.prefillStudents', req.class_id + ':' + created.length, 'ok');
  return created;
}

function adminStudentUpsert_(req, ctx) {
  const s = req.student || req;
  const row = findRow_('Students', 'student_id', String(s.student_id));
  if (row) {
    const cur = readRow_('Students', row);
    Object.assign(cur, s, { updated_at: new Date().toISOString() });
    updateRowObj_('Students', row, cur, true);
  }
  audit_('admin', ctx.id, 'admin.studentUpsert', String(s.student_id), 'ok');
  return true;
}

function adminStudentTransfer_(req, ctx) {
  const sid = String(req.student_id || '').replace(/\D/g, '');
  const stRow = findRow_('Students', 'student_id', sid);
  if (!stRow) throw new Error('NOT_FOUND');
  const st = readRow_('Students', stRow);
  const cls = readAll_('Classes');
  const curCls = cls.find(c => c.class_id === st.class_id);
  const tgtCls = cls.find(c => c.class_id === req.class_id);
  if (!tgtCls) throw new Error('NOT_FOUND');
  if (curCls && curCls.stage_id !== tgtCls.stage_id) {
    const yr = config_().academic_year;
    if (readAll_('Grades').some(g => String(g.student_id) === sid && String(g.year) === yr)) {
      throw new Error('HAS_GRADES_ARCHIVE_FIRST');
    }
  }
  sheet_('Students').getRange(stRow, colIndex_('Students', 'class_id')).setValue(req.class_id);
  const idRow = findRow_('IDs', 'id', sid);
  if (idRow) sheet_('IDs').getRange(idRow, colIndex_('IDs', 'class_id')).setValue(req.class_id);
  audit_('admin', ctx.id, 'admin.studentTransfer', sid + '->' + req.class_id, 'ok');
  return true;
}

function adminStudentStatus_(req, ctx) {
  const sid = String(req.student_id || '').replace(/\D/g, '');
  const stRow = findRow_('Students', 'student_id', sid);
  if (!stRow) throw new Error('NOT_FOUND');
  sheet_('Students').getRange(stRow, colIndex_('Students', 'enroll_status')).setValue(req.enroll_status);
  sheet_('Students').getRange(stRow, colIndex_('Students', 'status_note')).setValue(req.status_note || '');
  audit_('admin', ctx.id, 'admin.studentStatus', sid + ':' + req.enroll_status, 'ok');
  return true;
}

function adminTeacherUpsert_(req, ctx) {
  const t = req.teacher || req;
  const row = findRow_('Teachers', 'teacher_id', String(t.teacher_id));
  if (row) {
    const cur = readRow_('Teachers', row);
    Object.assign(cur, t, { updated_at: new Date().toISOString() });
    updateRowObj_('Teachers', row, cur, true);
  }
  audit_('admin', ctx.id, 'admin.teacherUpsert', String(t.teacher_id), 'ok');
  return true;
}

function announcementUpsert_(req, ctx) {
  const id = req.ann_id || ('Ann-' + Utilities.getUuid().slice(0, 6).toUpperCase());
  const obj = { ann_id: id, title: req.title, body: req.body, audience: req.audience || 'all', publish_date: req.publish_date || todayDate_(), expire_date: req.expire_date || '', active: req.active === undefined ? 1 : Number(req.active) };
  const row = findRow_('Announcements', 'ann_id', id);
  if (row) updateRowObj_('Announcements', row, obj, false);
  else appendObj_('Announcements', obj, false);
  audit_('admin', ctx.id, 'admin.announcementUpsert', id, 'ok');
  return readAll_('Announcements');
}

function announcementDelete_(req, ctx) {
  const row = findRow_('Announcements', 'ann_id', req.ann_id);
  if (row) sheet_('Announcements').deleteRow(row);
  audit_('admin', ctx.id, 'admin.announcementDelete', req.ann_id, 'ok');
  return true;
}

function permList_() {
  return readAll_('Permissions');
}

function permSave_(req, ctx) {
  const rows = req.rows || [];
  const all = readAll_('Permissions');
  rows.forEach(r => {
    const idx = all.findIndex(x => x.entity === r.entity && x.field === r.field);
    if (idx >= 0) {
      const sheetRow = idx + 2;
      sheet_('Permissions').getRange(sheetRow, 5, 1, 5).setValues([[1, r.self ? 1 : 0, r.teacher ? 1 : 0, r.student ? 1 : 0, r.guest ? 1 : 0]]);
    }
  });
  clearCache_(['perm']);
  audit_('admin', ctx.id, 'perm.save', rows.length + ' rows', 'ok');
  return permList_();
}

function auditList_() {
  return readAll_('Audit_Log').reverse().slice(0, 300);
}

function sheetsInspect_(req) {
  const name = String(req.sheet || 'Config');
  if (!schemaHeaders_()[name]) throw new Error('NOT_FOUND');
  const rows = readAll_(name);
  if (name === 'Admin') {
    return rows.map(r => { const c = Object.assign({}, r); delete c.salt; delete c.pass_hash; delete c.sec_answer_hash; return c; });
  }
  return rows.slice(0, 500);
}
