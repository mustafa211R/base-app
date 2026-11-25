// ===== backup.gs : النسخ الاحتياطي، نهاية السنة، والبيانات التجريبية =====
function dailyBackup() {
  const folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID');
  const folder = DriveApp.getFolderById(folderId);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd_HH-mm');
  DriveApp.getFileById(ss_().getId()).makeCopy('base_backup_' + stamp, folder);

  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(30).forEach(f => f.setTrashed(true));
}

function installTriggers() {
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
}

function backupExportJson_() {
  const out = {};
  const headers = schemaHeaders_();
  Object.keys(headers).forEach(name => {
    let rows = readAll_(name);
    if (name === 'Admin') {
      rows = rows.map(r => { const c = Object.assign({}, r); delete c.salt; delete c.pass_hash; delete c.sec_answer_hash; return c; });
    }
    out[name] = rows;
  });
  return out;
}

function backupRestore_(req, ctx) {
  const adm = readAll_('Admin')[0];
  if (!adm || sha256_(String(adm.salt) + String(req.password || '')) !== String(adm.pass_hash)) {
    throw new Error('INVALID_CREDENTIALS');
  }
  const headers = schemaHeaders_();
  const sheetsData = req.sheets_data || {};
  let total = 0;
  Object.keys(sheetsData).forEach(name => {
    if (!headers[name] || name === 'Admin') return;
    const rows = sheetsData[name] || [];
    if (!rows.length) return;
    const head = headers[name];
    const sh = sheet_(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
    const values = rows.map(r => head.map(h => r[h] === undefined ? '' : r[h]));
    const range = sh.getRange(2, 1, values.length, head.length);
    if (['IDs', 'Students', 'Teachers', 'Attendance', 'Complaints', 'Leaves'].indexOf(name) >= 0) range.setNumberFormat('@');
    range.setValues(values);
    total += values.length;
  });
  clearCache_(['cfg', 'perm']);
  audit_('admin', ctx.id, 'backup.restore', total + ' rows', 'ok');
  return { restoredRows: total };
}

function yearArchive_(req, ctx) {
  const cfg = config_();
  const nextYear = String(req.next_academic_year || '').trim();
  if (!nextYear) throw new Error('MISSING_FIELD');
  const passMark = Number(cfg.pass_mark || 50);
  const stages = stagesList_();
  const classes = readAll_('Classes');
  const students = readAll_('Students').filter(s => s.enroll_status === 'official');
  const grades = readAll_('Grades').filter(g => String(g.year) === cfg.academic_year);
  const now = new Date().toISOString();

  grades.forEach(g => {
    const st = students.find(s => String(s.student_id) === String(g.student_id));
    const cls = st ? classes.find(c => c.class_id === st.class_id) : null;
    const stg = cls ? stages.find(s => s.stage_id === cls.stage_id) : null;
    appendObj_('Archive_Grades', Object.assign({}, g, {
      archived_at: now, stage_at_time: stg ? stg.name_ar : '', class_at_time: st ? st.class_id : ''
    }), false);
  });

  let promoted = 0, graduated = 0;
  students.forEach(st => {
    const stGrades = grades.filter(g => String(g.student_id) === String(st.student_id));
    const allPassed = stGrades.length === 0 || stGrades.every(g => Number(g.final || 0) >= passMark);
    if (!allPassed) return;
    const curCls = classes.find(c => c.class_id === st.class_id);
    const curStg = curCls ? stages.find(s => s.stage_id === curCls.stage_id) : null;
    if (!curStg) return;
    const nextStg = stages.find(s => Number(s.sort_order) > Number(curStg.sort_order));
    const stRow = findRow_('Students', 'student_id', st.student_id);
    if (!nextStg) {
      sheet_('Students').getRange(stRow, colIndex_('Students', 'enroll_status')).setValue('graduated');
      graduated++;
    } else {
      const tgt = classes.find(c => c.stage_id === nextStg.stage_id && c.section === curCls.section) || classes.find(c => c.stage_id === nextStg.stage_id);
      if (tgt) {
        sheet_('Students').getRange(stRow, colIndex_('Students', 'class_id')).setValue(tgt.class_id);
        const idRow = findRow_('IDs', 'id', st.student_id);
        if (idRow) sheet_('IDs').getRange(idRow, colIndex_('IDs', 'class_id')).setValue(tgt.class_id);
        promoted++;
      }
    }
  });

  const cfgRow = findRow_('Config', 'key', 'academic_year');
  if (cfgRow) sheet_('Config').getRange(cfgRow, 2).setValue(nextYear);
  clearCache_(['cfg']);
  audit_('admin', ctx.id, 'year.archive', cfg.academic_year + '->' + nextYear, 'ok');
  return { archivedGrades: grades.length, promoted: promoted, graduated: graduated, retained: students.length - promoted - graduated, academic_year: nextYear };
}

function demoPopulate_(req, ctx) {
  const cfg = config_();
  const stages = stageApplyDefaults_({ school_type: cfg.school_type }, ctx);
  const first = stages[0];
  const clsId = 'Cls-' + first.stage_id.replace('Stg-', '') + '-A';
  const clsLabel = first.name_ar + ' / شعبة أ';
  if (!findRow_('Classes', 'class_id', clsId)) {
    appendObj_('Classes', { class_id: clsId, stage_id: first.stage_id, section: 'أ', label: clsLabel, capacity: 35, status: 'active' }, false);
  }
  const subId = 'Sub-' + first.stage_id.replace('Stg-', '') + '-1';
  if (!findRow_('Subjects', 'subject_id', subId)) {
    appendObj_('Subjects', { subject_id: subId, name_ar: 'الرياضيات', stage_id: first.stage_id, weekly_periods: 5, active: 1 }, false);
  }
  const tIds = makeIdsBatch_(1, 8);
  const sIds = makeIdsBatch_(3, 16);
  const now = new Date().toISOString();
  appendObj_('IDs', { id: tIds[0], kind: 'teacher', class_id: '', status: 'registered', pin_hash: '', generated_at: now, registered_at: now, last_login: '', card_printed: 'TRUE' }, true);
  appendObj_('Teachers', { teacher_id: tIds[0], full_name: 'أ. علي حسين الجبوري', mother_name: '', gender: 'ذكر', birth_date: '1988-04-12', degree: 'بكالوريوس', specialty: 'الرياضيات', university: 'جامعة بغداد', college: 'التربية', grad_year: '2011', job_title: 'مدرس', hire_date: '2013-10-01', start_date: '2018-09-01', bio_cv: 'خبرة في تدريس الرياضيات.', subjects: 'الرياضيات', phone: '07700001122', whatsapp: '07700001122', email: '', address: 'بغداد', photo_file_id: '', status: 'active', updated_at: now }, true);
  appendObj_('Assignments', { assign_id: 'Asg-' + Utilities.getUuid().slice(0, 6), teacher_id: tIds[0], subject_id: subId, class_id: clsId, year: cfg.academic_year }, true);

  const stNames = ['أحمد محمد الكاظمي', 'فاطمة الزهراء علي', 'يوسف مصطفى الربيعي'];
  stNames.forEach((name, idx) => {
    appendObj_('IDs', { id: sIds[idx], kind: 'student', class_id: clsId, status: 'registered', pin_hash: '', generated_at: now, registered_at: now, last_login: '', card_printed: 'TRUE' }, true);
    appendObj_('Students', { student_id: sIds[idx], full_name: name, mother_name: '', gender: idx === 1 ? 'أنثى' : 'ذكر', birth_date: '2012-05-14', address: 'بغداد', guardian_name: 'ولي الأمر', guardian_phone: '07711223344', photo_file_id: '', prev_school: '', prev_stage: '', prev_average: '', reg_reason: 'جديد', failed_years: 0, dropout_years: 0, enroll_date: todayDate_(), health_note: '', class_id: clsId, enroll_status: 'official', status_note: '', notes: '', updated_at: now }, true);
    saveSingleGrade_({ student_id: sIds[idx], subject_id: subId, year: cfg.academic_year, m1: 85, m2: 88, mid_year: 86, m3: 90, m4: 92, final_exam: 90, round: 1 }, ctx, cfg);
  });

  const baghdadToday = baghdadNow_().date;
  appendObj_('Attendance', {
    att_id: 'Att-DEMO-' + Utilities.getUuid().slice(0, 4).toUpperCase(),
    teacher_id: tIds[0],
    teacher_name: 'أ. علي حسين الجبوري',
    att_date: baghdadToday,
    check_in_time: '07:55:00',
    check_out_time: '',
    method: 'fingerprint_digital',
    status: 'on_time',
    late_minutes: 0,
    device_note: 'بصمة حضور صباحية',
    created_at: now,
    updated_at: now
  }, true);

  appendObj_('Complaints', {
    complaint_id: 'Cmp-DEMO-' + Utilities.getUuid().slice(0, 4).toUpperCase(),
    student_id: sIds[0],
    student_name: stNames[0],
    class_label: clsLabel,
    category: 'بنية تحتية وخدمات',
    title: 'صيانة جهاز التبريد في القاعة',
    details: 'نرجو فحص جهاز التبريد في الشعبة قبل بدء الامتحانات الشهرية.',
    status: 'in_review',
    admin_reply: 'تم تحويل الطلب إلى لجنة الصيانة للمتابعة هذا الأسبوع.',
    created_at: now,
    updated_at: now
  }, true);

  audit_('admin', ctx.id, 'demo.populate', '3 students, 1 teacher', 'ok');
  return { studentIds: sIds, teacherIds: tIds };
}
