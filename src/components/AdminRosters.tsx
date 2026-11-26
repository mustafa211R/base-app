import React, { useEffect, useMemo, useState } from 'react';
import { Users, GraduationCap, Search, X, Printer, UserRound } from 'lucide-react';
import type { ClassRow } from '../../shared/types.ts';
import { api, ATTENDANCE_STATUS_LABELS, ENROLL_STATUS_LABELS } from '../lib/api.ts';

type Row = Record<string, unknown>;

interface Props {
  classes: Array<ClassRow & { stage_name?: string }>;
  onError: (err: unknown) => void;
}

interface FullProfile {
  kind: 'student' | 'teacher';
  profile: Row;
  id_info: Row | null;
  academic_year: string;
  pass_mark?: number;
  schedule: Row[];
  grades?: Row[];
  archive?: Row[];
  complaints?: Row[];
  total_weekly_periods?: number;
  attendance_summary?: Record<string, number>;
  attendance_recent?: Row[];
  leaves?: Row[];
  attendance_times?: Row;
}

const STUDENT_FIELDS: Array<[string, string]> = [
  ['student_id', 'رقم الهوية'],
  ['full_name', 'الاسم الكامل'],
  ['mother_name', 'اسم الأم'],
  ['gender', 'الجنس'],
  ['birth_date', 'تاريخ الميلاد'],
  ['address', 'العنوان'],
  ['guardian_name', 'ولي الأمر'],
  ['guardian_phone', 'هاتف ولي الأمر'],
  ['stage_name', 'المرحلة'],
  ['class_label', 'الشعبة'],
  ['enroll_status', 'حالة القيد'],
  ['status_note', 'سبب/ملاحظة الحالة'],
  ['enroll_date', 'تاريخ التسجيل'],
  ['reg_reason', 'سبب التسجيل'],
  ['prev_school', 'المدرسة السابقة'],
  ['prev_stage', 'المرحلة السابقة'],
  ['prev_average', 'المعدل السابق'],
  ['failed_years', 'سنوات الرسوب'],
  ['dropout_years', 'سنوات الانقطاع'],
  ['health_note', 'ملاحظة صحية'],
  ['notes', 'ملاحظات'],
  ['updated_at', 'آخر تحديث'],
];

const TEACHER_FIELDS: Array<[string, string]> = [
  ['teacher_id', 'رقم الهوية'],
  ['full_name', 'الاسم الكامل'],
  ['mother_name', 'اسم الأم'],
  ['gender', 'الجنس'],
  ['birth_date', 'تاريخ الميلاد'],
  ['job_title', 'العنوان الوظيفي'],
  ['specialty', 'الاختصاص'],
  ['degree', 'الشهادة'],
  ['university', 'الجامعة'],
  ['college', 'الكلية'],
  ['grad_year', 'سنة التخرج'],
  ['hire_date', 'تاريخ التعيين'],
  ['start_date', 'تاريخ المباشرة'],
  ['subjects', 'المواد'],
  ['phone', 'الهاتف'],
  ['whatsapp', 'واتساب'],
  ['email', 'البريد'],
  ['address', 'العنوان'],
  ['status', 'الحالة'],
  ['bio_cv', 'السيرة الذاتية'],
  ['updated_at', 'آخر تحديث'],
];

const ID_STATUS_LABELS: Record<string, string> = {
  unused: 'غير مستخدمة',
  registered: 'مسجّلة وفعّالة',
  disabled: 'معطّلة',
};

