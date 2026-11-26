export type Role = 'guest' | 'student' | 'teacher' | 'admin' | 'education';

export type SchoolType = 'primary' | 'middle' | 'prep' | 'secondary' | 'vocational';
export type ShiftType = 'morning' | 'noon' | 'evening';
export type TeacherProfileVisibility = 'all' | 'admin_only';
export type StudentProfileVisibility = 'all' | 'members_only';
export type GuestStudentListMode = 'full' | 'first_names' | 'stats_only' | 'off';
export type EnrollStatus =
  | 'official'
  | 'affiliated'
  | 'hosted'
  | 'carried'
  | 'transferred'
  | 'expelled'
  | 'graduated';

// حالات القيد المسموح لها بالدخول: رسمي، منتسب (انتساب)، استضافة، محمّل
export const LOGIN_ALLOWED_ENROLL_STATUSES: readonly string[] = ['official', 'affiliated', 'hosted', 'carried'];
// حالات القيد الممنوعة من الدخول: مفصول، منقول، متخرج
export const LOGIN_BLOCKED_ENROLL_STATUSES: readonly string[] = ['expelled', 'transferred', 'graduated'];

export function isEnrollStatusLoginAllowed(status: string | null | undefined): boolean {
  return LOGIN_ALLOWED_ENROLL_STATUSES.includes(String(status || 'official'));
}
export type IdStatus = 'unused' | 'registered' | 'disabled';
export type IdKind = 'student' | 'teacher';
export type ComplaintStatus = 'open' | 'in_review' | 'resolved';
export type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused_leave';

export interface AttendanceLockInfo {
  locked: boolean;
  reason: string;
  updated_at: string;
}

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
  education_access_code: string;
  attendance_start_time: string;
  attendance_end_time: string;
  attendance_grace_minutes: string;
  attendance_workdays: string; // comma-separated 0..6 (0=Sun)
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

export interface AttendanceRow {
  att_id: string;
  teacher_id: string;
  teacher_name: string;
  att_date: string;
  check_in_time: string;
  check_out_time: string;
  method: string;
  status: AttendanceStatus;
  late_minutes: number;
  device_note: string;
  created_at: string;
  updated_at: string;
}

export interface ComplaintRow {
  complaint_id: string;
  student_id: string;
  student_name: string;
  class_label: string;
  category: string;
  title: string;
  details: string;
  status: ComplaintStatus;
  admin_reply: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSchedule {
  attendance_start_time: string;
  attendance_end_time: string;
  attendance_grace_minutes: number;
  attendance_workdays: string;
}

export type LeaveType = 'leave' | 'sick' | 'absence' | 'hourly';

export interface LeaveRow {
  leave_id: string;
  teacher_id: string;
  teacher_name: string;
  type: LeaveType;
  date_from: string;
  date_to: string;
  minutes: number;
  reason: string;
  created_at: string;
}

export interface AttendanceState {
  workday: boolean;
  dayLeave: LeaveRow | null;
  timeLeaveMinutes: number;
  checkInOpensAt: string;
  checkInClosesAt: string;
  checkOutOpensAt: string;
  nowTime: string;
  blocked: string;
  reasonIn: string;
  reasonOut: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

export interface TeacherAttendanceMineResponse {
  state?: AttendanceState;
  leaves?: LeaveRow[];
  todayDate: string;
  todayRecord: AttendanceRow | null;
  schedule: AttendanceSchedule;
  locked: boolean;
  lockReason: string;
  summary: {
    totalDays: number;
    onTimeDays: number;
    lateDays: number;
    absentDays: number;
    leaveDays: number;
    totalLateMinutes: number;
  };
  records: AttendanceRow[];
}

export interface EducationDashboardData {
  school: {
    school_name: string;
    school_type: SchoolType;
    shift_type: string;
    founded_date: string;
    academic_year: string;
    admin_name: string;
    pass_mark: number;
    about: string;
    schedule: AttendanceSchedule;
  };
  students: {
    total: number;
    official: number;
    affiliated: number;
    hosted: number;
    carried: number;
    transferred: number;
    expelled: number;
    graduated: number;
    byGender: { male: number; female: number };
    byStage: Array<{ stage_id: string; stage_name: string; count: number }>;
    byClass: Array<{ class_id: string; label: string; count: number; capacity: number }>;
    directory: Array<{
      student_id: string;
      full_name: string;
      gender: string;
      class_label: string;
      stage_name: string;
      enroll_status: string;
    }>;
  };
  teachers: {
    total: number;
    directory: Array<{
      teacher_id: string;
      full_name: string;
      job_title: string;
      degree: string;
      specialty: string;
      subjects: string;
      status: string;
    }>;
  };
  academics: {
    gradesEvaluated: number;
    gradesPassed: number;
    gradesFailed: number;
    evaluatedStudents: number;
    passedStudents: number;
    failedStudents: number;
    overallAverage: number | null;
    byStage: Array<{
      stage_id: string;
      stage_name: string;
      evaluated: number;
      passed: number;
      failed: number;
      avgScore: number | null;
    }>;
    bySubject: Array<{
      subject_id: string;
      subject_name: string;
      stage_name: string;
      evaluated: number;
      passed: number;
      failed: number;
      avgScore: number | null;
    }>;
  };
  attendance: {
    todayDate: string;
    totalTeachers: number;
    todayPresent: number;
    todayOnTime: number;
    todayLate: number;
    todayAbsent: number;
    todayLeave: number;
    totalRecords: number;
    onTimeRecords: number;
    lateRecords: number;
    absentRecords: number;
    leaveRecords: number;
    lockedTeachers: number;
    totalLateMinutes: number;
    dailyTrend: Array<{ date: string; on_time: number; late: number; total: number }>;
    byTeacher: Array<{
      teacher_id: string;
      teacher_name: string;
      specialty: string;
      total_days: number;
      on_time_days: number;
      late_days: number;
      absent_days: number;
      leave_days: number;
      total_late_minutes: number;
      locked: boolean;
      lock_reason: string;
      today_status: 'on_time' | 'late' | 'absent' | 'excused_leave';
      today_check_in: string;
      today_check_out: string;
    }>;
    records: AttendanceRow[];
  };
  complaints: {
    total: number;
    open: number;
    in_review: number;
    resolved: number;
    byCategory: Array<{ category: string; count: number }>;
    items: ComplaintRow[];
  };
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
  educationEnabled: boolean;
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
  attendance_start_time: string;
  attendance_end_time: string;
  attendance_grace_minutes: number;
  attendance_workdays: string;
  admin_name: string;
  announcements: AnnouncementRow[];
  stats: {
    students_count: number;
    teachers_count: number;
    classes_count: number;
    unused_ids_count: number;
  };
}
