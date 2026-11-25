import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { db, initSchema, PHOTOS_DIR } from './db.ts';
import { luhnCheckDigit, luhnValid, normalizeIdDigits } from '../shared/luhn.ts';
import { parseHHMM } from '../shared/timeFormat.ts';
import { isEnrollStatusLoginAllowed, LOGIN_ALLOWED_ENROLL_STATUSES } from '../shared/types.ts';
import type {
  Role,
  SchoolConfig,
  GradeRow,
  PublicSchoolData,
  AnnouncementRow,
  StudentRow,
  TeacherRow,
  PermissionRow,
  AttendanceRow,
  AttendanceSchedule,
  ComplaintRow,
  ComplaintStatus,
  EducationDashboardData,
  TeacherAttendanceMineResponse,
} from '../shared/types.ts';

const SESSION_TTL_MS = 6 * 3600 * 1000; // 6 hours matching CacheService 21600s
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

interface SessionCtx {
  role: Role;
  id: string;
  registered: boolean;
  expiresAt: number;
}

interface LoginAttempt {
  count: number;
  lockedUntil: number;
}

const ALLOWED_STATUS_SQL = LOGIN_ALLOWED_ENROLL_STATUSES.map((s) => `'${s}'`).join(', ');

// هل للهوية ملف شخصي مسجّل (طالب أو مدرس)؟ هذا هو المرجع لمعرفة أن الهوية "مسجّلة"
function idHasProfile(id: string, kind: string): boolean {
  const sql =
    kind === 'student'
      ? 'SELECT 1 AS x FROM Students WHERE student_id = ? LIMIT 1'
      : 'SELECT 1 AS x FROM Teachers WHERE teacher_id = ? LIMIT 1';
  return !!db.prepare(sql).get(id);
}

// مزامنة كل الهويات مع حالات القيد عند تشغيل الخادم (يصلح الهويات المعطّلة خطأً لطلاب حالتهم مسموحة)
export function syncAllStudentIds() {
  const rows = db.prepare('SELECT student_id FROM Students').all() as Array<{ student_id: string }>;
  for (const r of rows) syncStudentIdWithEnrollStatus(r.student_id);
}

// مزامنة الهوية مع حالة القيد: مفصول/منقول/متخرج => الهوية معطّلة، وغير ذلك => تعمل وتبقى مسجّلة
function syncStudentIdWithEnrollStatus(studentId: string) {
  const st = db.prepare('SELECT enroll_status, class_id FROM Students WHERE student_id = ?').get(studentId) as
    | { enroll_status: string; class_id: string }
    | undefined;
  if (!st) return;
  if (isEnrollStatusLoginAllowed(st.enroll_status)) {
    db.prepare("UPDATE IDs SET status = 'registered', class_id = ? WHERE id = ? AND kind = 'student'").run(st.class_id, studentId);
  } else {
    db.prepare("UPDATE IDs SET status = 'disabled' WHERE id = ? AND kind = 'student'").run(studentId);
    // إنهاء الجلسات المفتوحة لهذا الطالب فوراً
    for (const [tok, sess] of sessions.entries()) {
      if (sess.role === 'student' && sess.id === studentId) sessions.delete(tok);
    }
  }
}

const sessions = new Map<string, SessionCtx>();
const loginAttempts = new Map<string, LoginAttempt>();

export class ApiError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  constructor(code: string, meta?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.meta = meta;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function baghdadNow(): { date: string; time: string; minutes: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hourNum = Number(parts.hour === '24' ? '00' : parts.hour);
  const minNum = Number(parts.minute);
  const hh = String(hourNum).padStart(2, '0');
  const mm = String(minNum).padStart(2, '0');
  const ss = String(parts.second || '00').padStart(2, '0');
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hh}:${mm}:${ss}`,
    minutes: hourNum * 60 + minNum,
  };
}

function parseTimeMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new ApiError('INVALID_TIME_FORMAT');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new ApiError('INVALID_TIME_FORMAT');
  return h * 60 + min;
}

function safeEqualText(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getScheduleFromConfig(cfg: SchoolConfig): AttendanceSchedule {
  return {
    attendance_start_time: parseHHMM(cfg.attendance_start_time) ?? '08:00',
    attendance_end_time: parseHHMM(cfg.attendance_end_time) ?? '13:30',
    attendance_grace_minutes: Math.max(0, Math.min(180, Number(cfg.attendance_grace_minutes || 15))),
    attendance_workdays: cfg.attendance_workdays || '0,1,2,3,4',
  };
}

function hashSecret(secret: string, salt?: string): { salt: string; hash: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, s, 64).toString('hex');
  return { salt: s, hash: derived };
}

function verifySecret(secret: string, salt: string, storedHash: string): boolean {
  if (!salt || !storedHash) return false;
  const derived = crypto.scryptSync(secret, salt, 64);
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function hashPin(pin: string): string {
  const { salt, hash } = hashSecret(pin);
  return `${salt}:${hash}`;
}

function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  return verifySecret(pin, parts[0], parts[1]);
}

function audit(
  role: string,
  actorId: string,
  action: string,
  target: string,
  result: 'ok' | 'fail',
  detail = ''
): void {
  db.prepare(
    `INSERT INTO Audit_Log (timestamp, role, actor_id, action, target, result, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nowIso(), role, actorId, action, target, result, detail);
}

export function getConfigMap(): SchoolConfig {
  const rows = db.prepare('SELECT key, value FROM Config').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map as unknown as SchoolConfig;
}

function validateMapUrl(url: string): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('https://maps.') ||
    trimmed.startsWith('https://goo.gl/maps') ||
    trimmed.startsWith('https://www.google.com/maps') ||
    trimmed.startsWith('https://maps.app.goo.gl')
  );
}

function savePhotoFromDataUrl(dataUrl: string): string {
  if (!dataUrl) return '';
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new ApiError('INVALID_PHOTO_FORMAT');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new ApiError('PHOTO_TOO_LARGE');
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const resolved = path.resolve(PHOTOS_DIR, fileName);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
    throw new ApiError('FORBIDDEN');
  }
  fs.writeFileSync(resolved, buf);
  return fileName;
}

function readPhotoAsDataUrl(fileId: string): string {
  if (!fileId) return '';
  if (!/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(fileId)) return '';
  const resolved = path.resolve(PHOTOS_DIR, fileId);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep) || !fs.existsSync(resolved)) return '';
  const ext = path.extname(fileId).slice(1);
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const b64 = fs.readFileSync(resolved).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export function getContext(token?: string | null): { role: Role; id: string | null } {
  if (!token) return { role: 'guest', id: null };
  const sess = sessions.get(token);
  if (!sess || Date.now() > sess.expiresAt) {
    if (sess) sessions.delete(token);
    throw new ApiError('SESSION_EXPIRED');
  }
  return { role: sess.role, id: sess.id };
}

function relation(ctx: { role: Role; id: string | null }, targetId: string): 'admin' | 'self' | 'teacher' | 'student' | 'guest' {
  if (ctx.role === 'admin' || ctx.role === 'education') return 'admin';
  if (ctx.role !== 'guest' && ctx.id === targetId) return 'self';
  return ctx.role;
}

function allowedFields(entity: 'student' | 'teacher', rel: 'admin' | 'self' | 'teacher' | 'student' | 'guest'): string[] {
  const rows = db
    .prepare('SELECT field, admin, self, teacher, student, guest FROM Permissions WHERE entity = ?')
    .all(entity) as unknown as Array<PermissionRow>;
  return rows.filter((r) => Number(r[rel]) === 1).map((r) => r.field);
}

function pick<T extends Record<string, unknown>>(rec: T, fields: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in rec) out[f] = rec[f];
  }
  return out as Partial<T>;
}

function teacherHasClass(teacherId: string, classId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM Assignments WHERE teacher_id = ? AND class_id = ? LIMIT 1')
    .get(teacherId, classId);
  return Boolean(row);
}

function teacherTeaches(teacherId: string, studentId: string, subjectId: string): boolean {
  const st = db.prepare('SELECT class_id FROM Students WHERE student_id = ?').get(studentId) as { class_id: string } | undefined;
  if (!st) return false;
  const assign = db
    .prepare('SELECT 1 FROM Assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ? LIMIT 1')
    .get(teacherId, st.class_id, subjectId);
  return Boolean(assign);
}

function computeGradeFields(
  g: Partial<GradeRow>,
  cfg: SchoolConfig
): { avg_t1: number | ''; avg_t2: number | ''; annual_effort: number | ''; final: number | '' } {
  const numOrEmpty = (v: unknown): number | '' => (v === '' || v === null || v === undefined ? '' : Number(v));
  const m1 = numOrEmpty(g.m1);
  const m2 = numOrEmpty(g.m2);
  const mid = numOrEmpty(g.mid_year);
  const m3 = numOrEmpty(g.m3);
  const m4 = numOrEmpty(g.m4);
  const finExam = numOrEmpty(g.final_exam);

  const avg_t1 = m1 !== '' && m2 !== '' ? Math.round((m1 + m2) / 2) : '';
  const avg_t2 = m3 !== '' && m4 !== '' ? Math.round((m3 + m4) / 2) : '';

  let annual_effort: number | '' = '';
  if (cfg.annual_effort_formula === 'terms_only') {
    if (avg_t1 !== '' && avg_t2 !== '') annual_effort = Math.round((avg_t1 + avg_t2) / 2);
  } else if (cfg.annual_effort_formula === 'weighted_40_20_40') {
    if (avg_t1 !== '' && mid !== '' && avg_t2 !== '') {
      annual_effort = Math.round(avg_t1 * 0.4 + mid * 0.2 + avg_t2 * 0.4);
    }
  } else {
    // iraqi_avg default: average of term1, mid_year, term2
    if (avg_t1 !== '' && mid !== '' && avg_t2 !== '') {
      annual_effort = Math.round((avg_t1 + mid + avg_t2) / 3);
    }
  }

  let final: number | '' = '';
  if (annual_effort !== '' && finExam !== '') {
    if (cfg.final_score_formula === 'weighted_40_60') {
      final = Math.round(annual_effort * 0.4 + finExam * 0.6);
    } else {
      final = Math.round((annual_effort + finExam) / 2);
    }
  }

  return { avg_t1, avg_t2, annual_effort, final };
}

function generateLuhnIds(count: number, length: number, existingSet: Set<string>): string[] {
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard++;
    let body = '';
    for (let i = 0; i < length - 1; i++) {
      body += String(crypto.randomInt(0, 10));
    }
    const full = body + luhnCheckDigit(body);
    if (!existingSet.has(full)) {
      existingSet.add(full);
      out.push(full);
    }
  }
  return out;
}

const DEFAULT_STAGES_BY_TYPE: Record<string, Array<{ stage_id: string; name_ar: string; level_type: string; sort_order: number; track: string }>> = {
  primary: [
    { stage_id: 'Stg-P1', name_ar: 'الأول الابتدائي', level_type: 'primary', sort_order: 1, track: '' },
    { stage_id: 'Stg-P2', name_ar: 'الثاني الابتدائي', level_type: 'primary', sort_order: 2, track: '' },
    { stage_id: 'Stg-P3', name_ar: 'الثالث الابتدائي', level_type: 'primary', sort_order: 3, track: '' },
    { stage_id: 'Stg-P4', name_ar: 'الرابع الابتدائي', level_type: 'primary', sort_order: 4, track: '' },
    { stage_id: 'Stg-P5', name_ar: 'الخامس الابتدائي', level_type: 'primary', sort_order: 5, track: '' },
    { stage_id: 'Stg-P6', name_ar: 'السادس الابتدائي', level_type: 'primary', sort_order: 6, track: '' },
  ],
  middle: [
    { stage_id: 'Stg-M1', name_ar: 'الأول المتوسط', level_type: 'middle', sort_order: 1, track: '' },
    { stage_id: 'Stg-M2', name_ar: 'الثاني المتوسط', level_type: 'middle', sort_order: 2, track: '' },
    { stage_id: 'Stg-M3', name_ar: 'الثالث المتوسط', level_type: 'middle', sort_order: 3, track: '' },
  ],
  prep: [
    { stage_id: 'Stg-Pr4S', name_ar: 'الرابع الإعدادي (علمي)', level_type: 'prep', sort_order: 1, track: 'علمي' },
    { stage_id: 'Stg-Pr4L', name_ar: 'الرابع الإعدادي (أدبي)', level_type: 'prep', sort_order: 2, track: 'أدبي' },
    { stage_id: 'Stg-Pr5S', name_ar: 'الخامس الإعدادي (علمي)', level_type: 'prep', sort_order: 3, track: 'علمي' },
    { stage_id: 'Stg-Pr5L', name_ar: 'الخامس الإعدادي (أدبي)', level_type: 'prep', sort_order: 4, track: 'أدبي' },
    { stage_id: 'Stg-Pr6S', name_ar: 'السادس الإعدادي (علمي)', level_type: 'prep', sort_order: 5, track: 'علمي' },
    { stage_id: 'Stg-Pr6L', name_ar: 'السادس الإعدادي (أدبي)', level_type: 'prep', sort_order: 6, track: 'أدبي' },
  ],
  secondary: [
    { stage_id: 'Stg-M1', name_ar: 'الأول المتوسط', level_type: 'middle', sort_order: 1, track: '' },
    { stage_id: 'Stg-M2', name_ar: 'الثاني المتوسط', level_type: 'middle', sort_order: 2, track: '' },
    { stage_id: 'Stg-M3', name_ar: 'الثالث المتوسط', level_type: 'middle', sort_order: 3, track: '' },
    { stage_id: 'Stg-Pr4S', name_ar: 'الرابع الإعدادي (علمي)', level_type: 'prep', sort_order: 4, track: 'علمي' },
    { stage_id: 'Stg-Pr5S', name_ar: 'الخامس الإعدادي (علمي)', level_type: 'prep', sort_order: 5, track: 'علمي' },
    { stage_id: 'Stg-Pr6S', name_ar: 'السادس الإعدادي (علمي)', level_type: 'prep', sort_order: 6, track: 'علمي' },
  ],
  vocational: [
    { stage_id: 'Stg-V1', name_ar: 'الأول المهني (صناعي)', level_type: 'vocational', sort_order: 1, track: 'صناعي' },
    { stage_id: 'Stg-V2', name_ar: 'الثاني المهني (صناعي)', level_type: 'vocational', sort_order: 2, track: 'صناعي' },
    { stage_id: 'Stg-V3', name_ar: 'الثالث المهني (صناعي)', level_type: 'vocational', sort_order: 3, track: 'صناعي' },
  ],
};

function requireFields(obj: Record<string, unknown>, keys: string[]): void {
  for (const k of keys) {
    if (obj[k] === undefined || obj[k] === null || String(obj[k]).trim() === '') {
      throw new ApiError('MISSING_FIELD', { field: k });
    }
  }
}

function getAdminCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM Admin').get() as { c: number };
  return row.c;
}

// =========================================================================
// API ACTIONS
// =========================================================================