const GRADE_COLS: Array<[string, string]> = [
  ['m1', 'ش1'],
  ['m2', 'ش2'],
  ['avg_t1', 'معدل 1'],
  ['mid_year', 'نصف السنة'],
  ['m3', 'ش3'],
  ['m4', 'ش4'],
  ['avg_t2', 'معدل 2'],
  ['annual_effort', 'سعي سنوي'],
  ['final_exam', 'امتحان نهائي'],
  ['final', 'النهائي'],
];

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function statusBadge(status: string) {
  const blocked = ['expelled', 'transferred', 'graduated'].includes(status);
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        blocked ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
      }`}
    >
      {ENROLL_STATUS_LABELS[status] || status}
    </span>
  );
}

function PhotoBox({ entity, id }: { entity: 'student' | 'teacher'; id: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    setSrc('');
    api<string>('photo.get', { entity, id })
      .then((d) => {
        if (alive && typeof d === 'string' && d) setSrc(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entity, id]);
  return src ? (
    <img src={src} alt="" className="w-20 h-24 rounded-lg object-cover border border-slate-200" />
  ) : (
    <div className="w-20 h-24 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
      <UserRound className="w-8 h-8" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <h4 className="text-sm font-bold text-[#0F294A] border-b border-slate-200 pb-1">{title}</h4>
      {children}
    </section>
  );
}

function FieldGrid({ fields, data }: { fields: Array<[string, string]>; data: Row }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      {fields.map(([k, label]) => (
        <div key={k} className="flex gap-2 border-b border-slate-100 py-1">
          <span className="text-slate-500 shrink-0 w-32">{label}</span>
          <span className="font-medium text-slate-900 break-words min-w-0">
            {k === 'enroll_status' ? ENROLL_STATUS_LABELS[String(data[k] || 'official')] || show(data[k]) : show(data[k])}
          </span>
        </div>
      ))}
    </div>
  );
}

function IdInfo({ info }: { info: Row | null }) {
  if (!info) return <div className="text-xs text-slate-500">لا توجد هوية مرتبطة.</div>;
  return (
    <FieldGrid
      data={{ ...info, status: ID_STATUS_LABELS[String(info.status)] || info.status }}
      fields={[
        ['id', 'رقم الهوية'],
        ['status', 'حالة الهوية'],
        ['generated_at', 'تاريخ الإصدار'],
        ['registered_at', 'تاريخ التسجيل'],
        ['last_login', 'آخر دخول'],
        ['card_printed', 'بطاقة مطبوعة'],
      ]}
    />
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (rows.length === 0) return <div className="text-xs text-slate-500">لا توجد بيانات.</div>;
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-xs text-right">
        <thead>
          <tr className="bg-slate-100 text-slate-700">
            {head.map((h) => (
              <th key={h} className="py-2 px-2.5 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 px-2.5 font-mono tabular-nums whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileView({ data }: { data: FullProfile }) {
  const p = data.profile;
  if (data.kind === 'student') {
    const passMark = data.pass_mark ?? 50;
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <PhotoBox entity="student" id={String(p.student_id)} />
          <div className="space-y-1">
            <div className="text-lg font-bold text-slate-900">{show(p.full_name)}</div>
            <div className="text-xs text-slate-600">
              {show(p.stage_name)} · {show(p.class_label)}
            </div>
            <div>{statusBadge(String(p.enroll_status || 'official'))}</div>
          </div>
        </div>

        <Section title="المعلومات الشخصية والأكاديمية">
          <FieldGrid fields={STUDENT_FIELDS} data={p} />
        </Section>

        <Section title="الهوية">
          <IdInfo info={data.id_info} />
        </Section>

        <Section title={`جدول المواد والمدرسين (الشعبة ${show(p.class_label)})`}>
          <SimpleTable
            head={['المادة', 'المدرس', 'الحصص الأسبوعية']}
            rows={data.schedule.map((s) => [
              <span className="font-sans">{show(s.subject_name)}</span>,
              <span className="font-sans">{show(s.teacher_name)}</span>,
              show(s.weekly_periods),
            ])}
          />
          <div className="text-[11px] text-slate-500">
            الدوام: {show(data.attendance_times?.attendance_start_time)} – {show(data.attendance_times?.attendance_end_time)} · أيام
            الدوام: {show(data.attendance_times?.attendance_workdays)}
          </div>
        </Section>

        <Section title={`الدرجات — ${data.academic_year}`}>
          <SimpleTable
            head={['المادة', ...GRADE_COLS.map((c) => c[1])]}
            rows={(data.grades || []).map((g) => [
              <span className="font-sans">{show(g.subject_name)}</span>,
              ...GRADE_COLS.map(([k]) => {
                const v = g[k];
                const isFinal = k === 'final';
                const failed = isFinal && v !== null && v !== undefined && v !== '' && Number(v) < passMark;
                return <span className={failed ? 'text-red-600 font-bold' : isFinal ? 'font-bold' : ''}>{show(v)}</span>;
              }),
            ])}
          />
          <div className="text-[11px] text-slate-500">درجة النجاح: {passMark}</div>
        </Section>

        {(data.archive || []).length > 0 && (
          <Section title="أرشيف درجات السنوات السابقة">
            <SimpleTable
              head={['السنة', 'المادة', 'النهائي']}
              rows={(data.archive || []).map((a) => [
                show(a.year),
                <span className="font-sans">{show(a.subject_name)}</span>,
                show(a.final),
              ])}
            />
          </Section>
        )}

        {(data.complaints || []).length > 0 && (
          <Section title="الشكاوى">
            <SimpleTable
              head={['التاريخ', 'العنوان', 'الحالة', 'رد الإدارة']}
              rows={(data.complaints || []).map((c) => [
                show(String(c.created_at || '').slice(0, 10)),
                <span className="font-sans">{show(c.title)}</span>,
                show(c.status),
                <span className="font-sans">{show(c.admin_reply)}</span>,
              ])}
            />
          </Section>
        )}
      </div>
    );
  }

  const summary = data.attendance_summary || {};
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <PhotoBox entity="teacher" id={String(p.teacher_id)} />
        <div className="space-y-1">
          <div className="text-lg font-bold text-slate-900">{show(p.full_name)}</div>
          <div className="text-xs text-slate-600">
            {show(p.job_title)} · {show(p.specialty)}
          </div>
          <div className="text-xs text-slate-600">
            مجموع الحصص الأسبوعية: <span className="font-mono tabular-nums font-bold">{data.total_weekly_periods ?? 0}</span>
          </div>
        </div>
      </div>

      <Section title="المعلومات الشخصية والوظيفية">
        <FieldGrid fields={TEACHER_FIELDS} data={p} />
      </Section>

      <Section title="الهوية">
        <IdInfo info={data.id_info} />
      </Section>

      <Section title={`الجدول والإسناد — ${data.academic_year}`}>
        <SimpleTable
          head={['المرحلة', 'الشعبة', 'المادة', 'الحصص الأسبوعية']}
          rows={data.schedule.map((s) => [
            <span className="font-sans">{show(s.stage_name)}</span>,
            <span className="font-sans">{show(s.class_label)}</span>,
            <span className="font-sans">{show(s.subject_name)}</span>,
            show(s.weekly_periods),
          ])}
        />
        <div className="text-[11px] text-slate-500">
          الدوام: {show(data.attendance_times?.attendance_start_time)} – {show(data.attendance_times?.attendance_end_time)} · أيام
          الدوام: {show(data.attendance_times?.attendance_workdays)}
        </div>
      </Section>

      <Section title="ملخص الحضور (آخر 60 سجلاً)">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.keys(summary).length === 0 && <span className="text-slate-500">لا توجد سجلات.</span>}
          {Object.entries(summary).map(([k, v]) => (
            <span key={k} className="px-2.5 py-1 bg-slate-100 rounded-lg">
              {ATTENDANCE_STATUS_LABELS[k] || k}: <b className="font-mono tabular-nums">{v}</b>
            </span>
          ))}
        </div>
        <SimpleTable
          head={['التاريخ', 'الدخول', 'الخروج', 'الحالة', 'تأخير (د)']}
          rows={(data.attendance_recent || []).map((r) => [
            show(r.att_date),
            show(r.check_in_time),
            show(r.check_out_time),
            <span className="font-sans">{ATTENDANCE_STATUS_LABELS[String(r.status)] || show(r.status)}</span>,
            show(r.late_minutes),
          ])}
        />
      </Section>

      {(data.leaves || []).length > 0 && (
        <Section title="الإجازات">
          <SimpleTable
            head={['النوع', 'من', 'إلى', 'السبب']}
            rows={(data.leaves || []).map((l) => [
              <span className="font-sans">{show(l.type)}</span>,
              show(l.date_from),
              show(l.date_to),
              <span className="font-sans">{show(l.reason)}</span>,
            ])}
          />
        </Section>
      )}
    </div>
  );
}

export function AdminRosters({ classes, onError }: Props) {
  const [tab, setTab] = useState<'students' | 'teachers'>('students');
  const [students, setStudents] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<{ kind: 'student' | 'teacher'; id: string } | null>(null);
  const [detail, setDetail] = useState<FullProfile | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api<{ items: Row[] }>('student.list'), api<Row[]>('teacher.list')])
      .then(([s, t]) => {
        if (!alive) return;
        setStudents(s.items || []);
        setTeachers(Array.isArray(t) ? t : []);
      })
      .catch(onError)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    api<FullProfile>('admin.profileFull', { kind: selected.kind, id: selected.id })
      .then((d) => alive && setDetail(d))
      .catch((e) => {
        if (alive) {
          setSelected(null);
          onError(e);
        }
      })
      .finally(() => alive && setDetailLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of students) {
      const k = String(s.enroll_status || 'official');
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [students]);

  const needle = q.trim().toLowerCase();
  const filteredStudents = students.filter(
    (s) =>
      (!needle || String(s.full_name || '').toLowerCase().includes(needle) || String(s.student_id || '').includes(needle)) &&
      (!classFilter || String(s.class_id) === classFilter) &&
      (!statusFilter || String(s.enroll_status || 'official') === statusFilter)
  );
  const filteredTeachers = teachers.filter(
    (t) =>
      !needle ||
      String(t.full_name || '').toLowerCase().includes(needle) ||
      String(t.teacher_id || '').includes(needle) ||
      String(t.specialty || '').toLowerCase().includes(needle)
  );

  return (
    <div className="space-y-4">
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-sm">
            <button
              type="button"
              onClick={() => setTab('students')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md cursor-pointer ${
                tab === 'students' ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-600'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              <span>قسم الطلاب ({students.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('teachers')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md cursor-pointer ${
                tab === 'teachers' ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-600'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>قسم المدرسين ({teachers.length})</span>
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالاسم أو الهوية..."
              className="pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-xs w-60"
            />
          </div>
        </div>

        {tab === 'students' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('')}
                className={`px-2.5 py-1 rounded-full border cursor-pointer ${
                  !statusFilter ? 'bg-[#0F294A] text-white border-[#0F294A]' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                الكل ({students.length})
              </button>
              {Object.entries(ENROLL_STATUS_LABELS).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
                  className={`px-2.5 py-1 rounded-full border cursor-pointer ${
                    statusFilter === k ? 'bg-[#0F294A] text-white border-[#0F294A]' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {label} ({statusCounts[k] || 0})
                </button>
              ))}
            </div>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="">كل الشعب</option>
              {classes.map((c) => (
                <option key={c.class_id} value={c.class_id}>
                  {c.stage_name ? `${c.stage_name} — ` : ''}
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">جاري تحميل الكشوفات...</div>
      ) : (
        <div className="no-print bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {tab === 'students' ? (
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3 w-10">#</th>
                  <th className="py-2.5 px-3">الاسم</th>
                  <th className="py-2.5 px-3">الهوية</th>
                  <th className="py-2.5 px-3">المرحلة / الشعبة</th>
                  <th className="py-2.5 px-3">حالة القيد</th>
                  <th className="py-2.5 px-3">هاتف ولي الأمر</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, i) => (
                  <tr
                    key={String(s.student_id)}
                    onClick={() => setSelected({ kind: 'student', id: String(s.student_id) })}
                    className="border-b border-slate-100 hover:bg-amber-50/50 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{show(s.full_name)}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{show(s.student_id)}</td>
                    <td className="py-2 px-3">
                      {show(s.stage_name)} · {show(s.class_label)}
                    </td>
                    <td className="py-2 px-3">{statusBadge(String(s.enroll_status || 'official'))}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{show(s.guardian_phone)}</td>
                  </tr>
                ))}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      لا يوجد طلاب مطابقون.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3 w-10">#</th>
                  <th className="py-2.5 px-3">الاسم</th>
                  <th className="py-2.5 px-3">الهوية</th>
                  <th className="py-2.5 px-3">الاختصاص</th>
                  <th className="py-2.5 px-3">العنوان الوظيفي</th>
                  <th className="py-2.5 px-3">الهاتف</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map((t, i) => (
                  <tr
                    key={String(t.teacher_id)}
                    onClick={() => setSelected({ kind: 'teacher', id: String(t.teacher_id) })}
                    className="border-b border-slate-100 hover:bg-amber-50/50 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{show(t.full_name)}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{show(t.teacher_id)}</td>
                    <td className="py-2 px-3">{show(t.specialty)}</td>
                    <td className="py-2 px-3">{show(t.job_title)}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{show(t.phone)}</td>
                  </tr>
                ))}
                {filteredTeachers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      لا يوجد مدرسون مطابقون.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-2 sm:p-6 overflow-y-auto print:static print:bg-white print:p-0">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-2 print:shadow-none print:max-w-none">
            <div className="no-print flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-xl">
              <div className="font-bold text-[#0F294A] text-sm">
                {selected.kind === 'student' ? 'كشف الطالب' : 'كشف المدرس'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-6">
              {detailLoading || !detail ? (
                <div className="py-10 text-center text-sm text-slate-500">جاري تحميل الكشف...</div>
              ) : (
                <ProfileView data={detail} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
