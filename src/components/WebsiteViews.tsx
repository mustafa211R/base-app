import React, { useEffect, useMemo, useState } from 'react';
import {
  Home,
  BarChart3,
  User,
  Users,
  School,
  ClipboardList,
  GraduationCap,
  Printer,
  MapPin,
  Search,
  Save,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Lock,
  Fingerprint,
  MessageSquareWarning,
  Clock,
  Send,
} from 'lucide-react';
import { formatIdGrouped } from '../../shared/luhn.ts';
import type {
  AssignmentRow,
  AuthSession,
  ComplaintRow,
  GradeRow,
  PublicSchoolData,
  Role,
  TeacherAttendanceMineResponse,
} from '../../shared/types.ts';
import {
  api,
  COMPLAINT_STATUS_LABELS,
  ENROLL_STATUS_LABELS,
  formatErrorAr,
  formatShifts,
  SCHOOL_TYPE_LABELS,
} from '../lib/api.ts';
import { DeveloperCard, DeveloperFooter } from './DeveloperFooter.tsx';

interface WebsiteViewsProps {
  role: Role; // 'student' | 'teacher' | 'guest'
  session: AuthSession | null;
  publicData: PublicSchoolData;
  onLogout: () => void;
}

interface StudentGradesResponse {
  student: {
    student_id: string;
    full_name: string;
    class_id: string;
    class_label: string;
    stage_id: string;
    stage_name: string;
  };
  pass_mark: number;
  academic_year: string;
  rows: GradeRow[];
}