export function handleBaseAction(action: string, req: Record<string, unknown>, token?: string | null): unknown {
  const ALL: Role[] = ['guest', 'student', 'teacher', 'admin'];
  const ALL_WITH_EDU: Role[] = ['guest', 'student', 'teacher', 'admin', 'education'];
  const routeRoles: Record<string, Role[]> = {
    'auth.login': ALL_WITH_EDU,
    'auth.logout': ALL_WITH_EDU,
    'school.public': ALL_WITH_EDU,
    'student.get': ALL_WITH_EDU,
    'student.list': ALL_WITH_EDU,
    'student.register': ['student'],
    'student.selfUpdate': ['student'],
    'teacher.get': ALL_WITH_EDU,
    'teacher.list': ALL_WITH_EDU,
    'teacher.register': ['teacher'],
    'photo.get': ALL_WITH_EDU,
    'grades.mine': ['student'],
    'grades.sheet': ['teacher', 'admin'],
    'grades.save': ['teacher', 'admin'],
    'admin.setup': ALL,
    'admin.initSchema': ['admin'],
    'admin.dashboard': ['admin'],
    'admin.profileGet': ['admin'],
    'admin.profileSave': ['admin'],
    'admin.schoolSave': ['admin'],
    'admin.stagesList': ALL_WITH_EDU,
    'admin.stageUpsert': ['admin'],
    'admin.stageApplyDefaults': ['admin'],
    'admin.stageDelete': ['admin'],
    'admin.classesList': ALL_WITH_EDU,
    'admin.classUpsert': ['admin'],
    'admin.classDelete': ['admin'],
    'admin.subjectsList': ALL_WITH_EDU,
    'admin.subjectUpsert': ['admin'],
    'admin.assignmentsList': ['admin', 'teacher'],
    'admin.assignmentUpsert': ['admin'],
    'admin.assignmentDelete': ['admin'],
    'admin.studentUpsert': ['admin'],
    'admin.studentTransfer': ['admin'],
    'admin.studentStatus': ['admin'],
    'admin.teacherUpsert': ['admin'],
    'admin.announcementUpsert': ['admin'],
    'admin.announcementDelete': ['admin'],
    'ids.generate': ['admin'],
    'ids.list': ['admin'],
    'ids.markPrinted': ['admin'],
    'ids.replace': ['admin'],
    'ids.disable': ['admin'],
    'ids.prefillStudents': ['admin'],
    'grades.importBatch': ['admin'],
    'perm.list': ['admin'],
    'perm.save': ['admin'],
    'audit.list': ['admin'],
    'sheets.inspect': ['admin'],
    'year.archive': ['admin'],
    'backup.exportJson': ['admin'],
    'backup.restore': ['admin'],
    'demo.populate': ['admin'],
    // New features: Attendance, Absence/Leave & Lock, Complaints, Education Directorate Supervision
    'attendance.punch': ['teacher'],
    'attendance.mine': ['teacher'],
    'attendance.list': ['admin', 'education'],
    'attendance.markAbsence': ['admin'],
    'attendance.clearDay': ['admin'],
    'attendance.setLock': ['admin'],
    'leaves.list': ['admin', 'education'],
    'leaves.create': ['admin'],
    'leaves.delete': ['admin'],
    'complaints.create': ['student'],
    'complaints.mine': ['student'],
    'complaints.list': ['admin', 'education'],
    'complaints.updateStatus': ['admin'],
    'education.dashboard': ['education', 'admin'],
  };

  const allowed = routeRoles[action];
  if (!allowed) throw new ApiError('UNKNOWN_ACTION');

  const ctx = action === 'auth.login' || action === 'admin.setup' || action === 'school.public'
    ? (token ? (() => { try { return getContext(token); } catch { return { role: 'guest' as Role, id: null }; } })() : { role: 'guest' as Role, id: null })
    : getContext(token);

  if (!allowed.includes(ctx.role)) throw new ApiError('FORBIDDEN');

  switch (action) {
    case 'school.public':
      return actionSchoolPublic();
    case 'auth.login':
      return actionAuthLogin(req);
    case 'auth.logout':
      return actionAuthLogout(token);
    case 'admin.setup':
      return actionAdminSetup(req);
    case 'admin.initSchema':
      initSchema();
      audit(ctx.role, ctx.id || 'admin', 'admin.initSchema', '-', 'ok');
      return { initialized: true, sheets: 16 };
    case 'admin.dashboard':
      return actionAdminDashboard();
    case 'admin.profileGet':
      return actionAdminProfileGet();
    case 'admin.profileSave':
      return actionAdminProfileSave(req, ctx.id || 'admin');
    case 'admin.schoolSave':
      return actionAdminSchoolSave(req, ctx.id || 'admin');
    case 'admin.stagesList':
      return db.prepare('SELECT * FROM Stages ORDER BY sort_order ASC').all();
    case 'admin.stageApplyDefaults':
      return actionApplyDefaultStages(String(req.school_type || getConfigMap().school_type || 'middle'), ctx.id || 'admin');
    case 'admin.stageUpsert':
      return actionStageUpsert(req, ctx.id || 'admin');
    case 'admin.stageDelete':
      return actionStageDelete(String(req.stage_id || ''), ctx.id || 'admin');
    case 'admin.classesList':
      return db
        .prepare(
          `SELECT c.*, s.name_ar AS stage_name, s.level_type, s.track,
             (SELECT COUNT(*) FROM Students st WHERE st.class_id = c.class_id) AS students_count
           FROM Classes c
           LEFT JOIN Stages s ON s.stage_id = c.stage_id
           ORDER BY s.sort_order ASC, c.section ASC`
        )
        .all();
    case 'admin.classUpsert':
      return actionClassUpsert(req, ctx.id || 'admin');
    case 'admin.classDelete':
      return actionClassDelete(String(req.class_id || ''), ctx.id || 'admin');
    case 'admin.subjectsList':
      return db
        .prepare(
          `SELECT sub.*, s.name_ar AS stage_name
           FROM Subjects sub
           LEFT JOIN Stages s ON s.stage_id = sub.stage_id
           ORDER BY s.sort_order ASC, sub.name_ar ASC`
        )
        .all();
    case 'admin.subjectUpsert':
      return actionSubjectUpsert(req, ctx.id || 'admin');
    case 'admin.assignmentsList':
      return actionAssignmentsList(ctx);
    case 'admin.assignmentUpsert':
      return actionAssignmentUpsert(req, ctx.id || 'admin');
    case 'admin.assignmentDelete':
      db.prepare('DELETE FROM Assignments WHERE assign_id = ?').run(String(req.assign_id || ''));
      audit('admin', ctx.id || 'admin', 'admin.assignmentDelete', String(req.assign_id || ''), 'ok');
      return true;
    case 'ids.generate':
      return actionIdsGenerate(req, ctx.id || 'admin');
    case 'ids.list':
      return actionIdsList(req);
    case 'ids.markPrinted':
      return actionIdsMarkPrinted(req, ctx.id || 'admin');
    case 'ids.replace':
      return actionIdsReplace(req, ctx.id || 'admin');
    case 'ids.disable':
      return actionIdsDisable(req, ctx.id || 'admin');
    case 'ids.prefillStudents':
      return actionPrefillStudents(req, ctx.id || 'admin');
    case 'student.register':
      return actionStudentRegister(req, ctx);
    case 'student.selfUpdate':
      return actionStudentSelfUpdate(req, ctx);
    case 'student.get':
      return actionStudentGet(req, ctx);
    case 'student.list':
      return actionStudentList(req, ctx);
    case 'admin.studentUpsert':
      return actionAdminStudentUpsert(req, ctx.id || 'admin');
    case 'admin.studentTransfer':
      return actionAdminStudentTransfer(req, ctx.id || 'admin');
    case 'admin.studentStatus':
      return actionAdminStudentStatus(req, ctx.id || 'admin');
    case 'teacher.register':
      return actionTeacherRegister(req, ctx);
    case 'teacher.get':
      return actionTeacherGet(req, ctx);
    case 'teacher.list':
      return actionTeacherList(ctx);
    case 'admin.teacherUpsert':
      return actionAdminTeacherUpsert(req, ctx.id || 'admin');
    case 'photo.get':
      return actionPhotoGet(req, ctx);
    case 'grades.mine':
      return actionGradesMine(ctx);
    case 'grades.sheet':
      return actionGradesSheet(req, ctx);
    case 'grades.save':
      return actionGradesSave(req, ctx);
    case 'grades.importBatch':
      return actionGradesImportBatch(req, ctx.id || 'admin');
    case 'admin.announcementUpsert':
      return actionAnnouncementUpsert(req, ctx.id || 'admin');
    case 'admin.announcementDelete':
      db.prepare('DELETE FROM Announcements WHERE ann_id = ?').run(String(req.ann_id || ''));
      audit('admin', ctx.id || 'admin', 'admin.announcementDelete', String(req.ann_id || ''), 'ok');
      return true;
    case 'perm.list':
      return db.prepare('SELECT * FROM Permissions ORDER BY entity ASC, id ASC').all();
    case 'perm.save':
      return actionPermSave(req, ctx.id || 'admin');
    case 'audit.list':
      return db.prepare('SELECT * FROM Audit_Log ORDER BY log_id DESC LIMIT 300').all();
    case 'sheets.inspect':
      return actionSheetsInspect(String(req.sheet || 'Config'));
    case 'year.archive':
      return actionYearArchive(req, ctx.id || 'admin');
    case 'backup.exportJson':
      return actionBackupExportJson();
    case 'backup.restore':
      return actionBackupRestore(req, ctx.id || 'admin');
    case 'demo.populate':
      return actionDemoPopulate(ctx.id || 'admin');
    case 'attendance.punch':
      return actionAttendancePunch(req, ctx);
    case 'attendance.mine':
      return actionAttendanceMine(ctx);
    case 'attendance.list':
      return actionAttendanceList(req);
    case 'attendance.markAbsence':
      return actionAttendanceMarkAbsence(req, ctx.id || 'admin');
    case 'attendance.clearDay':
      return actionAttendanceClearDay(req, ctx.id || 'admin');
    case 'attendance.setLock':
      return actionAttendanceSetLock(req, ctx.id || 'admin');
    case 'leaves.list':
      return actionLeavesList(req);
    case 'leaves.create':
      return actionLeavesCreate(req, ctx.id || 'admin');
    case 'leaves.delete':
      return actionLeavesDelete(req, ctx.id || 'admin');
    case 'complaints.create':
      return actionComplaintsCreate(req, ctx);
    case 'complaints.mine':
      return actionComplaintsMine(ctx);
    case 'complaints.list':
      return actionComplaintsList(req);
    case 'complaints.updateStatus':
      return actionComplaintsUpdateStatus(req, ctx.id || 'admin');
    case 'education.dashboard':
      return actionEducationDashboard();
    default:
      throw new ApiError('UNKNOWN_ACTION');
  }
}

function actionSchoolPublic(): PublicSchoolData {
  const cfg = getConfigMap();
  const adminRow = db.prepare('SELECT full_name FROM Admin LIMIT 1').get() as { full_name: string } | undefined;
  const announcements = db
    .prepare('SELECT * FROM Announcements WHERE active = 1 ORDER BY publish_date DESC LIMIT 20')
    .all() as unknown as AnnouncementRow[];
  const studentsCount = (db.prepare('SELECT COUNT(*) AS c FROM Students').get() as { c: number }).c;
  const teachersCount = (db.prepare('SELECT COUNT(*) AS c FROM Teachers').get() as { c: number }).c;
  const classesCount = (db.prepare('SELECT COUNT(*) AS c FROM Classes').get() as { c: number }).c;
  const unusedIdsCount = (db.prepare("SELECT COUNT(*) AS c FROM IDs WHERE status = 'unused'").get() as { c: number }).c;

  const setupKeyRequired = Boolean(process.env.SETUP_KEY && process.env.SETUP_KEY.trim() !== '');
  const schedule = getScheduleFromConfig(cfg);

  return {
    initialized: Boolean(adminRow),
    setupKeyRequired,
    educationEnabled: Boolean(cfg.education_access_code && cfg.education_access_code.trim() !== ''),
    school_name: cfg.school_name || 'نظام base المدرسي',
    founded_date: cfg.founded_date || '',
    school_type: cfg.school_type || 'middle',
    shift_type: cfg.shift_type || 'morning',
    map_url: cfg.map_url || '',
    about: cfg.about || '',
    logo_file_id: cfg.logo_file_id ? readPhotoAsDataUrl(cfg.logo_file_id) : '',
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
    admin_name: adminRow ? adminRow.full_name : '',
    announcements,
    stats: {
      students_count: studentsCount,
      teachers_count: teachersCount,
      classes_count: classesCount,
      unused_ids_count: unusedIdsCount,
    },
  };
}

function actionAuthLogin(req: Record<string, unknown>) {
  const role = String(req.role || '');
  if (!['admin', 'student', 'teacher', 'education'].includes(role)) {
    throw new ApiError('INVALID_CREDENTIALS');
  }
  const identifier =
    role === 'admin'
      ? String(req.username || '').trim()
      : role === 'education'
        ? 'education'
        : normalizeIdDigits(String(req.id || ''));
  const attemptKey = `${role}:${identifier}`;
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.lockedUntil > Date.now()) {
    const retryAfterSec = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    throw new ApiError('TOO_MANY_ATTEMPTS', { retryAfterSec });
  }

  let authResult: { role: Role; id: string; registered: boolean } | null = null;

  if (role === 'admin') {
    const username = String(req.username || '').trim();
    const password = String(req.password || '');
    const adm = db.prepare('SELECT username, salt, pass_hash FROM Admin WHERE username = ?').get(username) as
      | { username: string; salt: string; pass_hash: string }
      | undefined;
    if (adm && verifySecret(password, adm.salt, adm.pass_hash)) {
      authResult = { role: 'admin', id: 'admin', registered: true };
    }
  } else if (role === 'education') {
    const cfg = getConfigMap();
    const storedCode = String(cfg.education_access_code || '').trim();
    if (!storedCode) {
      throw new ApiError('EDUCATION_DISABLED');
    }
    const inputCode = String(req.access_code || '').trim();
    if (inputCode && safeEqualText(inputCode, storedCode)) {
      authResult = { role: 'education', id: 'education', registered: true };
    }
  } else {
    const expectedLen = role === 'student' ? 16 : 8;
    const cleanId = normalizeIdDigits(String(req.id || ''));
    if (cleanId.length === expectedLen && luhnValid(cleanId)) {
      const idRec = db.prepare('SELECT * FROM IDs WHERE id = ?').get(cleanId) as
        | { id: string; kind: string; status: string; pin_hash: string }
        | undefined;
      let enrollOk = true;
      let hasProfile = false;
      if (idRec && role === 'student') {
        const stRec = db.prepare('SELECT enroll_status FROM Students WHERE student_id = ?').get(cleanId) as
          | { enroll_status: string }
          | undefined;
        hasProfile = !!stRec;
        // الدخول يتبع حالة القيد: رسمي/منتسب/استضافة/محمّل فقط
        if (stRec) enrollOk = isEnrollStatusLoginAllowed(stRec.enroll_status);
        // طالب حالته مسموحة لكن هويته معطّلة بسبب حالة سابقة: أعد تفعيلها تلقائياً
        if (stRec && enrollOk && idRec.status === 'disabled') {
          db.prepare("UPDATE IDs SET status = 'registered' WHERE id = ?").run(cleanId);
          idRec.status = 'registered';
        }
      }
      if (idRec && idRec.kind === role && idRec.status !== 'disabled' && enrollOk) {
        const cfg = getConfigMap();
        const pinOk =
          role === 'teacher' && cfg.require_teacher_pin === 'TRUE' && idRec.pin_hash
            ? verifyPin(String(req.pin || ''), idRec.pin_hash)
            : true;
        if (pinOk) {
          db.prepare('UPDATE IDs SET last_login = ? WHERE id = ?').run(nowIso(), cleanId);
          authResult = {
            role: role as Role,
            id: cleanId,
            registered: role === 'student' ? hasProfile || idRec.status === 'registered' : idRec.status === 'registered',
          };
        }
      }
    }
  }

  if (!authResult) {
    const prev = attempt && attempt.lockedUntil <= Date.now() ? 0 : attempt ? attempt.count : 0;
    const nextCount = prev + 1;
    const lockedUntil = nextCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
    loginAttempts.set(attemptKey, { count: nextCount, lockedUntil });
    audit(role, identifier || '-', 'auth.login', '-', 'fail', `attempt ${nextCount}`);
    if (lockedUntil > 0) {
      throw new ApiError('TOO_MANY_ATTEMPTS', { retryAfterSec: Math.ceil(LOCKOUT_MS / 1000) });
    }
    throw new ApiError('INVALID_CREDENTIALS', { remaining: MAX_ATTEMPTS - nextCount });
  }

  loginAttempts.delete(attemptKey);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    ...authResult,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  audit(authResult.role, authResult.id, 'auth.login', '-', 'ok');
  return { token, role: authResult.role, id: authResult.id, registered: authResult.registered };
}

function actionAuthLogout(token?: string | null): boolean {
  if (token) sessions.delete(token);
  return true;
}

