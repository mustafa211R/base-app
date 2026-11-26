// ===== grades.gs : الدرجات والحساب التلقائي =====
function computeGrade_(g, cfg) {
  const numOrEmpty = v => (v === '' || v === null || v === undefined) ? '' : Number(v);
  const m1 = numOrEmpty(g.m1);
  const m2 = numOrEmpty(g.m2);
  const mid = numOrEmpty(g.mid_year);
  const m3 = numOrEmpty(g.m3);
  const m4 = numOrEmpty(g.m4);
  const finExam = numOrEmpty(g.final_exam);

  const avg_t1 = (m1 === '' || m2 === '') ? '' : Math.round((m1 + m2) / 2);
  const avg_t2 = (m3 === '' || m4 === '') ? '' : Math.round((m3 + m4) / 2);

  let annual_effort = '';
  if (cfg.annual_effort_formula === 'terms_only') {
    if (avg_t1 !== '' && avg_t2 !== '') annual_effort = Math.round((avg_t1 + avg_t2) / 2);
  } else if (cfg.annual_effort_formula === 'weighted_40_20_40') {
    if (avg_t1 !== '' && mid !== '' && avg_t2 !== '') annual_effort = Math.round(avg_t1 * 0.4 + mid * 0.2 + avg_t2 * 0.4);
  } else {
    if (avg_t1 !== '' && mid !== '' && avg_t2 !== '') annual_effort = Math.round((avg_t1 + mid + avg_t2) / 3);
  }

  let final = '';
  if (annual_effort !== '' && finExam !== '') {
    if (cfg.final_score_formula === 'weighted_40_60') {
      final = Math.round(annual_effort * 0.4 + finExam * 0.6);
    } else {
      final = Math.round((annual_effort + finExam) / 2);
    }
  }
  return { avg_t1, avg_t2, annual_effort, final };
}

function teacherTeaches_(teacherId, studentId, subjectId) {
  const st = readAll_('Students').find(s => String(s.student_id) === String(studentId));
  if (!st) return false;
  return readAll_('Assignments').some(a =>
    String(a.teacher_id) === String(teacherId) && String(a.class_id) === String(st.class_id) && String(a.subject_id) === String(subjectId)
  );
}

function saveSingleGrade_(g, ctx, cfg) {
  const studentId = String(g.student_id || '').replace(/\D/g, '');
  const subjectId = String(g.subject_id || '');
  const year = String(g.year || cfg.academic_year);
  if (!studentId || !subjectId) throw new Error('MISSING_FIELD');
  if (ctx.role === 'teacher' && !teacherTeaches_(ctx.id, studentId, subjectId)) {
    throw new Error('FORBIDDEN');
  }

  const parsed = {};
  ['m1', 'm2', 'mid_year', 'm3', 'm4', 'final_exam'].forEach(k => {
    if (g[k] === '' || g[k] === null || g[k] === undefined) { parsed[k] = ''; return; }
    const n = Number(g[k]);
    if (!isFinite(n) || n < 0 || n > 100) throw new Error('INVALID_GRADE');
    parsed[k] = n;
  });

  const calc = computeGrade_(parsed, cfg);
  const gradeKey = [studentId, subjectId, year].join('|');
  const rec = {
    grade_key: gradeKey,
    student_id: studentId,
    subject_id: subjectId,
    year: year,
    m1: parsed.m1,
    m2: parsed.m2,
    avg_t1: calc.avg_t1,
    mid_year: parsed.mid_year,
    m3: parsed.m3,
    m4: parsed.m4,
    avg_t2: calc.avg_t2,
    annual_effort: calc.annual_effort,
    final_exam: parsed.final_exam,
    final: calc.final,
    round: Number(g.round || 1),
    entered_by: ctx.id || ctx.role,
    updated_at: new Date().toISOString()
  };

  const row = findRow_('Grades', 'grade_key', gradeKey);
  if (row) updateRowObj_('Grades', row, rec, false);
  else appendObj_('Grades', rec, false);

  return Object.assign({ grade_key: gradeKey }, calc);
}

function saveGrade_(req, ctx) {
  const cfg = config_();
  const res = saveSingleGrade_(req.grade || req, ctx, cfg);
  audit_(ctx.role, ctx.id, 'grades.save', res.grade_key, 'ok');
  return res;
}

