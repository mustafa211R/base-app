export type Role = 'guest' | 'student' | 'teacher' | 'admin';

export type SchoolType = 'primary' | 'middle' | 'prep' | 'secondary' | 'vocational';
export type ShiftType = 'morning' | 'noon' | 'evening';
export type TeacherProfileVisibility = 'all' | 'admin_only';
export type StudentProfileVisibility = 'all' | 'members_only';
export type GuestStudentListMode = 'full' | 'first_names' | 'stats_only' | 'off';
export type EnrollStatus = 'official' | 'transferred' | 'expelled' | 'graduated';
export type IdStatus = 'unused' | 'registered' | 'disabled';
export type IdKind = 'student' | 'teacher';

export interface SchoolConfig {
  school_name: string;
  founded_date: string;
  school_type: SchoolType;
  shift_type: string; // comma-separated: morning,noon,evening
  map_url: string;
  about: string;
  logo_file_id: string;
  academic_year: string;
  teacher_profile_visibility: TeacherProfileVisibility;
  student_profile_visibility: StudentProfileVisibility;
  guest_student_list: GuestStudentListMode;
  require_teacher_pin: string; // 'TRUE' | 'FALSE'
  allow_student_self_edit: string; // 'TRUE' | 'FALSE'
  pass_mark: string;
  annual_effort_formula: 'iraqi_avg' | 'weighted_40_20_40' | 'terms_only';
  final_score_formula: 'avg_effort_final' | 'weighted_40_60';
  schema_version: string;
}

export interface StageRow {
  stage_id: string;
  name_ar: string;
  level_type: string;
  sort_order: number;
  track: string;
}

export interface ClassRow {
  class_id: string;
  stage_id: string;
  section: string;
  label: string;
  capacity: number;
  status: string;
}

export interface SubjectRow {
  subject_id: string;
  name_ar: string;
  stage_id: string;
  weekly_periods: number;
  active: number;
}

export interface IdRow {
  id: string;
  kind: IdKind;
  class_id: string;
  status: IdStatus;
  pin_hash?: string;
  generated_at: string;
  registered_at: string;
  last_login: string;
  card_printed: string;
}

export interface StudentRow {
  student_id: string;
  full_name: string;
  mother_name: string;
  gender: string;
  birth_date: string;
  address: string;
  guardian_name: string;
  guardian_phone: string;
  photo_file_id: string;
  prev_school: string;
  prev_stage: string;
  prev_average: string;
  reg_reason: string;
  failed_years: number;
  dropout_years: number;
  enroll_date: string;
  health_note: string;
  class_id: string;
  enroll_status: EnrollStatus;
  status_note: string;
  notes: string;
  updated_at: string;
}

export interface TeacherRow {
  teacher_id: string;
  full_name: string;
  mother_name: string;
  gender: string;
  birth_date: string;
  degree: string;
  specialty: string;
  university: string;
  college: string;
  grad_year: string;
  job_title: string;
  hire_date: string;
  start_date: string;
  bio_cv: string;
  subjects: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  photo_file_id: string;
  status: string;
  updated_at: string;
}

export interface AssignmentRow {
  assign_id: string;
  teacher_id: string;
  subject_id: string;
  class_id: string;
  year: string;
}

export interface GradeRow {
  grade_key: string;
  student_id: string;
  subject_id: string;
  year: string;
  m1: number | '' | null;
  m2: number | '' | null;
  avg_t1: number | '' | null;
  mid_year: number | '' | null;
  m3: number | '' | null;
  m4: number | '' | null;
  avg_t2: number | '' | null;
  annual_effort: number | '' | null;
  final_exam: number | '' | null;
  final: number | '' | null;
  round: number;
  entered_by: string;
  updated_at: string;
  subject_name?: string;
}

export interface PermissionRow {
  id: number;
  entity: 'student' | 'teacher' | 'school';
  field: string;
  label_ar?: string;
  admin: number;
  self: number;
  teacher: number;
  student: number;
  guest: number;
}

export interface AnnouncementRow {
  ann_id: string;
  title: string;
  body: string;
  audience: 'all' | 'students' | 'teachers';
  publish_date: string;
  expire_date: string;
  active: number;
}

export interface AuditLogRow {
  log_id: number;
  timestamp: string;
  role: string;
  actor_id: string;
  action: string;
  target: string;
  result: 'ok' | 'fail';
  detail: string;
}

export interface AuthSession {
  token: string;
  role: Role;
  id: string;
  registered: boolean;
}

export interface PublicSchoolData {
  initialized: boolean;
  setupKeyRequired: boolean;
  school_name: string;
  founded_date: string;
  school_type: SchoolType;
  shift_type: string;
  map_url: string;
  about: string;
  logo_file_id: string;
  academic_year: string;
  teacher_profile_visibility: TeacherProfileVisibility;
  student_profile_visibility: StudentProfileVisibility;
  guest_student_list: GuestStudentListMode;
  require_teacher_pin: boolean;
  allow_student_self_edit: boolean;
  pass_mark: number;
  admin_name: string;
  announcements: AnnouncementRow[];
  stats: {
    students_count: number;
    teachers_count: number;
    classes_count: number;
    unused_ids_count: number;
  };
}