function actionAdminSetup(req: Record<string, unknown>) {
  const envKey = process.env.SETUP_KEY?.trim();
  if (envKey && String(req.setup_key || '') !== envKey) {
    throw new ApiError('FORBIDDEN');
  }
  if (getAdminCount() > 0) {
    throw new ApiError('ALREADY_SETUP');
  }
  requireFields(req, ['full_name', 'username', 'password']);
  const username = String(req.username).trim();
  const password = String(req.password);
  if (username.length < 4) throw new ApiError('INVALID_USERNAME');
  if (password.length < 8) throw new ApiError('WEAK_PASSWORD');

  const { salt, hash } = hashSecret(password);
  const secAnswer = String(req.sec_answer || '').trim();
  const secHash = secAnswer ? hashPin(secAnswer.toLowerCase()) : '';

  db.prepare(
    `INSERT INTO Admin (admin_id, full_name, certificate, specialty, start_date, phone, whatsapp, username, salt, pass_hash, sec_question, sec_answer_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'admin',
    String(req.full_name).trim(),
    String(req.certificate || 'بكالوريوس'),
    String(req.specialty || ''),
    String(req.start_date || todayDate()),
    String(req.phone || ''),
    String(req.whatsapp || ''),
    username,
    salt,
    hash,
    String(req.sec_question || ''),
    secHash,
    nowIso()
  );

  // Also save optional school settings if passed during setup
  if (req.school_name) {
    actionAdminSchoolSave(req, 'admin');
  } else {
    const stgCount = (db.prepare('SELECT COUNT(*) AS c FROM Stages').get() as { c: number }).c;
    if (stgCount === 0) {
      actionApplyDefaultStages(getConfigMap().school_type || 'middle', 'admin');
    }
  }

  audit('admin', 'admin', 'admin.setup', username, 'ok');
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role: 'admin', id: 'admin', registered: true, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token, role: 'admin', id: 'admin', registered: true };
}

function actionAdminDashboard() {
  const cfg = getConfigMap();
  const studentsCount = (db.prepare('SELECT COUNT(*) AS c FROM Students').get() as { c: number }).c;
  const teachersCount = (db.prepare('SELECT COUNT(*) AS c FROM Teachers').get() as { c: number }).c;
  const classesCount = (db.prepare('SELECT COUNT(*) AS c FROM Classes').get() as { c: number }).c;
  const stagesCount = (db.prepare('SELECT COUNT(*) AS c FROM Stages').get() as { c: number }).c;
  const subjectsCount = (db.prepare('SELECT COUNT(*) AS c FROM Subjects').get() as { c: number }).c;
  const totalIds = (db.prepare('SELECT COUNT(*) AS c FROM IDs').get() as { c: number }).c;
  const unusedIds = (db.prepare("SELECT COUNT(*) AS c FROM IDs WHERE status = 'unused'").get() as { c: number }).c;
  const registeredIds = (db.prepare("SELECT COUNT(*) AS c FROM IDs WHERE status = 'registered'").get() as { c: number }).c;
  const disabledIds = (db.prepare("SELECT COUNT(*) AS c FROM IDs WHERE status = 'disabled'").get() as { c: number }).c;

  const passMark = Number(cfg.pass_mark || 50);
  const gradesRows = db.prepare('SELECT final FROM Grades WHERE final IS NOT NULL AND year = ?').all(cfg.academic_year) as Array<{ final: number }>;
  const passed = gradesRows.filter((g) => g.final >= passMark).length;
  const failed = gradesRows.filter((g) => g.final < passMark).length;

  const recentAudit = db.prepare('SELECT * FROM Audit_Log ORDER BY log_id DESC LIMIT 10').all();

  return {
    config: cfg,
    counts: {
      studentsCount,
      teachersCount,
      classesCount,
      stagesCount,
      subjectsCount,
      totalIds,
      unusedIds,
      registeredIds,
      disabledIds,
      gradesEvaluated: gradesRows.length,
      passed,
      failed,
    },
    recentAudit,
  };
}

function actionAdminProfileGet() {
  const adm = db
    .prepare('SELECT admin_id, full_name, certificate, specialty, start_date, phone, whatsapp, username, sec_question, updated_at FROM Admin LIMIT 1')
    .get();
  return adm || null;
}

function actionAdminProfileSave(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['full_name', 'username']);
  const current = db.prepare('SELECT * FROM Admin LIMIT 1').get() as Record<string, string> | undefined;
  if (!current) throw new ApiError('NOT_FOUND');

  let salt = current.salt;
  let passHash = current.pass_hash;
  if (req.new_password && String(req.new_password).length > 0) {
    if (!verifySecret(String(req.old_password || ''), current.salt, current.pass_hash)) {
      throw new ApiError('INVALID_CREDENTIALS');
    }
    if (String(req.new_password).length < 8) throw new ApiError('WEAK_PASSWORD');
    const hashed = hashSecret(String(req.new_password));
    salt = hashed.salt;
    passHash = hashed.hash;
  }

  let secAnswerHash = current.sec_answer_hash;
  if (req.sec_answer && String(req.sec_answer).trim() !== '') {
    secAnswerHash = hashPin(String(req.sec_answer).trim().toLowerCase());
  }

  db.prepare(
    `UPDATE Admin SET full_name = ?, certificate = ?, specialty = ?, start_date = ?, phone = ?, whatsapp = ?,
       username = ?, salt = ?, pass_hash = ?, sec_question = ?, sec_answer_hash = ?, updated_at = ?
     WHERE admin_id = ?`
  ).run(
    String(req.full_name).trim(),
    String(req.certificate || current.certificate),
    String(req.specialty || ''),
    String(req.start_date || current.start_date),
    String(req.phone || ''),
    String(req.whatsapp || ''),
    String(req.username).trim(),
    salt,
    passHash,
    String(req.sec_question ?? current.sec_question ?? ''),
    secAnswerHash,
    nowIso(),
    current.admin_id
  );
  audit('admin', actorId, 'admin.profileSave', current.username, 'ok');
  return actionAdminProfileGet();
}

function actionAdminSchoolSave(req: Record<string, unknown>, actorId: string) {
  const cfg = getConfigMap();
  const mapUrl = req.map_url !== undefined ? String(req.map_url).trim() : cfg.map_url;
  if (!validateMapUrl(mapUrl)) throw new ApiError('INVALID_MAP_URL');

  const attStart = req.attendance_start_time !== undefined
    ? (parseHHMM(req.attendance_start_time) ?? '')
    : (parseHHMM(cfg.attendance_start_time) ?? '08:00');
  const attEnd = req.attendance_end_time !== undefined
    ? (parseHHMM(req.attendance_end_time) ?? '')
    : (parseHHMM(cfg.attendance_end_time) ?? '13:30');
  parseTimeMinutes(attStart);
  parseTimeMinutes(attEnd);

  const graceRaw = req.attendance_grace_minutes !== undefined
    ? Number(req.attendance_grace_minutes)
    : Number(cfg.attendance_grace_minutes || 15);
  const graceMinutes = String(Math.max(0, Math.min(180, Number.isFinite(graceRaw) ? Math.round(graceRaw) : 15)));

  const eduCode = req.education_access_code !== undefined
    ? String(req.education_access_code).trim()
    : (cfg.education_access_code || '');

  const workdays = req.attendance_workdays !== undefined
    ? String(req.attendance_workdays).trim()
    : (cfg.attendance_workdays || '0,1,2,3,4');

  let logoFileId = cfg.logo_file_id || '';
  if (typeof req.logo_data_url === 'string' && req.logo_data_url.startsWith('data:image/')) {
    logoFileId = savePhotoFromDataUrl(req.logo_data_url);
  } else if (req.logo_data_url === '') {
    logoFileId = '';
  }

  const updates: Array<[string, string]> = [
    ['school_name', String(req.school_name ?? cfg.school_name).trim()],
    ['founded_date', String(req.founded_date ?? cfg.founded_date)],
    ['school_type', String(req.school_type ?? cfg.school_type)],
    ['shift_type', String(req.shift_type ?? cfg.shift_type)],
    ['map_url', mapUrl],
    ['about', String(req.about ?? cfg.about)],
    ['logo_file_id', logoFileId],
    ['academic_year', String(req.academic_year ?? cfg.academic_year)],
    ['teacher_profile_visibility', String(req.teacher_profile_visibility ?? cfg.teacher_profile_visibility)],
    ['student_profile_visibility', String(req.student_profile_visibility ?? cfg.student_profile_visibility)],
    ['guest_student_list', String(req.guest_student_list ?? cfg.guest_student_list)],
    ['require_teacher_pin', String(req.require_teacher_pin ?? cfg.require_teacher_pin)],
    ['allow_student_self_edit', String(req.allow_student_self_edit ?? cfg.allow_student_self_edit)],
    ['pass_mark', String(req.pass_mark ?? cfg.pass_mark)],
    ['annual_effort_formula', String(req.annual_effort_formula ?? cfg.annual_effort_formula)],
    ['final_score_formula', String(req.final_score_formula ?? cfg.final_score_formula)],
    ['education_access_code', eduCode],
    ['attendance_start_time', attStart],
    ['attendance_end_time', attEnd],
    ['attendance_grace_minutes', graceMinutes],
    ['attendance_workdays', workdays],
  ];

  const stmt = db.prepare('INSERT OR REPLACE INTO Config (key, value) VALUES (?, ?)');
  for (const [k, v] of updates) {
    stmt.run(k, v);
  }

  // If Stages table is empty, initialize default stages for chosen school_type
  const stgCount = (db.prepare('SELECT COUNT(*) AS c FROM Stages').get() as { c: number }).c;
  if (stgCount === 0) {
    actionApplyDefaultStages(String(req.school_type ?? cfg.school_type), actorId);
  }

  audit('admin', actorId, 'admin.schoolSave', updates[0][1], 'ok');
  return getConfigMap();
}

function actionApplyDefaultStages(schoolType: string, actorId: string) {
  const list = DEFAULT_STAGES_BY_TYPE[schoolType] || DEFAULT_STAGES_BY_TYPE.middle;
  const ins = db.prepare('INSERT OR IGNORE INTO Stages (stage_id, name_ar, level_type, sort_order, track) VALUES (?, ?, ?, ?, ?)');
  for (const st of list) {
    ins.run(st.stage_id, st.name_ar, st.level_type, st.sort_order, st.track);
  }
  audit('admin', actorId, 'admin.stageApplyDefaults', schoolType, 'ok');
  return db.prepare('SELECT * FROM Stages ORDER BY sort_order ASC').all();
}

function actionStageUpsert(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['name_ar', 'level_type']);
  const stageId = String(req.stage_id || `Stg-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const sortOrder = Number(req.sort_order || 1);
  const track = String(req.track || '');
  const existing = db.prepare('SELECT stage_id FROM Stages WHERE stage_id = ?').get(stageId);
  if (existing) {
    db.prepare('UPDATE Stages SET name_ar = ?, level_type = ?, sort_order = ?, track = ? WHERE stage_id = ?').run(
      String(req.name_ar).trim(),
      String(req.level_type),
      sortOrder,
      track,
      stageId
    );
  } else {
    db.prepare('INSERT INTO Stages (stage_id, name_ar, level_type, sort_order, track) VALUES (?, ?, ?, ?, ?)').run(
      stageId,
      String(req.name_ar).trim(),
      String(req.level_type),
      sortOrder,
      track
    );
  }
  audit('admin', actorId, 'admin.stageUpsert', stageId, 'ok');
  return db.prepare('SELECT * FROM Stages ORDER BY sort_order ASC').all();
}

function actionStageDelete(stageId: string, actorId: string) {
  const cls = db.prepare('SELECT 1 FROM Classes WHERE stage_id = ? LIMIT 1').get(stageId);
  if (cls) throw new ApiError('STAGE_HAS_CLASSES');
  db.prepare('DELETE FROM Stages WHERE stage_id = ?').run(stageId);
  audit('admin', actorId, 'admin.stageDelete', stageId, 'ok');
  return true;
}

function actionClassUpsert(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['stage_id', 'section']);
  const stage = db.prepare('SELECT * FROM Stages WHERE stage_id = ?').get(String(req.stage_id)) as
    | { stage_id: string; name_ar: string }
    | undefined;
  if (!stage) throw new ApiError('NOT_FOUND');

  const section = String(req.section).trim();
  const capacity = Number(req.capacity || 35);
  const status = String(req.status || 'active');
  const label = String(req.label || `${stage.name_ar} / شعبة ${section}`);

  if (req.class_id) {
    db.prepare('UPDATE Classes SET stage_id = ?, section = ?, label = ?, capacity = ?, status = ? WHERE class_id = ?').run(
      stage.stage_id,
      section,
      label,
      capacity,
      status,
      String(req.class_id)
    );
    audit('admin', actorId, 'admin.classUpsert', String(req.class_id), 'ok');
  } else {
    const dup = db.prepare('SELECT 1 FROM Classes WHERE stage_id = ? AND section = ?').get(stage.stage_id, section);
    if (dup) throw new ApiError('DUPLICATE_SECTION');
    const secCode = section.replace(/[^A-Za-z0-9]/g, '') || String(crypto.randomInt(10, 99));
    const classId = `Cls-${stage.stage_id.replace('Stg-', '')}-${secCode}-${crypto.randomUUID().slice(0, 3).toUpperCase()}`;
    db.prepare('INSERT INTO Classes (class_id, stage_id, section, label, capacity, status) VALUES (?, ?, ?, ?, ?, ?)').run(
      classId,
      stage.stage_id,
      section,
      label,
      capacity,
      status
    );
    audit('admin', actorId, 'admin.classUpsert', classId, 'ok');
  }
  return db
    .prepare(
      `SELECT c.*, s.name_ar AS stage_name, s.level_type, s.track,
         (SELECT COUNT(*) FROM Students st WHERE st.class_id = c.class_id) AS students_count
       FROM Classes c LEFT JOIN Stages s ON s.stage_id = c.stage_id
       ORDER BY s.sort_order ASC, c.section ASC`
    )
    .all();
}

function actionClassDelete(classId: string, actorId: string) {
  const hasIds = db.prepare('SELECT 1 FROM IDs WHERE class_id = ? LIMIT 1').get(classId);
  const hasStudents = db.prepare('SELECT 1 FROM Students WHERE class_id = ? LIMIT 1').get(classId);
  if (hasIds || hasStudents) throw new ApiError('CLASS_IN_USE');
  db.prepare('DELETE FROM Classes WHERE class_id = ?').run(classId);
  audit('admin', actorId, 'admin.classDelete', classId, 'ok');
  return true;
}

function actionSubjectUpsert(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['name_ar', 'stage_id']);
  const stageId = String(req.stage_id);
  const nameAr = String(req.name_ar).trim();
  const weekly = Number(req.weekly_periods || 4);
  const active = req.active === undefined ? 1 : Number(req.active);

  if (req.subject_id) {
    db.prepare('UPDATE Subjects SET name_ar = ?, stage_id = ?, weekly_periods = ?, active = ? WHERE subject_id = ?').run(
      nameAr,
      stageId,
      weekly,
      active,
      String(req.subject_id)
    );
  } else {
    const dup = db.prepare('SELECT 1 FROM Subjects WHERE stage_id = ? AND name_ar = ?').get(stageId, nameAr);
    if (dup) throw new ApiError('DUPLICATE_SUBJECT');
    const subjectId = `Sub-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    db.prepare('INSERT INTO Subjects (subject_id, name_ar, stage_id, weekly_periods, active) VALUES (?, ?, ?, ?, ?)').run(
      subjectId,
      nameAr,
      stageId,
      weekly,
      active
    );
  }
  audit('admin', actorId, 'admin.subjectUpsert', nameAr, 'ok');
  return db
    .prepare(
      `SELECT sub.*, s.name_ar AS stage_name FROM Subjects sub LEFT JOIN Stages s ON s.stage_id = sub.stage_id ORDER BY s.sort_order ASC, sub.name_ar ASC`
    )
    .all();
}

function actionAssignmentsList(ctx: { role: Role; id: string | null }) {
  const year = getConfigMap().academic_year;
  if (ctx.role === 'teacher') {
    return db
      .prepare(
        `SELECT a.*, sub.name_ar AS subject_name, c.label AS class_label, c.stage_id, t.full_name AS teacher_name
         FROM Assignments a
         LEFT JOIN Subjects sub ON sub.subject_id = a.subject_id
         LEFT JOIN Classes c ON c.class_id = a.class_id
         LEFT JOIN Teachers t ON t.teacher_id = a.teacher_id
         WHERE a.teacher_id = ? AND a.year = ?`
      )
      .all(ctx.id, year);
  }
  return db
    .prepare(
      `SELECT a.*, sub.name_ar AS subject_name, c.label AS class_label, c.stage_id, t.full_name AS teacher_name
       FROM Assignments a
       LEFT JOIN Subjects sub ON sub.subject_id = a.subject_id
       LEFT JOIN Classes c ON c.class_id = a.class_id
       LEFT JOIN Teachers t ON t.teacher_id = a.teacher_id
       WHERE a.year = ?
       ORDER BY t.full_name ASC, c.label ASC`
    )
    .all(year);
}

function actionAssignmentUpsert(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['teacher_id', 'subject_id', 'class_id']);
  const year = String(req.year || getConfigMap().academic_year);
  const teacherId = normalizeIdDigits(String(req.teacher_id));
  const subjectId = String(req.subject_id);
  const classId = String(req.class_id);

  const dup = db
    .prepare('SELECT 1 FROM Assignments WHERE teacher_id = ? AND subject_id = ? AND class_id = ? AND year = ?')
    .get(teacherId, subjectId, classId, year);
  if (dup) throw new ApiError('DUPLICATE_ASSIGNMENT');

  const assignId = `Asg-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  db.prepare('INSERT INTO Assignments (assign_id, teacher_id, subject_id, class_id, year) VALUES (?, ?, ?, ?, ?)').run(
    assignId,
    teacherId,
    subjectId,
    classId,
    year
  );
  audit('admin', actorId, 'admin.assignmentUpsert', `${teacherId}->${classId}`, 'ok');
  return actionAssignmentsList({ role: 'admin', id: 'admin' });
}

