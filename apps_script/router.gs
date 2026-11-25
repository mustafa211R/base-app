// ===== router.gs : نقطة الدخول والموجّه (Router) =====
const SS = SpreadsheetApp.getActiveSpreadsheet();
const SESSION_TTL = 6 * 3600;
function ss_() {
  return SS || SpreadsheetApp.getActiveSpreadsheet();
}

function getRoutes_() {
  const ALL = ['guest', 'student', 'teacher', 'admin'];
  const ALL_EDU = ['guest', 'student', 'teacher', 'admin', 'education'];
  return {
    'auth.login':               { roles: ALL_EDU,              fn: authLogin_ },
    'auth.logout':              { roles: ALL_EDU,              fn: authLogout_ },
    'school.public':            { roles: ALL_EDU,              fn: schoolPublic_ },
    'student.get':              { roles: ALL_EDU,              fn: getStudent_ },
    'student.list':             { roles: ALL_EDU,              fn: listStudents_ },
    'student.register':         { roles: ['student'],          fn: registerStudent_,       write: true },
    'student.selfUpdate':       { roles: ['student'],          fn: studentSelfUpdate_,     write: true },
    'teacher.get':              { roles: ALL_EDU,              fn: getTeacher_ },
    'teacher.list':             { roles: ALL_EDU,              fn: listTeachers_ },
    'teacher.register':         { roles: ['teacher'],          fn: registerTeacher_,       write: true },
    'photo.get':                { roles: ALL_EDU,              fn: getPhoto_ },
    'grades.mine':              { roles: ['student'],          fn: gradesMine_ },
    'grades.sheet':             { roles: ['teacher', 'admin'], fn: gradesSheet_ },
    'grades.save':              { roles: ['teacher', 'admin'], fn: saveGrade_,             write: true },
    'grades.importBatch':       { roles: ['admin'],            fn: gradesImportBatch_,     write: true },
    'attendance.punch':         { roles: ['teacher'],          fn: attendancePunch_,       write: true },
    'attendance.mine':          { roles: ['teacher'],          fn: attendanceMine_ },
    'attendance.list':          { roles: ['admin', 'education'], fn: attendanceList_ },
    'attendance.markAbsence':   { roles: ['admin'],            fn: attendanceMarkAbsence_, write: true },
    'attendance.clearDay':      { roles: ['admin'],            fn: attendanceClearDay_,    write: true },
    'attendance.setLock':       { roles: ['admin'],            fn: attendanceSetLock_,     write: true },
    'leaves.list':              { roles: ['admin', 'education'], fn: leavesList_ },
    'leaves.create':            { roles: ['admin'],            fn: leavesCreate_,         write: true },
    'leaves.delete':            { roles: ['admin'],            fn: leavesDelete_,         write: true },
    'complaints.create':        { roles: ['student'],          fn: complaintsCreate_,      write: true },
    'complaints.mine':          { roles: ['student'],          fn: complaintsMine_ },
    'complaints.list':          { roles: ['admin', 'education'], fn: complaintsList_ },
    'complaints.updateStatus':  { roles: ['admin'],            fn: complaintsUpdateStatus_, write: true },
    'education.dashboard':      { roles: ['education', 'admin'], fn: educationDashboard_ },
    'admin.setup':              { roles: ALL,                  fn: adminSetup_,            write: true },
    'admin.initSchema':         { roles: ['admin'],            fn: initSchema_,            write: true },
    'admin.dashboard':          { roles: ['admin'],            fn: adminDashboard_ },
    'admin.profileGet':         { roles: ['admin'],            fn: adminProfileGet_ },
    'admin.profileSave':        { roles: ['admin'],            fn: adminProfileSave_,      write: true },
    'admin.schoolSave':         { roles: ['admin'],            fn: adminSchoolSave_,       write: true },
    'admin.stagesList':         { roles: ALL_EDU,              fn: stagesList_ },
    'admin.stageApplyDefaults': { roles: ['admin'],            fn: stageApplyDefaults_,    write: true },
    'admin.stageUpsert':        { roles: ['admin'],            fn: stageUpsert_,           write: true },
    'admin.stageDelete':        { roles: ['admin'],            fn: stageDelete_,           write: true },
    'admin.classesList':        { roles: ALL_EDU,              fn: classesList_ },
    'admin.classUpsert':        { roles: ['admin'],            fn: classUpsert_,           write: true },
    'admin.classDelete':        { roles: ['admin'],            fn: classDelete_,           write: true },
    'admin.subjectsList':       { roles: ALL_EDU,              fn: subjectsList_ },
    'admin.subjectUpsert':      { roles: ['admin'],            fn: subjectUpsert_,         write: true },
    'admin.assignmentsList':    { roles: ['admin', 'teacher'], fn: assignmentsList_ },
    'admin.assignmentUpsert':   { roles: ['admin'],            fn: assignmentUpsert_,      write: true },
    'admin.assignmentDelete':   { roles: ['admin'],            fn: assignmentDelete_,      write: true },
    'admin.studentUpsert':      { roles: ['admin'],            fn: adminStudentUpsert_,    write: true },
    'admin.studentTransfer':    { roles: ['admin'],            fn: adminStudentTransfer_,  write: true },
    'admin.studentStatus':      { roles: ['admin'],            fn: adminStudentStatus_,    write: true },
    'admin.teacherUpsert':      { roles: ['admin'],            fn: adminTeacherUpsert_,    write: true },
    'admin.announcementUpsert': { roles: ['admin'],            fn: announcementUpsert_,    write: true },
    'admin.announcementDelete': { roles: ['admin'],            fn: announcementDelete_,    write: true },
    'ids.generate':             { roles: ['admin'],            fn: idsGenerate_,           write: true },
    'ids.list':                 { roles: ['admin'],            fn: idsList_ },
    'ids.markPrinted':          { roles: ['admin'],            fn: idsMarkPrinted_,        write: true },
    'ids.replace':              { roles: ['admin'],            fn: idsReplace_,            write: true },
    'ids.disable':              { roles: ['admin'],            fn: idsDisable_,            write: true },
    'ids.prefillStudents':      { roles: ['admin'],            fn: idsPrefillStudents_,    write: true },
    'perm.list':                { roles: ['admin'],            fn: permList_ },
    'perm.save':                { roles: ['admin'],            fn: permSave_,              write: true },
    'audit.list':               { roles: ['admin'],            fn: auditList_ },
    'sheets.inspect':           { roles: ['admin'],            fn: sheetsInspect_ },
    'year.archive':             { roles: ['admin'],            fn: yearArchive_,           write: true },
    'backup.exportJson':        { roles: ['admin'],            fn: backupExportJson_ },
    'backup.restore':           { roles: ['admin'],            fn: backupRestore_,         write: true },
    'demo.populate':            { roles: ['admin'],            fn: demoPopulate_,          write: true }
  };
}

function doGet() {
  return out_({ ok: true, data: { name: 'base-api', version: 1 } });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (_) {
    return out_({ ok: false, error: 'BAD_JSON' });
  }
  try {
    ensureSchemaIfNeeded_();
    const routes = getRoutes_();
    const route = routes[req.action];
    if (!route) return out_({ ok: false, error: 'UNKNOWN_ACTION' });
    const ctx = getContext_(req.token);
    if (route.roles.indexOf(ctx.role) < 0) return out_({ ok: false, error: 'FORBIDDEN' });
    const data = route.write ? withLock_(function() { return route.fn(req, ctx); }) : route.fn(req, ctx);
    return out_({ ok: true, data: data });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'SERVER_ERROR';
    const code = /^[A-Z_]+$/.test(msg) ? msg : 'SERVER_ERROR';
    if (code === 'SERVER_ERROR') {
      try { audit_('system', '-', req && req.action, '-', 'fail', String(err)); } catch (_) {}
    }
    return out_({ ok: false, error: code });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function audit_(role, actor, action, target, result, detail) {
  const sh = ss_().getSheetByName('Audit_Log');
  if (!sh) return;
  sh.appendRow([new Date().toISOString(), role, actor, action, target, result, detail || '']);
}
