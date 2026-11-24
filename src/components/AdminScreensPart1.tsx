import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Database,
  Download,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Upload,
  Plus,
  Trash2,
  Copy,
  FileSpreadsheet,
} from 'lucide-react';
import { formatIdGrouped } from '../../shared/luhn.ts';
import type {
  ClassRow,
  IdRow,
  PublicSchoolData,
  SchoolConfig,
  SchoolType,
  StageRow,
} from '../../shared/types.ts';
import {
  api,
  callAppsScript,
  configureBackend,
  downloadProjectBundle,
  formatErrorAr,
  getBackendState,
  ID_STATUS_LABELS,
} from '../lib/api.ts';

interface Part1Props {
  screen: 1 | 2 | 3 | 4 | 5;
  publicData: PublicSchoolData;
  config: SchoolConfig | null;
  stages: StageRow[];
  classes: Array<ClassRow & { stage_name?: string; students_count?: number }>;
  idsList: Array<IdRow & { class_label?: string; person_name?: string }>;
  adminProfile: Record<string, unknown> | null;
  onSuccess: (msg: string) => void;
  onError: (err: unknown) => void;
  onRefreshAll: () => Promise<void>;
}

export function AdminScreensPart1({
  screen,
  publicData,
  config,
  stages,
  classes,
  idsList,
  adminProfile,
  onSuccess,
  onError,
  onRefreshAll,
}: Part1Props) {
  // Screen 1: Connection & Bundle
  const backendState = getBackendState();
  const [extScriptUrl, setExtScriptUrl] = useState(backendState.appsScriptUrl);
  const [extTestStatus, setExtTestStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Screen 2: School Config
  const [schoolName, setSchoolName] = useState(config?.school_name || publicData.school_name);
  const [foundedDate, setFoundedDate] = useState(config?.founded_date || publicData.founded_date);
  const [schoolType, setSchoolType] = useState<SchoolType>(config?.school_type || publicData.school_type);
  const [shifts, setShifts] = useState<string[]>((config?.shift_type || publicData.shift_type || 'morning').split(',').filter(Boolean));
  const [mapUrl, setMapUrl] = useState(config?.map_url || '');
  const [about, setAbout] = useState(config?.about || '');
  const [academicYear, setAcademicYear] = useState(config?.academic_year || publicData.academic_year);
  const [passMark, setPassMark] = useState(config?.pass_mark || '50');
  const [effortFormula, setEffortFormula] = useState(config?.annual_effort_formula || 'iraqi_avg');
  const [finalFormula, setFinalFormula] = useState(config?.final_score_formula || 'avg_effort_final');
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);

  // Screen 3: Admin Profile
  const [admFullName, setAdmFullName] = useState(String(adminProfile?.full_name || ''));
  const [admCert, setAdmCert] = useState(String(adminProfile?.certificate || 'بكالوريوس'));
  const [admSpec, setAdmSpec] = useState(String(adminProfile?.specialty || ''));
  const [admStart, setAdmStart] = useState(String(adminProfile?.start_date || ''));
  const [admPhone, setAdmPhone] = useState(String(adminProfile?.phone || ''));
  const [admWa, setAdmWa] = useState(String(adminProfile?.whatsapp || ''));
  const [admUser, setAdmUser] = useState(String(adminProfile?.username || ''));
  const [admSecQ, setAdmSecQ] = useState(String(adminProfile?.sec_question || ''));
  const [admSecA, setAdmSecA] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Screen 4: Stages & Classes
  const [newStageName, setNewStageName] = useState('');
  const [newStageTrack, setNewStageTrack] = useState('');
  const [selectedStageId, setSelectedStageId] = useState(stages[0]?.stage_id || '');
  const [newSection, setNewSection] = useState('أ');
  const [newCapacity, setNewCapacity] = useState('35');

  // Screen 5: ID Generation
  const [genKind, setGenKind] = useState<'student' | 'teacher'>('student');
  const [genClassId, setGenClassId] = useState(classes[0]?.class_id || '');
  const [genCount, setGenCount] = useState('10');
  const [idFilterKind, setIdFilterKind] = useState<'all' | 'student' | 'teacher'>('all');

  function toggleShift(s: string) {
    setShifts((prev) => (prev.includes(s) ? (prev.length > 1 ? prev.filter((x) => x !== s) : prev) : [...prev, s]));
  }

  async function handleInitSchema() {
    setBusy(true);
    try {
      await api('admin.initSchema');
      await onRefreshAll();
      onSuccess('تم التحقق من تهيئة الأوراق الـ 14 بنجاح');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handlePopulateDemo() {
    setBusy(true);
    try {
      await api('demo.populate');
      await onRefreshAll();
      onSuccess('تمت تعبئة بيانات المدرسة النموذجية (الصفوف، الشعب، المواد، الهويات، والدرجات)');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleTestExternalAppsScript(switchToIt = false) {
    if (!extScriptUrl.startsWith('https://script.google.com/')) {
      setExtTestStatus('يجب أن يبدأ الرابط بـ https://script.google.com/macros/s/...');
      return;
    }
    setExtTestStatus('جارٍ اختبار الاتصال...');
    try {
      await callAppsScript(extScriptUrl, 'school.public');
      if (switchToIt) {
        configureBackend('apps_script', extScriptUrl);
        await onRefreshAll();
        onSuccess('تم اعتماد رابط Google Apps Script كخادم حالي وتحديث البيانات');
      }
      setExtTestStatus('الاتصال ناجح مع Google Apps Script!');
    } catch (err) {
      setExtTestStatus(formatErrorAr(err));
    }
  }

  async function handleSaveSchool(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('admin.schoolSave', {
        school_name: schoolName,
        founded_date: foundedDate,
        school_type: schoolType,
        shift_type: shifts.join(','),
        map_url: mapUrl,
        about,
        academic_year: academicYear,
        pass_mark: passMark,
        annual_effort_formula: effortFormula,
        final_score_formula: finalFormula,
        logo_data_url: logoDataUrl,
      });
      await onRefreshAll();
      onSuccess('تم حفظ بيانات المدرسة والإعدادات بنجاح');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdminProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('admin.profileSave', {
        full_name: admFullName,
        certificate: admCert,
        specialty: admSpec,
        start_date: admStart,
        phone: admPhone,
        whatsapp: admWa,
        username: admUser,
        sec_question: admSecQ,
        sec_answer: admSecA,
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      await onRefreshAll();
      onSuccess('تم حفظ بيانات المدير وحساب الدخول');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyDefaultStages() {
    setBusy(true);
    try {
      await api('admin.stageApplyDefaults', { school_type: schoolType });
      await onRefreshAll();
      onSuccess('تمت إضافة المراحل الافتراضية لنوع المدرسة');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    setBusy(true);
    try {
      await api('admin.stageUpsert', {
        name_ar: newStageName.trim(),
        level_type: schoolType,
        sort_order: stages.length + 1,
        track: newStageTrack.trim(),
      });
      setNewStageName('');
      setNewStageTrack('');
      await onRefreshAll();
      onSuccess('تمت إضافة المرحلة بنجاح');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    const targetStage = selectedStageId || stages[0]?.stage_id;
    if (!targetStage || !newSection.trim()) return;
    setBusy(true);
    try {
      await api('admin.classUpsert', {
        stage_id: targetStage,
        section: newSection.trim(),
        capacity: Number(newCapacity || 35),
      });
      await onRefreshAll();
      onSuccess('تمت إضافة الشعبة بنجاح');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateIds(e: React.FormEvent) {
    e.preventDefault();
    const targetClass = genClassId || classes[0]?.class_id;
    if (genKind === 'student' && !targetClass) {
      onError(new Error('يرجى إنشاء شعبة دراسية أولاً في الشاشة 4'));
      return;
    }
    setBusy(true);
    try {
      const created = await api<string[]>('ids.generate', {
        kind: genKind,
        class_id: genKind === 'student' ? targetClass : '',
        count: Number(genCount || 1),
      });
      await onRefreshAll();
      onSuccess(`تم توليد ${created.length} هوية جديدة بنجاح`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleExcelPrefill(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const targetClass = genClassId || classes[0]?.class_id;
    if (!file || !targetClass) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as Array<Record<string, unknown>>;
      const mapped = rows
        .map((r) => ({
          full_name: r['الاسم'] || r['full_name'] || r['Name'] || '',
          mother_name: r['اسم الأم'] || r['mother_name'] || '',
          gender: r['الجنس'] || r['gender'] || 'ذكر',
          birth_date: r['تاريخ الميلاد'] || r['birth_date'] || '2012-01-01',
          guardian_name: r['ولي الأمر'] || r['guardian_name'] || '',
          guardian_phone: String(r['الهاتف'] || r['guardian_phone'] || ''),
        }))
        .filter((r) => String(r.full_name).trim() !== '');
      const created = await api<Array<{ student_id: string }>>('ids.prefillStudents', {
        class_id: targetClass,
        students: mapped,
      });
      await onRefreshAll();
      onSuccess(`تم استيراد ${created.length} طالب وتوليد هويات Luhn لهم`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  if (screen === 1) {
    const modeLabel =
      backendState.mode === 'apps_script'
        ? 'متصل مباشرة بـ Google Sheets عبر Google Apps Script Web App.'
        : 'متصل بالخادم المحلي (SQLite) المتوافق مع أوراق Google Sheets الـ 14.';
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">1. الاتصال وتهيئة قاعدة البيانات</h2>
              <p className="text-sm text-slate-500 mt-1">{modeLabel}</p>
            </div>
            <Database className="w-6 h-6 text-[#0F294A] shrink-0" />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleInitSchema}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>التحقق من الأوراق الـ 14</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handlePopulateDemo}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#B8860B] hover:bg-[#9E7208] text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>تعبئة بيانات مدرسة نموذجية للتجربة</span>
            </button>

            <button
              type="button"
              onClick={() => downloadProjectBundle().catch(onError)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تنزيل حزمة Apps Script + Python (.zip)</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="font-bold text-slate-900 text-base">إعداد واختبار رابط Google Apps Script Web App</h3>
          <p className="text-xs text-slate-500">
            عند نشر شيفرة Apps Script من الحزمة على حساب جوجل الخاص بالمدرسة (مع ضبط Who has access على Anyone)، يمكنك اختبار الرابط أو التبديل إليه هنا.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              dir="ltr"
              value={extScriptUrl}
              onChange={(e) => setExtScriptUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
              className="flex-1 px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => handleTestExternalAppsScript(false)}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              اختبار الاتصال
            </button>
            <button
              type="button"
              onClick={() => handleTestExternalAppsScript(true)}
              className="px-4 py-2 border border-[#0F294A] text-[#0F294A] hover:bg-slate-50 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              اعتماد كخادم نشط
            </button>
          </div>
          {extTestStatus && <p className="text-xs text-slate-700 font-medium">{extTestStatus}</p>}
        </div>
      </div>
    );
  }

  if (screen === 2) {
    return (
      <form onSubmit={handleSaveSchool} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-lg font-bold text-slate-900">2. بيانات المدرسة ومعادلات الدرجات</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">اسم المدرسة *</label>
            <input
              type="text"
              required
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">تاريخ الإنشاء</label>
            <input
              type="date"
              value={foundedDate}
              onChange={(e) => setFoundedDate(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">نوع المدرسة</label>
            <select
              value={schoolType}
              onChange={(e) => setSchoolType(e.target.value as SchoolType)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="primary">ابتدائي (6 صفوف)</option>
              <option value="middle">متوسط (3 صفوف)</option>
              <option value="prep">إعدادي (4، 5، 6 علمي/أدبي)</option>
              <option value="secondary">ثانوي (متوسط + إعدادي)</option>
              <option value="vocational">مهني</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">العام الدراسي الحالي</label>
            <input
              type="text"
              dir="ltr"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">نوع الدوام (يمكن اختيار أكثر من نوع)</label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'morning', label: 'صباحي' },
              { id: 'noon', label: 'ظهري' },
              { id: 'evening', label: 'مسائي' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleShift(s.id)}
                className={`px-3.5 py-2 rounded-lg text-sm border cursor-pointer ${
                  shifts.includes(s.id)
                    ? 'bg-[#0F294A] text-white border-[#0F294A]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رابط الموقع على خرائط جوجل</label>
            <input
              type="url"
              dir="ltr"
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">شعار المدرسة (اختياري)</label>
            <label className="inline-flex items-center gap-2 px-3.5 py-2 border border-slate-300 rounded-lg text-sm cursor-pointer hover:bg-slate-50">
              <Upload className="w-4 h-4" />
              <span>رفع صورة الشعار</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') setLogoDataUrl(reader.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">نبذة عن المدرسة (تظهر للضيف والطلاب)</label>
          <textarea
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">حد النجاح الافتراضي</label>
            <input
              type="number"
              min={0}
              max={100}
              value={passMark}
              onChange={(e) => setPassMark(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">معادلة السعي السنوي</label>
            <select
              value={effortFormula}
              onChange={(e) => setEffortFormula(e.target.value as SchoolConfig['annual_effort_formula'])}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="iraqi_avg">متوسط (ف1 + نصف السنة + ف2) ÷ 3</option>
              <option value="weighted_40_20_40">أوزان (40% ف1 + 20% نصف + 40% ف2)</option>
              <option value="terms_only">متوسط الفصلين فقط (ف1 + ف2) ÷ 2</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">معادلة الدرجة النهائية</label>
            <select
              value={finalFormula}
              onChange={(e) => setFinalFormula(e.target.value as SchoolConfig['final_score_formula'])}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="avg_effort_final">متوسط (السعي + نهاية السنة) ÷ 2</option>
              <option value="weighted_40_60">أوزان (40% السعي + 60% نهاية السنة)</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-medium rounded-lg cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>حفظ بيانات المدرسة</span>
        </button>
      </form>
    );
  }

  if (screen === 3) {
    return (
      <form onSubmit={handleSaveAdminProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-lg font-bold text-slate-900">3. بيانات المدير وحساب الدخول</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">اسم المدير *</label>
            <input
              type="text"
              required
              value={admFullName}
              onChange={(e) => setAdmFullName(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">الشهادة</label>
            <select
              value={admCert}
              onChange={(e) => setAdmCert(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="دبلوم">دبلوم</option>
              <option value="بكالوريوس">بكالوريوس</option>
              <option value="ماجستير">ماجستير</option>
              <option value="دكتوراه">دكتوراه</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">التخصص</label>
            <input
              type="text"
              value={admSpec}
              onChange={(e) => setAdmSpec(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">تاريخ مباشرة الإدارة</label>
            <input
              type="date"
              value={admStart}
              onChange={(e) => setAdmStart(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف (اختياري — لا يُعرض للضيف)</label>
            <input
              type="tel"
              dir="ltr"
              value={admPhone}
              onChange={(e) => setAdmPhone(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رقم الواتساب (اختياري)</label>
            <input
              type="tel"
              dir="ltr"
              value={admWa}
              onChange={(e) => setAdmWa(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">اسم المستخدم *</label>
            <input
              type="text"
              dir="ltr"
              required
              value={admUser}
              onChange={(e) => setAdmUser(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">سؤال الأمان</label>
            <input
              type="text"
              value={admSecQ}
              onChange={(e) => setAdmSecQ(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 space-y-3">
          <div className="text-sm font-semibold text-slate-800">تغيير كلمة المرور (اختياري)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="password"
              dir="ltr"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="كلمة المرور الحالية"
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
            <input
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="كلمة المرور الجديدة (8 رموز+)"
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
            <input
              type="text"
              value={admSecA}
              onChange={(e) => setAdmSecA(e.target.value)}
              placeholder="تحديث جواب الأمان (اختياري)"
              className="px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-medium rounded-lg cursor-pointer"
        >
          حفظ بيانات المدير
        </button>
      </form>
    );
  }

  if (screen === 4) {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">4. المراحل (الصفوف) والشعب</h2>
              <p className="text-xs text-slate-500">يمنع النظام تكرار الصف أو تكرار الشعبة داخل نفس الصف</p>
            </div>
            <button
              type="button"
              onClick={handleApplyDefaultStages}
              className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
            >
              تطبيق المراحل الافتراضية لنوع المدرسة
            </button>
          </div>

          <form onSubmit={handleAddStage} className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2">
            <input
              type="text"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="اسم الصف (مثلاً: الأول المتوسط)"
              className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="text"
              value={newStageTrack}
              onChange={(e) => setNewStageTrack(e.target.value)}
              placeholder="الفرع (علمي/أدبي/صناعي...)"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 px-4 py-2 bg-[#0F294A] text-white text-sm rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صف</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2 pt-2">
            {stages.map((st) => (
              <div
                key={st.stage_id}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <span className="font-medium text-slate-800">{st.name_ar}</span>
                {st.track ? <span className="text-slate-500">({st.track})</span> : null}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api('admin.stageDelete', { stage_id: st.stage_id });
                      await onRefreshAll();
                    } catch (err) {
                      onError(err);
                    }
                  }}
                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                  title="حذف الصف"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-slate-900">إضافة شعبة دراسية</h3>
          <form onSubmit={handleAddClass} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select
              value={selectedStageId || stages[0]?.stage_id || ''}
              onChange={(e) => setSelectedStageId(e.target.value)}
              className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              {stages.map((st) => (
                <option key={st.stage_id} value={st.stage_id}>
                  {st.name_ar}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                placeholder="الشعبة (أ، ب)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <input
                type="number"
                min={1}
                max={100}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                title="السعة"
                className="w-20 px-2 py-2 border border-slate-300 rounded-lg font-mono text-sm"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 px-4 py-2 bg-[#B8860B] text-white text-sm rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة شعبة</span>
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2 px-3">الرمز</th>
                  <th className="py-2 px-3">الصف والشعبة</th>
                  <th className="py-2 px-3">الطلاب</th>
                  <th className="py-2 px-3">السعة</th>
                  <th className="py-2 px-3 text-left">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {classes.map((c) => (
                  <tr key={c.class_id}>
                    <td className="py-2 px-3 font-mono text-xs text-slate-500">{c.class_id}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{c.label}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{c.students_count || 0}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{c.capacity}</td>
                    <td className="py-2 px-3 text-left">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api('admin.classDelete', { class_id: c.class_id });
                            await onRefreshAll();
                          } catch (err) {
                            onError(err);
                          }
                        }}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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

  // Screen 5: ID Generation
  const filteredIds = idsList.filter((i) => idFilterKind === 'all' || i.kind === idFilterKind);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">5. مولّد الهويات (Luhn + CSPRNG)</h2>
          <p className="text-xs text-slate-500 mt-1">
            هويات الطلاب (16 رقماً عشوائياً مشفراً + رقم تحقق Luhn) وهويات المدرسين (8 أرقام + رقم تحقق Luhn)
          </p>
        </div>

        <form onSubmit={handleGenerateIds} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">الفئة</label>
            <select
              value={genKind}
              onChange={(e) => setGenKind(e.target.value as 'student' | 'teacher')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="student">طالب (16 رقماً)</option>
              <option value="teacher">مدرس (8 أرقام)</option>
            </select>
          </div>
          {genKind === 'student' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ربط بالشعبة</label>
              <select
                value={genClassId || classes[0]?.class_id || ''}
                onChange={(e) => setGenClassId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {classes.map((c) => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">العدد</label>
            <input
              type="number"
              min={1}
              max={500}
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            توليد الهويات
          </button>
        </form>

        {genKind === 'student' && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-600">
              أو استورد قائمة طلاب مسبقة من ملف Excel/CSV لربط الأسماء مباشرةً بهويات مولّدة (عمود: الاسم)
            </span>
            <label className="inline-flex items-center gap-2 px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>تعبئة مسبقة من Excel</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelPrefill} className="hidden" />
            </label>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900 text-sm">سجل الهويات ({filteredIds.length})</h3>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'student', label: 'الطلاب' },
              { id: 'teacher', label: 'المدرسون' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setIdFilterKind(f.id as 'all' | 'student' | 'teacher')}
                className={`px-3 py-1 rounded-md cursor-pointer ${
                  idFilterKind === f.id ? 'bg-white text-slate-900 font-medium' : 'text-slate-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <th className="py-2 px-3">رقم الهوية</th>
                <th className="py-2 px-3">الفئة</th>
                <th className="py-2 px-3">الشعبة</th>
                <th className="py-2 px-3">الاسم المسجل</th>
                <th className="py-2 px-3">الحالة</th>
                <th className="py-2 px-3 text-left">نسخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredIds.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="py-2 px-3 font-mono tabular-nums text-xs" dir="ltr">
                    {formatIdGrouped(item.id)}
                  </td>
                  <td className="py-2 px-3 text-xs">{item.kind === 'student' ? 'طالب' : 'مدرس'}</td>
                  <td className="py-2 px-3 text-xs text-slate-600">{item.class_label || '—'}</td>
                  <td className="py-2 px-3 text-xs font-medium">{item.person_name || '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    <span
                      className={
                        item.status === 'registered'
                          ? 'text-emerald-700 font-medium'
                          : item.status === 'disabled'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }
                    >
                      {ID_STATUS_LABELS[item.status] || item.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-left">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(item.id);
                        onSuccess(`تم نسخ الهوية: ${item.id}`);
                      }}
                      className="text-slate-500 hover:text-slate-900 cursor-pointer"
                      title="نسخ الهوية"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
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