function actionIdsGenerate(req: Record<string, unknown>, actorId: string) {
  const kind = req.kind === 'teacher' ? 'teacher' : 'student';
  const count = Math.min(Math.max(Number(req.count || 0), 1), 500);
  const classId = kind === 'student' ? String(req.class_id || '') : '';
  if (kind === 'student' && !classId) throw new ApiError('MISSING_FIELD', { field: 'class_id' });

  const existingRows = db.prepare('SELECT id FROM IDs').all() as Array<{ id: string }>;
  const existing = new Set(existingRows.map((r) => r.id));

  const len = kind === 'student' ? 16 : 8;
  const createdIds = generateLuhnIds(count, len, existing);
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO IDs (id, kind, class_id, status, pin_hash, generated_at, registered_at, last_login, card_printed)
     VALUES (?, ?, ?, 'unused', '', ?, '', '', 'FALSE')`
  );
  for (const id of createdIds) {
    stmt.run(id, kind, classId, now);
  }
  audit('admin', actorId, 'ids.generate', `${kind}:${count}`, 'ok');
  return createdIds;
}

function actionIdsList(req: Record<string, unknown>) {
  const kind = req.kind ? String(req.kind) : '';
  const classId = req.class_id ? String(req.class_id) : '';
  let sql = `
    SELECT i.id, i.kind, i.class_id, i.status, i.generated_at, i.registered_at, i.last_login, i.card_printed,
           c.label AS class_label,
           COALESCE(s.full_name, t.full_name, '') AS person_name
    FROM IDs i
    LEFT JOIN Classes c ON c.class_id = i.class_id
    LEFT JOIN Students s ON s.student_id = i.id
    LEFT JOIN Teachers t ON t.teacher_id = i.id
    WHERE 1=1
  `;
  const params: string[] = [];
  if (kind) {
    sql += ' AND i.kind = ?';
    params.push(kind);
  }
  if (classId) {
    sql += ' AND i.class_id = ?';
    params.push(classId);
  }
  sql += ' ORDER BY i.generated_at DESC, i.id ASC';
  return db.prepare(sql).all(...params);
}

function actionIdsMarkPrinted(req: Record<string, unknown>, actorId: string) {
  const ids = Array.isArray(req.ids) ? req.ids.map((x) => normalizeIdDigits(String(x))) : [];
  const stmt = db.prepare("UPDATE IDs SET card_printed = 'TRUE' WHERE id = ?");
  for (const id of ids) stmt.run(id);
  audit('admin', actorId, 'ids.markPrinted', `${ids.length}`, 'ok');
  return true;
}

function actionIdsDisable(req: Record<string, unknown>, actorId: string) {
  const id = normalizeIdDigits(String(req.id || ''));
  db.prepare("UPDATE IDs SET status = 'disabled' WHERE id = ?").run(id);
  audit('admin', actorId, 'ids.disable', id, 'ok');
  return true;
}

function actionIdsReplace(req: Record<string, unknown>, actorId: string) {
  const oldId = normalizeIdDigits(String(req.old_id || ''));
  const oldRec = db.prepare('SELECT * FROM IDs WHERE id = ?').get(oldId) as { id: string; kind: string; class_id: string; status: string } | undefined;
  if (!oldRec) throw new ApiError('NOT_FOUND');

  const existingRows = db.prepare('SELECT id FROM IDs').all() as Array<{ id: string }>;
  const existing = new Set(existingRows.map((r) => r.id));
  const len = oldRec.kind === 'student' ? 16 : 8;
  const [newId] = generateLuhnIds(1, len, existing);
  const now = nowIso();

  const fullOld = db.prepare('SELECT pin_hash, registered_at FROM IDs WHERE id = ?').get(oldId) as
    | { pin_hash: string; registered_at: string }
    | undefined;
  // "مسجّلة" تُحدَّد بوجود الملف الشخصي وليس بحالة الهوية القديمة (قد تكون معطّلة بسبب الفصل/النقل/التخرج)
  const hadProfile = idHasProfile(oldId, oldRec.kind);
  let newStatus: string = hadProfile ? 'registered' : oldRec.status === 'registered' ? 'registered' : 'unused';
  if (oldRec.kind === 'student' && hadProfile) {
    const st = db.prepare('SELECT enroll_status FROM Students WHERE student_id = ?').get(oldId) as { enroll_status: string } | undefined;
    if (st && !isEnrollStatusLoginAllowed(st.enroll_status)) newStatus = 'disabled';
  }

  // الهوية القديمة تُعطَّل نهائياً، والجديدة ترث كل شيء (الحالة، الصف، PIN، تاريخ التسجيل)
  db.prepare("UPDATE IDs SET status = 'disabled' WHERE id = ?").run(oldId);
  db.prepare(
    `INSERT INTO IDs (id, kind, class_id, status, pin_hash, generated_at, registered_at, last_login, card_printed)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', 'FALSE')`
  ).run(
    newId,
    oldRec.kind,
    oldRec.class_id,
    newStatus,
    fullOld?.pin_hash || '',
    now,
    hadProfile ? fullOld?.registered_at || now : ''
  );

  // إنهاء أي جلسة مفتوحة بالهوية القديمة
  for (const [tok, sess] of sessions.entries()) {
    if (sess.id === oldId) sessions.delete(tok);
  }

  if (oldRec.kind === 'student') {
    db.prepare('UPDATE Students SET student_id = ?, updated_at = ? WHERE student_id = ?').run(newId, now, oldId);
    db.prepare('UPDATE Complaints SET student_id = ? WHERE student_id = ?').run(newId, oldId);
    db.prepare('UPDATE Archive_Grades SET student_id = ?, grade_key = ? || \'|\' || subject_id || \'|\' || year WHERE student_id = ?').run(newId, newId, oldId);
    const grades = db.prepare('SELECT grade_key, subject_id, year FROM Grades WHERE student_id = ?').all(oldId) as Array<{
      grade_key: string;
      subject_id: string;
      year: string;
    }>;
    for (const g of grades) {
      const newKey = `${newId}|${g.subject_id}|${g.year}`;
      db.prepare('UPDATE Grades SET student_id = ?, grade_key = ? WHERE grade_key = ?').run(newId, newKey, g.grade_key);
    }
  } else {
    db.prepare('UPDATE Teachers SET teacher_id = ?, updated_at = ? WHERE teacher_id = ?').run(newId, now, oldId);
    db.prepare('UPDATE Assignments SET teacher_id = ? WHERE teacher_id = ?').run(newId, oldId);
  }

  audit('admin', actorId, 'ids.replace', `${oldId}->${newId}`, 'ok');
  return { old_id: oldId, new_id: newId };
}

function actionPrefillStudents(req: Record<string, unknown>, actorId: string) {
  const classId = String(req.class_id || '');
  const rows = Array.isArray(req.students) ? (req.students as Array<Record<string, unknown>>) : [];
  if (!classId || rows.length === 0) throw new ApiError('MISSING_FIELD');

  const existingRows = db.prepare('SELECT id FROM IDs').all() as Array<{ id: string }>;
  const existing = new Set(existingRows.map((r) => r.id));
  const ids = generateLuhnIds(rows.length, 16, existing);
  const now = nowIso();

  const insId = db.prepare(
    `INSERT INTO IDs (id, kind, class_id, status, pin_hash, generated_at, registered_at, last_login, card_printed)
     VALUES (?, 'student', ?, 'registered', '', ?, ?, '', 'FALSE')`
  );
  const insSt = db.prepare(
    `INSERT INTO Students (student_id, full_name, mother_name, gender, birth_date, address, guardian_name, guardian_phone, photo_file_id, prev_school, prev_stage, prev_average, reg_reason, failed_years, dropout_years, enroll_date, health_note, class_id, enroll_status, status_note, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'جديد', 0, 0, ?, '', ?, 'official', '', '', ?)`
  );

  const created: Array<{ student_id: string; full_name: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fullName = String(r.full_name || '').trim();
    if (!fullName) continue;
    const id = ids[i];
    insId.run(id, classId, now, now);
    insSt.run(
      id,
      fullName,
      String(r.mother_name || ''),
      String(r.gender || 'ذكر'),
      String(r.birth_date || '2012-01-01'),
      String(r.address || ''),
      String(r.guardian_name || ''),
      String(r.guardian_phone || ''),
      String(r.prev_school || ''),
      String(r.prev_stage || ''),
      String(r.prev_average || ''),
      todayDate(),
      classId,
      now
    );
    created.push({ student_id: id, full_name: fullName });
  }
  audit('admin', actorId, 'ids.prefillStudents', `${classId}:${created.length}`, 'ok');
  return created;
}

function actionStudentRegister(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const idRec = db.prepare('SELECT * FROM IDs WHERE id = ?').get(ctx.id) as
    | { id: string; class_id: string; status: string }
    | undefined;
  if (!idRec) throw new ApiError('NOT_FOUND');
  if (idRec.status === 'registered') throw new ApiError('ALREADY_REGISTERED');

  const p = (req.profile || {}) as Record<string, unknown>;
  requireFields(p, ['full_name', 'birth_date', 'guardian_phone']);

  let photoFileId = '';
  if (typeof p.photo_data_url === 'string' && p.photo_data_url.startsWith('data:image/')) {
    photoFileId = savePhotoFromDataUrl(p.photo_data_url);
  }

  const now = nowIso();
  db.prepare(
    `INSERT INTO Students (student_id, full_name, mother_name, gender, birth_date, address, guardian_name, guardian_phone, photo_file_id, prev_school, prev_stage, prev_average, reg_reason, failed_years, dropout_years, enroll_date, health_note, class_id, enroll_status, status_note, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'official', '', '', ?)`
  ).run(
    ctx.id,
    String(p.full_name).trim(),
    String(p.mother_name || ''),
    String(p.gender || 'ذكر'),
    String(p.birth_date),
    String(p.address || ''),
    String(p.guardian_name || ''),
    String(p.guardian_phone),
    photoFileId,
    String(p.prev_school || ''),
    String(p.prev_stage || ''),
    String(p.prev_average || ''),
    String(p.reg_reason || 'جديد'),
    Number(p.failed_years || 0),
    Number(p.dropout_years || 0),
    todayDate(),
    idRec.class_id,
    now
  );

  db.prepare("UPDATE IDs SET status = 'registered', registered_at = ? WHERE id = ?").run(now, ctx.id);
  audit('student', ctx.id, 'student.register', ctx.id, 'ok');
  return true;
}

function actionStudentSelfUpdate(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  if (cfg.allow_student_self_edit !== 'TRUE') throw new ApiError('FORBIDDEN');
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const p = (req.profile || {}) as Record<string, unknown>;
  const cur = db.prepare('SELECT * FROM Students WHERE student_id = ?').get(ctx.id) as StudentRow | undefined;
  if (!cur) throw new ApiError('NOT_FOUND');

  let photoFileId = cur.photo_file_id;
  if (typeof p.photo_data_url === 'string' && p.photo_data_url.startsWith('data:image/')) {
    photoFileId = savePhotoFromDataUrl(p.photo_data_url);
  }

  db.prepare(
    `UPDATE Students SET address = ?, guardian_phone = ?, photo_file_id = ?, updated_at = ? WHERE student_id = ?`
  ).run(
    String(p.address ?? cur.address),
    String(p.guardian_phone ?? cur.guardian_phone),
    photoFileId,
    nowIso(),
    ctx.id
  );
  audit('student', ctx.id, 'student.selfUpdate', ctx.id, 'ok');
  return true;
}

function actionStudentGet(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  if (ctx.role === 'guest' && (cfg.student_profile_visibility === 'members_only' || cfg.guest_student_list === 'off' || cfg.guest_student_list === 'stats_only')) {
    throw new ApiError('FORBIDDEN');
  }
  const targetId = normalizeIdDigits(String(req.student_id || (ctx.role === 'student' ? ctx.id : '')));
  const rec = db
    .prepare(
      `SELECT s.*, c.label AS class_label, c.stage_id, stg.name_ar AS stage_name
       FROM Students s
       LEFT JOIN Classes c ON c.class_id = s.class_id
       LEFT JOIN Stages stg ON stg.stage_id = c.stage_id
       WHERE s.student_id = ?`
    )
    .get(targetId) as (StudentRow & { class_label?: string; stage_id?: string; stage_name?: string }) | undefined;
  if (!rec) throw new ApiError('NOT_FOUND');

  if (ctx.role === 'student' && ctx.id !== rec.student_id) throw new ApiError('FORBIDDEN');
  if (ctx.role === 'teacher' && ctx.id && !teacherHasClass(ctx.id, rec.class_id)) throw new ApiError('FORBIDDEN');

  const rel = relation(ctx, rec.student_id);
  const fields = allowedFields('student', rel);
  const filtered = pick(rec as unknown as Record<string, unknown>, [...fields, 'class_label', 'stage_id', 'stage_name']);
  if (ctx.role === 'guest' && cfg.guest_student_list === 'first_names' && typeof filtered.full_name === 'string') {
    filtered.full_name = filtered.full_name.split(' ')[0];
  }
  return filtered;
}

function actionStudentList(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  if (ctx.role === 'student') throw new ApiError('FORBIDDEN');
  if (ctx.role === 'guest') {
    if (cfg.student_profile_visibility === 'members_only' || cfg.guest_student_list === 'off') {
      return { mode: 'off', items: [] };
    }
    if (cfg.guest_student_list === 'stats_only') {
      const byClass = db
        .prepare(
          `SELECT c.class_id, c.label, COUNT(s.student_id) AS count
           FROM Classes c LEFT JOIN Students s ON s.class_id = c.class_id
           GROUP BY c.class_id`
        )
        .all();
      return { mode: 'stats_only', items: [], stats: byClass };
    }
  }

  let rows = db
    .prepare(
      `SELECT s.*, c.label AS class_label, c.stage_id, stg.name_ar AS stage_name
       FROM Students s
       LEFT JOIN Classes c ON c.class_id = s.class_id
       LEFT JOIN Stages stg ON stg.stage_id = c.stage_id
       ORDER BY stg.sort_order ASC, c.section ASC, s.full_name ASC`
    )
    .all() as unknown as Array<StudentRow & { class_label?: string; stage_id?: string; stage_name?: string }>;

  if (ctx.role === 'teacher' && ctx.id) {
    rows = rows.filter((r) => teacherHasClass(ctx.id!, r.class_id));
  }
  if (req.class_id) {
    rows = rows.filter((r) => r.class_id === String(req.class_id));
  }

  const permRel: 'admin' | 'self' | 'teacher' | 'student' | 'guest' =
    ctx.role === 'education' ? 'admin' : ctx.role;
  const fields = allowedFields('student', permRel);
  const mapped = rows.map((rec) => {
    const out = pick(rec as unknown as Record<string, unknown>, [...fields, 'student_id', 'class_id', 'class_label', 'stage_id', 'stage_name']);
    if (!fields.includes('student_id') && ctx.role === 'guest') {
      delete out.student_id;
    }
    if (ctx.role === 'guest' && cfg.guest_student_list === 'first_names' && typeof out.full_name === 'string') {
      out.full_name = out.full_name.split(' ')[0];
    }
    return out;
  });

  return { mode: ctx.role === 'guest' ? cfg.guest_student_list : 'full', items: mapped };
}

function actionAdminStudentUpsert(req: Record<string, unknown>, actorId: string) {
  const s = (req.student || req) as Record<string, unknown>;
  requireFields(s, ['student_id', 'full_name', 'class_id']);
  const studentId = normalizeIdDigits(String(s.student_id));
  const cur = db.prepare('SELECT * FROM Students WHERE student_id = ?').get(studentId) as StudentRow | undefined;

  let photoFileId = cur ? cur.photo_file_id : '';
  if (typeof s.photo_data_url === 'string' && s.photo_data_url.startsWith('data:image/')) {
    photoFileId = savePhotoFromDataUrl(s.photo_data_url);
  }

  const now = nowIso();
  if (cur) {
    db.prepare(
      `UPDATE Students SET full_name=?, mother_name=?, gender=?, birth_date=?, address=?, guardian_name=?, guardian_phone=?, photo_file_id=?, prev_school=?, prev_stage=?, prev_average=?, reg_reason=?, failed_years=?, dropout_years=?, health_note=?, notes=?, updated_at=? WHERE student_id=?`
    ).run(
      String(s.full_name).trim(),
      String(s.mother_name ?? cur.mother_name),
      String(s.gender ?? cur.gender),
      String(s.birth_date ?? cur.birth_date),
      String(s.address ?? cur.address),
      String(s.guardian_name ?? cur.guardian_name),
      String(s.guardian_phone ?? cur.guardian_phone),
      photoFileId,
      String(s.prev_school ?? cur.prev_school),
      String(s.prev_stage ?? cur.prev_stage),
      String(s.prev_average ?? cur.prev_average),
      String(s.reg_reason ?? cur.reg_reason),
      Number(s.failed_years ?? cur.failed_years),
      Number(s.dropout_years ?? cur.dropout_years),
      String(s.health_note ?? cur.health_note),
      String(s.notes ?? cur.notes),
      now,
      studentId
    );
  } else {
    db.prepare(
      `INSERT INTO Students (student_id, full_name, mother_name, gender, birth_date, address, guardian_name, guardian_phone, photo_file_id, prev_school, prev_stage, prev_average, reg_reason, failed_years, dropout_years, enroll_date, health_note, class_id, enroll_status, status_note, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official', '', ?, ?)`
    ).run(
      studentId,
      String(s.full_name).trim(),
      String(s.mother_name || ''),
      String(s.gender || 'ذكر'),
      String(s.birth_date || '2012-01-01'),
      String(s.address || ''),
      String(s.guardian_name || ''),
      String(s.guardian_phone || ''),
      photoFileId,
      String(s.prev_school || ''),
      String(s.prev_stage || ''),
      String(s.prev_average || ''),
      String(s.reg_reason || 'جديد'),
      Number(s.failed_years || 0),
      Number(s.dropout_years || 0),
      todayDate(),
      String(s.health_note || ''),
      String(s.class_id),
      String(s.notes || ''),
      now
    );
    db.prepare("UPDATE IDs SET status = 'registered', registered_at = ? WHERE id = ?").run(now, studentId);
  }

  audit('admin', actorId, 'admin.studentUpsert', studentId, 'ok');
  return true;
}