export function WebsiteViews({ role, session, publicData, onLogout }: WebsiteViewsProps) {
  const defaultTab = role === 'guest' ? 'school' : 'home';
  const [tab, setTab] = useState<string>(defaultTab);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Data states
  const [myProfile, setMyProfile] = useState<Record<string, unknown> | null>(null);
  const [myPhoto, setMyPhoto] = useState('');
  const [myGrades, setMyGrades] = useState<StudentGradesResponse | null>(null);

  const [teachersList, setTeachersList] = useState<Array<Record<string, unknown>>>([]);
  const [studentsResult, setStudentsResult] = useState<{
    mode: string;
    items: Array<Record<string, unknown>>;
    stats?: Array<{ class_id: string; label: string; count: number }>;
  }>({ mode: 'full', items: [] });

  // Teacher assignments & grade entry
  const [assignments, setAssignments] = useState<Array<AssignmentRow & { subject_name?: string; class_label?: string }>>([]);
  const [selectedAssignIdx, setSelectedAssignIdx] = useState(0);
  const [gradeSheet, setGradeSheet] = useState<Array<Record<string, unknown>>>([]);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  // Student search & detail modal
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<Record<string, unknown> | null>(null);
  const [selectedStudentPhoto, setSelectedStudentPhoto] = useState('');

  // Self edit for student if allowed
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Teacher attendance (fingerprint)
  const [myAttendance, setMyAttendance] = useState<TeacherAttendanceMineResponse | null>(null);
  const [punchNote, setPunchNote] = useState('');
  const [punchBusy, setPunchBusy] = useState(false);

  // Student complaints
  const [myComplaints, setMyComplaints] = useState<ComplaintRow[]>([]);
  const [cmpCategory, setCmpCategory] = useState('أكاديمي وتدريس');
  const [cmpTitle, setCmpTitle] = useState('');
  const [cmpDetails, setCmpDetails] = useState('');
  const [cmpBusy, setCmpBusy] = useState(false);

  const navItems = useMemo(() => {
    if (role === 'student') {
      return [
        { id: 'home', label: 'الرئيسية', icon: Home },
        { id: 'grades', label: 'درجاتي', icon: BarChart3 },
        { id: 'profile', label: 'بروفايلي', icon: User },
        { id: 'complaints', label: 'الشكاوى', icon: MessageSquareWarning },
        { id: 'teachers', label: 'المدرسون', icon: Users },
        { id: 'school', label: 'المدرسة', icon: School },
      ];
    }
    if (role === 'teacher') {
      return [
        { id: 'home', label: 'الرئيسية', icon: Home },
        { id: 'attendance', label: 'البصمة والحضور', icon: Fingerprint },
        { id: 'gradebook', label: 'درجات صفوفي', icon: ClipboardList },
        { id: 'students', label: 'الطلاب', icon: GraduationCap },
        { id: 'profile', label: 'بروفايلي', icon: User },
        { id: 'school', label: 'المدرسة', icon: School },
      ];
    }
    return [
      { id: 'school', label: 'المدرسة', icon: School },
      { id: 'teachers', label: 'المدرسون', icon: Users },
      { id: 'students', label: 'الطلاب', icon: GraduationCap },
    ];
  }, [role]);

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, session?.id]);

  async function loadInitialData() {
    setErrorMsg('');
    try {
      if (role === 'student' && session) {
        const [prof, grades, tList, cmps] = await Promise.all([
          api<Record<string, unknown>>('student.get', { student_id: session.id }),
          api<StudentGradesResponse>('grades.mine'),
          api<Array<Record<string, unknown>>>('teacher.list'),
          api<ComplaintRow[]>('complaints.mine'),
        ]);
        setMyProfile(prof);
        setEditAddress(String(prof.address || ''));
        setEditPhone(String(prof.guardian_phone || ''));
        setMyGrades(grades);
        setTeachersList(tList);
        setMyComplaints(cmps || []);
        if (prof.photo_file_id) {
          api<string>('photo.get', { entity: 'student', id: session.id })
            .then(setMyPhoto)
            .catch(() => setMyPhoto(''));
        }
      } else if (role === 'teacher' && session) {
        const [prof, asgs, sRes, attRes] = await Promise.all([
          api<Record<string, unknown>>('teacher.get', { teacher_id: session.id }),
          api<Array<AssignmentRow & { subject_name?: string; class_label?: string }>>('admin.assignmentsList'),
          api<{ mode: string; items: Array<Record<string, unknown>> }>('student.list'),
          api<TeacherAttendanceMineResponse>('attendance.mine'),
        ]);
        setMyProfile(prof);
        setAssignments(asgs);
        setStudentsResult(sRes);
        setMyAttendance(attRes);
        if (prof.photo_file_id) {
          api<string>('photo.get', { entity: 'teacher', id: session.id })
            .then(setMyPhoto)
            .catch(() => setMyPhoto(''));
        }
        if (asgs.length > 0) {
          loadTeacherGradeSheet(asgs[0].class_id, asgs[0].subject_id);
        }
      } else if (role === 'guest') {
        const [tList, sRes] = await Promise.all([
          api<Array<Record<string, unknown>>>('teacher.list'),
          api<{
            mode: string;
            items: Array<Record<string, unknown>>;
            stats?: Array<{ class_id: string; label: string; count: number }>;
          }>('student.list'),
        ]);
        setTeachersList(tList);
        setStudentsResult(sRes);
      }
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    }
  }

  async function loadTeacherGradeSheet(classId: string, subjectId: string) {
    try {
      const sheet = await api<Array<Record<string, unknown>>>('grades.sheet', {
        class_id: classId,
        subject_id: subjectId,
      });
      setGradeSheet(sheet);
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    }
  }

  function updateGradeField(studentId: string, field: string, value: string) {
    setGradeSheet((prev) =>
      prev.map((row) => (row.student_id === studentId ? { ...row, [field]: value } : row))
    );
  }

  async function saveGradeRow(row: Record<string, unknown>) {
    const asg = assignments[selectedAssignIdx];
    if (!asg) return;
    setSavingRowId(String(row.student_id));
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const saved = await api<{ avg_t1: number | ''; avg_t2: number | ''; annual_effort: number | ''; final: number | '' }>(
        'grades.save',
        {
          grade: {
            student_id: row.student_id,
            subject_id: asg.subject_id,
            year: publicData.academic_year,
            m1: row.m1,
            m2: row.m2,
            mid_year: row.mid_year,
            m3: row.m3,
            m4: row.m4,
            final_exam: row.final_exam,
            round: row.round || 1,
          },
        }
      );
      setGradeSheet((prev) =>
        prev.map((r) => (r.student_id === row.student_id ? { ...r, ...saved } : r))
      );
      setSuccessMsg(`تم حفظ درجات الطالب ${row.full_name}`);
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setSavingRowId(null);
    }
  }

  async function openStudentDetail(studentId: string) {
    setSelectedStudentPhoto('');
    try {
      const detail = await api<Record<string, unknown>>('student.get', { student_id: studentId });
      setSelectedStudentDetail(detail);
      if (detail.photo_file_id) {
        api<string>('photo.get', { entity: 'student', id: studentId })
          .then(setSelectedStudentPhoto)
          .catch(() => setSelectedStudentPhoto(''));
      }
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    }
  }

  async function handleStudentSelfSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await api('student.selfUpdate', {
        profile: { address: editAddress, guardian_phone: editPhone },
      });
      setSuccessMsg('تم تحديث بياناتك بنجاح');
      loadInitialData();
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    }
  }

  async function handleTeacherPunch(type: 'in' | 'out', tryBiometric = false) {
    setPunchBusy(true);
    setErrorMsg('');
    setSuccessMsg('');
    let method: 'fingerprint_digital' | 'webauthn' = 'fingerprint_digital';
    try {
      if (tryBiometric && typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials?.create) {
        try {
          const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          if (available) {
            const challenge = new Uint8Array(16);
            window.crypto.getRandomValues(challenge);
            const userBytes = new TextEncoder().encode(session?.id || 'teacher');
            await navigator.credentials.create({
              publicKey: {
                challenge,
                rp: { name: publicData.school_name || 'base school' },
                user: { id: userBytes, name: session?.id || 'teacher', displayName: String(myProfile?.full_name || 'مدرس') },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                timeout: 15000,
              },
            });
            method = 'webauthn';
          }
        } catch {
          method = 'fingerprint_digital';
        }
      }
      await api('attendance.punch', {
        type,
        method,
        device_note: punchNote.trim(),
      });
      setPunchNote('');
      const updated = await api<TeacherAttendanceMineResponse>('attendance.mine');
      setMyAttendance(updated);
      setSuccessMsg(type === 'in' ? 'تم تسجيل بصمة الحضور بنجاح' : 'تم تسجيل بصمة الانصراف بنجاح');
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setPunchBusy(false);
    }
  }

  async function handleCreateComplaint(e: React.FormEvent) {
    e.preventDefault();
    if (!cmpTitle.trim() || !cmpDetails.trim()) return;
    setCmpBusy(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await api('complaints.create', {
        category: cmpCategory,
        title: cmpTitle.trim(),
        details: cmpDetails.trim(),
      });
      setCmpTitle('');
      setCmpDetails('');
      const list = await api<ComplaintRow[]>('complaints.mine');
      setMyComplaints(list || []);
      setSuccessMsg('تم إرسال شكواك بنجاح، وستظهر لإدارة المدرسة وقسم الإشراف التربوي');
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setCmpBusy(false);
    }
  }

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return studentsResult.items;
    return studentsResult.items.filter((s) =>
      String(s.full_name || '').toLowerCase().includes(q) ||
      String(s.class_label || '').toLowerCase().includes(q)
    );
  }, [studentsResult.items, studentSearch]);

  const relevantAnnouncements = useMemo(() => {
    return publicData.announcements.filter(
      (a) => a.audience === 'all' || (role === 'student' && a.audience === 'students') || (role === 'teacher' && a.audience === 'teachers')
    );
  }, [publicData.announcements, role]);

  const latestGrade = useMemo(() => {
    if (!myGrades) return null;
    return myGrades.rows.find((r) => r.final !== '' || r.mid_year !== '' || r.m1 !== '') || null;
  }, [myGrades]);

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:pb-8">
      {/* Top Bar Contract (3 zones) */}
      <header className="no-print bg-[#0F294A] text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="font-bold text-base sm:text-lg whitespace-nowrap shrink-0 truncate max-w-[220px]">
            {publicData.school_name}
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-200">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === item.id
                    ? 'border-[#C59B27] text-white font-semibold'
                    : 'border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{role === 'guest' ? 'العودة للدخول' : 'تسجيل الخروج'}</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {errorMsg && (
          <div className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="no-print p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* STUDENT HOME */}
        {role === 'student' && tab === 'home' && myProfile && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                  مرحباً، {String(myProfile.full_name || 'الطالب')}
                </h1>
                <p className="text-sm text-slate-600 mt-1 flex flex-wrap items-center gap-2">
                  <span>{String(myProfile.class_label || '')}</span>
                  <span aria-hidden="true">·</span>
                  <span>حالة القيد: {ENROLL_STATUS_LABELS[String(myProfile.enroll_status || 'official')]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{publicData.academic_year}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab('grades')}
                className="px-4 py-2.5 bg-[#0F294A] text-white text-sm font-medium rounded-lg hover:bg-[#163864] whitespace-nowrap shrink-0 cursor-pointer"
              >
                عرض سجل الدرجات
              </button>
            </div>

            {latestGrade && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">آخر مادة مرصودة</div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">{latestGrade.subject_name}</div>
                </div>
                <div className="text-left">
                  <div className="text-xs text-slate-500">الدرجة النهائية / السعي</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-[#0F294A]">
                    {latestGrade.final !== '' ? latestGrade.final : latestGrade.annual_effort !== '' ? latestGrade.annual_effort : latestGrade.m1}
                  </div>
                </div>
              </div>
            )}

            <AnnouncementsSection items={relevantAnnouncements} />
          </div>
        )}

        {/* STUDENT GRADES + PRINT CERTIFICATE */}
        {role === 'student' && tab === 'grades' && myGrades && (
          <div className="space-y-4">
            <div className="no-print flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">درجاتي — العام {myGrades.academic_year}</h2>
                <p className="text-sm text-slate-500">
                  {myGrades.student.class_label} · حد النجاح: {myGrades.pass_mark}
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 bg-[#B8860B] hover:bg-[#9E7208] text-white text-sm font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة / تنزيل الشهادة PDF</span>
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 print:border-2 print:border-slate-900">
              <div className="hidden print:block text-center border-b border-slate-300 pb-4 mb-4">
                <h1 className="text-xl font-bold">{publicData.school_name}</h1>
                <p className="text-sm mt-1">
                  شهادة درجات الطالب للعام الدراسي {myGrades.academic_year}
                </p>
                <div className="flex justify-between text-sm mt-3 font-medium">
                  <span>الطالب: {myGrades.student.full_name}</span>
                  <span>الصف والشعبة: {myGrades.student.class_label}</span>
                  <span className="font-mono">{formatIdGrouped(myGrades.student.student_id)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="bg-[#0F294A] text-white">
                      <th className="py-2.5 px-3 font-semibold">المادة</th>
                      <th className="py-2.5 px-2 font-semibold text-center">ش1</th>
                      <th className="py-2.5 px-2 font-semibold text-center">ش2</th>
                      <th className="py-2.5 px-2 font-semibold text-center">معدل ف1</th>
                      <th className="py-2.5 px-2 font-semibold text-center">نصف السنة</th>
                      <th className="py-2.5 px-2 font-semibold text-center">ش3</th>
                      <th className="py-2.5 px-2 font-semibold text-center">ش4</th>
                      <th className="py-2.5 px-2 font-semibold text-center">معدل ف2</th>
                      <th className="py-2.5 px-2 font-semibold text-center">السعي السنوي</th>
                      <th className="py-2.5 px-2 font-semibold text-center">نهاية السنة</th>
                      <th className="py-2.5 px-2 font-semibold text-center">النهائية</th>
                      <th className="py-2.5 px-3 font-semibold text-center">النتيجة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {myGrades.rows.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-8 text-center text-slate-500">
                          لا توجد مواد دراسية مضافة لهذه المرحلة بعد
                        </td>
                      </tr>
                    ) : (
                      myGrades.rows.map((r) => {
                        const fin = r.final === '' || r.final === null ? null : Number(r.final);
                        const passed = fin !== null && fin >= myGrades.pass_mark;
                        return (
                          <tr key={r.subject_id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-medium text-slate-900">{r.subject_name}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.m1 === '' ? '—' : r.m1}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.m2 === '' ? '—' : r.m2}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums font-medium bg-slate-50">{r.avg_t1 === '' ? '—' : r.avg_t1}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.mid_year === '' ? '—' : r.mid_year}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.m3 === '' ? '—' : r.m3}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.m4 === '' ? '—' : r.m4}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums font-medium bg-slate-50">{r.avg_t2 === '' ? '—' : r.avg_t2}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums font-semibold text-[#0F294A]">{r.annual_effort === '' ? '—' : r.annual_effort}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">{r.final_exam === '' ? '—' : r.final_exam}</td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums font-bold">{fin === null ? '—' : fin}</td>
                            <td className="py-2.5 px-3 text-center font-medium">
                              {fin === null ? (
                                <span className="text-slate-400">قيد الرصد</span>
                              ) : passed ? (
                                <span className="text-emerald-700">ناجح</span>
                              ) : (
                                <span className="text-red-700">مكمل / راسب</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="hidden print:flex justify-between mt-10 pt-4 border-t border-slate-300 text-sm">
                <span>توقيع المرشد التربوي</span>
                <span>توقيع وختم مدير المدرسة: {publicData.admin_name}</span>
              </div>
            </div>
          </div>
        )}

        {/* TEACHER HOME */}
        {role === 'teacher' && tab === 'home' && myProfile && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                  مرحباً، {String(myProfile.full_name || 'الأستاذ')}
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  {String(myProfile.job_title || 'مدرس')} · {String(myProfile.specialty || '')} · صفوفك المسندة: {assignments.length}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTab('attendance')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-lg hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>البصمة الحضورية</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('gradebook')}
                  className="px-4 py-2.5 bg-[#0F294A] text-white text-sm font-medium rounded-lg hover:bg-[#163864] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  إدخال الدرجات
                </button>
              </div>
            </div>

            {myAttendance && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#0F294A]/10 text-[#0F294A] flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      حالة البصمة اليوم ({myAttendance.todayDate})
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {myAttendance.todayRecord
                        ? `حضور: ${myAttendance.todayRecord.check_in_time}${
                            myAttendance.todayRecord.check_out_time
                              ? ` · انصراف: ${myAttendance.todayRecord.check_out_time}`
                              : ' · بانتظار الانصراف'
                          }`
                        : `لم تُسجل بصمة الحضور بعد · وقت الدوام ${myAttendance.schedule.attendance_start_time} – ${myAttendance.schedule.attendance_end_time}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('attendance')}
                  className="text-xs px-3.5 py-2 border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  فتح سجل الحضور والبصمة
                </button>
              </div>
            )}

            {assignments.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="font-bold text-slate-900 mb-3">المواد والشعب المسندة لك</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {assignments.map((a, idx) => (
                    <button
                      key={a.assign_id}
                      type="button"
                      onClick={() => {
                        setSelectedAssignIdx(idx);
                        loadTeacherGradeSheet(a.class_id, a.subject_id);
                        setTab('gradebook');
                      }}
                      className="p-3.5 border border-slate-200 hover:border-[#0F294A] rounded-lg text-right transition-colors cursor-pointer"
                    >
                      <div className="font-semibold text-slate-900">{a.subject_name}</div>
                      <div className="text-xs text-slate-500 mt-1">{a.class_label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <AnnouncementsSection items={relevantAnnouncements} />
          </div>
        )}

        {/* TEACHER FINGERPRINT ATTENDANCE & PERSONAL LOG */}
        {role === 'teacher' && tab === 'attendance' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-[#B8860B]" />
                    <span>البصمة الحضورية وسجل الحضور الشخصي</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    توقيت الدوام المحدد من الإدارة: من{' '}
                    <span className="font-mono font-semibold text-slate-800" dir="ltr">
                      {myAttendance?.schedule.attendance_start_time || publicData.attendance_start_time}
                    </span>{' '}
                    إلى{' '}
                    <span className="font-mono font-semibold text-slate-800" dir="ltr">
                      {myAttendance?.schedule.attendance_end_time || publicData.attendance_end_time}
                    </span>{' '}
                    · فترة سماح{' '}
                    <span className="font-mono tabular-nums font-semibold">
                      {myAttendance?.schedule.attendance_grace_minutes ?? publicData.attendance_grace_minutes}
                    </span>{' '}
                    دقيقة (بتوقيت بغداد)
                  </p>
                </div>
                {myAttendance && (
                  <div className="text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
                    {myAttendance.todayDate}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="text-xs font-medium text-slate-500">حالة بصمة اليوم</div>
                  {myAttendance?.todayRecord ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">وقت الحضور:</span>
                        <span className="font-mono font-bold text-slate-900" dir="ltr">
                          {myAttendance.todayRecord.check_in_time}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">وقت الانصراف:</span>
                        <span className="font-mono font-bold text-slate-900" dir="ltr">
                          {myAttendance.todayRecord.check_out_time || 'لم يسجل بعد'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">التقييم:</span>
                        <span
                          className={`font-semibold ${
                            myAttendance.todayRecord.status === 'on_time' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {myAttendance.todayRecord.status === 'on_time'
                            ? 'حضور بالوقت المحدد'
                            : `متأخر (${myAttendance.todayRecord.late_minutes} دقيقة)`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">
                      لم تقم بتسجيل بصمة الحضور لهذا اليوم بعد. اضغط على زر البصمة لتثبيت حضورك الآن.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={punchNote}
                    onChange={(e) => setPunchNote(e.target.value)}
                    placeholder="ملاحظة اختيارية (مثلاً: حصة أولى / عذر تأخير)..."
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <div className="flex flex-wrap gap-2.5">
                    {!myAttendance?.todayRecord ? (
                      <>
                        <button
                          type="button"
                          disabled={punchBusy}
                          onClick={() => handleTeacherPunch('in', false)}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-50 text-white text-sm font-semibold rounded-xl cursor-pointer"
                        >
                          <Fingerprint className="w-5 h-5 text-[#C59B27]" />
                          <span>{punchBusy ? 'جارٍ تسجيل البصمة...' : 'تسجيل بصمة الحضور'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={punchBusy}
                          onClick={() => handleTeacherPunch('in', true)}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-3 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl cursor-pointer"
                          title="استخدام مستشعر بصمة الجهاز إن توفر"
                        >
                          <span>بصمة الجهاز</span>
                        </button>
                      </>
                    ) : !myAttendance.todayRecord.check_out_time ? (
                      <button
                        type="button"
                        disabled={punchBusy}
                        onClick={() => handleTeacherPunch('out', false)}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#B8860B] hover:bg-[#9E7208] disabled:opacity-50 text-white text-sm font-semibold rounded-xl cursor-pointer"
                      >
                        <Fingerprint className="w-5 h-5" />
                        <span>{punchBusy ? 'جارٍ تسجيل الانصراف...' : 'تسجيل بصمة الانصراف'}</span>
                      </button>
                    ) : (
                      <div className="w-full p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm text-center font-medium">
                        تم إكمال بصمة الحضور والانصراف لهذا اليوم
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {myAttendance && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs text-slate-500">إجمالي أيام الحضور</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {myAttendance.summary.totalDays}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs text-slate-500">حضور بالوقت</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                      {myAttendance.summary.onTimeDays}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs text-slate-500">أيام التأخير</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                      {myAttendance.summary.lateDays}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs text-slate-500">مجموع دقائق التأخير</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {myAttendance.summary.totalLateMinutes} د
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-sm">سجل حضوري الشخصي (للقراءة فقط)</h3>
                    <span className="text-xs text-slate-500">{myAttendance.records.length} سجل</span>
                  </div>
                  <table className="w-full text-xs text-right">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <th className="py-2.5 px-4">التاريخ</th>
                        <th className="py-2.5 px-4 text-center">وقت الحضور</th>
                        <th className="py-2.5 px-4 text-center">وقت الانصراف</th>
                        <th className="py-2.5 px-4 text-center">الحالة</th>
                        <th className="py-2.5 px-4 text-center">دقائق التأخير</th>
                        <th className="py-2.5 px-4">الملاحظة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {myAttendance.records.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">
                            لا توجد بصمات مسجلة في حسابك بعد
                          </td>
                        </tr>
                      ) : (
                        myAttendance.records.map((r) => (
                          <tr key={r.att_id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4 font-mono tabular-nums" dir="ltr">{r.att_date}</td>
                            <td className="py-2.5 px-4 text-center font-mono tabular-nums" dir="ltr">{r.check_in_time || '—'}</td>
                            <td className="py-2.5 px-4 text-center font-mono tabular-nums" dir="ltr">{r.check_out_time || '—'}</td>
                            <td className="py-2.5 px-4 text-center font-medium">
                              <span className={r.status === 'on_time' ? 'text-emerald-700' : 'text-amber-700'}>
                                {r.status === 'on_time' ? 'بالوقت' : 'متأخر'}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-center font-mono tabular-nums">
                              {r.late_minutes > 0 ? `${r.late_minutes} د` : '0'}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">{r.device_note || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* TEACHER GRADEBOOK */}
        {role === 'teacher' && tab === 'gradebook' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">سجل درجات صفوفي</h2>
                <p className="text-xs text-slate-500">الحساب التلقائي للمعدلات والسعي السنوي يتم في الخادم عند الحفظ</p>
              </div>
              {assignments.length > 0 && (
                <select
                  value={selectedAssignIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setSelectedAssignIdx(idx);
                    const a = assignments[idx];
                    if (a) loadTeacherGradeSheet(a.class_id, a.subject_id);
                  }}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {assignments.map((a, idx) => (
                    <option key={a.assign_id} value={idx}>
                      {a.class_label} — {a.subject_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {assignments.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
                لم يتم إسناد أي صفوف أو مواد لك من قبل الإدارة بعد.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="bg-[#0F294A] text-white">
                      <th className="py-2.5 px-3 font-semibold">الطالب</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ش1</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ش2</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ف1</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">نصف السنة</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ش3</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ش4</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">ف2</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">السعي</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">النهائي</th>
                      <th className="py-2.5 px-1.5 font-semibold text-center">الدرجة</th>
                      <th className="py-2.5 px-2 font-semibold text-center">حفظ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {gradeSheet.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-8 text-center text-slate-500">
                          لا يوجد طلاب مسجلون في هذه الشعبة بعد
                        </td>
                      </tr>
                    ) : (
                      gradeSheet.map((r) => (
                        <tr key={String(r.student_id)} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                            {String(r.full_name)}
                          </td>
                          {(['m1', 'm2'] as const).map((f) => (
                            <td key={f} className="py-1.5 px-1 text-center">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={r[f] === null ? '' : String(r[f])}
                                onChange={(e) => updateGradeField(String(r.student_id), f, e.target.value)}
                                className="w-14 px-1.5 py-1 border border-slate-300 rounded text-center font-mono tabular-nums text-xs"
                              />
                            </td>
                          ))}
                          <td className="py-1.5 px-1 text-center font-mono tabular-nums text-xs bg-slate-50 font-semibold">
                            {r.avg_t1 === '' || r.avg_t1 == null ? '—' : String(r.avg_t1)}
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={r.mid_year === null ? '' : String(r.mid_year)}
                              onChange={(e) => updateGradeField(String(r.student_id), 'mid_year', e.target.value)}
                              className="w-14 px-1.5 py-1 border border-slate-300 rounded text-center font-mono tabular-nums text-xs"
                            />
                          </td>
                          {(['m3', 'm4'] as const).map((f) => (
                            <td key={f} className="py-1.5 px-1 text-center">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={r[f] === null ? '' : String(r[f])}
                                onChange={(e) => updateGradeField(String(r.student_id), f, e.target.value)}
                                className="w-14 px-1.5 py-1 border border-slate-300 rounded text-center font-mono tabular-nums text-xs"
                              />
                            </td>
                          ))}
                          <td className="py-1.5 px-1 text-center font-mono tabular-nums text-xs bg-slate-50 font-semibold">
                            {r.avg_t2 === '' || r.avg_t2 == null ? '—' : String(r.avg_t2)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono tabular-nums text-xs font-bold text-[#0F294A]">
                            {r.annual_effort === '' || r.annual_effort == null ? '—' : String(r.annual_effort)}
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={r.final_exam === null ? '' : String(r.final_exam)}
                              onChange={(e) => updateGradeField(String(r.student_id), 'final_exam', e.target.value)}
                              className="w-14 px-1.5 py-1 border border-slate-300 rounded text-center font-mono tabular-nums text-xs"
                            />
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono tabular-nums text-xs font-bold">
                            {r.final === '' || r.final == null ? '—' : String(r.final)}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              disabled={savingRowId === String(r.student_id)}
                              onClick={() => saveGradeRow(r)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#0F294A] hover:bg-[#163864] text-white rounded text-xs cursor-pointer"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>{savingRowId === String(r.student_id) ? '...' : 'حفظ'}</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PROFILE (STUDENT / TEACHER SELF) */}
        {(role === 'student' || role === 'teacher') && tab === 'profile' && myProfile && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
              <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {myPhoto ? (
                  <img src={myPhoto} alt={String(myProfile.full_name || '')} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-8 h-8 text-slate-400" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{String(myProfile.full_name || '')}</h2>
                <p className="text-sm text-slate-500 font-mono tabular-nums mt-0.5">
                  {session ? formatIdGrouped(session.id) : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              {Object.entries(myProfile)
                .filter(([k]) => !['photo_file_id', 'student_id', 'teacher_id'].includes(k))
                .map(([k, v]) => (
                  <div key={k} className="p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                    <div className="text-xs text-slate-500">{FIELD_LABELS_AR[k] || k}</div>
                    <div className="font-medium text-slate-900 mt-0.5">{String(v || '—')}</div>
                  </div>
                ))}
            </div>

            {role === 'student' && publicData.allow_student_self_edit && (
              <form onSubmit={handleStudentSelfSave} className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="font-bold text-slate-900 text-sm">التعديل الذاتي المسموح به من الإدارة</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">العنوان السكني</label>
                    <input
                      type="text"
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">هاتف ولي الأمر</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#0F294A] text-white text-sm rounded-lg cursor-pointer"
                >
                  حفظ التعديلات
                </button>
              </form>
            )}

            {role === 'student' && (
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <MessageSquareWarning className="w-4 h-4 text-[#B8860B]" />
                    <span>قسم الشكاوى والمقترحات</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    يمكنك تقديم شكوى أو مقترح ليصل مباشرةً إلى مدير المدرسة وقسم الإشراف التربوي ({myComplaints.length} شكوى مسجلة)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('complaints')}
                  className="px-4 py-2 bg-[#B8860B] hover:bg-[#9E7208] text-white text-xs sm:text-sm font-medium rounded-lg cursor-pointer"
                >
                  فتح قسم الشكاوى
                </button>
              </div>
            )}
          </div>
        )}

        {/* STUDENT COMPLAINTS SECTION */}
        {role === 'student' && tab === 'complaints' && (
          <div className="space-y-6">
            <form onSubmit={handleCreateComplaint} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <MessageSquareWarning className="w-5 h-5 text-[#B8860B]" />
                  <span>تقديم شكوى جديدة</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  تُعرض الشكاوى لمدير المدرسة ومديرية التربية والإشراف التربوي لمتابعتها ومعالجتها
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">تصنيف الشكوى</label>
                  <select
                    value={cmpCategory}
                    onChange={(e) => setCmpCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="أكاديمي وتدريس">أكاديمي وتدريس</option>
                    <option value="درجات وامتحانات">درجات وامتحانات</option>
                    <option value="بنية تحتية وخدمات">بنية تحتية وخدمات</option>
                    <option value="سلوك وانضباط">سلوك وانضباط</option>
                    <option value="أخرى">أخرى</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">عنوان الشكوى *</label>
                  <input
                    type="text"
                    required
                    value={cmpTitle}
                    onChange={(e) => setCmpTitle(e.target.value)}
                    placeholder="ملخص قصير للموضوع..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">تفاصيل الشكوى *</label>
                <textarea
                  rows={3}
                  required
                  value={cmpDetails}
                  onChange={(e) => setCmpDetails(e.target.value)}
                  placeholder="اشرح التفاصيل بوضوح..."
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={cmpBusy}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{cmpBusy ? 'جارٍ الإرسال...' : 'إرسال الشكوى'}</span>
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-slate-900 text-base">شكاواي المسجلة ({myComplaints.length})</h3>
              {myComplaints.length === 0 ? (
                <p className="text-sm text-slate-500">لم تقم بتقديم أي شكوى حتى الآن</p>
              ) : (
                <div className="space-y-3">
                  {myComplaints.map((c) => (
                    <div key={c.complaint_id} className="p-4 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 text-sm">{c.title}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {c.category} · <span className="font-mono" dir="ltr">{c.created_at.slice(0, 10)}</span>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold ${
                            c.status === 'resolved'
                              ? 'text-emerald-700'
                              : c.status === 'in_review'
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {COMPLAINT_STATUS_LABELS[c.status] || c.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{c.details}</p>
                      {c.admin_reply && (
                        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                          <span className="font-semibold text-[#0F294A]">رد الإدارة: </span>
                          <span>{c.admin_reply}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STUDENTS LIST (TEACHER / GUEST) */}
        {(role === 'teacher' || role === 'guest') && tab === 'students' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {role === 'teacher' ? 'طلاب صفوفي' : 'قائمة الطلاب'}
                </h2>
                <p className="text-xs text-slate-500">
                  البيانات المعروضة مفلترة بالكامل على الخادم حسب مصفوفة الصلاحيات
                </p>
              </div>
              {studentsResult.mode !== 'off' && studentsResult.mode !== 'stats_only' && (
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الشعبة..."
                    className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  />
                </div>
              )}
            </div>

            {studentsResult.mode === 'off' ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-600 flex flex-col items-center gap-2">
                <Lock className="w-6 h-6 text-slate-400" />
                <span>عرض بيانات الطلاب مقيد حالياً للأعضاء فقط حسب إعدادات خصوصية المدرسة.</span>
              </div>
            ) : studentsResult.mode === 'stats_only' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(studentsResult.stats || []).map((st) => (
                  <div key={st.class_id} className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-sm font-semibold text-slate-900">{st.label}</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-[#0F294A] mt-2">
                      {st.count} طالب
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                      <th className="py-2.5 px-4 font-semibold">الاسم</th>
                      <th className="py-2.5 px-4 font-semibold">الصف والشعبة</th>
                      <th className="py-2.5 px-4 font-semibold">الجنس</th>
                      {role === 'teacher' && <th className="py-2.5 px-4 font-semibold text-left">البروفايل</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          لا توجد نتائج مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((s, i) => (
                        <tr key={String(s.student_id || i)} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-medium text-slate-900">{String(s.full_name || '—')}</td>
                          <td className="py-2.5 px-4 text-slate-600">{String(s.class_label || '—')}</td>
                          <td className="py-2.5 px-4 text-slate-600">{String(s.gender || '—')}</td>
                          {role === 'teacher' && (
                            <td className="py-2.5 px-4 text-left">
                              <button
                                type="button"
                                onClick={() => openStudentDetail(String(s.student_id))}
                                className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                              >
                                عرض التفاصيل
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {selectedStudentDetail && (
              <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h3 className="font-bold text-slate-900">ملف الطالب</h3>
                    <button
                      type="button"
                      onClick={() => setSelectedStudentDetail(null)}
                      className="text-sm text-slate-500 hover:text-slate-900 cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                      {selectedStudentPhoto ? (
                        <img src={selectedStudentPhoto} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-6 h-6 text-slate-400" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{String(selectedStudentDetail.full_name || '')}</div>
                      <div className="text-xs text-slate-500">{String(selectedStudentDetail.class_label || '')}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {Object.entries(selectedStudentDetail)
                      .filter(([k]) => !['photo_file_id', 'full_name', 'class_label'].includes(k))
                      .map(([k, v]) => (
                        <div key={k} className="p-2.5 bg-slate-50 rounded-lg">
                          <div className="text-xs text-slate-500">{FIELD_LABELS_AR[k] || k}</div>
                          <div className="font-medium text-slate-900">{String(v || '—')}</div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TEACHERS LIST (STUDENT / GUEST) */}
        {(role === 'student' || role === 'guest') && tab === 'teachers' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">الهيئة التدريسية</h2>
            {publicData.teacher_profile_visibility === 'admin_only' ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-600 flex flex-col items-center gap-2">
                <Lock className="w-6 h-6 text-slate-400" />
                <span>ملفات المدرسين متاحة للإدارة فقط حسب إعدادات الخصوصية.</span>
              </div>
            ) : teachersList.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
                لا يوجد مدرسون مسجلون بعد
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {teachersList.map((t, i) => (
                  <div key={String(t.teacher_id || i)} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                    <div className="font-bold text-slate-900 text-base">{String(t.full_name || 'مدرس')}</div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-2">
                      {t.job_title ? <span>{String(t.job_title)}</span> : null}
                      {t.degree ? <span>· {String(t.degree)}</span> : null}
                      {t.specialty ? <span>· {String(t.specialty)}</span> : null}
                    </div>
                    {t.subjects ? (
                      <div className="text-xs text-[#0F294A] font-medium">المواد: {String(t.subjects)}</div>
                    ) : null}
                    {t.bio_cv ? <p className="text-sm text-slate-600 pt-1">{String(t.bio_cv)}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SCHOOL INFO (ALL ROLES) */}
        {tab === 'school' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{publicData.school_name}</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {SCHOOL_TYPE_LABELS[publicData.school_type]} · {formatShifts(publicData.shift_type)} · سنة التأسيس:{' '}
                    <span className="font-mono tabular-nums">{publicData.founded_date || '—'}</span>
                  </p>
                </div>
                {publicData.map_url && (
                  <a
                    href={publicData.map_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 rounded-lg text-sm text-[#0F294A] hover:bg-slate-50"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>موقع المدرسة على الخرائط</span>
                  </a>
                )}
              </div>

              {publicData.about && <p className="text-sm text-slate-700 leading-relaxed">{publicData.about}</p>}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                  <div className="text-xs text-slate-500">مدير المدرسة</div>
                  <div className="font-semibold text-slate-900 mt-0.5 text-sm">{publicData.admin_name || '—'}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                  <div className="text-xs text-slate-500">الطلبة المسجلون</div>
                  <div className="font-bold font-mono tabular-nums text-slate-900 mt-0.5">{publicData.stats.students_count}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                  <div className="text-xs text-slate-500">الهيئة التدريسية</div>
                  <div className="font-bold font-mono tabular-nums text-slate-900 mt-0.5">{publicData.stats.teachers_count}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                  <div className="text-xs text-slate-500">الشعب الدراسية</div>
                  <div className="font-bold font-mono tabular-nums text-slate-900 mt-0.5">{publicData.stats.classes_count}</div>
                </div>
              </div>
            </div>

            <AnnouncementsSection items={relevantAnnouncements} />
            <DeveloperCard />
          </div>
        )}
      </main>

      <DeveloperFooter />

      {/* Mobile Bottom Navigation Bar (<= 15% sticky height, h-14) */}
      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 h-14 z-30 flex items-center justify-around px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-medium cursor-pointer ${
                active ? 'text-[#0F294A] font-bold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function AnnouncementsSection({ items }: { items: PublicSchoolData['announcements'] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <h3 className="font-bold text-slate-900 text-base">إعلانات المدرسة</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">لا توجد إعلانات منشورة حالياً</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {items.map((a) => (
            <div key={a.ann_id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 text-sm">{a.title}</span>
                <span className="text-xs font-mono tabular-nums text-slate-400">{a.publish_date}</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">{a.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FIELD_LABELS_AR: Record<string, string> = {
  full_name: 'الاسم الكامل',
  mother_name: 'اسم الأم',
  gender: 'الجنس',
  birth_date: 'تاريخ الميلاد',
  address: 'العنوان',
  guardian_name: 'ولي الأمر',
  guardian_phone: 'هاتف ولي الأمر',
  prev_school: 'المدرسة السابقة',
  prev_stage: 'المرحلة السابقة',
  prev_average: 'المعدل السابق',
  reg_reason: 'سبب التسجيل',
  enroll_date: 'تاريخ التسجيل',
  enroll_status: 'حالة القيد',
  class_id: 'رمز الشعبة',
  class_label: 'الصف والشعبة',
  stage_name: 'المرحلة',
  stage_id: 'رمز المرحلة',
  health_note: 'الملاحظات الصحية',
  notes: 'ملاحظات',
  status_note: 'سبب الحالة',
  degree: 'الشهادة',
  specialty: 'التخصص',
  university: 'الجامعة',
  college: 'الكلية',
  grad_year: 'سنة التخرج',
  job_title: 'العنوان الوظيفي',
  hire_date: 'تاريخ التعيين',
  start_date: 'تاريخ المباشرة',
  bio_cv: 'السيرة الذاتية',
  subjects: 'المواد',
  phone: 'الهاتف',
  whatsapp: 'الواتساب',
  email: 'البريد الإلكتروني',
};