function gradesImportBatch_(req, ctx) {
  const cfg = config_();
  const rows = req.rows || [];
  let saved = 0;
  rows.forEach(r => {
    saveSingleGrade_(Object.assign({}, r, { subject_id: req.subject_id, year: req.year || cfg.academic_year }), ctx, cfg);
    saved++;
  });
  audit_('admin', ctx.id, 'grades.importBatch', req.subject_id + ':' + saved, 'ok');
  return { saved: saved };
}

function gradesMine_(req, ctx) {
  const cfg = config_();
  const year = cfg.academic_year;
  const student = readAll_('Students').find(s => String(s.student_id) === ctx.id);
  if (!student) throw new Error('NOT_FOUND');
  const cls = readAll_('Classes').find(c => c.class_id === student.class_id) || {};
  const stg = readAll_('Stages').find(s => s.stage_id === cls.stage_id) || {};
  const subs = readAll_('Subjects').filter(s => s.stage_id === cls.stage_id && Number(s.active) === 1);
  const existing = readAll_('Grades').filter(g => String(g.student_id) === ctx.id && String(g.year) === year);

  const rows = subs.map(sub => {
    const g = existing.find(x => x.subject_id === sub.subject_id) || {};
    return {
      subject_id: sub.subject_id,
      subject_name: sub.name_ar,
      year: year,
      m1: g.m1 !== undefined ? g.m1 : '',
      m2: g.m2 !== undefined ? g.m2 : '',
      avg_t1: g.avg_t1 !== undefined ? g.avg_t1 : '',
      mid_year: g.mid_year !== undefined ? g.mid_year : '',
      m3: g.m3 !== undefined ? g.m3 : '',
      m4: g.m4 !== undefined ? g.m4 : '',
      avg_t2: g.avg_t2 !== undefined ? g.avg_t2 : '',
      annual_effort: g.annual_effort !== undefined ? g.annual_effort : '',
      final_exam: g.final_exam !== undefined ? g.final_exam : '',
      final: g.final !== undefined ? g.final : '',
      round: g.round || 1
    };
  });

  return {
    student: {
      student_id: student.student_id,
      full_name: student.full_name,
      class_id: student.class_id,
      class_label: cls.label || '',
      stage_id: cls.stage_id || '',
      stage_name: stg.name_ar || ''
    },
    pass_mark: Number(cfg.pass_mark || 50),
    academic_year: year,
    rows: rows
  };
}

function gradesSheet_(req, ctx) {
  const cfg = config_();
  const classId = String(req.class_id || '');
  const subjectId = String(req.subject_id || '');
  const year = String(req.year || cfg.academic_year);
  if (!classId || !subjectId) throw new Error('MISSING_FIELD');

  if (ctx.role === 'teacher') {
    const ok = readAll_('Assignments').some(a =>
      String(a.teacher_id) === ctx.id && a.class_id === classId && a.subject_id === subjectId && String(a.year) === year
    );
    if (!ok) throw new Error('FORBIDDEN');
  }

  const students = readAll_('Students').filter(s => s.class_id === classId && isEnrollAllowed_(s.enroll_status));
  const grades = readAll_('Grades').filter(g => g.subject_id === subjectId && String(g.year) === year);

  return students.map(st => {
    const g = grades.find(x => String(x.student_id) === String(st.student_id)) || {};
    return {
      student_id: st.student_id,
      full_name: st.full_name,
      subject_id: subjectId,
      year: year,
      m1: g.m1 !== undefined ? g.m1 : '',
      m2: g.m2 !== undefined ? g.m2 : '',
      avg_t1: g.avg_t1 !== undefined ? g.avg_t1 : '',
      mid_year: g.mid_year !== undefined ? g.mid_year : '',
      m3: g.m3 !== undefined ? g.m3 : '',
      m4: g.m4 !== undefined ? g.m4 : '',
      avg_t2: g.avg_t2 !== undefined ? g.avg_t2 : '',
      annual_effort: g.annual_effort !== undefined ? g.annual_effort : '',
      final_exam: g.final_exam !== undefined ? g.final_exam : '',
      final: g.final !== undefined ? g.final : '',
      round: g.round || 1,
      entered_by: g.entered_by || '',
      updated_at: g.updated_at || ''
    };
  });
}