function actionAdminStudentTransfer(req: Record<string, unknown>, actorId: string) {
  const studentId = normalizeIdDigits(String(req.student_id || ''));
  const targetClassId = String(req.class_id || '');
  const st = db.prepare('SELECT class_id FROM Students WHERE student_id = ?').get(studentId) as { class_id: string } | undefined;
  if (!st) throw new ApiError('NOT_FOUND');

  const curCls = db.prepare('SELECT stage_id FROM Classes WHERE class_id = ?').get(st.class_id) as { stage_id: string } | undefined;
  const tgtCls = db.prepare('SELECT stage_id FROM Classes WHERE class_id = ?').get(targetClassId) as { stage_id: string } | undefined;
  if (!tgtCls) throw new ApiError('NOT_FOUND');

  // Integrity rule from PDF page 24: no stage change if student has active grades without archiving first
  if (curCls && curCls.stage_id !== tgtCls.stage_id) {
    const cfg = getConfigMap();
    const hasGrades = db
      .prepare('SELECT 1 FROM Grades WHERE student_id = ? AND year = ? LIMIT 1')
      .get(studentId, cfg.academic_year);
    if (hasGrades) throw new ApiError('HAS_GRADES_ARCHIVE_FIRST');
  }

  const now = nowIso();
  db.prepare('UPDATE Students SET class_id = ?, updated_at = ? WHERE student_id = ?').run(targetClassId, now, studentId);
  db.prepare('UPDATE IDs SET class_id = ? WHERE id = ?').run(targetClassId, studentId);
  audit('admin', actorId, 'admin.studentTransfer', `${studentId}->${targetClassId}`, 'ok');
  return true;
}

function actionAdminStudentStatus(req: Record<string, unknown>, actorId: string) {
  const studentId = normalizeIdDigits(String(req.student_id || ''));
  const enrollStatus = String(req.enroll_status || 'official');
  const statusNote = String(req.status_note || '');
  if (!['official', 'affiliated', 'hosted', 'carried', 'transferred', 'expelled', 'graduated'].includes(enrollStatus)) {
    throw new ApiError('INVALID_STATUS');
  }
  const exists = db.prepare('SELECT 1 AS x FROM Students WHERE student_id = ?').get(studentId);
  if (!exists) throw new ApiError('NOT_FOUND');
  db.prepare('UPDATE Students SET enroll_status = ?, status_note = ?, updated_at = ? WHERE student_id = ?').run(
    enrollStatus,
    statusNote,
    nowIso(),
    studentId
  );
  // تتبّع الهوية للحالة: تعطيل عند فصل/نقل/تخرج، وتفعيل عند رسمي/منتسب/استضافة/محمّل
  syncStudentIdWithEnrollStatus(studentId);
  audit('admin', actorId, 'admin.studentStatus', `${studentId}:${enrollStatus}`, 'ok', statusNote);
  return true;
}

function actionTeacherRegister(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const idRec = db.prepare('SELECT * FROM IDs WHERE id = ?').get(ctx.id) as { id: string; status: string } | undefined;
  if (!idRec) throw new ApiError('NOT_FOUND');
  if (idRec.status === 'registered') throw new ApiError('ALREADY_REGISTERED');

  const p = (req.profile || {}) as Record<string, unknown>;
  requireFields(p, ['full_name']);

  let photoFileId = '';
  if (typeof p.photo_data_url === 'string' && p.photo_data_url.startsWith('data:image/')) {
    photoFileId = savePhotoFromDataUrl(p.photo_data_url);
  }

  const pinHash = p.pin && /^\d{4}$/.test(String(p.pin)) ? hashPin(String(p.pin)) : '';
  const now = nowIso();

  db.prepare(
    `INSERT INTO Teachers (teacher_id, full_name, mother_name, gender, birth_date, degree, specialty, university, college, grad_year, job_title, hire_date, start_date, bio_cv, subjects, phone, whatsapp, email, address, photo_file_id, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    ctx.id,
    String(p.full_name).trim(),
    String(p.mother_name || ''),
    String(p.gender || 'ذكر'),
    String(p.birth_date || ''),
    String(p.degree || 'بكالوريوس'),
    String(p.specialty || ''),
    String(p.university || ''),
    String(p.college || ''),
    String(p.grad_year || ''),
    String(p.job_title || 'مدرس'),
    String(p.hire_date || ''),
    String(p.start_date || todayDate()),
    String(p.bio_cv || ''),
    String(p.subjects || ''),
    String(p.phone || ''),
    String(p.whatsapp || ''),
    String(p.email || ''),
    String(p.address || ''),
    photoFileId,
    now
  );

  db.prepare("UPDATE IDs SET status = 'registered', registered_at = ?, pin_hash = ? WHERE id = ?").run(now, pinHash, ctx.id);
  audit('teacher', ctx.id, 'teacher.register', ctx.id, 'ok');
  return true;
}

function actionTeacherGet(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  if (cfg.teacher_profile_visibility === 'admin_only' && ctx.role !== 'admin' && ctx.id !== String(req.teacher_id || '')) {
    throw new ApiError('FORBIDDEN');
  }
  const targetId = normalizeIdDigits(String(req.teacher_id || (ctx.role === 'teacher' ? ctx.id : '')));
  const rec = db.prepare('SELECT * FROM Teachers WHERE teacher_id = ?').get(targetId) as TeacherRow | undefined;
  if (!rec) throw new ApiError('NOT_FOUND');

  const rel = relation(ctx, rec.teacher_id);
  const fields = allowedFields('teacher', rel);
  return pick(rec as unknown as Record<string, unknown>, fields);
}

function actionTeacherList(ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  if (cfg.teacher_profile_visibility === 'admin_only' && ctx.role !== 'admin') {
    return [];
  }
  const rows = db.prepare('SELECT * FROM Teachers ORDER BY full_name ASC').all() as unknown as TeacherRow[];
  return rows.map((rec) => {
    const rel = relation(ctx, rec.teacher_id);
    const fields = allowedFields('teacher', rel);
    return pick(rec as unknown as Record<string, unknown>, [...fields, 'teacher_id']);
  });
}

function actionAdminTeacherUpsert(req: Record<string, unknown>, actorId: string) {
  const t = (req.teacher || req) as Record<string, unknown>;
  requireFields(t, ['teacher_id', 'full_name']);
  const teacherId = normalizeIdDigits(String(t.teacher_id));
  const cur = db.prepare('SELECT * FROM Teachers WHERE teacher_id = ?').get(teacherId) as TeacherRow | undefined;

  let photoFileId = cur ? cur.photo_file_id : '';
  if (typeof t.photo_data_url === 'string' && t.photo_data_url.startsWith('data:image/')) {
    photoFileId = savePhotoFromDataUrl(t.photo_data_url);
  }
  const now = nowIso();
  if (cur) {
    db.prepare(
      `UPDATE Teachers SET full_name=?, mother_name=?, gender=?, birth_date=?, degree=?, specialty=?, university=?, college=?, grad_year=?, job_title=?, hire_date=?, start_date=?, bio_cv=?, subjects=?, phone=?, whatsapp=?, email=?, address=?, photo_file_id=?, status=?, updated_at=? WHERE teacher_id=?`
    ).run(
      String(t.full_name).trim(),
      String(t.mother_name ?? cur.mother_name),
      String(t.gender ?? cur.gender),
      String(t.birth_date ?? cur.birth_date),
      String(t.degree ?? cur.degree),
      String(t.specialty ?? cur.specialty),
      String(t.university ?? cur.university),
      String(t.college ?? cur.college),
      String(t.grad_year ?? cur.grad_year),
      String(t.job_title ?? cur.job_title),
      String(t.hire_date ?? cur.hire_date),
      String(t.start_date ?? cur.start_date),
      String(t.bio_cv ?? cur.bio_cv),
      String(t.subjects ?? cur.subjects),
      String(t.phone ?? cur.phone),
      String(t.whatsapp ?? cur.whatsapp),
      String(t.email ?? cur.email),
      String(t.address ?? cur.address),
      photoFileId,
      String(t.status ?? cur.status),
      now,
      teacherId
    );
  } else {
    db.prepare(
      `INSERT INTO Teachers (teacher_id, full_name, mother_name, gender, birth_date, degree, specialty, university, college, grad_year, job_title, hire_date, start_date, bio_cv, subjects, phone, whatsapp, email, address, photo_file_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(
      teacherId,
      String(t.full_name).trim(),
      String(t.mother_name || ''),
      String(t.gender || 'ذكر'),
      String(t.birth_date || ''),
      String(t.degree || 'بكالوريوس'),
      String(t.specialty || ''),
      String(t.university || ''),
      String(t.college || ''),
      String(t.grad_year || ''),
      String(t.job_title || 'مدرس'),
      String(t.hire_date || ''),
      String(t.start_date || todayDate()),
      String(t.bio_cv || ''),
      String(t.subjects || ''),
      String(t.phone || ''),
      String(t.whatsapp || ''),
      String(t.email || ''),
      String(t.address || ''),
      photoFileId,
      now
    );
    db.prepare("UPDATE IDs SET status = 'registered', registered_at = ? WHERE id = ?").run(now, teacherId);
  }
  audit('admin', actorId, 'admin.teacherUpsert', teacherId, 'ok');
  return true;
}

function actionPhotoGet(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  const entity = req.entity === 'teacher' ? 'teacher' : 'student';
  const targetId = normalizeIdDigits(String(req.id || ''));

  if (entity === 'student' && ctx.role === 'guest') {
    if (
      cfg.student_profile_visibility === 'members_only' ||
      cfg.guest_student_list === 'off' ||
      cfg.guest_student_list === 'stats_only' ||
      cfg.guest_student_list === 'first_names'
    ) {
      throw new ApiError('FORBIDDEN');
    }
  }
  if (entity === 'teacher' && ctx.role !== 'admin' && cfg.teacher_profile_visibility === 'admin_only' && ctx.id !== targetId) {
    throw new ApiError('FORBIDDEN');
  }

  const row =
    entity === 'teacher'
      ? (db.prepare('SELECT teacher_id AS id, photo_file_id FROM Teachers WHERE teacher_id = ?').get(targetId) as
          | { id: string; photo_file_id: string }
          | undefined)
      : (db.prepare('SELECT student_id AS id, class_id, photo_file_id FROM Students WHERE student_id = ?').get(targetId) as
          | { id: string; class_id: string; photo_file_id: string }
          | undefined);

  if (!row) throw new ApiError('NOT_FOUND');
  if (entity === 'student' && ctx.role === 'teacher' && ctx.id && 'class_id' in row) {
    if (!teacherHasClass(ctx.id, String(row.class_id))) throw new ApiError('FORBIDDEN');
  }
  if (entity === 'student' && ctx.role === 'student' && ctx.id !== targetId) {
    throw new ApiError('FORBIDDEN');
  }

  const fields = allowedFields(entity, relation(ctx, targetId));
  if (!fields.includes('photo_file_id')) throw new ApiError('FORBIDDEN');
  return readPhotoAsDataUrl(row.photo_file_id);
}

function actionGradesMine(ctx: { role: Role; id: string | null }) {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const cfg = getConfigMap();
  const student = db
    .prepare(
      `SELECT s.student_id, s.full_name, s.class_id, c.label AS class_label, c.stage_id, stg.name_ar AS stage_name
       FROM Students s
       LEFT JOIN Classes c ON c.class_id = s.class_id
       LEFT JOIN Stages stg ON stg.stage_id = c.stage_id
       WHERE s.student_id = ?`
    )
    .get(ctx.id) as { student_id: string; full_name: string; class_id: string; class_label: string; stage_id: string; stage_name: string } | undefined;

  if (!student) throw new ApiError('NOT_FOUND');

  const subjects = db
    .prepare('SELECT * FROM Subjects WHERE stage_id = ? AND active = 1 ORDER BY name_ar ASC')
    .all(student.stage_id) as Array<{ subject_id: string; name_ar: string }>;
  const existingGrades = db
    .prepare('SELECT * FROM Grades WHERE student_id = ? AND year = ?')
    .all(ctx.id, cfg.academic_year) as unknown as GradeRow[];

  const bySubject = new Map(existingGrades.map((g) => [g.subject_id, g]));
  const rows = subjects.map((sub) => {
    const g = bySubject.get(sub.subject_id);
    return {
      subject_id: sub.subject_id,
      subject_name: sub.name_ar,
      year: cfg.academic_year,
      m1: g?.m1 ?? '',
      m2: g?.m2 ?? '',
      avg_t1: g?.avg_t1 ?? '',
      mid_year: g?.mid_year ?? '',
      m3: g?.m3 ?? '',
      m4: g?.m4 ?? '',
      avg_t2: g?.avg_t2 ?? '',
      annual_effort: g?.annual_effort ?? '',
      final_exam: g?.final_exam ?? '',
      final: g?.final ?? '',
      round: g?.round ?? 1,
    };
  });

  return { student, pass_mark: Number(cfg.pass_mark || 50), academic_year: cfg.academic_year, rows };
}

function actionGradesSheet(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const classId = String(req.class_id || '');
  const subjectId = String(req.subject_id || '');
  const cfg = getConfigMap();
  const year = String(req.year || cfg.academic_year);

  if (!classId || !subjectId) throw new ApiError('MISSING_FIELD');

  if (ctx.role === 'teacher' && ctx.id) {
    const ok = db
      .prepare('SELECT 1 FROM Assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND year = ? LIMIT 1')
      .get(ctx.id, classId, subjectId, year);
    if (!ok) throw new ApiError('FORBIDDEN');
  }

  const students = db
    .prepare(`SELECT student_id, full_name, enroll_status FROM Students WHERE class_id = ? AND enroll_status IN (${ALLOWED_STATUS_SQL}) ORDER BY full_name ASC`)
    .all(classId) as Array<{ student_id: string; full_name: string; enroll_status: string }>;

  const grades = db
    .prepare('SELECT * FROM Grades WHERE subject_id = ? AND year = ?')
    .all(subjectId, year) as unknown as GradeRow[];
  const byStudent = new Map(grades.map((g) => [g.student_id, g]));

  return students.map((st) => {
    const g = byStudent.get(st.student_id);
    return {
      student_id: st.student_id,
      full_name: st.full_name,
      subject_id: subjectId,
      year,
      m1: g?.m1 ?? '',
      m2: g?.m2 ?? '',
      avg_t1: g?.avg_t1 ?? '',
      mid_year: g?.mid_year ?? '',
      m3: g?.m3 ?? '',
      m4: g?.m4 ?? '',
      avg_t2: g?.avg_t2 ?? '',
      annual_effort: g?.annual_effort ?? '',
      final_exam: g?.final_exam ?? '',
      final: g?.final ?? '',
      round: g?.round ?? 1,
      entered_by: g?.entered_by ?? '',
      updated_at: g?.updated_at ?? '',
    };
  });
}

function saveSingleGrade(g: Record<string, unknown>, ctx: { role: Role; id: string | null }, cfg: SchoolConfig) {
  const studentId = normalizeIdDigits(String(g.student_id || ''));
  const subjectId = String(g.subject_id || '');
  const year = String(g.year || cfg.academic_year);

  if (!studentId || !subjectId) throw new ApiError('MISSING_FIELD');
  if (ctx.role === 'teacher' && ctx.id && !teacherTeaches(ctx.id, studentId, subjectId)) {
    throw new ApiError('FORBIDDEN');
  }

  const parsed: Record<string, number | null> = {};
  for (const k of ['m1', 'm2', 'mid_year', 'm3', 'm4', 'final_exam']) {
    const v = g[k];
    if (v === '' || v === null || v === undefined) {
      parsed[k] = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError('INVALID_GRADE', { field: k });
      parsed[k] = n;
    }
  }

  const calc = computeGradeFields(parsed, cfg);
  const gradeKey = `${studentId}|${subjectId}|${year}`;
  const round = Number(g.round || 1);
  const now = nowIso();

  db.prepare(
    `INSERT OR REPLACE INTO Grades (grade_key, student_id, subject_id, year, m1, m2, avg_t1, mid_year, m3, m4, avg_t2, annual_effort, final_exam, final, round, entered_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gradeKey,
    studentId,
    subjectId,
    year,
    parsed.m1,
    parsed.m2,
    calc.avg_t1 === '' ? null : calc.avg_t1,
    parsed.mid_year,
    parsed.m3,
    parsed.m4,
    calc.avg_t2 === '' ? null : calc.avg_t2,
    calc.annual_effort === '' ? null : calc.annual_effort,
    parsed.final_exam,
    calc.final === '' ? null : calc.final,
    round,
    ctx.id || ctx.role,
    now
  );

  return { grade_key: gradeKey, ...calc };
}

function actionGradesSave(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  const cfg = getConfigMap();
  const g = (req.grade || req) as Record<string, unknown>;
  const res = saveSingleGrade(g, ctx, cfg);
  audit(ctx.role, ctx.id || '-', 'grades.save', res.grade_key, 'ok');
  return res;
}

function actionGradesImportBatch(req: Record<string, unknown>, actorId: string) {
  const cfg = getConfigMap();
  const subjectId = String(req.subject_id || '');
  const year = String(req.year || cfg.academic_year);
  const rows = Array.isArray(req.rows) ? (req.rows as Array<Record<string, unknown>>) : [];
  if (!subjectId || rows.length === 0) throw new ApiError('MISSING_FIELD');

  let saved = 0;
  for (const r of rows) {
    saveSingleGrade({ ...r, subject_id: subjectId, year }, { role: 'admin', id: actorId }, cfg);
    saved++;
  }
  audit('admin', actorId, 'grades.importBatch', `${subjectId}:${saved}`, 'ok');
  return { saved };
}

function actionAnnouncementUpsert(req: Record<string, unknown>, actorId: string) {
  requireFields(req, ['title', 'body']);
  const annId = String(req.ann_id || `Ann-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  db.prepare(
    `INSERT OR REPLACE INTO Announcements (ann_id, title, body, audience, publish_date, expire_date, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    annId,
    String(req.title).trim(),
    String(req.body).trim(),
    String(req.audience || 'all'),
    String(req.publish_date || todayDate()),
    String(req.expire_date || ''),
    req.active === undefined ? 1 : Number(req.active)
  );
  audit('admin', actorId, 'admin.announcementUpsert', annId, 'ok');
  return db.prepare('SELECT * FROM Announcements ORDER BY publish_date DESC').all();
}

function actionPermSave(req: Record<string, unknown>, actorId: string) {
  const rows = Array.isArray(req.rows) ? (req.rows as Array<Record<string, unknown>>) : [];
  const stmt = db.prepare(
    `UPDATE Permissions SET admin = 1, self = ?, teacher = ?, student = ?, guest = ? WHERE entity = ? AND field = ?`
  );
  for (const r of rows) {
    stmt.run(
      Number(r.self ? 1 : 0),
      Number(r.teacher ? 1 : 0),
      Number(r.student ? 1 : 0),
      Number(r.guest ? 1 : 0),
      String(r.entity),
      String(r.field)
    );
  }
  audit('admin', actorId, 'perm.save', `${rows.length} rows`, 'ok');
  return db.prepare('SELECT * FROM Permissions ORDER BY entity ASC, id ASC').all();
}

const VALID_SHEETS = [
  'Config',
  'Admin',
  'Stages',
  'Classes',
  'Subjects',
  'IDs',
  'Students',
  'Teachers',
  'Assignments',
  'Grades',
  'Permissions',
  'Announcements',
  'Audit_Log',
  'Archive_Grades',
  'Attendance',
  'Complaints',
] as const;

function actionSheetsInspect(sheetName: string) {
  if (!VALID_SHEETS.includes(sheetName as (typeof VALID_SHEETS)[number])) {
    throw new ApiError('NOT_FOUND');
  }
  if (sheetName === 'Admin') {
    return db
      .prepare('SELECT admin_id, full_name, certificate, specialty, start_date, phone, whatsapp, username, sec_question, updated_at FROM Admin')
      .all();
  }
  if (sheetName === 'IDs') {
    return db
      .prepare('SELECT id, kind, class_id, status, generated_at, registered_at, last_login, card_printed FROM IDs LIMIT 500')
      .all();
  }
  return db.prepare(`SELECT * FROM ${sheetName} LIMIT 500`).all();
}

function actionYearArchive(req: Record<string, unknown>, actorId: string) {
  const cfg = getConfigMap();
  const nextAcademicYear = String(req.next_academic_year || '').trim();
  if (!nextAcademicYear) throw new ApiError('MISSING_FIELD', { field: 'next_academic_year' });

  const passMark = Number(cfg.pass_mark || 50);
  const stages = db.prepare('SELECT * FROM Stages ORDER BY sort_order ASC').all() as Array<{
    stage_id: string;
    name_ar: string;
    sort_order: number;
  }>;
  const classes = db.prepare('SELECT * FROM Classes').all() as Array<{
    class_id: string;
    stage_id: string;
    section: string;
  }>;
  const students = db.prepare(`SELECT * FROM Students WHERE enroll_status IN (${ALLOWED_STATUS_SQL})`).all() as unknown as StudentRow[];
  const grades = db.prepare('SELECT * FROM Grades WHERE year = ?').all(cfg.academic_year) as unknown as GradeRow[];

  const now = nowIso();
  const classMap = new Map(classes.map((c) => [c.class_id, c]));
  const stageMap = new Map(stages.map((s) => [s.stage_id, s]));

  // 1. Archive current year's grades
  const insArch = db.prepare(
    `INSERT INTO Archive_Grades (grade_key, student_id, subject_id, year, m1, m2, avg_t1, mid_year, m3, m4, avg_t2, annual_effort, final_exam, final, round, entered_by, updated_at, archived_at, stage_at_time, class_at_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const stMap = new Map(students.map((s) => [s.student_id, s]));
  for (const g of grades) {
    const st = stMap.get(g.student_id);
    const cls = st ? classMap.get(st.class_id) : undefined;
    const stg = cls ? stageMap.get(cls.stage_id) : undefined;
    insArch.run(
      g.grade_key,
      g.student_id,
      g.subject_id,
      g.year,
      g.m1 ?? null,
      g.m2 ?? null,
      g.avg_t1 ?? null,
      g.mid_year ?? null,
      g.m3 ?? null,
      g.m4 ?? null,
      g.avg_t2 ?? null,
      g.annual_effort ?? null,
      g.final_exam ?? null,
      g.final ?? null,
      g.round ?? 1,
      g.entered_by || '',
      g.updated_at || now,
      now,
      stg?.name_ar || '',
      st?.class_id || ''
    );
  }

  // 2. Promote passing students or graduate final stage
  let promoted = 0;
  let graduated = 0;
  let retained = 0;

  for (const st of students) {
    const stGrades = grades.filter((g) => g.student_id === st.student_id);
    const allPassed = stGrades.length > 0 && stGrades.every((g) => Number(g.final ?? 0) >= passMark);
    if (!allPassed && stGrades.length > 0) {
      retained++;
      continue;
    }

    const curCls = classMap.get(st.class_id);
    const curStage = curCls ? stageMap.get(curCls.stage_id) : undefined;
    if (!curStage) continue;

    const nextStage = stages.find((s) => s.sort_order > curStage.sort_order);
    if (!nextStage) {
      db.prepare("UPDATE Students SET enroll_status = 'graduated', status_note = ?, updated_at = ? WHERE student_id = ?").run(
        `تخرج في العام الدراسي ${cfg.academic_year}`,
        now,
        st.student_id
      );
      syncStudentIdWithEnrollStatus(st.student_id);
      graduated++;
    } else {
      const targetClass =
        classes.find((c) => c.stage_id === nextStage.stage_id && c.section === curCls?.section) ||
        classes.find((c) => c.stage_id === nextStage.stage_id);
      if (targetClass) {
        db.prepare('UPDATE Students SET class_id = ?, updated_at = ? WHERE student_id = ?').run(
          targetClass.class_id,
          now,
          st.student_id
        );
        db.prepare('UPDATE IDs SET class_id = ? WHERE id = ?').run(targetClass.class_id, st.student_id);
        promoted++;
      } else {
        retained++;
      }
    }
  }

  db.prepare('DELETE FROM Grades WHERE year = ?').run(cfg.academic_year);
  db.prepare("INSERT OR REPLACE INTO Config (key, value) VALUES ('academic_year', ?)").run(nextAcademicYear);

  audit(
    'admin',
    actorId,
    'year.archive',
    `${cfg.academic_year}->${nextAcademicYear}`,
    'ok',
    `archived=${grades.length}, promoted=${promoted}, graduated=${graduated}, retained=${retained}`
  );
  return { archivedGrades: grades.length, promoted, graduated, retained, academic_year: nextAcademicYear };
}

function actionBackupExportJson(): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const sheet of VALID_SHEETS) {
    if (sheet === 'Admin') {
      out[sheet] = db
        .prepare('SELECT admin_id, full_name, certificate, specialty, start_date, phone, whatsapp, username, sec_question, updated_at FROM Admin')
        .all() as Record<string, unknown>[];
    } else if (sheet === 'IDs') {
      out[sheet] = db
        .prepare('SELECT id, kind, class_id, status, generated_at, registered_at, last_login, card_printed FROM IDs')
        .all() as Record<string, unknown>[];
    } else {
      out[sheet] = db.prepare(`SELECT * FROM ${sheet}`).all() as Record<string, unknown>[];
    }
  }
  return out;
}

export function exportFullExcelBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const sheetsData = actionBackupExportJson();
  for (const sheet of VALID_SHEETS) {
    const rows = sheetsData[sheet] || [];
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function actionBackupRestore(req: Record<string, unknown>, actorId: string) {
  const password = String(req.password || '');
  const adm = db.prepare('SELECT salt, pass_hash FROM Admin LIMIT 1').get() as { salt: string; pass_hash: string } | undefined;
  if (!adm || !verifySecret(password, adm.salt, adm.pass_hash)) {
    throw new ApiError('INVALID_CREDENTIALS');
  }

  let sheetsData: Record<string, Array<Record<string, unknown>>> = {};
  if (req.sheets_data && typeof req.sheets_data === 'object') {
    sheetsData = req.sheets_data as Record<string, Array<Record<string, unknown>>>;
  } else if (req.xlsx_base64) {
    const b64 = String(req.xlsx_base64 || '');
    const buf = Buffer.from(b64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const sheet of Object.keys(wb.Sheets)) {
      sheetsData[sheet] = XLSX.utils.sheet_to_json(wb.Sheets[sheet]) as Array<Record<string, unknown>>;
    }
  } else {
    throw new ApiError('MISSING_FIELD');
  }

  const restorable = ['Config', 'Stages', 'Classes', 'Subjects', 'IDs', 'Students', 'Teachers', 'Assignments', 'Grades', 'Permissions', 'Announcements', 'Attendance', 'Complaints'] as const;
  let totalRows = 0;

  for (const sheet of restorable) {
    const rows = sheetsData[sheet];
    if (!Array.isArray(rows) || rows.length === 0 || Object.keys(rows[0]).length === 0) continue;

    if (sheet === 'Config') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Config (key, value) VALUES (?, ?)');
      for (const r of rows) {
        if (r.key) {
          stmt.run(String(r.key), String(r.value ?? ''));
          totalRows++;
        }
      }
    } else if (sheet === 'Stages') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Stages (stage_id, name_ar, level_type, sort_order, track) VALUES (?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.stage_id) {
          stmt.run(String(r.stage_id), String(r.name_ar || ''), String(r.level_type || ''), Number(r.sort_order || 1), String(r.track || ''));
          totalRows++;
        }
      }
    } else if (sheet === 'Classes') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Classes (class_id, stage_id, section, label, capacity, status) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.class_id) {
          stmt.run(String(r.class_id), String(r.stage_id || ''), String(r.section || ''), String(r.label || ''), Number(r.capacity || 35), String(r.status || 'active'));
          totalRows++;
        }
      }
    } else if (sheet === 'Subjects') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Subjects (subject_id, name_ar, stage_id, weekly_periods, active) VALUES (?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.subject_id) {
          stmt.run(String(r.subject_id), String(r.name_ar || ''), String(r.stage_id || ''), Number(r.weekly_periods || 4), Number(r.active ?? 1));
          totalRows++;
        }
      }
    } else if (sheet === 'IDs') {
      const stmt = db.prepare('INSERT OR IGNORE INTO IDs (id, kind, class_id, status, pin_hash, generated_at, registered_at, last_login, card_printed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.id) {
          stmt.run(String(r.id), String(r.kind || 'student'), String(r.class_id || ''), String(r.status || 'unused'), '', String(r.generated_at || nowIso()), String(r.registered_at || ''), String(r.last_login || ''), String(r.card_printed || 'FALSE'));
          totalRows++;
        }
      }
    } else if (sheet === 'Announcements') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Announcements (ann_id, title, body, audience, publish_date, expire_date, active) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.ann_id) {
          stmt.run(String(r.ann_id), String(r.title || ''), String(r.body || ''), String(r.audience || 'all'), String(r.publish_date || todayDate()), String(r.expire_date || ''), Number(r.active ?? 1));
          totalRows++;
        }
      }
    } else if (sheet === 'Attendance') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.att_id) {
          stmt.run(String(r.att_id), String(r.teacher_id || ''), String(r.teacher_name || ''), String(r.att_date || ''), String(r.check_in_time || ''), String(r.check_out_time || ''), String(r.method || 'digital'), String(r.status || 'on_time'), Number(r.late_minutes || 0), String(r.device_note || ''), String(r.created_at || nowIso()), String(r.updated_at || nowIso()));
          totalRows++;
        }
      }
    } else if (sheet === 'Complaints') {
      const stmt = db.prepare('INSERT OR REPLACE INTO Complaints (complaint_id, student_id, student_name, class_label, category, title, details, status, admin_reply, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        if (r.complaint_id) {
          stmt.run(String(r.complaint_id), String(r.student_id || ''), String(r.student_name || ''), String(r.class_label || ''), String(r.category || 'أخرى'), String(r.title || ''), String(r.details || ''), String(r.status || 'open'), String(r.admin_reply || ''), String(r.created_at || nowIso()), String(r.updated_at || nowIso()));
          totalRows++;
        }
      }
    }
  }

  audit('admin', actorId, 'backup.restore', `${totalRows} rows`, 'ok');
  return { restoredRows: totalRows };
}

