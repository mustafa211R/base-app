import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  Printer,
  Shield,
  Users,
  Archive,
  Upload,
  Download,
  Plus,
  RefreshCw,
  CheckCircle2,
  FileSpreadsheet,
  Trash2,
  Table,
} from 'lucide-react';
import { formatIdGrouped } from '../../shared/luhn.ts';
import type {
  AnnouncementRow,
  AssignmentRow,
  AuditLogRow,
  ClassRow,
  EnrollStatus,
  IdRow,
  PermissionRow,
  PublicSchoolData,
  SchoolConfig,
  StageRow,
  SubjectRow,
} from '../../shared/types.ts';
import {
  api,
  downloadExcelBackup,
  ENROLL_STATUS_LABELS,
} from '../lib/api.ts';

interface Part2Props {
  screen: 6 | 7 | 8 | 9 | 10; // 10 = 14-Sheets Inspector
  publicData: PublicSchoolData;
  config: SchoolConfig | null;
  stages: StageRow[];
  classes: Array<ClassRow & { stage_name?: string }>;
  subjects: Array<SubjectRow & { stage_name?: string }>;
  idsList: Array<IdRow & { class_label?: string; person_name?: string }>;
  permissions: PermissionRow[];
  onSuccess: (msg: string) => void;
  onError: (err: unknown) => void;
  onRefreshAll: () => Promise<void>;
}

const SHEET_NAMES = [
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
];

