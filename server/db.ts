import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const DB_PATH = path.join(DATA_DIR, 'base_school.sqlite');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = OFF;');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Admin (
      admin_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      certificate TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      username TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      sec_question TEXT NOT NULL DEFAULT '',
      sec_answer_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Stages (
      stage_id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      level_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      track TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS Classes (
      class_id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      section TEXT NOT NULL,
      label TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 35,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE(stage_id, section)
    );

    CREATE TABLE IF NOT EXISTS Subjects (
      subject_id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      weekly_periods INTEGER NOT NULL DEFAULT 4,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(stage_id, name_ar)
    );

    CREATE TABLE IF NOT EXISTS IDs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      class_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unused',
      pin_hash TEXT NOT NULL DEFAULT '',
      generated_at TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT '',
      last_login TEXT NOT NULL DEFAULT '',
      card_printed TEXT NOT NULL DEFAULT 'FALSE'
    );

    CREATE TABLE IF NOT EXISTS Students (
      student_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      mother_name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'ذكر',
      birth_date TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      guardian_name TEXT NOT NULL DEFAULT '',
      guardian_phone TEXT NOT NULL,
      photo_file_id TEXT NOT NULL DEFAULT '',
      prev_school TEXT NOT NULL DEFAULT '',
      prev_stage TEXT NOT NULL DEFAULT '',
      prev_average TEXT NOT NULL DEFAULT '',
      reg_reason TEXT NOT NULL DEFAULT 'جديد',
      failed_years INTEGER NOT NULL DEFAULT 0,
      dropout_years INTEGER NOT NULL DEFAULT 0,
      enroll_date TEXT NOT NULL DEFAULT '',
      health_note TEXT NOT NULL DEFAULT '',
      class_id TEXT NOT NULL,
      enroll_status TEXT NOT NULL DEFAULT 'official',
      status_note TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Teachers (
      teacher_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      mother_name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'ذكر',
      birth_date TEXT NOT NULL DEFAULT '',
      degree TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      university TEXT NOT NULL DEFAULT '',
      college TEXT NOT NULL DEFAULT '',
      grad_year TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT 'مدرس',
      hire_date TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      bio_cv TEXT NOT NULL DEFAULT '',
      subjects TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      photo_file_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Assignments (
      assign_id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      year TEXT NOT NULL,
      UNIQUE(teacher_id, subject_id, class_id, year)
    );

    CREATE TABLE IF NOT EXISTS Grades (
      grade_key TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      year TEXT NOT NULL,
      m1 REAL,
      m2 REAL,
      avg_t1 REAL,
      mid_year REAL,
      m3 REAL,
      m4 REAL,
      avg_t2 REAL,
      annual_effort REAL,
      final_exam REAL,
      final REAL,
      round INTEGER NOT NULL DEFAULT 1,
      entered_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      field TEXT NOT NULL,
      label_ar TEXT NOT NULL DEFAULT '',
      admin INTEGER NOT NULL DEFAULT 1,
      self INTEGER NOT NULL DEFAULT 1,
      teacher INTEGER NOT NULL DEFAULT 0,
      student INTEGER NOT NULL DEFAULT 0,
      guest INTEGER NOT NULL DEFAULT 0,
      UNIQUE(entity, field)
    );

    CREATE TABLE IF NOT EXISTS Announcements (
      ann_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'all',
      publish_date TEXT NOT NULL,
      expire_date TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS Audit_Log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      role TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS Archive_Grades (
      archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
      grade_key TEXT NOT NULL,
      student_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      year TEXT NOT NULL,
      m1 REAL,
      m2 REAL,
      avg_t1 REAL,
      mid_year REAL,
      m3 REAL,
      m4 REAL,
      avg_t2 REAL,
      annual_effort REAL,
      final_exam REAL,
      final REAL,
      round INTEGER NOT NULL DEFAULT 1,
      entered_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      stage_at_time TEXT NOT NULL,
      class_at_time TEXT NOT NULL
    );
  `);

  const defaultConfig: Array<[string, string]> = [
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
    ['schema_version', '1'],
  ];

  const insertCfg = db.prepare('INSERT OR IGNORE INTO Config (key, value) VALUES (?, ?)');
  for (const [k, v] of defaultConfig) {
    insertCfg.run(k, v);
  }

  const defaultPerms: Array<[string, string, string, number, number, number, number, number]> = [
    // Student entity
    ['student', 'student_id', 'رقم الهوية', 1, 1, 1, 0, 0],
    ['student', 'full_name', 'الاسم الرباعي', 1, 1, 1, 0, 1],
    ['student', 'mother_name', 'اسم الأم', 1, 1, 0, 0, 0],
    ['student', 'gender', 'الجنس', 1, 1, 1, 0, 1],
    ['student', 'class_id', 'الصف والشعبة', 1, 1, 1, 0, 1],
    ['student', 'photo_file_id', 'الصورة الشخصية', 1, 1, 1, 0, 1],
    ['student', 'enroll_status', 'حالة القيد', 1, 1, 1, 0, 0],
    ['student', 'birth_date', 'تاريخ الميلاد', 1, 1, 0, 0, 0],
    ['student', 'address', 'العنوان', 1, 1, 0, 0, 0],
    ['student', 'guardian_name', 'اسم ولي الأمر', 1, 1, 1, 0, 0],
    ['student', 'guardian_phone', 'هاتف ولي الأمر', 1, 1, 1, 0, 0],
    ['student', 'prev_school', 'المدرسة السابقة والمعدل', 1, 1, 0, 0, 0],
    ['student', 'health_note', 'الملاحظات الصحية', 1, 0, 1, 0, 0],
    ['student', 'notes', 'الملاحظات والتحذيرات', 1, 0, 1, 0, 0],
    ['student', 'grades', 'الدرجات', 1, 1, 1, 0, 0],
    // Teacher entity
    ['teacher', 'teacher_id', 'رقم الهوية', 1, 1, 0, 0, 0],
    ['teacher', 'full_name', 'الاسم الكامل', 1, 1, 1, 1, 1],
    ['teacher', 'photo_file_id', 'الصورة الشخصية', 1, 1, 1, 1, 1],
    ['teacher', 'job_title', 'العنوان الوظيفي', 1, 1, 1, 1, 1],
    ['teacher', 'degree', 'الشهادة', 1, 1, 1, 1, 1],
    ['teacher', 'specialty', 'التخصص', 1, 1, 1, 1, 1],
    ['teacher', 'subjects', 'المواد التي يدرّسها', 1, 1, 1, 1, 1],
    ['teacher', 'bio_cv', 'السيرة الذاتية', 1, 1, 1, 1, 1],
    ['teacher', 'university', 'الجامعة والكلية وسنة التخرج', 1, 1, 0, 0, 0],
    ['teacher', 'phone', 'رقم الهاتف', 1, 1, 0, 0, 0],
    ['teacher', 'whatsapp', 'الواتساب', 1, 1, 0, 0, 0],
    ['teacher', 'email', 'البريد الإلكتروني', 1, 1, 0, 0, 0],
    ['teacher', 'address', 'العنوان السكني', 1, 1, 0, 0, 0],
    ['teacher', 'hire_date', 'تاريخ التعيين والمباشرة', 1, 1, 0, 0, 0],
  ];

  const insertPerm = db.prepare(
    `INSERT OR IGNORE INTO Permissions (entity, field, label_ar, admin, self, teacher, student, guest)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of defaultPerms) {
    insertPerm.run(...row);
  }
}

initSchema();
