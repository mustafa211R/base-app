import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  MessageSquareWarning,
  Users,
  LogOut,
  ShieldAlert,
  RefreshCw,
  Search,
  Lock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { EducationDashboardData, PublicSchoolData } from '../../shared/types.ts';
import {
  api,
  COMPLAINT_STATUS_LABELS,
  ENROLL_STATUS_LABELS,
  formatErrorAr,
  formatShifts,
  SCHOOL_TYPE_LABELS,
} from '../lib/api.ts';
import { DeveloperCard, DeveloperFooter } from './DeveloperFooter.tsx';

interface EducationPortalProps {
  publicData: PublicSchoolData;
  onLogout: () => void;
}

type EduTab = 'overview' | 'attendance' | 'complaints' | 'directory';

const WORKDAY_NAMES: Record<string, string> = {
  '0': 'الأحد',
  '1': 'الإثنين',
  '2': 'الثلاثاء',
  '3': 'الأربعاء',
  '4': 'الخميس',
  '5': 'الجمعة',
  '6': 'السبت',
};

function formatWorkdays(str: string): string {
  return str
    .split(',')
    .map((d) => WORKDAY_NAMES[d.trim()] || d.trim())
    .filter(Boolean)
    .join(' · ');
}

function DonutChart({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offsetAcc = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-36 h-36 shrink-0">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="18" />
          {total > 0 &&
            segments.map((seg) => {
              if (seg.value <= 0) return null;
              const dash = (seg.value / total) * circumference;
              const dashOffset = -offsetAcc;
              offsetAcc += dash;
              return (
                <circle
                  key={seg.label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="18"
                  strokeDasharray={`${dash} ${circumference}`}
                  strokeDashoffset={dashOffset}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold font-mono tabular-nums text-slate-900">{centerValue}</span>
          <span className="text-[11px] text-slate-500">{centerLabel}</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2.5">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <div key={seg.label} className="flex items-center justify-between text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-slate-700 font-medium">{seg.label}</span>
              </div>
              <div className="font-mono tabular-nums text-slate-900 font-semibold">
                {seg.value} <span className="text-slate-400 font-normal">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EducationPortal({ publicData, onLogout }: EducationPortalProps) {
  const [tab, setTab] = useState<EduTab>('overview');
  const [data, setData] = useState<EducationDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Filters
  const [attSearch, setAttSearch] = useState('');
  const [attStatusFilter, setAttStatusFilter] = useState<'all' | 'on_time' | 'late'>('all');
  const [cmpStatusFilter, setCmpStatusFilter] = useState<'all' | 'open' | 'in_review' | 'resolved'>('all');
  const [cmpSearch, setCmpSearch] = useState('');
  const [dirSearch, setDirSearch] = useState('');

  async function loadDashboard() {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api<EducationDashboardData>('education.dashboard');
      setData(res);
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const filteredAttRecords = useMemo(() => {
    if (!data) return [];
    const q = attSearch.trim().toLowerCase();
    return data.attendance.records.filter((r) => {
      if (attStatusFilter !== 'all' && r.status !== attStatusFilter) return false;
      if (!q) return true;
      return (
        r.teacher_name.toLowerCase().includes(q) ||
        r.teacher_id.includes(q) ||
        r.att_date.includes(q)
      );
    });
  }, [data, attSearch, attStatusFilter]);

  const filteredComplaints = useMemo(() => {
    if (!data) return [];
    const q = cmpSearch.trim().toLowerCase();
    return data.complaints.items.filter((c) => {
      if (cmpStatusFilter !== 'all' && c.status !== cmpStatusFilter) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.details.toLowerCase().includes(q) ||
        c.student_name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });
  }, [data, cmpSearch, cmpStatusFilter]);

  const navTabs: Array<{ id: EduTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'الإحصاءات والرسوم البيانية', icon: BarChart3 },
    { id: 'attendance', label: 'سجل الحضور والبصمة', icon: Clock },
    { id: 'complaints', label: 'شكاوى الطلبة', icon: MessageSquareWarning },
    { id: 'directory', label: 'كشوفات المدرسة', icon: Users },
  ];

  const passRate =
    data && data.academics.gradesEvaluated > 0
      ? Math.round((data.academics.gradesPassed / data.academics.gradesEvaluated) * 100)
      : 0;

  const studentPassRate =
    data && data.academics.evaluatedStudents > 0
      ? Math.round((data.academics.passedStudents / data.academics.evaluatedStudents) * 100)
      : 0;

  const attendanceCommitmentRate =
    data && data.attendance.totalRecords > 0
      ? Math.round((data.attendance.onTimeRecords / data.attendance.totalRecords) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between pb-16 md:pb-0">
      <div>
        <header className="no-print bg-[#0F294A] text-white border-b border-slate-800 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#B8860B]/20 border border-[#C59B27]/50 flex items-center justify-center text-[#C59B27] shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm sm:text-base truncate">
                  قسم التربية والإشراف التربوي — {publicData.school_name}
                </div>
                <div className="text-[11px] text-slate-300 truncate">
                  اطلاع إشرافي ومراقبة الأداء (للقراءة فقط دون تعديل)
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={loadDashboard}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer"
                title="تحديث البيانات"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">تحديث</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            </div>
          </div>
          <div className="hidden md:block bg-[#0B1F3A] border-t border-white/10">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-6">
              {navTabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`py-3 text-xs sm:text-sm font-medium border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                      active
                        ? 'border-[#C59B27] text-white'
                        : 'border-transparent text-slate-300 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading && !data ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
              جارٍ تحميل تقارير وإحصاءات مديرية التربية والإشراف...
            </div>
          ) : data ? (
            <>
              {/* Top School Context Banner */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span>{SCHOOL_TYPE_LABELS[data.school.school_type] || data.school.school_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatShifts(data.school.shift_type)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">العام {data.school.academic_year}</span>
                    <span aria-hidden="true">·</span>
                    <span>المدير: {data.school.admin_name || '—'}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    دوام البصمة المعتمد: من{' '}
                    <span className="font-mono font-semibold text-slate-900" dir="ltr">
                      {data.school.schedule.attendance_start_time}
                    </span>{' '}
                    إلى{' '}
                    <span className="font-mono font-semibold text-slate-900" dir="ltr">
                      {data.school.schedule.attendance_end_time}
                    </span>{' '}
                    · سماح <span className="font-mono tabular-nums">{data.school.schedule.attendance_grace_minutes}</span> دقيقة
                  </div>
                </div>
                <div className="text-xs font-medium text-[#0F294A] bg-slate-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-[#B8860B]" />
                  <span>بوابة إشراف رسمية — القراءة فقط</span>
                </div>
              </div>

              {/* TAB 1: OVERVIEW & ANALYTICS CHARTS */}
              {tab === 'overview' && (
                <div className="space-y-6">
                  {/* 4 KPI Summary Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                      <div className="text-xs text-slate-500">إجمالي الطلبة</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {data.students.total}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        رسمي: <span className="font-mono tabular-nums">{data.students.official}</span> · متخرج:{' '}
                        <span className="font-mono tabular-nums">{data.students.graduated}</span>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                      <div className="text-xs text-slate-500">نسبة النجاح (المواد)</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                        {data.academics.gradesEvaluated > 0 ? `${passRate}%` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        ناجح: <span className="font-mono tabular-nums">{data.academics.gradesPassed}</span> · راسب:{' '}
                        <span className="font-mono tabular-nums">{data.academics.gradesFailed}</span>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                      <div className="text-xs text-slate-500">حضور الكادر اليوم</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[#0F294A] mt-1">
                        {data.attendance.todayPresent}/{data.attendance.totalTeachers}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        بالوقت: <span className="font-mono tabular-nums">{data.attendance.todayOnTime}</span> · متأخر:{' '}
                        <span className="font-mono tabular-nums">{data.attendance.todayLate}</span> · غائب:{' '}
                        <span className="font-mono tabular-nums">{data.attendance.todayAbsent}</span>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                      <div className="text-xs text-slate-500">شكاوى الطلبة</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[#B8860B] mt-1">
                        {data.complaints.total}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        مفتوحة: <span className="font-mono tabular-nums">{data.complaints.open}</span> · قيد المتابعة:{' '}
                        <span className="font-mono tabular-nums">{data.complaints.in_review}</span>
                      </div>
                    </div>
                  </div>

                  {/* Row 1: Pass/Fail Donut + Student Distribution */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div>
                          <h3 className="font-bold text-slate-900">إحصاءات الناجحين والراسبين</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            حد النجاح المعتمد: <span className="font-mono">{data.school.pass_mark}</span> · المعدل العام:{' '}
                            <span className="font-mono font-semibold text-slate-800">
                              {data.academics.overallAverage ?? '—'}
                            </span>
                          </p>
                        </div>
                      </div>

                      <DonutChart
                        centerValue={data.academics.gradesEvaluated > 0 ? `${passRate}%` : '—'}
                        centerLabel="نسبة النجاح"
                        segments={[
                          { label: 'درجات ناجحة', value: data.academics.gradesPassed, color: '#047857' },
                          { label: 'درجات راسبة / مكملة', value: data.academics.gradesFailed, color: '#B91C1C' },
                        ]}
                      />

                      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
                        <div className="p-2.5 bg-slate-50 rounded-lg">
                          <div className="text-[11px] text-slate-500">طلاب مقيّمون</div>
                          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                            {data.academics.evaluatedStudents}
                          </div>
                        </div>
                        <div className="p-2.5 bg-emerald-50 rounded-lg">
                          <div className="text-[11px] text-emerald-700">ناجح بجميع المواد</div>
                          <div className="text-base font-bold font-mono tabular-nums text-emerald-800">
                            {data.academics.passedStudents} ({studentPassRate}%)
                          </div>
                        </div>
                        <div className="p-2.5 bg-red-50 rounded-lg">
                          <div className="text-[11px] text-red-700">مكمل / راسب</div>
                          <div className="text-base font-bold font-mono tabular-nums text-red-800">
                            {data.academics.failedStudents}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                      <div className="border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-900">توزيع الطلبة وحالات القيد</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          حسب الجنس، المرحلة الدراسية، وحالة القيد الرسمية
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-600">
                          <span>توزيع الجنس (بنين: {data.students.byGender.male} · بنات: {data.students.byGender.female})</span>
                          <span className="font-mono tabular-nums">{data.students.total}</span>
                        </div>
                        <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                          {data.students.total > 0 && (
                            <>
                              <div
                                style={{ width: `${(data.students.byGender.male / data.students.total) * 100}%` }}
                                className="bg-[#0F294A] h-full"
                                title={`بنين: ${data.students.byGender.male}`}
                              />
                              <div
                                style={{ width: `${(data.students.byGender.female / data.students.total) * 100}%` }}
                                className="bg-[#C59B27] h-full"
                                title={`بنات: ${data.students.byGender.female}`}
                              />
                            </>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <div className="text-xs font-semibold text-slate-700">أعداد الطلبة حسب المرحلة</div>
                        {data.students.byStage.length === 0 ? (
                          <div className="text-xs text-slate-400">لا توجد مراحل مسجلة</div>
                        ) : (
                          data.students.byStage.map((st) => {
                            const maxStage = Math.max(1, ...data.students.byStage.map((x) => x.count));
                            const widthPct = Math.round((st.count / maxStage) * 100);
                            return (
                              <div key={st.stage_id} className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-slate-700">{st.stage_name}</span>
                                  <span className="font-mono tabular-nums font-semibold text-slate-900">{st.count}</span>
                                </div>
                                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-[#0F294A] rounded-full" style={{ width: `${widthPct}%` }} />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-center text-xs">
                        <div className="p-2 bg-slate-50 rounded">
                          <div className="text-slate-500">رسمي</div>
                          <div className="font-bold font-mono tabular-nums">{data.students.official}</div>
                        </div>
                        <div className="p-2 bg-slate-50 rounded">
                          <div className="text-slate-500">منقول</div>
                          <div className="font-bold font-mono tabular-nums">{data.students.transferred}</div>
                        </div>
                        <div className="p-2 bg-slate-50 rounded">
                          <div className="text-slate-500">مفصول</div>
                          <div className="font-bold font-mono tabular-nums">{data.students.expelled}</div>
                        </div>
                        <div className="p-2 bg-slate-50 rounded">
                          <div className="text-slate-500">متخرج</div>
                          <div className="font-bold font-mono tabular-nums">{data.students.graduated}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Attendance Compliance Donut + Complaints Analytics */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                      <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-slate-900">مؤشر الالتزام بالدوام والبصمة</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            إجمالي البصمات المسجلة: <span className="font-mono">{data.attendance.totalRecords}</span> · دقائق التأخير:{' '}
                            <span className="font-mono text-amber-700 font-semibold">{data.attendance.totalLateMinutes} د</span>
                          </p>
                        </div>
                      </div>

                      <DonutChart
                        centerValue={data.attendance.totalRecords > 0 ? `${attendanceCommitmentRate}%` : '—'}
                        centerLabel="التزام بالوقت"
                        segments={[
                          { label: 'حضور بالوقت', value: data.attendance.onTimeRecords, color: '#047857' },
                          { label: 'تأخير عن الدوام', value: data.attendance.lateRecords, color: '#D97706' },
                        ]}
                      />

                      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center text-xs">
                        <div className="p-2.5 bg-emerald-50 rounded-lg">
                          <div className="text-emerald-700">اليوم بالوقت</div>
                          <div className="text-base font-bold font-mono tabular-nums text-emerald-800">
                            {data.attendance.todayOnTime}
                          </div>
                        </div>
                        <div className="p-2.5 bg-amber-50 rounded-lg">
                          <div className="text-amber-700">اليوم متأخر</div>
                          <div className="text-base font-bold font-mono tabular-nums text-amber-800">
                            {data.attendance.todayLate}
                          </div>
                        </div>
                        <div className="p-2.5 bg-slate-100 rounded-lg">
                          <div className="text-slate-600">لم يبصم اليوم</div>
                          <div className="text-base font-bold font-mono tabular-nums text-slate-800">
                            {data.attendance.todayAbsent}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                      <div className="border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-900">تحليل الشكاوى الطلابية</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          حالات المعالجة وتصنيف الشكاوى الواردة من الطلبة
                        </p>
                      </div>

                      <DonutChart
                        centerValue={String(data.complaints.total)}
                        centerLabel="إجمالي الشكاوى"
                        segments={[
                          { label: 'مفتوحة', value: data.complaints.open, color: '#B91C1C' },
                          { label: 'قيد المتابعة', value: data.complaints.in_review, color: '#D97706' },
                          { label: 'تمت المعالجة', value: data.complaints.resolved, color: '#047857' },
                        ]}
                      />

                      {data.complaints.byCategory.length > 0 && (
                        <div className="space-y-2 pt-3 border-t border-slate-100">
                          <div className="text-xs font-semibold text-slate-700">الشكاوى حسب التصنيف</div>
                          {data.complaints.byCategory.map((cat) => {
                            const maxCat = Math.max(1, ...data.complaints.byCategory.map((x) => x.count));
                            return (
                              <div key={cat.category} className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-slate-700">{cat.category}</span>
                                  <span className="font-mono tabular-nums font-semibold">{cat.count}</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#B8860B] rounded-full"
                                    style={{ width: `${Math.round((cat.count / maxCat) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Stage & Subject Pass/Fail Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                      <h3 className="font-bold text-slate-900">نسب النجاح حسب المرحلة</h3>
                      {data.academics.byStage.length === 0 ? (
                        <p className="text-xs text-slate-400">لا توجد بيانات مراحل</p>
                      ) : (
                        <div className="space-y-3">
                          {data.academics.byStage.map((st) => {
                            const rate = st.evaluated > 0 ? Math.round((st.passed / st.evaluated) * 100) : 0;
                            return (
                              <div key={st.stage_id} className="p-3 bg-slate-50 rounded-lg space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-slate-900">{st.stage_name}</span>
                                  <span className="font-mono tabular-nums text-slate-600">
                                    المعدل: {st.avgScore ?? '—'}
                                  </span>
                                </div>
                                <div className="h-2.5 bg-red-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-600" style={{ width: `${rate}%` }} />
                                </div>
                                <div className="flex justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                                  <span>ناجح: {st.passed}</span>
                                  <span>راسب: {st.failed}</span>
                                  <span>{st.evaluated > 0 ? `${rate}%` : '—'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                      <h3 className="font-bold text-slate-900">تفصيل الناجحين والراسبين حسب المادة الدراسية</h3>
                      <div className="overflow-x-auto max-h-80">
                        <table className="w-full text-xs text-right">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                              <th className="py-2 px-3">المادة</th>
                              <th className="py-2 px-3">المرحلة</th>
                              <th className="py-2 px-2 text-center">المرصودة</th>
                              <th className="py-2 px-2 text-center">ناجح</th>
                              <th className="py-2 px-2 text-center">راسب</th>
                              <th className="py-2 px-2 text-center">المعدل</th>
                              <th className="py-2 px-3 text-center">النسبة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {data.academics.bySubject.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="py-6 text-center text-slate-400">
                                  لا توجد مواد مرصودة بعد
                                </td>
                              </tr>
                            ) : (
                              data.academics.bySubject.map((sub) => {
                                const rate = sub.evaluated > 0 ? Math.round((sub.passed / sub.evaluated) * 100) : null;
                                return (
                                  <tr key={sub.subject_id} className="hover:bg-slate-50">
                                    <td className="py-2 px-3 font-semibold text-slate-900">{sub.subject_name}</td>
                                    <td className="py-2 px-3 text-slate-600">{sub.stage_name}</td>
                                    <td className="py-2 px-2 text-center font-mono tabular-nums">{sub.evaluated}</td>
                                    <td className="py-2 px-2 text-center font-mono tabular-nums text-emerald-700 font-semibold">
                                      {sub.passed}
                                    </td>
                                    <td className="py-2 px-2 text-center font-mono tabular-nums text-red-700 font-semibold">
                                      {sub.failed}
                                    </td>
                                    <td className="py-2 px-2 text-center font-mono tabular-nums">{sub.avgScore ?? '—'}</td>
                                    <td className="py-2 px-3 text-center font-mono tabular-nums font-semibold">
                                      {rate === null ? '—' : `${rate}%`}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ATTENDANCE ANALYTICS & READ-ONLY LOGS */}
              {tab === 'attendance' && (
                <div className="space-y-6">
                  {/* Schedule Info Bar */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs sm:text-sm">
                    <div>
                      <div className="text-xs text-slate-500">وقت بدء البصمة</div>
                      <div className="font-mono font-bold text-slate-900 mt-0.5" dir="ltr">
                        {data.school.schedule.attendance_start_time}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">وقت الانصراف</div>
                      <div className="font-mono font-bold text-slate-900 mt-0.5" dir="ltr">
                        {data.school.schedule.attendance_end_time}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">فترة السماح</div>
                      <div className="font-mono font-bold text-slate-900 mt-0.5">
                        {data.school.schedule.attendance_grace_minutes} دقيقة
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">أيام الدوام المعتمدة</div>
                      <div className="font-medium text-slate-900 mt-0.5 text-xs">
                        {formatWorkdays(data.school.schedule.attendance_workdays)}
                      </div>
                    </div>
                  </div>

                  {/* 14-day Trend Bar Chart */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900">مخطط الحضور والتأخير اليومي (آخر 14 يوم دوام)</h3>
                        <p className="text-xs text-slate-500">سجل إشرافي محسوب بتوقيت بغداد دون قابلية التعديل</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm bg-emerald-600" />
                          <span>بالوقت</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm bg-amber-500" />
                          <span>متأخر</span>
                        </span>
                      </div>
                    </div>

                    {data.attendance.dailyTrend.length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-400">
                        لم تُسجل بصمات حضور حتى الآن
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <div className="min-w-[460px] flex items-end gap-3 h-48 pt-6 pb-2 px-2 border-b border-slate-200">
                          {data.attendance.dailyTrend.map((d) => {
                            const maxDay = Math.max(1, ...data.attendance.dailyTrend.map((x) => x.total));
                            const hOn = Math.round((d.on_time / maxDay) * 130);
                            const hLate = Math.round((d.late / maxDay) * 130);
                            return (
                              <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1.5">
                                <div className="text-[11px] font-mono tabular-nums text-slate-600">{d.total}</div>
                                <div className="w-full max-w-[36px] flex flex-col-reverse rounded-t overflow-hidden bg-slate-100">
                                  {d.on_time > 0 && (
                                    <div
                                      style={{ height: `${hOn}px` }}
                                      className="bg-emerald-600 w-full"
                                      title={`بالوقت: ${d.on_time}`}
                                    />
                                  )}
                                  {d.late > 0 && (
                                    <div
                                      style={{ height: `${hLate}px` }}
                                      className="bg-amber-500 w-full"
                                      title={`متأخر: ${d.late}`}
                                    />
                                  )}
                                </div>
                                <div className="text-[10px] font-mono text-slate-500" dir="ltr">
                                  {d.date.slice(5)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Per-teacher summary table */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h3 className="font-bold text-slate-900">التزام الهيئة التدريسية بالدوام والبصمة</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-right">
                        <thead>
                          <tr className="bg-[#0F294A] text-white">
                            <th className="py-2.5 px-3">المدرس / الموظف</th>
                            <th className="py-2.5 px-3">التخصص</th>
                            <th className="py-2.5 px-3 text-center">حالة اليوم ({data.attendance.todayDate})</th>
                            <th className="py-2.5 px-3 text-center">بصمة اليوم</th>
                            <th className="py-2.5 px-2 text-center">إجمالي الحضور</th>
                            <th className="py-2.5 px-2 text-center">بالوقت</th>
                            <th className="py-2.5 px-2 text-center">تأخير</th>
                            <th className="py-2.5 px-3 text-center">دقائق التأخير</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {data.attendance.byTeacher.map((t) => (
                            <tr key={t.teacher_id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-semibold text-slate-900">{t.teacher_name}</td>
                              <td className="py-2.5 px-3 text-slate-600">{t.specialty || '—'}</td>
                              <td className="py-2.5 px-3 text-center font-medium">
                                <span
                                  className={
                                    t.today_status === 'on_time'
                                      ? 'text-emerald-700'
                                      : t.today_status === 'late'
                                        ? 'text-amber-700'
                                        : 'text-slate-400'
                                  }
                                >
                                  {t.today_status === 'on_time'
                                    ? 'حاضر بالوقت'
                                    : t.today_status === 'late'
                                      ? 'متأخر'
                                      : 'لم يبصم'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono tabular-nums" dir="ltr">
                                {t.today_check_in ? `${t.today_check_in}${t.today_check_out ? ` → ${t.today_check_out}` : ''}` : '—'}
                              </td>
                              <td className="py-2.5 px-2 text-center font-mono tabular-nums">{t.total_days}</td>
                              <td className="py-2.5 px-2 text-center font-mono tabular-nums text-emerald-700">{t.on_time_days}</td>
                              <td className="py-2.5 px-2 text-center font-mono tabular-nums text-amber-700">{t.late_days}</td>
                              <td className="py-2.5 px-3 text-center font-mono tabular-nums font-semibold">
                                {t.total_late_minutes} د
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Detailed Attendance Records */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-bold text-slate-900">السجل التفصيلي للبصمات ({filteredAttRecords.length})</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                          <input
                            type="text"
                            value={attSearch}
                            onChange={(e) => setAttSearch(e.target.value)}
                            placeholder="بحث بالاسم أو التاريخ..."
                            className="pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-xs w-48"
                          />
                        </div>
                        <select
                          value={attStatusFilter}
                          onChange={(e) => setAttStatusFilter(e.target.value as 'all' | 'on_time' | 'late')}
                          className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        >
                          <option value="all">جميع الحالات</option>
                          <option value="on_time">بالوقت فقط</option>
                          <option value="late">المتأخرون فقط</option>
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-xs text-right">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                            <th className="py-2 px-3">التاريخ</th>
                            <th className="py-2 px-3">المدرس</th>
                            <th className="py-2 px-3 text-center">الحضور</th>
                            <th className="py-2 px-3 text-center">الانصراف</th>
                            <th className="py-2 px-3 text-center">الحالة</th>
                            <th className="py-2 px-3 text-center">دقائق التأخير</th>
                            <th className="py-2 px-3">ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredAttRecords.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-slate-400">
                                لا توجد سجلات مطابقة
                              </td>
                            </tr>
                          ) : (
                            filteredAttRecords.map((r) => (
                              <tr key={r.att_id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-mono tabular-nums" dir="ltr">{r.att_date}</td>
                                <td className="py-2 px-3 font-medium text-slate-900">{r.teacher_name}</td>
                                <td className="py-2 px-3 text-center font-mono tabular-nums" dir="ltr">{r.check_in_time || '—'}</td>
                                <td className="py-2 px-3 text-center font-mono tabular-nums" dir="ltr">{r.check_out_time || '—'}</td>
                                <td className="py-2 px-3 text-center font-medium">
                                  <span className={r.status === 'on_time' ? 'text-emerald-700' : 'text-amber-700'}>
                                    {r.status === 'on_time' ? 'بالوقت' : 'متأخر'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-center font-mono tabular-nums">
                                  {r.late_minutes > 0 ? `${r.late_minutes} د` : '0'}
                                </td>
                                <td className="py-2 px-3 text-slate-600">{r.device_note || '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: STUDENT COMPLAINTS (READ-ONLY) */}
              {tab === 'complaints' && (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                      {[
                        { id: 'all', label: `الكل (${data.complaints.total})` },
                        { id: 'open', label: `مفتوحة (${data.complaints.open})` },
                        { id: 'in_review', label: `قيد المتابعة (${data.complaints.in_review})` },
                        { id: 'resolved', label: `معالجة (${data.complaints.resolved})` },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setCmpStatusFilter(f.id as typeof cmpStatusFilter)}
                          className={`px-3 py-1.5 rounded-md cursor-pointer ${
                            cmpStatusFilter === f.id ? 'bg-white text-slate-900 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                      <input
                        type="text"
                        value={cmpSearch}
                        onChange={(e) => setCmpSearch(e.target.value)}
                        placeholder="بحث في الشكاوى..."
                        className="pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-xs w-56"
                      />
                    </div>
                  </div>

                  {filteredComplaints.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                      لا توجد شكاوى مطابقة للعرض
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredComplaints.map((c) => (
                        <div key={c.complaint_id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-slate-900 text-sm sm:text-base">{c.title}</h4>
                              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                                <span>الطالب: {c.student_name}</span>
                                <span aria-hidden="true">·</span>
                                <span>{c.class_label || '—'}</span>
                                <span aria-hidden="true">·</span>
                                <span>التصنيف: {c.category}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums" dir="ltr">{c.created_at.slice(0, 10)}</span>
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
                          <p className="text-sm text-slate-700 leading-relaxed">{c.details}</p>
                          {c.admin_reply && (
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-[#0F294A] shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-slate-900">رد إدارة المدرسة: </span>
                                <span>{c.admin_reply}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: SCHOOL DIRECTORY & DEVELOPER */}
              {tab === 'directory' && (
                <div className="space-y-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-bold text-slate-900">كشوفات الطلبة والهيئة التدريسية (للقراءة فقط)</h3>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                      <input
                        type="text"
                        value={dirSearch}
                        onChange={(e) => setDirSearch(e.target.value)}
                        placeholder="بحث بالاسم أو الشعبة..."
                        className="pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-xs w-56"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        الطلبة ({data.students.directory.length})
                      </h4>
                      <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-xs text-right">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                              <th className="py-2 px-3">الاسم</th>
                              <th className="py-2 px-3">الشعبة</th>
                              <th className="py-2 px-3">الجنس</th>
                              <th className="py-2 px-3">القيد</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {data.students.directory
                              .filter(
                                (s) =>
                                  !dirSearch.trim() ||
                                  s.full_name.toLowerCase().includes(dirSearch.trim().toLowerCase()) ||
                                  s.class_label.toLowerCase().includes(dirSearch.trim().toLowerCase())
                              )
                              .map((s) => (
                                <tr key={s.student_id}>
                                  <td className="py-2 px-3 font-medium text-slate-900">{s.full_name}</td>
                                  <td className="py-2 px-3 text-slate-600">{s.class_label}</td>
                                  <td className="py-2 px-3 text-slate-600">{s.gender}</td>
                                  <td className="py-2 px-3 text-slate-600">
                                    {ENROLL_STATUS_LABELS[s.enroll_status] || s.enroll_status}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        الهيئة التدريسية ({data.teachers.directory.length})
                      </h4>
                      <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-xs text-right">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                              <th className="py-2 px-3">الاسم</th>
                              <th className="py-2 px-3">العنوان الوظيفي</th>
                              <th className="py-2 px-3">الشهادة والتخصص</th>
                              <th className="py-2 px-3">المواد</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {data.teachers.directory
                              .filter(
                                (t) =>
                                  !dirSearch.trim() ||
                                  t.full_name.toLowerCase().includes(dirSearch.trim().toLowerCase()) ||
                                  t.specialty.toLowerCase().includes(dirSearch.trim().toLowerCase())
                              )
                              .map((t) => (
                                <tr key={t.teacher_id}>
                                  <td className="py-2 px-3 font-medium text-slate-900">{t.full_name}</td>
                                  <td className="py-2 px-3 text-slate-600">{t.job_title}</td>
                                  <td className="py-2 px-3 text-slate-600">
                                    {t.degree} · {t.specialty}
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">{t.subjects || '—'}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <DeveloperCard />
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 h-14 z-30 flex items-center justify-around px-1">
        {navTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[10px] font-medium cursor-pointer ${
                active ? 'text-[#0F294A] font-bold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">{t.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>

      <DeveloperFooter />
    </div>
  );
}