export function AdminScreensPart2({
  screen,
  publicData,
  config,
  stages,
  classes,
  subjects,
  idsList,
  permissions,
  onSuccess,
  onError,
  onRefreshAll,
}: Part2Props) {
  const [busy, setBusy] = useState(false);

  // Screen 6: ID Cards + QR
  const [cardFilter, setCardFilter] = useState<'all' | 'unprinted'>('all');
  const [cardKind, setCardKind] = useState<'student' | 'teacher'>('student');
  const [cardLayout, setCardLayout] = useState<'a4' | 'single'>('a4');
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Screen 7: Permissions & Privacy
  const [teacherVis, setTeacherVis] = useState(config?.teacher_profile_visibility || 'all');
  const [studentVis, setStudentVis] = useState(config?.student_profile_visibility || 'all');
  const [guestMode, setGuestMode] = useState(config?.guest_student_list || 'full');
  const [reqPin, setReqPin] = useState(config?.require_teacher_pin === 'TRUE');
  const [allowSelfEdit, setAllowSelfEdit] = useState(config?.allow_student_self_edit === 'TRUE');
  const [permRows, setPermRows] = useState<PermissionRow[]>(permissions);

  // Screen 8: Data Management sub-tabs
  const [subTab, setSubTab] = useState<'students' | 'teachers' | 'subjects' | 'grades' | 'announcements'>('students');
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [teachers, setTeachers] = useState<Array<Record<string, unknown>>>([]);
  const [assignments, setAssignments] = useState<Array<AssignmentRow & { subject_name?: string; class_label?: string; teacher_name?: string }>>([]);
  const [dataSearch, setDataSearch] = useState('');
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [statusNoteMap, setStatusNoteMap] = useState<Record<string, string>>({});

  // Subjects & Assignments
  const [newSubName, setNewSubName] = useState('');
  const [newSubStage, setNewSubStage] = useState(stages[0]?.stage_id || '');
  const [asgTeacher, setAsgTeacher] = useState('');
  const [asgSubject, setAsgSubject] = useState('');
  const [asgClass, setAsgClass] = useState('');

  // Batch Grades Import
  const [importSubjectId, setImportSubjectId] = useState(subjects[0]?.subject_id || '');
  const [gradeClassId, setGradeClassId] = useState(classes[0]?.class_id || '');
  const [gradeSubjectId, setGradeSubjectId] = useState(subjects[0]?.subject_id || '');
  const [adminGradeRows, setAdminGradeRows] = useState<Array<Record<string, unknown>>>([]);

  // Announcements
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annAudience, setAnnAudience] = useState<'all' | 'students' | 'teachers'>('all');

  // Screen 9: Backup & Year End
  const [nextAcademicYear, setNextAcademicYear] = useState('2027-2028');
  const [restorePassword, setRestorePassword] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  // Screen 10: 14-Sheet Explorer
  const [activeSheet, setActiveSheet] = useState('Config');
  const [sheetRows, setSheetRows] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    setPermRows(permissions);
  }, [permissions]);

  useEffect(() => {
    if (screen === 6) {
      const targetCards = idsList.filter((i) => i.kind === cardKind && i.status !== 'disabled').slice(0, 60);
      Promise.all(
        targetCards.map(async (c) => {
          const url = `${window.location.origin}/?role=${c.kind}&id=${c.id}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 110, margin: 1 });
          return [c.id, dataUrl] as const;
        })
      ).then((entries) => {
        setQrMap(Object.fromEntries(entries));
      });
    }
    if (screen === 8) {
      loadDataMgmt();
    }
    if (screen === 9) {
      api<AuditLogRow[]>('audit.list').then(setAuditLogs).catch(onError);
    }
    if (screen === 10) {
      loadSheetRows(activeSheet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, cardKind, idsList.length]);

  async function loadDataMgmt() {
    try {
      const [sRes, tRes, aRes] = await Promise.all([
        api<{ items: Array<Record<string, unknown>> }>('student.list'),
        api<Array<Record<string, unknown>>>('teacher.list'),
        api<Array<AssignmentRow & { subject_name?: string; class_label?: string; teacher_name?: string }>>('admin.assignmentsList'),
      ]);
      setStudents(sRes.items || []);
      setTeachers(tRes || []);
      setAssignments(aRes || []);
    } catch (err) {
      onError(err);
    }
  }

  async function loadSheetRows(sheet: string) {
    setActiveSheet(sheet);
    try {
      const rows = await api<Array<Record<string, unknown>>>('sheets.inspect', { sheet });
      setSheetRows(rows);
    } catch (err) {
      onError(err);
    }
  }

  async function handlePrintCards(cardIds: string[]) {
    window.print();
    try {
      await api('ids.markPrinted', { ids: cardIds });
      await onRefreshAll();
    } catch (err) {
      onError(err);
    }
  }

  async function handleSavePrivacyAndPerms() {
    setBusy(true);
    try {
      await api('admin.schoolSave', {
        teacher_profile_visibility: teacherVis,
        student_profile_visibility: studentVis,
        guest_student_list: guestMode,
        require_teacher_pin: reqPin ? 'TRUE' : 'FALSE',
        allow_student_self_edit: allowSelfEdit ? 'TRUE' : 'FALSE',
      });
      await api('perm.save', { rows: permRows });
      await onRefreshAll();
      onSuccess('تم حفظ إعدادات الخصوصية ومصفوفة الصلاحيات بنجاح');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  function togglePermCell(entity: string, field: string, col: 'self' | 'teacher' | 'student' | 'guest') {
    setPermRows((prev) =>
      prev.map((r) => (r.entity === entity && r.field === field ? { ...r, [col]: r[col] ? 0 : 1 } : r))
    );
  }

  async function handleReplaceId(oldId: string) {
    setBusy(true);
    try {
      const res = await api<{ old_id: string; new_id: string }>('ids.replace', { old_id: oldId });
      await onRefreshAll();
      await loadDataMgmt();
      onSuccess(`تم تعطيل الهوية القديمة وإصدار الهوية البديلة: ${formatIdGrouped(res.new_id)}`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!restorePassword) {
      onError(new Error('يرجى إدخال كلمة مرور المدير أولاً لتأكيد الاستعادة'));
      e.target.value = '';
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetsData: Record<string, Array<Record<string, unknown>>> = {};
      for (const name of wb.SheetNames) {
        sheetsData[name] = XLSX.utils.sheet_to_json(wb.Sheets[name]) as Array<Record<string, unknown>>;
      }
      const res = await api<{ restoredRows: number }>('backup.restore', {
        password: restorePassword,
        sheets_data: sheetsData,
      });
      setRestorePassword('');
      await onRefreshAll();
      onSuccess(`تمت استعادة ${res.restoredRows} صف بنجاح`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function handleImportGradesExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const targetSub = importSubjectId || subjects[0]?.subject_id;
    if (!file || !targetSub) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as Array<Record<string, unknown>>;
      const mapped = rows
        .map((r) => ({
          student_id: String(r['student_id'] || r['رقم الهوية'] || ''),
          m1: r['m1'] ?? r['ش1'] ?? '',
          m2: r['m2'] ?? r['ش2'] ?? '',
          mid_year: r['mid_year'] ?? r['نصف السنة'] ?? '',
          m3: r['m3'] ?? r['ش3'] ?? '',
          m4: r['m4'] ?? r['ش4'] ?? '',
          final_exam: r['final_exam'] ?? r['نهاية السنة'] ?? '',
        }))
        .filter((r) => r.student_id.trim() !== '');
      const res = await api<{ saved: number }>('grades.importBatch', {
        subject_id: targetSub,
        rows: mapped,
      });
      onSuccess(`تم استيراد ${res.saved} درجة بنجاح`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  if (screen === 6) {
    const cards = idsList.filter(
      (i) => i.kind === cardKind && i.status !== 'disabled' && (cardFilter === 'all' || i.card_printed !== 'TRUE')
    );
    return (
      <div className="space-y-5">
        <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">6. بطاقات الهويات والطباعة (QR + Luhn)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              لا يُخزن اسم الطالب على البطاقة الفارغة — تُطبع قبل التسجيل الأول ويُمسح رمز QR للدخول السريع
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={cardKind}
              onChange={(e) => setCardKind(e.target.value as 'student' | 'teacher')}
              className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="student">بطاقات الطلاب</option>
              <option value="teacher">بطاقات المدرسين</option>
            </select>
            <select
              value={cardFilter}
              onChange={(e) => setCardFilter(e.target.value as 'all' | 'unprinted')}
              className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="all">جميع البطاقات الفعالة</option>
              <option value="unprinted">غير المطبوعة فقط</option>
            </select>
            <select
              value={cardLayout}
              onChange={(e) => setCardLayout(e.target.value as 'a4' | 'single')}
              className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="a4">صفحة A4 (عدة بطاقات)</option>
              <option value="single">مقاس بطاقة مفردة</option>
            </select>
            <button
              type="button"
              onClick={() => handlePrintCards(cards.map((c) => c.id))}
              disabled={cards.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F294A] text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة ({cards.length})</span>
            </button>
          </div>
        </div>

        <div className={cardLayout === 'a4' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'max-w-md space-y-4'}>
          {cards.map((c) => (
            <div
              key={c.id}
              className="print-break-inside-avoid bg-white border-2 border-[#0F294A] rounded-xl p-4 flex items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="text-xs font-bold text-[#B8860B]">{publicData.school_name}</div>
                <div className="text-sm font-bold text-slate-900">
                  {c.kind === 'student' ? `بطاقة طالب · ${c.class_label || 'غير محدد'}` : 'بطاقة مدرس'}
                </div>
                {c.person_name && <div className="text-xs text-slate-600">{c.person_name}</div>}
                <div className="text-base font-bold font-mono tabular-nums tracking-wider text-[#0F294A] pt-1" dir="ltr">
                  {formatIdGrouped(c.id)}
                </div>
                <div className="text-[11px] text-slate-400">
                  {c.card_printed === 'TRUE' ? 'مطبوعة مسبقاً' : 'جاهزة للطباعة'}
                </div>
              </div>
              {qrMap[c.id] && (
                <img src={qrMap[c.id]} alt="QR" className="w-20 h-20 border border-slate-200 rounded p-0.5 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (screen === 7) {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">7. الصلاحيات والخصوصية</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                جميع هذه القواعد تُفرض مباشرة في الخادم ولا يغادر أي حقل غير مسموح به
              </p>
            </div>
            <Shield className="w-5 h-5 text-[#B8860B]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">من يرى بروفايل المدرس؟</label>
              <select
                value={teacherVis}
                onChange={(e) => setTeacherVis(e.target.value as 'all' | 'admin_only')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="all">الجميع (بحدود حقول الضيف)</option>
                <option value="admin_only">الإدارة فقط</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">من يرى بروفايل الطالب؟</label>
              <select
                value={studentVis}
                onChange={(e) => setStudentVis(e.target.value as 'all' | 'members_only')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="all">الجميع (الضيف يرى الأساسي فقط)</option>
                <option value="members_only">الطالب والمدرس والإدارة فقط</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">رؤية الضيف لقائمة الطلاب</label>
              <select
                value={guestMode}
                onChange={(e) => setGuestMode(e.target.value as 'full' | 'first_names' | 'stats_only' | 'off')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="full">القائمة الأساسية (بدون هاتف ودرجات)</option>
                <option value="first_names">الأسماء الأولى فقط</option>
                <option value="stats_only">الإحصاءات فقط</option>
                <option value="off">إيقاف القائمة عن الضيف</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={reqPin}
                onChange={(e) => setReqPin(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span>تفعيل رمز PIN من 4 أرقام للمدرس عند الدخول</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={allowSelfEdit}
                onChange={(e) => setAllowSelfEdit(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span>السماح للطالب بالتعديل الذاتي للعنوان والهاتف بعد التسجيل</span>
            </label>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base">مصفوفة الحقول (المدير يرى كل شيء دائماً)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="bg-[#0F294A] text-white">
                  <th className="py-2.5 px-3">الكيان</th>
                  <th className="py-2.5 px-3">الحقل</th>
                  <th className="py-2.5 px-2 text-center">المدير</th>
                  <th className="py-2.5 px-2 text-center">صاحب البروفايل</th>
                  <th className="py-2.5 px-2 text-center">المدرس</th>
                  <th className="py-2.5 px-2 text-center">طالب آخر</th>
                  <th className="py-2.5 px-2 text-center">الضيف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {permRows.map((p) => (
                  <tr key={`${p.entity}-${p.field}`} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-xs text-slate-500">{p.entity === 'student' ? 'طالب' : 'مدرس'}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{p.label_ar || p.field}</td>
                    <td className="py-2 px-2 text-center text-emerald-700 font-bold">✓</td>
                    {(['self', 'teacher', 'student', 'guest'] as const).map((col) => (
                      <td key={col} className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(p[col])}
                          onChange={() => togglePermCell(p.entity, p.field, col)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={handleSavePrivacyAndPerms}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>حفظ مصفوفة الصلاحيات والخصوصية</span>
          </button>
        </div>
      </div>
    );
  }

  if (screen === 8) {
    const q = dataSearch.trim().toLowerCase();
    const filteredStudents = students.filter(
      (s) =>
        !q ||
        String(s.full_name || '').toLowerCase().includes(q) ||
        String(s.student_id || '').includes(q)
    );
    const filteredTeachers = teachers.filter(
      (t) =>
        !q ||
        String(t.full_name || '').toLowerCase().includes(q) ||
        String(t.teacher_id || '').includes(q)
    );

    return (
      <div className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {[
              { id: 'students', label: 'الطلاب والنقل والبديل' },
              { id: 'teachers', label: 'المدرسون' },
              { id: 'subjects', label: 'المواد والإسناد' },
              { id: 'grades', label: 'الدرجات واستيراد Excel' },
              { id: 'announcements', label: 'الإعلانات' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as typeof subTab)}
                className={`px-3 py-1.5 rounded-md cursor-pointer ${
                  subTab === t.id ? 'bg-white text-slate-900 font-semibold' : 'text-slate-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {(subTab === 'students' || subTab === 'teachers') && (
            <input
              type="text"
              value={dataSearch}
              onChange={(e) => setDataSearch(e.target.value)}
              placeholder="بحث بالاسم أو الهوية..."
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs w-56"
            />
          )}
        </div>

        {subTab === 'students' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3">الهوية</th>
                  <th className="py-2.5 px-3">الاسم</th>
                  <th className="py-2.5 px-3">الشعبة الحالية</th>
                  <th className="py-2.5 px-3">حالة القيد والسبب</th>
                  <th className="py-2.5 px-3">نقل شعبة</th>
                  <th className="py-2.5 px-3">هوية بديلة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredStudents.map((s) => {
                  const sid = String(s.student_id);
                  return (
                    <tr key={sid} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono tabular-nums" dir="ltr">
                        {formatIdGrouped(sid)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{String(s.full_name)}</td>
                      <td className="py-2.5 px-3">{String(s.class_label || s.class_id)}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <select
                            value={String(s.enroll_status || 'official')}
                            onChange={async (e) => {
                              try {
                                await api('admin.studentStatus', {
                                  student_id: sid,
                                  enroll_status: e.target.value as EnrollStatus,
                                  status_note: statusNoteMap[sid] || String(s.status_note || ''),
                                });
                                await loadDataMgmt();
                                onSuccess('تم تحديث حالة القيد');
                              } catch (err) {
                                onError(err);
                              }
                            }}
                            className="px-2 py-1 border border-slate-300 rounded bg-white"
                          >
                            {Object.entries(ENROLL_STATUS_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={statusNoteMap[sid] ?? String(s.status_note || '')}
                            onChange={(e) => setStatusNoteMap((prev) => ({ ...prev, [sid]: e.target.value }))}
                            placeholder="السبب..."
                            className="w-24 px-2 py-1 border border-slate-300 rounded"
                          />
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <select
                            value={transferTarget[sid] || String(s.class_id)}
                            onChange={(e) => setTransferTarget((prev) => ({ ...prev, [sid]: e.target.value }))}
                            className="px-2 py-1 border border-slate-300 rounded bg-white max-w-[140px]"
                          >
                            {classes.map((c) => (
                              <option key={c.class_id} value={c.class_id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api('admin.studentTransfer', {
                                  student_id: sid,
                                  class_id: transferTarget[sid] || String(s.class_id),
                                });
                                await loadDataMgmt();
                                onSuccess('تم نقل الطالب بنجاح');
                              } catch (err) {
                                onError(err);
                              }
                            }}
                            className="px-2 py-1 bg-[#0F294A] text-white rounded cursor-pointer"
                          >
                            نقل
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleReplaceId(sid)}
                          className="px-2.5 py-1 border border-amber-300 text-amber-800 hover:bg-amber-50 rounded cursor-pointer whitespace-nowrap"
                        >
                          إصدار بديلة
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {subTab === 'teachers' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3">الهوية</th>
                  <th className="py-2.5 px-3">الاسم</th>
                  <th className="py-2.5 px-3">التخصص والشهادة</th>
                  <th className="py-2.5 px-3">الهاتف</th>
                  <th className="py-2.5 px-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredTeachers.map((t) => {
                  const tid = String(t.teacher_id);
                  return (
                    <tr key={tid}>
                      <td className="py-2.5 px-3 font-mono tabular-nums" dir="ltr">
                        {formatIdGrouped(tid)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{String(t.full_name)}</td>
                      <td className="py-2.5 px-3">
                        {String(t.degree || '')} · {String(t.specialty || '')}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">{String(t.phone || '—')}</td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleReplaceId(tid)}
                          className="px-2.5 py-1 border border-amber-300 text-amber-800 hover:bg-amber-50 rounded cursor-pointer"
                        >
                          هوية بديلة
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {subTab === 'subjects' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-slate-900 text-sm">المواد الدراسية لكل مرحلة</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api('admin.subjectUpsert', {
                      name_ar: newSubName,
                      stage_id: newSubStage || stages[0]?.stage_id,
                    });
                    setNewSubName('');
                    await onRefreshAll();
                    onSuccess('تمت إضافة المادة الدراسية');
                  } catch (err) {
                    onError(err);
                  }
                }}
                className="flex gap-2"
              >
                <select
                  value={newSubStage || stages[0]?.stage_id || ''}
                  onChange={(e) => setNewSubStage(e.target.value)}
                  className="px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {stages.map((s) => (
                    <option key={s.stage_id} value={s.stage_id}>
                      {s.name_ar}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="اسم المادة..."
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                <button type="submit" className="px-3 py-2 bg-[#0F294A] text-white text-xs rounded-lg cursor-pointer">
                  إضافة
                </button>
              </form>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 text-xs">
                {subjects.map((sub) => (
                  <div key={sub.subject_id} className="py-2 flex justify-between">
                    <span className="font-medium text-slate-900">{sub.name_ar}</span>
                    <span className="text-slate-500">{sub.stage_name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-slate-900 text-sm">إسناد المدرسين (Assignments)</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api('admin.assignmentUpsert', {
                      teacher_id: asgTeacher || String(teachers[0]?.teacher_id || ''),
                      subject_id: asgSubject || subjects[0]?.subject_id || '',
                      class_id: asgClass || classes[0]?.class_id || '',
                    });
                    await loadDataMgmt();
                    onSuccess('تم حفظ الإسناد');
                  } catch (err) {
                    onError(err);
                  }
                }}
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                <select
                  value={asgTeacher || String(teachers[0]?.teacher_id || '')}
                  onChange={(e) => setAsgTeacher(e.target.value)}
                  className="px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {teachers.map((t) => (
                    <option key={String(t.teacher_id)} value={String(t.teacher_id)}>
                      {String(t.full_name)}
                    </option>
                  ))}
                </select>
                <select
                  value={asgClass || classes[0]?.class_id || ''}
                  onChange={(e) => setAsgClass(e.target.value)}
                  className="px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {classes.map((c) => (
                    <option key={c.class_id} value={c.class_id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={asgSubject || subjects[0]?.subject_id || ''}
                  onChange={(e) => setAsgSubject(e.target.value)}
                  className="px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {subjects.map((sub) => (
                    <option key={sub.subject_id} value={sub.subject_id}>
                      {sub.name_ar} ({sub.stage_name})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="sm:col-span-3 py-2 bg-[#B8860B] text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  إسناد المادة والشعبة للمدرس
                </button>
              </form>

              <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 text-xs">
                {assignments.map((a) => (
                  <div key={a.assign_id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900">{a.teacher_name}</span>
                      <span className="text-slate-500"> · {a.subject_name} · {a.class_label}</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api('admin.assignmentDelete', { assign_id: a.assign_id });
                        await loadDataMgmt();
                      }}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === 'grades' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={gradeClassId || classes[0]?.class_id || ''}
                  onChange={(e) => setGradeClassId(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {classes.map((c) => (
                    <option key={c.class_id} value={c.class_id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={gradeSubjectId || subjects[0]?.subject_id || ''}
                  onChange={(e) => setGradeSubjectId(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {subjects.map((s) => (
                    <option key={s.subject_id} value={s.subject_id}>
                      {s.name_ar} ({s.stage_name})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const rows = await api<Array<Record<string, unknown>>>('grades.sheet', {
                        class_id: gradeClassId || classes[0]?.class_id,
                        subject_id: gradeSubjectId || subjects[0]?.subject_id,
                      });
                      setAdminGradeRows(rows);
                    } catch (err) {
                      onError(err);
                    }
                  }}
                  className="px-3.5 py-2 bg-[#0F294A] text-white text-xs rounded-lg cursor-pointer"
                >
                  عرض سجل الدرجات
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={importSubjectId || subjects[0]?.subject_id || ''}
                  onChange={(e) => setImportSubjectId(e.target.value)}
                  className="px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {subjects.map((s) => (
                    <option key={s.subject_id} value={s.subject_id}>
                      {s.name_ar}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs cursor-pointer hover:bg-slate-50">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>استيراد درجات Excel</span>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportGradesExcel} className="hidden" />
                </label>
              </div>
            </div>

            {adminGradeRows.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="bg-[#0F294A] text-white">
                      <th className="py-2 px-3">الطالب</th>
                      <th className="py-2 px-2 text-center">ش1</th>
                      <th className="py-2 px-2 text-center">ش2</th>
                      <th className="py-2 px-2 text-center">ف1</th>
                      <th className="py-2 px-2 text-center">نصف</th>
                      <th className="py-2 px-2 text-center">ش3</th>
                      <th className="py-2 px-2 text-center">ش4</th>
                      <th className="py-2 px-2 text-center">ف2</th>
                      <th className="py-2 px-2 text-center">السعي</th>
                      <th className="py-2 px-2 text-center">نهائي</th>
                      <th className="py-2 px-2 text-center">النهائية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {adminGradeRows.map((r) => (
                      <tr key={String(r.student_id)}>
                        <td className="py-2 px-3 font-medium">{String(r.full_name)}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.m1 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.m2 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.avg_t1 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.mid_year ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.m3 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.m4 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.avg_t2 ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums font-semibold">{String(r.annual_effort ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums">{String(r.final_exam ?? '—')}</td>
                        <td className="py-2 px-2 text-center font-mono tabular-nums font-bold">{String(r.final ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {subTab === 'announcements' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">إدارة الإعلانات المدرسية</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api('admin.announcementUpsert', {
                    title: annTitle,
                    body: annBody,
                    audience: annAudience,
                  });
                  setAnnTitle('');
                  setAnnBody('');
                  await onRefreshAll();
                  onSuccess('تم نشر الإعلان بنجاح');
                } catch (err) {
                  onError(err);
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="عنوان الإعلان"
                  className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <select
                  value={annAudience}
                  onChange={(e) => setAnnAudience(e.target.value as 'all' | 'students' | 'teachers')}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">للجميع</option>
                  <option value="students">للطلاب فقط</option>
                  <option value="teachers">للمدرسين فقط</option>
                </select>
              </div>
              <textarea
                rows={2}
                required
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                placeholder="نص الإعلان..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F294A] text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>نشر الإعلان</span>
              </button>
            </form>

            <div className="divide-y divide-slate-200 text-sm">
              {publicData.announcements.map((a: AnnouncementRow) => (
                <div key={a.ann_id} className="py-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{a.title}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{a.body}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api('admin.announcementDelete', { ann_id: a.ann_id });
                      await onRefreshAll();
                    }}
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === 9) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">9. النسخ الاحتياطي والاستعادة (Excel .xlsx)</h2>
            <p className="text-xs text-slate-500">
              تصدير جميع الأوراق الـ 14 إلى ملف Excel واحد، أو استعادة نسخة سابقة بعد تأكيد كلمة مرور المدير.
            </p>
            <button
              type="button"
              onClick={() => downloadExcelBackup(publicData.academic_year).catch(onError)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F294A] text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>نسخة احتياطية الآن (.xlsx)</span>
            </button>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <label className="block text-xs font-medium text-slate-700">تأكيد كلمة مرور المدير للاستعادة</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  dir="ltr"
                  value={restorePassword}
                  onChange={(e) => setRestorePassword(e.target.value)}
                  placeholder="كلمة مرور المدير"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
                />
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50">
                  <Upload className="w-4 h-4" />
                  <span>رفع واستعادة</span>
                  <input type="file" accept=".xlsx" onChange={handleRestoreExcel} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Archive className="w-5 h-5 text-[#B8860B]" />
              <h3 className="text-lg font-bold text-slate-900">إنهاء السنة الدراسية والأرشفة</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              ينقل درجات العام <span className="font-mono">{publicData.academic_year}</span> إلى ورقة{' '}
              <span className="font-mono">Archive_Grades</span>، يرحّل الناجحين للصف التالي، ويحوّل طلاب الصف الأخير الناجحين إلى «متخرج».
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                dir="ltr"
                value={nextAcademicYear}
                onChange={(e) => setNextAcademicYear(e.target.value)}
                placeholder="2027-2028"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api<{ archivedGrades: number; promoted: number; graduated: number }>(
                      'year.archive',
                      { next_academic_year: nextAcademicYear }
                    );
                    await onRefreshAll();
                    onSuccess(
                      `تم إنهاء السنة: أرشفة ${res.archivedGrades} درجة · ترحيل ${res.promoted} طالب · تخرج ${res.graduated} طالب`
                    );
                  } catch (err) {
                    onError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-4 py-2 bg-[#B8860B] hover:bg-[#9E7208] text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                تنفيذ إنهاء السنة
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-base">سجل العمليات الأمني (Audit_Log)</h3>
            <button
              type="button"
              onClick={() => api<AuditLogRow[]>('audit.list').then(setAuditLogs).catch(onError)}
              className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
          </div>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2 px-3">الوقت</th>
                  <th className="py-2 px-3">الدور</th>
                  <th className="py-2 px-3">الفاعل</th>
                  <th className="py-2 px-3">الإجراء</th>
                  <th className="py-2 px-3">الهدف</th>
                  <th className="py-2 px-3">النتيجة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((l) => (
                  <tr key={l.log_id}>
                    <td className="py-1.5 px-3 font-mono tabular-nums text-slate-500" dir="ltr">
                      {l.timestamp.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-1.5 px-3">{l.role}</td>
                    <td className="py-1.5 px-3 font-mono">{l.actor_id}</td>
                    <td className="py-1.5 px-3 font-mono text-[#0F294A]">{l.action}</td>
                    <td className="py-1.5 px-3 font-mono">{l.target}</td>
                    <td className="py-1.5 px-3 font-medium">
                      <span className={l.result === 'ok' ? 'text-emerald-700' : 'text-red-700'}>{l.result}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Screen 10: 14-Sheet Inspector
  const columns = sheetRows.length > 0 ? Object.keys(sheetRows[0]) : [];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Table className="w-5 h-5 text-[#0F294A]" />
          <h2 className="text-lg font-bold text-slate-900">مستعرض الأوراق الـ 14 (Google Sheets Schema)</h2>
        </div>
        <Users className="w-4 h-4 text-slate-400" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SHEET_NAMES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => loadSheetRows(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer border ${
              activeSheet === s
                ? 'bg-[#0F294A] text-white border-[#0F294A]'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto max-h-[420px] border border-slate-200 rounded-lg">
        <table className="w-full text-xs text-right">
          <thead>
            <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
              {columns.map((col) => (
                <th key={col} className="py-2 px-3 font-mono whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sheetRows.length === 0 ? (
              <tr>
                <td className="py-8 text-center text-slate-500">لا توجد صفوف في ورقة {activeSheet} حالياً</td>
              </tr>
            ) : (
              sheetRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  {columns.map((col) => (
                    <td key={col} className="py-2 px-3 font-mono whitespace-nowrap max-w-[220px] truncate">
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