function actionDemoPopulate(actorId: string) {
  const cfg = getConfigMap();
  const year = cfg.academic_year || '2026-2027';

  // Ensure stages exist
  const stages = actionApplyDefaultStages(cfg.school_type || 'middle', actorId) as Array<{ stage_id: string; name_ar: string }>;
  const firstStage = stages[0];
  const secondStage = stages[1] || stages[0];

  // Create classes
  const classDefs = [
    { class_id: `Cls-${firstStage.stage_id.replace('Stg-', '')}-A`, stage_id: firstStage.stage_id, section: 'أ', label: `${firstStage.name_ar} / شعبة أ` },
    { class_id: `Cls-${firstStage.stage_id.replace('Stg-', '')}-B`, stage_id: firstStage.stage_id, section: 'ب', label: `${firstStage.name_ar} / شعبة ب` },
    { class_id: `Cls-${secondStage.stage_id.replace('Stg-', '')}-A`, stage_id: secondStage.stage_id, section: 'أ', label: `${secondStage.name_ar} / شعبة أ` },
  ];
  const insCls = db.prepare('INSERT OR IGNORE INTO Classes (class_id, stage_id, section, label, capacity, status) VALUES (?, ?, ?, ?, 35, ?)');
  for (const c of classDefs) insCls.run(c.class_id, c.stage_id, c.section, c.label, 'active');

  // Subjects
  const subNames = ['الرياضيات', 'اللغة العربية', 'اللغة الإنكليزية', 'العلوم', 'الاجتماعيات'];
  const insSub = db.prepare('INSERT OR IGNORE INTO Subjects (subject_id, name_ar, stage_id, weekly_periods, active) VALUES (?, ?, ?, 5, 1)');
  for (const st of stages) {
    for (let i = 0; i < subNames.length; i++) {
      insSub.run(`Sub-${st.stage_id.replace('Stg-', '')}-${i + 1}`, subNames[i], st.stage_id);
    }
  }

  // Generate IDs and register sample teachers & students
  const existingRows = db.prepare('SELECT id FROM IDs').all() as Array<{ id: string }>;
  const existing = new Set(existingRows.map((r) => r.id));

  const teacherIds = generateLuhnIds(2, 8, existing);
  const studentIds = generateLuhnIds(6, 16, existing);
  const unusedStudentIds = generateLuhnIds(3, 16, existing);
  const unusedTeacherIds = generateLuhnIds(1, 8, existing);
  const now = nowIso();

  const insId = db.prepare(
    'INSERT OR IGNORE INTO IDs (id, kind, class_id, status, pin_hash, generated_at, registered_at, last_login, card_printed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insTeacher = db.prepare(
    `INSERT OR IGNORE INTO Teachers (teacher_id, full_name, mother_name, gender, birth_date, degree, specialty, university, college, grad_year, job_title, hire_date, start_date, bio_cv, subjects, phone, whatsapp, email, address, photo_file_id, status, updated_at)
     VALUES (?, ?, '', ?, '1988-04-12', 'بكالوريوس', ?, 'جامعة بغداد', 'كلية التربية', '2011', 'مدرس', '2013-10-01', '2018-09-01', ?, ?, '07700001122', '07700001122', '', 'بغداد', '', 'active', ?)`
  );

  const tMeta = [
    { name: 'أ. علي حسين الجبوري', spec: 'الرياضيات', bio: 'خبرة 12 عاماً في تدريس الرياضيات للمرحلة المتوسطة والإعدادية.', subs: 'الرياضيات' },
    { name: 'أ. زينب كريم الساعدي', spec: 'اللغة العربية', bio: 'أستاذة قواعد اللغة العربية والأدب والمطالعة.', subs: 'اللغة العربية' },
  ];

  teacherIds.forEach((tid, idx) => {
    const m = tMeta[idx];
    insId.run(tid, 'teacher', '', 'registered', '', now, now, '', 'TRUE');
    insTeacher.run(tid, m.name, idx === 0 ? 'ذكر' : 'أنثى', m.spec, m.bio, m.subs, now);
  });
  unusedTeacherIds.forEach((tid) => insId.run(tid, 'teacher', '', 'unused', '', now, '', '', 'FALSE'));

  // Assign teachers to first class subjects
  const sub1 = `Sub-${firstStage.stage_id.replace('Stg-', '')}-1`;
  const sub2 = `Sub-${firstStage.stage_id.replace('Stg-', '')}-2`;
  const insAssign = db.prepare('INSERT OR IGNORE INTO Assignments (assign_id, teacher_id, subject_id, class_id, year) VALUES (?, ?, ?, ?, ?)');
  insAssign.run('Asg-DEMO-1', teacherIds[0], sub1, classDefs[0].class_id, year);
  insAssign.run('Asg-DEMO-2', teacherIds[1], sub2, classDefs[0].class_id, year);

  const sampleStudents = [
    'أحمد محمد عبد الله الكاظمي',
    'فاطمة الزهراء علي حسن',
    'يوسف مصطفى كامل الربيعي',
    'مريم حيدر جاسم الشمري',
    'عمر طارق سعدون العبيدي',
    'نور الهدى خالد ناصر',
  ];
  const insStudent = db.prepare(
    `INSERT OR IGNORE INTO Students (student_id, full_name, mother_name, gender, birth_date, address, guardian_name, guardian_phone, photo_file_id, prev_school, prev_stage, prev_average, reg_reason, failed_years, dropout_years, enroll_date, health_note, class_id, enroll_status, status_note, notes, updated_at)
     VALUES (?, ?, 'سعاد حسن', ?, '2012-05-14', 'حي المنصور', 'ولي الأمر', '07711223344', '', 'ابتدائية النور', 'السادس الابتدائي', '89', 'جديد', 0, 0, ?, '', ?, 'official', '', '', ?)`
  );

  studentIds.forEach((sid, idx) => {
    const cls = classDefs[idx < 4 ? 0 : 1].class_id;
    const gender = idx % 2 === 0 ? 'ذكر' : 'أنثى';
    insId.run(sid, 'student', cls, 'registered', '', now, now, '', 'TRUE');
    insStudent.run(sid, sampleStudents[idx], gender, todayDate(), cls, now);
  });
  unusedStudentIds.forEach((sid) => insId.run(sid, 'student', classDefs[0].class_id, 'unused', '', now, '', '', 'FALSE'));

  // Sample grades for first 3 students
  for (let i = 0; i < 3; i++) {
    saveSingleGrade(
      { student_id: studentIds[i], subject_id: sub1, year, m1: 82 + i * 3, m2: 86 + i * 2, mid_year: 84, m3: 88, m4: 90, final_exam: 89, round: 1 },
      { role: 'admin', id: actorId },
      cfg
    );
    saveSingleGrade(
      { student_id: studentIds[i], subject_id: sub2, year, m1: 75 + i * 4, m2: 79, mid_year: 80, m3: 82, m4: 84, final_exam: 85, round: 1 },
      { role: 'admin', id: actorId },
      cfg
    );
  }

  // Announcements
  db.prepare(
    'INSERT OR IGNORE INTO Announcements (ann_id, title, body, audience, publish_date, expire_date, active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run('Ann-DEMO-1', 'بدء امتحانات الشهر الأول', 'تبدأ امتحانات الشهر الأول للفصل الدراسي الأول يوم الأحد القادم وفق الجدول المعلن.', 'all', todayDate(), '');
  db.prepare(
    'INSERT OR IGNORE INTO Announcements (ann_id, title, body, audience, publish_date, expire_date, active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run('Ann-DEMO-2', 'تحديث بيانات الهيئة التدريسية', 'يرجى من المدرسين الجدد استكمال السيرة الذاتية عند أول تسجيل دخول.', 'teachers', todayDate(), '');

  // Demo Attendance & Complaints
  const baghdadToday = baghdadNow().date;
  db.prepare(
    `INSERT OR IGNORE INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('Att-DEMO-1', teacherIds[0], tMeta[0].name, baghdadToday, '07:55:00', '', 'fingerprint_digital', 'on_time', 0, 'بصمة حضور صباحية', now, now);
  db.prepare(
    `INSERT OR IGNORE INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('Att-DEMO-2', teacherIds[1], tMeta[1].name, baghdadToday, '08:22:00', '', 'fingerprint_digital', 'late', 22, 'تأخر مروري', now, now);

  db.prepare(
    `INSERT OR IGNORE INTO Complaints (complaint_id, student_id, student_name, class_label, category, title, details, status, admin_reply, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'Cmp-DEMO-1',
    studentIds[0],
    sampleStudents[0],
    classDefs[0].label,
    'بنية تحتية وخدمات',
    'صيانة جهاز التبريد في القاعة',
    'نرجو فحص جهاز التبريد في الشعبة قبل بدء الامتحانات الشهرية.',
    'in_review',
    'تم تحويل الطلب إلى لجنة الصيانة للمتابعة هذا الأسبوع.',
    now,
    now
  );

  audit('admin', actorId, 'demo.populate', `${studentIds.length} students, ${teacherIds.length} teachers`, 'ok');
  return { studentIds, teacherIds, unusedStudentIds, unusedTeacherIds };
}

// =========================================================================
// ATTENDANCE (FINGERPRINT), COMPLAINTS, & EDUCATION SUPERVISION PORTAL
// =========================================================================

function parseAttendanceLocksMap(cfg: Record<string, string>): Record<string, { locked: boolean; reason: string; updated_at: string }> {
  try {
    const raw = cfg.attendance_locks ? JSON.parse(cfg.attendance_locks) : {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, { locked: boolean; reason: string; updated_at: string }>;
    }
  } catch {
    // ignore invalid JSON
  }
  return {};
}

function saveAttendanceLocksMap(locks: Record<string, { locked: boolean; reason: string; updated_at: string }>): void {
  db.prepare('INSERT OR REPLACE INTO Config (key, value) VALUES (?, ?)').run('attendance_locks', JSON.stringify(locks));
}

function actionAttendancePunch(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const teacher = db.prepare('SELECT teacher_id, full_name FROM Teachers WHERE teacher_id = ?').get(ctx.id) as
    | { teacher_id: string; full_name: string }
    | undefined;
  if (!teacher) throw new ApiError('NOT_FOUND');

  const cfg = getConfigMap();
  const locks = parseAttendanceLocksMap(cfg);
  if (locks[teacher.teacher_id]?.locked) {
    throw new ApiError('ATTENDANCE_LOCKED', { reason: locks[teacher.teacher_id].reason || '' });
  }

  const punchType = req.type === 'out' ? 'out' : 'in';
  const method = req.method === 'webauthn' ? 'webauthn' : 'fingerprint_digital';
  const deviceNote = String(req.device_note || '').slice(0, 140);

  const schedule = getScheduleFromConfig(cfg);
  const startMinutes = parseTimeMinutes(schedule.attendance_start_time);
  const deadlineMinutes = startMinutes + schedule.attendance_grace_minutes;
  const { date: today, time: nowTime, minutes: nowMinutes } = baghdadNow();
  const now = nowIso();

  const existing = db
    .prepare('SELECT * FROM Attendance WHERE teacher_id = ? AND att_date = ?')
    .get(ctx.id, today) as unknown as AttendanceRow | undefined;

  if (existing && (existing.status === 'absent' || existing.status === 'excused_leave')) {
    throw new ApiError('ATTENDANCE_DAY_CLOSED', { status: existing.status, reason: existing.device_note });
  }

  if (punchType === 'in') {
    if (existing) throw new ApiError('ALREADY_CHECKED_IN');
    if (nowMinutes < startMinutes - 60) throw new ApiError('BEFORE_WORK_HOURS');
    if (nowMinutes > deadlineMinutes) throw new ApiError('CHECKIN_CLOSED');
    const isLate = nowMinutes > startMinutes && nowMinutes <= deadlineMinutes;
    const status = isLate ? 'late' : 'on_time';
    const lateMinutes = isLate ? Math.max(1, nowMinutes - startMinutes) : 0;
    const attId = `Att-${today.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

    db.prepare(
      `INSERT INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`
    ).run(attId, teacher.teacher_id, teacher.full_name, today, nowTime, method, status, lateMinutes, deviceNote, now, now);

    audit('teacher', ctx.id, 'attendance.punch', `in:${status}:${lateMinutes}m`, 'ok');
    return db.prepare('SELECT * FROM Attendance WHERE att_id = ?').get(attId);
  }

  if (!existing) throw new ApiError('NOT_CHECKED_IN');
  if (existing.check_out_time) throw new ApiError('ALREADY_CHECKED_OUT');

  db.prepare('UPDATE Attendance SET check_out_time = ?, updated_at = ? WHERE att_id = ?').run(nowTime, now, existing.att_id);
  audit('teacher', ctx.id, 'attendance.punch', `out:${today}`, 'ok');
  return db.prepare('SELECT * FROM Attendance WHERE att_id = ?').get(existing.att_id);
}

function actionAttendanceMine(ctx: { role: Role; id: string | null }): TeacherAttendanceMineResponse {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  const cfg = getConfigMap();
  const schedule = getScheduleFromConfig(cfg);
  const locks = parseAttendanceLocksMap(cfg);
  const lockInfo = locks[ctx.id];
  const { date: today } = baghdadNow();

  const records = db
    .prepare('SELECT * FROM Attendance WHERE teacher_id = ? ORDER BY att_date DESC, check_in_time DESC LIMIT 120')
    .all(ctx.id) as unknown as AttendanceRow[];

  const todayRecord = records.find((r) => r.att_date === today) || null;
  const onTimeDays = records.filter((r) => r.status === 'on_time').length;
  const lateDays = records.filter((r) => r.status === 'late').length;
  const absentDays = records.filter((r) => r.status === 'absent').length;
  const leaveDays = records.filter((r) => r.status === 'excused_leave').length;
  const totalLateMinutes = records.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0);

  return {
    todayDate: today,
    todayRecord,
    schedule,
    locked: Boolean(lockInfo?.locked),
    lockReason: lockInfo?.reason || '',
    summary: {
      totalDays: records.length,
      onTimeDays,
      lateDays,
      absentDays,
      leaveDays,
      totalLateMinutes,
    },
    records,
  };
}

function actionAttendanceList(req: Record<string, unknown>) {
  const cfg = getConfigMap();
  const schedule = getScheduleFromConfig(cfg);
  const locks = parseAttendanceLocksMap(cfg);
  const { date: today } = baghdadNow();
  const teachers = db
    .prepare('SELECT teacher_id, full_name, job_title, specialty, status FROM Teachers ORDER BY full_name ASC')
    .all() as Array<{ teacher_id: string; full_name: string; job_title: string; specialty: string; status: string }>;

  let rows = db
    .prepare('SELECT * FROM Attendance ORDER BY att_date DESC, check_in_time DESC LIMIT 500')
    .all() as unknown as AttendanceRow[];

  if (req.teacher_id) {
    const tid = normalizeIdDigits(String(req.teacher_id));
    rows = rows.filter((r) => r.teacher_id === tid);
  }
  if (req.att_date) {
    rows = rows.filter((r) => r.att_date === String(req.att_date));
  }
  if (req.status) {
    rows = rows.filter((r) => r.status === String(req.status));
  }

  return {
    todayDate: today,
    schedule,
    locks,
    teachers,
    records: rows,
  };
}

function actionAttendanceMarkAbsence(req: Record<string, unknown>, actorId: string) {
  const teacherId = normalizeIdDigits(String(req.teacher_id || ''));
  if (!teacherId) throw new ApiError('MISSING_FIELD', { field: 'teacher_id' });
  const teacher = db.prepare('SELECT teacher_id, full_name FROM Teachers WHERE teacher_id = ?').get(teacherId) as
    | { teacher_id: string; full_name: string }
    | undefined;
  if (!teacher) throw new ApiError('NOT_FOUND');

  const status = req.status === 'excused_leave' ? 'excused_leave' : 'absent';
  const { date: today } = baghdadNow();
  const attDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.att_date || '').trim())
    ? String(req.att_date).trim()
    : today;
  const note = String(req.note || '').trim().slice(0, 140);
  const now = nowIso();

  const existing = db
    .prepare('SELECT * FROM Attendance WHERE teacher_id = ? AND att_date = ?')
    .get(teacher.teacher_id, attDate) as unknown as AttendanceRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE Attendance SET check_in_time = '', check_out_time = '', method = 'admin_lock', status = ?, late_minutes = 0, device_note = ?, updated_at = ? WHERE att_id = ?`
    ).run(status, note, now, existing.att_id);
    audit('admin', actorId, 'attendance.markAbsence', `${teacher.teacher_id}:${attDate}:${status}`, 'ok');
    return db.prepare('SELECT * FROM Attendance WHERE att_id = ?').get(existing.att_id);
  }

  const attId = `Att-${attDate.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  db.prepare(
    `INSERT INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', 'admin_lock', ?, 0, ?, ?, ?)`
  ).run(attId, teacher.teacher_id, teacher.full_name, attDate, status, note, now, now);

  audit('admin', actorId, 'attendance.markAbsence', `${teacher.teacher_id}:${attDate}:${status}`, 'ok');
  return db.prepare('SELECT * FROM Attendance WHERE att_id = ?').get(attId);
}

function actionAttendanceClearDay(req: Record<string, unknown>, actorId: string) {
  const attId = String(req.att_id || '').trim();
  if (attId) {
    db.prepare('DELETE FROM Attendance WHERE att_id = ?').run(attId);
    audit('admin', actorId, 'attendance.clearDay', attId, 'ok');
    return true;
  }
  const teacherId = normalizeIdDigits(String(req.teacher_id || ''));
  const attDate = String(req.att_date || '').trim();
  if (!teacherId || !attDate) throw new ApiError('MISSING_FIELD');
  db.prepare('DELETE FROM Attendance WHERE teacher_id = ? AND att_date = ?').run(teacherId, attDate);
  audit('admin', actorId, 'attendance.clearDay', `${teacherId}:${attDate}`, 'ok');
  return true;
}

function actionAttendanceSetLock(req: Record<string, unknown>, actorId: string) {
  const teacherId = normalizeIdDigits(String(req.teacher_id || ''));
  if (!teacherId) throw new ApiError('MISSING_FIELD', { field: 'teacher_id' });
  const teacher = db.prepare('SELECT teacher_id FROM Teachers WHERE teacher_id = ?').get(teacherId);
  if (!teacher) throw new ApiError('NOT_FOUND');

  const cfg = getConfigMap();
  const locks = parseAttendanceLocksMap(cfg);
  const locked = Boolean(req.locked);
  const reason = String(req.reason || '').trim().slice(0, 140);
  const now = nowIso();

  if (locked) {
    locks[teacherId] = { locked: true, reason, updated_at: now };
  } else {
    delete locks[teacherId];
  }
  saveAttendanceLocksMap(locks);
  audit('admin', actorId, 'attendance.setLock', `${teacherId}:${locked ? 'locked' : 'unlocked'}`, 'ok');
  return locks;
}

const DAY_LEAVE_TYPES = ['leave', 'sick', 'absence'];
const LEAVE_LABELS_AR: Record<string, string> = { leave: 'إجازة', sick: 'إجازة مرضية', absence: 'غياب', hourly: 'إجازة زمنية' };

function isoDateAdd(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

function actionLeavesList(req: Record<string, unknown>) {
  const teachers = db
    .prepare('SELECT teacher_id, full_name, specialty FROM Teachers ORDER BY full_name')
    .all();
  const tid = normalizeIdDigits(String(req.teacher_id || ''));
  const leaves = tid
    ? db.prepare('SELECT * FROM Leaves WHERE teacher_id = ? ORDER BY date_from DESC LIMIT 500').all(tid)
    : db.prepare('SELECT * FROM Leaves ORDER BY date_from DESC LIMIT 500').all();
  return { todayDate: baghdadNow().date, teachers, leaves };
}

function actionLeavesCreate(req: Record<string, unknown>, actorId: string) {
  const teacherId = normalizeIdDigits(String(req.teacher_id || ''));
  if (!teacherId) throw new ApiError('MISSING_FIELD', { field: 'teacher_id' });
  const teacher = db.prepare('SELECT teacher_id, full_name FROM Teachers WHERE teacher_id = ?').get(teacherId) as
    | { teacher_id: string; full_name: string }
    | undefined;
  if (!teacher) throw new ApiError('NOT_FOUND');

  const type = String(req.type || '');
  if (!['leave', 'sick', 'absence', 'hourly'].includes(type)) throw new ApiError('INVALID_STATUS');

  const today = baghdadNow().date;
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fromRaw = String(req.date_from || '').trim();
  const toRaw = String(req.date_to || '').trim();
  const dateFrom = isDate(fromRaw) ? fromRaw : today;
  let dateTo = isDate(toRaw) ? toRaw : dateFrom;
  let minutes = 0;

  if (type === 'hourly') {
    dateTo = dateFrom;
    minutes = Math.round(Number(req.minutes || 0));
    if (!(minutes >= 1 && minutes <= 600)) throw new ApiError('INVALID_MINUTES');
  } else {
    if (dateTo < dateFrom || isoDateAdd(dateFrom, 120) < dateTo) throw new ApiError('INVALID_DATE_RANGE');
  }

  const reason = String(req.reason || '').trim().slice(0, 140);
  const now = nowIso();
  const leaveId = `Lv-${dateFrom.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  db.prepare(
    `INSERT INTO Leaves (leave_id, teacher_id, teacher_name, type, date_from, date_to, minutes, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(leaveId, teacher.teacher_id, teacher.full_name, type, dateFrom, dateTo, minutes, reason, now);

  if (DAY_LEAVE_TYPES.includes(type)) {
    const schedule = getScheduleFromConfig(getConfigMap() as unknown as SchoolConfig);
    const workdays = schedule.attendance_workdays.split(',').map((x) => x.trim());
    const status = type === 'absence' ? 'absent' : 'excused_leave';
    const note = LEAVE_LABELS_AR[type] + (reason ? ': ' + reason : '');
    for (let d = dateFrom; d <= dateTo && d <= today; d = isoDateAdd(d, 1)) {
      const dow = String(new Date(d + 'T00:00:00Z').getUTCDay());
      if (!workdays.includes(dow)) continue;
      const cur = db.prepare('SELECT * FROM Attendance WHERE teacher_id = ? AND att_date = ?').get(teacher.teacher_id, d) as
        | { att_id: string; check_in_time: string }
        | undefined;
      if (cur) {
        if (cur.check_in_time) continue;
        db.prepare(
          `UPDATE Attendance SET status = ?, method = ?, device_note = ?, late_minutes = 0, updated_at = ? WHERE att_id = ?`
        ).run(status, 'leave:' + leaveId, note, now, cur.att_id);
      } else {
        db.prepare(
          `INSERT INTO Attendance (att_id, teacher_id, teacher_name, att_date, check_in_time, check_out_time, method, status, late_minutes, device_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', '', ?, ?, 0, ?, ?, ?)`
        ).run(`Att-${d.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, teacher.teacher_id, teacher.full_name, d, 'leave:' + leaveId, status, note, now, now);
      }
    }
  }
  audit('admin', actorId, 'leaves.create', `${teacherId}:${type}:${dateFrom}..${dateTo}`, 'ok');
  return db.prepare('SELECT * FROM Leaves WHERE leave_id = ?').get(leaveId);
}

function actionLeavesDelete(req: Record<string, unknown>, actorId: string) {
  const leaveId = String(req.leave_id || '').trim();
  if (!leaveId) throw new ApiError('MISSING_FIELD', { field: 'leave_id' });
  const row = db.prepare('SELECT leave_id FROM Leaves WHERE leave_id = ?').get(leaveId);
  if (!row) throw new ApiError('NOT_FOUND');
  db.prepare('DELETE FROM Leaves WHERE leave_id = ?').run(leaveId);
  db.prepare('DELETE FROM Attendance WHERE method = ?').run('leave:' + leaveId);
  audit('admin', actorId, 'leaves.delete', leaveId, 'ok');
  return true;
}

function actionComplaintsCreate(req: Record<string, unknown>, ctx: { role: Role; id: string | null }) {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  requireFields(req, ['title', 'details']);
  const student = db
    .prepare(
      `SELECT s.student_id, s.full_name, c.label AS class_label
       FROM Students s LEFT JOIN Classes c ON c.class_id = s.class_id
       WHERE s.student_id = ?`
    )
    .get(ctx.id) as { student_id: string; full_name: string; class_label?: string } | undefined;
  if (!student) throw new ApiError('NOT_FOUND');

  const id = `Cmp-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const now = nowIso();
  const category = String(req.category || 'أخرى').trim().slice(0, 60);
  const title = String(req.title).trim().slice(0, 140);
  const details = String(req.details).trim().slice(0, 1500);

  db.prepare(
    `INSERT INTO Complaints (complaint_id, student_id, student_name, class_label, category, title, details, status, admin_reply, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', '', ?, ?)`
  ).run(id, student.student_id, student.full_name, student.class_label || '', category, title, details, now, now);

  audit('student', ctx.id, 'complaints.create', id, 'ok');
  return db.prepare('SELECT * FROM Complaints WHERE complaint_id = ?').get(id);
}

function actionComplaintsMine(ctx: { role: Role; id: string | null }): ComplaintRow[] {
  if (!ctx.id) throw new ApiError('FORBIDDEN');
  return db
    .prepare('SELECT * FROM Complaints WHERE student_id = ? ORDER BY created_at DESC')
    .all(ctx.id) as unknown as ComplaintRow[];
}

function actionComplaintsList(req: Record<string, unknown>): ComplaintRow[] {
  let rows = db.prepare('SELECT * FROM Complaints ORDER BY created_at DESC LIMIT 400').all() as unknown as ComplaintRow[];
  if (req.status) {
    rows = rows.filter((c) => c.status === String(req.status));
  }
  return rows;
}

function actionComplaintsUpdateStatus(req: Record<string, unknown>, actorId: string) {
  const id = String(req.complaint_id || '');
  if (!id) throw new ApiError('MISSING_FIELD', { field: 'complaint_id' });
  const cur = db.prepare('SELECT * FROM Complaints WHERE complaint_id = ?').get(id) as unknown as ComplaintRow | undefined;
  if (!cur) throw new ApiError('NOT_FOUND');

  const status = String(req.status || cur.status) as ComplaintStatus;
  if (!['open', 'in_review', 'resolved'].includes(status)) throw new ApiError('INVALID_STATUS');
  const reply = String(req.admin_reply ?? cur.admin_reply ?? '').slice(0, 1500);
  const now = nowIso();

  db.prepare('UPDATE Complaints SET status = ?, admin_reply = ?, updated_at = ? WHERE complaint_id = ?').run(
    status,
    reply,
    now,
    id
  );
  audit('admin', actorId, 'complaints.updateStatus', `${id}:${status}`, 'ok');
  return db.prepare('SELECT * FROM Complaints WHERE complaint_id = ?').get(id);
}

function actionEducationDashboard(): EducationDashboardData {
  const cfg = getConfigMap();
  const schedule = getScheduleFromConfig(cfg);
  const passMark = Number(cfg.pass_mark || 50);
  const adminRow = db.prepare('SELECT full_name FROM Admin LIMIT 1').get() as { full_name: string } | undefined;

  const stages = db.prepare('SELECT * FROM Stages ORDER BY sort_order ASC').all() as Array<{
    stage_id: string;
    name_ar: string;
  }>;
  const classes = db.prepare('SELECT * FROM Classes').all() as Array<{
    class_id: string;
    stage_id: string;
    label: string;
    capacity: number;
  }>;
  const subjects = db.prepare('SELECT * FROM Subjects').all() as Array<{
    subject_id: string;
    name_ar: string;
    stage_id: string;
  }>;
  const students = db.prepare('SELECT * FROM Students ORDER BY full_name ASC').all() as unknown as StudentRow[];
  const teachers = db.prepare('SELECT * FROM Teachers ORDER BY full_name ASC').all() as unknown as TeacherRow[];
  const grades = db
    .prepare('SELECT * FROM Grades WHERE year = ? AND final IS NOT NULL')
    .all(cfg.academic_year) as unknown as GradeRow[];
  const attendanceRows = db
    .prepare('SELECT * FROM Attendance ORDER BY att_date DESC, check_in_time DESC LIMIT 500')
    .all() as unknown as AttendanceRow[];
  const complaints = db
    .prepare('SELECT * FROM Complaints ORDER BY created_at DESC LIMIT 400')
    .all() as unknown as ComplaintRow[];

  const classMap = new Map(classes.map((c) => [c.class_id, c]));
  const stageMap = new Map(stages.map((s) => [s.stage_id, s]));

  // Students breakdown
  const male = students.filter((s) => s.gender === 'ذكر').length;
  const female = students.filter((s) => s.gender === 'أنثى').length;
  const official = students.filter((s) => s.enroll_status === 'official').length;
  const affiliated = students.filter((s) => s.enroll_status === 'affiliated').length;
  const hosted = students.filter((s) => s.enroll_status === 'hosted').length;
  const carried = students.filter((s) => s.enroll_status === 'carried').length;
  const transferred = students.filter((s) => s.enroll_status === 'transferred').length;
  const expelled = students.filter((s) => s.enroll_status === 'expelled').length;
  const graduated = students.filter((s) => s.enroll_status === 'graduated').length;

  const byStageCount = stages.map((st) => {
    const stageClassIds = new Set(classes.filter((c) => c.stage_id === st.stage_id).map((c) => c.class_id));
    return {
      stage_id: st.stage_id,
      stage_name: st.name_ar,
      count: students.filter((s) => stageClassIds.has(s.class_id)).length,
    };
  });

  const byClassCount = classes.map((c) => ({
    class_id: c.class_id,
    label: c.label,
    count: students.filter((s) => s.class_id === c.class_id).length,
    capacity: Number(c.capacity || 35),
  }));

  const studentDirectory = students.map((s) => {
    const cls = classMap.get(s.class_id);
    const stg = cls ? stageMap.get(cls.stage_id) : undefined;
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      gender: s.gender,
      class_label: cls?.label || s.class_id,
      stage_name: stg?.name_ar || '',
      enroll_status: s.enroll_status,
    };
  });

  // Academics pass/fail analytics
  const evaluatedGradeNums = grades.map((g) => Number(g.final));
  const gradesPassed = evaluatedGradeNums.filter((v) => v >= passMark).length;
  const gradesFailed = evaluatedGradeNums.length - gradesPassed;
  const overallAverage =
    evaluatedGradeNums.length > 0
      ? Math.round((evaluatedGradeNums.reduce((a, b) => a + b, 0) / evaluatedGradeNums.length) * 10) / 10
      : null;

  // Student-level pass/fail (a student passes if all evaluated subjects in current year >= passMark)
  const gradesByStudent = new Map<string, number[]>();
  for (const g of grades) {
    const arr = gradesByStudent.get(g.student_id) || [];
    arr.push(Number(g.final));
    gradesByStudent.set(g.student_id, arr);
  }
  let passedStudents = 0;
  let failedStudents = 0;
  for (const scores of gradesByStudent.values()) {
    if (scores.every((v) => v >= passMark)) passedStudents++;
    else failedStudents++;
  }

  const studentMap = new Map(students.map((s) => [s.student_id, s]));
  const academicByStage = stages.map((st) => {
    const stageClassIds = new Set(classes.filter((c) => c.stage_id === st.stage_id).map((c) => c.class_id));
    const stageGrades = grades.filter((g) => {
      const stu = studentMap.get(g.student_id);
      return stu && stageClassIds.has(stu.class_id);
    });
    const passed = stageGrades.filter((g) => Number(g.final) >= passMark).length;
    const avgScore =
      stageGrades.length > 0
        ? Math.round((stageGrades.reduce((a, g) => a + Number(g.final), 0) / stageGrades.length) * 10) / 10
        : null;
    return {
      stage_id: st.stage_id,
      stage_name: st.name_ar,
      evaluated: stageGrades.length,
      passed,
      failed: stageGrades.length - passed,
      avgScore,
    };
  });

  const academicBySubject = subjects.map((sub) => {
    const subGrades = grades.filter((g) => g.subject_id === sub.subject_id);
    const passed = subGrades.filter((g) => Number(g.final) >= passMark).length;
    const avgScore =
      subGrades.length > 0
        ? Math.round((subGrades.reduce((a, g) => a + Number(g.final), 0) / subGrades.length) * 10) / 10
        : null;
    return {
      subject_id: sub.subject_id,
      subject_name: sub.name_ar,
      stage_name: stageMap.get(sub.stage_id)?.name_ar || '',
      evaluated: subGrades.length,
      passed,
      failed: subGrades.length - passed,
      avgScore,
    };
  });

  // Attendance analytics
  const locks = parseAttendanceLocksMap(cfg);
  const { date: today } = baghdadNow();
  const todayRows = attendanceRows.filter((r) => r.att_date === today);
  const todayOnTime = todayRows.filter((r) => r.status === 'on_time').length;
  const todayLate = todayRows.filter((r) => r.status === 'late').length;
  const todayLeave = todayRows.filter((r) => r.status === 'excused_leave').length;
  const todayMarkedAbsent = todayRows.filter((r) => r.status === 'absent').length;
  const todayPresent = todayOnTime + todayLate;
  const todayAbsent = Math.max(todayMarkedAbsent, teachers.length - todayPresent - todayLeave);

  const onTimeRecords = attendanceRows.filter((r) => r.status === 'on_time').length;
  const lateRecords = attendanceRows.filter((r) => r.status === 'late').length;
  const absentRecords = attendanceRows.filter((r) => r.status === 'absent').length;
  const leaveRecords = attendanceRows.filter((r) => r.status === 'excused_leave').length;
  const lockedTeachers = teachers.filter((t) => Boolean(locks[t.teacher_id]?.locked)).length;
  const totalLateMinutes = attendanceRows.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0);

  const dateMap = new Map<string, { on_time: number; late: number }>();
  for (const r of attendanceRows) {
    if (r.status !== 'on_time' && r.status !== 'late') continue;
    const entry = dateMap.get(r.att_date) || { on_time: 0, late: 0 };
    if (r.status === 'late') entry.late++;
    else entry.on_time++;
    dateMap.set(r.att_date, entry);
  }
  const dailyTrend = Array.from(dateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([date, c]) => ({ date, on_time: c.on_time, late: c.late, total: c.on_time + c.late }));

  const byTeacher = teachers.map((t) => {
    const recs = attendanceRows.filter((r) => r.teacher_id === t.teacher_id);
    const todayRec = recs.find((r) => r.att_date === today);
    const lockInfo = locks[t.teacher_id];
    return {
      teacher_id: t.teacher_id,
      teacher_name: t.full_name,
      specialty: t.specialty,
      total_days: recs.length,
      on_time_days: recs.filter((r) => r.status === 'on_time').length,
      late_days: recs.filter((r) => r.status === 'late').length,
      absent_days: recs.filter((r) => r.status === 'absent').length,
      leave_days: recs.filter((r) => r.status === 'excused_leave').length,
      total_late_minutes: recs.reduce((acc, r) => acc + Number(r.late_minutes || 0), 0),
      locked: Boolean(lockInfo?.locked),
      lock_reason: lockInfo?.reason || '',
      today_status: todayRec ? todayRec.status : ('absent' as const),
      today_check_in: todayRec?.check_in_time || '',
      today_check_out: todayRec?.check_out_time || '',
    };
  });

  // Complaints analytics
  const openCount = complaints.filter((c) => c.status === 'open').length;
  const inReviewCount = complaints.filter((c) => c.status === 'in_review').length;
  const resolvedCount = complaints.filter((c) => c.status === 'resolved').length;
  const catCounts = new Map<string, number>();
  for (const c of complaints) {
    const cat = c.category || 'أخرى';
    catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
  }
  const byCategory = Array.from(catCounts.entries()).map(([category, count]) => ({ category, count }));

  return {
    school: {
      school_name: cfg.school_name || 'نظام base المدرسي',
      school_type: cfg.school_type || 'middle',
      shift_type: cfg.shift_type || 'morning',
      founded_date: cfg.founded_date || '',
      academic_year: cfg.academic_year || '2026-2027',
      admin_name: adminRow?.full_name || '',
      pass_mark: passMark,
      about: cfg.about || '',
      schedule,
    },
    students: {
      total: students.length,
      official,
      affiliated,
      hosted,
      carried,
      transferred,
      expelled,
      graduated,
      byGender: { male, female },
      byStage: byStageCount,
      byClass: byClassCount,
      directory: studentDirectory,
    },
    teachers: {
      total: teachers.length,
      directory: teachers.map((t) => ({
        teacher_id: t.teacher_id,
        full_name: t.full_name,
        job_title: t.job_title,
        degree: t.degree,
        specialty: t.specialty,
        subjects: t.subjects,
        status: t.status,
      })),
    },
    academics: {
      gradesEvaluated: evaluatedGradeNums.length,
      gradesPassed,
      gradesFailed,
      evaluatedStudents: gradesByStudent.size,
      passedStudents,
      failedStudents,
      overallAverage,
      byStage: academicByStage,
      bySubject: academicBySubject,
    },
    attendance: {
      todayDate: today,
      totalTeachers: teachers.length,
      todayPresent,
      todayOnTime,
      todayLate,
      todayAbsent,
      todayLeave,
      totalRecords: attendanceRows.length,
      onTimeRecords,
      lateRecords,
      absentRecords,
      leaveRecords,
      lockedTeachers,
      totalLateMinutes,
      dailyTrend,
      byTeacher,
      records: attendanceRows,
    },
    complaints: {
      total: complaints.length,
      open: openCount,
      in_review: inReviewCount,
      resolved: resolvedCount,
      byCategory,
      items: complaints,
    },
  };
}


try {
  syncAllStudentIds();
} catch (e) {
  console.error('syncAllStudentIds failed', e);
}
