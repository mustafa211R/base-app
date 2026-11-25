import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  ShieldCheck,
  Eye,
  ArrowRight,
  Lock,
  AlertCircle,
  CheckCircle2,
  Upload,
  Landmark,
} from 'lucide-react';
import { formatIdGrouped, luhnValid, normalizeIdDigits } from '../../shared/luhn.ts';
import type { AuthSession, PublicSchoolData, SchoolType } from '../../shared/types.ts';
import {
  api,
  BaseApiError,
  formatErrorAr,
  formatShifts,
  SCHOOL_TYPE_LABELS,
  setAuthToken,
} from '../lib/api.ts';
import { DeveloperCard, DeveloperFooter } from './DeveloperFooter.tsx';

interface RolePortalProps {
  publicData: PublicSchoolData;
  onAuthenticated: (session: AuthSession) => void;
  onEnterGuest: () => void;
  onRefreshPublic: () => Promise<void>;
}

type PortalView = 'select' | 'student' | 'teacher' | 'admin' | 'education' | 'setup';

export function RolePortal({
  publicData,
  onAuthenticated,
  onEnterGuest,
  onRefreshPublic,
}: RolePortalProps) {
  const initialQuery = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const queryRole = initialQuery?.get('role');
  const queryId = normalizeIdDigits(initialQuery?.get('id') || '');
  const initialView: PortalView = !publicData.initialized
    ? 'setup'
    : queryRole === 'student' || queryRole === 'teacher' || queryRole === 'admin' || queryRole === 'education'
      ? queryRole
      : 'select';

  const [view, setView] = useState<PortalView>(initialView);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lockoutSec, setLockoutSec] = useState(0);

  // Student / Teacher login state
  const [idInput, setIdInput] = useState(queryId ? formatIdGrouped(queryId) : '');
  const [pinInput, setPinInput] = useState('');

  // Admin login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Education Directorate login state
  const [eduCode, setEduCode] = useState('');

  // First-run setup state
  const [setupKey, setSetupKey] = useState('');
  const [schoolName, setSchoolName] = useState(publicData.school_name || 'مدرسة النخبة النموذجية');
  const [schoolType, setSchoolType] = useState<SchoolType>(publicData.school_type || 'middle');
  const [academicYear, setAcademicYear] = useState(publicData.academic_year || '2026-2027');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminCert, setAdminCert] = useState('بكالوريوس');
  const [adminSpecialty, setAdminSpecialty] = useState('إدارة تربوية');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [secQuestion, setSecQuestion] = useState('');
  const [secAnswer, setSecAnswer] = useState('');

  useEffect(() => {
    if (lockoutSec <= 0) return;
    const t = setInterval(() => {
      setLockoutSec((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [lockoutSec]);

  function resetErrors() {
    setErrorMsg('');
  }

  function switchView(next: PortalView) {
    resetErrors();
    setIdInput('');
    setPinInput('');
    setPassword('');
    setEduCode('');
    setView(next);
  }

  async function handleIdLogin(role: 'student' | 'teacher', e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    const clean = normalizeIdDigits(idInput);
    const expectedLen = role === 'student' ? 16 : 8;
    if (clean.length !== expectedLen || !luhnValid(clean)) {
      setErrorMsg(
        role === 'student'
          ? 'رقم هوية الطالب يجب أن يتكون من 16 رقماً وبصيغة تحقق (Luhn) صحيحة'
          : 'رقم هوية المدرس يجب أن يتكون من 8 أرقام وبصيغة تحقق (Luhn) صحيحة'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await api<AuthSession>('auth.login', {
        role,
        id: clean,
        pin: role === 'teacher' ? pinInput.trim() : undefined,
      });
      setAuthToken(res.token);
      onAuthenticated(res);
    } catch (err) {
      if (err instanceof BaseApiError && err.code === 'TOO_MANY_ATTEMPTS') {
        setLockoutSec(Number(err.meta?.retryAfterSec || 900));
      }
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!username.trim() || !password) {
      setErrorMsg('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      const res = await api<AuthSession>('auth.login', {
        role: 'admin',
        username: username.trim(),
        password,
      });
      setAuthToken(res.token);
      onAuthenticated(res);
    } catch (err) {
      if (err instanceof BaseApiError && err.code === 'TOO_MANY_ATTEMPTS') {
        setLockoutSec(Number(err.meta?.retryAfterSec || 900));
      }
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleEducationLogin(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!eduCode.trim()) {
      setErrorMsg('يرجى إدخال كود قسم التربية المعتمد من مدير المدرسة');
      return;
    }
    setLoading(true);
    try {
      const res = await api<AuthSession>('auth.login', {
        role: 'education',
        access_code: eduCode.trim(),
      });
      setAuthToken(res.token);
      onAuthenticated(res);
    } catch (err) {
      if (err instanceof BaseApiError && err.code === 'TOO_MANY_ATTEMPTS') {
        setLockoutSec(Number(err.meta?.retryAfterSec || 900));
      }
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleFirstSetup(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!schoolName.trim()) {
      setErrorMsg('يرجى إدخال اسم المدرسة');
      return;
    }
    if (!adminFullName.trim()) {
      setErrorMsg('يرجى إدخال اسم المدير الكامل');
      return;
    }
    if (adminUsername.trim().length < 4) {
      setErrorMsg(`اسم المستخدم يجب أن يكون 4 أحرف على الأقل (المدخل حالياً: ${adminUsername.trim().length})`);
      return;
    }
    if (adminPassword.length < 8) {
      setErrorMsg(`كلمة المرور يجب أن تكون 8 رموز على الأقل (المدخل حالياً: ${adminPassword.length})`);
      return;
    }
    setLoading(true);
    try {
      const res = await api<AuthSession>('admin.setup', {
        setup_key: setupKey,
        school_name: schoolName.trim(),
        school_type: schoolType,
        academic_year: academicYear.trim(),
        full_name: adminFullName.trim(),
        certificate: adminCert,
        specialty: adminSpecialty.trim(),
        phone: adminPhone.trim(),
        username: adminUsername.trim(),
        password: adminPassword,
        sec_question: secQuestion.trim(),
        sec_answer: secAnswer.trim(),
      });
      setAuthToken(res.token);
      await onRefreshPublic();
      onAuthenticated(res);
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  const cleanDigits = normalizeIdDigits(idInput);
  const expectedDigits = view === 'student' ? 16 : 8;
  const isClientLuhnOk = cleanDigits.length === expectedDigits && luhnValid(cleanDigits);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between overflow-x-hidden">
      <header className="bg-[#0F294A] text-white border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-8">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {publicData.logo_file_id ? (
              <img
                src={publicData.logo_file_id}
                alt={publicData.school_name}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover border border-amber-400/50 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-[#C59B27] bg-[#0B1F3A] flex items-center justify-center text-[#C59B27] font-bold text-xs sm:text-sm shrink-0">
                base
              </div>
            )}
            <span className="font-bold text-sm sm:text-lg truncate">
              {publicData.school_name || 'نظام base لإدارة المدرسة'}
            </span>
          </div>
          {publicData.initialized && view !== 'select' && (
            <button
              type="button"
              onClick={() => switchView('select')}
              className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-200 hover:text-white px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-white/15 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>تغيير الدور</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-3 sm:px-4 py-6 sm:py-10">
        <div className="w-full max-w-4xl">
          {view === 'select' && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900" style={{ textWrap: 'balance' }}>
                  بوابة الدخول المدرسية
                </h1>
                <p className="text-sm text-slate-600 flex items-center justify-center flex-wrap gap-2">
                  <span>{SCHOOL_TYPE_LABELS[publicData.school_type] || publicData.school_type}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatShifts(publicData.shift_type)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums font-mono">العام {publicData.academic_year}</span>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => switchView('student')}
                  className="bg-white border border-slate-200 hover:border-[#0F294A] rounded-xl p-4 sm:p-5 text-right transition-colors flex sm:flex-col items-center sm:items-stretch justify-between gap-3 sm:gap-4 min-h-[88px] sm:min-h-[168px] cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-lg bg-[#0F294A]/10 text-[#0F294A] flex items-center justify-center">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-slate-900">طالب</div>
                    <p className="text-xs text-slate-500 mt-1">الدخول برقم الهوية المدرسية (16 رقماً)</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => switchView('teacher')}
                  className="bg-white border border-slate-200 hover:border-emerald-700 rounded-xl p-4 sm:p-5 text-right transition-colors flex sm:flex-col items-center sm:items-stretch justify-between gap-3 sm:gap-4 min-h-[88px] sm:min-h-[168px] cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-lg bg-emerald-700/10 text-emerald-800 flex items-center justify-center shrink-0">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base sm:text-lg font-bold text-slate-900">مدرس</div>
                    <p className="text-xs text-slate-500 mt-1">الدخول برقم الهوية التدريسية والبصمة</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => switchView('admin')}
                  className="bg-white border border-slate-200 hover:border-[#B8860B] rounded-xl p-4 sm:p-5 text-right transition-colors flex sm:flex-col items-center sm:items-stretch justify-between gap-3 sm:gap-4 min-h-[88px] sm:min-h-[168px] cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-lg bg-amber-600/10 text-[#9A7008] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base sm:text-lg font-bold text-slate-900">مدير</div>
                    <p className="text-xs text-slate-500 mt-1">إدارة المدرسة والهويات والصلاحيات</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => switchView('education')}
                  className="bg-white border border-slate-200 hover:border-sky-700 rounded-xl p-4 sm:p-5 text-right transition-colors flex sm:flex-col items-center sm:items-stretch justify-between gap-3 sm:gap-4 min-h-[88px] sm:min-h-[168px] cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-lg bg-sky-700/10 text-sky-800 flex items-center justify-center shrink-0">
                    <Landmark className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base sm:text-lg font-bold text-slate-900">قسم التربية</div>
                    <p className="text-xs text-slate-500 mt-1">بوابة مديرية التربية والإشراف (بكود المدرسة)</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={onEnterGuest}
                  className="bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-4 sm:p-5 text-right transition-colors flex sm:flex-col items-center sm:items-stretch justify-between gap-3 sm:gap-4 min-h-[88px] sm:min-h-[168px] cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Eye className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="text-base sm:text-lg font-bold text-slate-900">ضيف — للمطالعة</div>
                    <p className="text-xs text-slate-500 mt-1">معلومات المدرسة والإعلانات العامة</p>
                  </div>
                </button>
              </div>

              <DeveloperCard />
            </div>
          )}

          {(view === 'student' || view === 'teacher') && (
            <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {view === 'student' ? 'دخول الطالب' : 'دخول المدرس'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {view === 'student'
                    ? 'أدخل رقم الهوية المكون من 16 رقماً المطبوع على بطاقتك'
                    : 'أدخل رقم الهوية التدريسية المكون من 8 أرقام'}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <div>{errorMsg}</div>
                    {lockoutSec > 0 && (
                      <div className="font-mono tabular-nums text-xs mt-1">
                        الوقت المتبقي: {Math.floor(lockoutSec / 60)}:{String(lockoutSec % 60).padStart(2, '0')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={(e) => handleIdLogin(view, e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    رقم الهوية ({expectedDigits} رقماً)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    value={idInput}
                    onChange={(e) => {
                      resetErrors();
                      setIdInput(e.target.value);
                    }}
                    placeholder={view === 'student' ? '0000 0000 0000 0000' : '0000 0000'}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-mono tabular-nums text-center text-base tracking-wider focus:outline-none focus:ring-2 focus:ring-[#0F294A]"
                  />
                  {cleanDigits.length > 0 && (
                    <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono tabular-nums">{formatIdGrouped(cleanDigits)}</span>
                      <span className={isClientLuhnOk ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                        {cleanDigits.length}/{expectedDigits}{' '}
                        {cleanDigits.length === expectedDigits
                          ? isClientLuhnOk
                            ? '· تحقق Luhn صحيح'
                            : '· رقم التحقق خاطئ'
                          : ''}
                      </span>
                    </div>
                  )}
                </div>

                {view === 'teacher' && publicData.require_teacher_pin && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      رمز PIN (4 أرقام — إذا تم ضبطه)
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-mono tabular-nums text-center text-base tracking-widest focus:outline-none focus:ring-2 focus:ring-[#0F294A]"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || lockoutSec > 0}
                  className="w-full py-2.5 px-4 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
                >
                  {loading ? 'جارٍ التحقق...' : 'دخول'}
                </button>
              </form>
            </div>
          )}

          {view === 'admin' && (
            <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">دخول الإدارة</h2>
                <p className="text-sm text-slate-500 mt-1">
                  تسجيل دخول مدير المدرسة للوصول إلى لوحة الإدارة الكاملة
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <div>{errorMsg}</div>
                    {lockoutSec > 0 && (
                      <div className="font-mono tabular-nums text-xs mt-1">
                        الوقت المتبقي: {Math.floor(lockoutSec / 60)}:{String(lockoutSec % 60).padStart(2, '0')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم المستخدم</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={username}
                    onChange={(e) => {
                      resetErrors();
                      setUsername(e.target.value);
                    }}
                    placeholder="principal"
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#0F294A]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور</label>
                  <input
                    type="password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => {
                      resetErrors();
                      setPassword(e.target.value);
                    }}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#0F294A]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || lockoutSec > 0}
                  className="w-full py-2.5 px-4 bg-[#B8860B] hover:bg-[#9E7208] disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
                >
                  {loading ? 'جارٍ تسجيل الدخول...' : 'دخول المدير'}
                </button>
              </form>
            </div>
          )}

          {view === 'education' && (
            <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div>
                <div className="flex items-center gap-2 text-sky-900">
                  <Landmark className="w-5 h-5 text-sky-700" />
                  <h2 className="text-xl font-bold text-slate-900">دخول قسم التربية والإشراف</h2>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  بوابة خاصة بمديرية التربية والمشرفين للاطلاع على الإحصاءات وسجلات الحضور والشكاوى دون تعديل
                </p>
              </div>

              {!publicData.educationEnabled && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  تنبيه: لم يقم مدير المدرسة بتعيين كود قسم التربية بعد من شاشة «بيانات المدرسة».
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <div>{errorMsg}</div>
                    {lockoutSec > 0 && (
                      <div className="font-mono tabular-nums text-xs mt-1">
                        الوقت المتبقي: {Math.floor(lockoutSec / 60)}:{String(lockoutSec % 60).padStart(2, '0')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleEducationLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    كود دخول مديرية التربية والإشراف
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    value={eduCode}
                    onChange={(e) => {
                      resetErrors();
                      setEduCode(e.target.value);
                    }}
                    placeholder="أدخل الكود المعتمد من مدير المدرسة"
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-mono text-center text-base focus:outline-none focus:ring-2 focus:ring-sky-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || lockoutSec > 0}
                  className="w-full py-2.5 px-4 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
                >
                  {loading ? 'جارٍ التحقق من الكود...' : 'دخول قسم التربية والإشراف'}
                </button>
              </form>
            </div>
          )}

          {view === 'setup' && (
            <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div className="border-b border-slate-200 pb-4">
                <div className="flex items-center gap-2 text-[#0F294A] font-bold text-xl">
                  <Lock className="w-5 h-5 text-[#B8860B]" />
                  <h2>التهيئة الأولى للنظام وحساب المدير</h2>
                </div>
                <p className="text-sm text-slate-600 mt-1">
                  أنشئ بيانات المدرسة وحساب المدير الأول لمرة واحدة. يُغلق هذا الإعداد تلقائياً فور حفظ المدير.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleFirstSetup} className="space-y-5">
                {publicData.setupKeyRequired && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">مفتاح التهيئة السري (SETUP_KEY)</label>
                    <input
                      type="password"
                      dir="ltr"
                      value={setupKey}
                      onChange={(e) => setSetupKey(e.target.value)}
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">اسم المدرسة *</label>
                    <input
                      type="text"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">نوع المدرسة *</label>
                    <select
                      value={schoolType}
                      onChange={(e) => setSchoolType(e.target.value as SchoolType)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="primary">ابتدائي</option>
                      <option value="middle">متوسط</option>
                      <option value="prep">إعدادي</option>
                      <option value="secondary">ثانوي</option>
                      <option value="vocational">مهني</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">اسم المدير الكامل *</label>
                    <input
                      type="text"
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      placeholder="الأستاذ محمد عبد الكريم"
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                    />
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">الشهادة</label>
                    <select
                      value={adminCert}
                      onChange={(e) => setAdminCert(e.target.value)}
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
                      value={adminSpecialty}
                      onChange={(e) => setAdminSpecialty(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">الهاتف (اختياري)</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={adminPhone}
                      onChange={(e) => setAdminPhone(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      اسم المستخدم للدخول * <span className="text-xs text-slate-500">(4 أحرف على الأقل · {adminUsername.trim().length}/4)</span>
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      minLength={4}
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="principal"
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      كلمة المرور * <span className="text-xs text-slate-500">(8 رموز على الأقل · {adminPassword.length}/8)</span>
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      minLength={8}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">سؤال الأمان (اختياري)</label>
                    <input
                      type="text"
                      value={secQuestion}
                      onChange={(e) => setSecQuestion(e.target.value)}
                      placeholder="اسم أول مدرسة عملت بها"
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">جواب سؤال الأمان (اختياري)</label>
                    <input
                      type="text"
                      value={secAnswer}
                      onChange={(e) => setSecAnswer(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-[#0F294A] hover:bg-[#163864] text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {loading ? 'جارٍ تهيئة الأوراق وإنشاء الحساب...' : 'إنشاء حساب المدير وفتح لوحة الإدارة'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>

      <DeveloperFooter />
    </div>
  );
}

interface FirstTimeRegisterProps {
  role: 'student' | 'teacher';
  id: string;
  requireTeacherPin: boolean;
  onComplete: () => void;
  onLogout: () => void;
}

export function FirstTimeRegister({
  role,
  id,
  requireTeacherPin,
  onComplete,
  onLogout,
}: FirstTimeRegisterProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');

  // Student fields
  const [fullName, setFullName] = useState('');
  const [motherName, setMotherName] = useState('');
  const [gender, setGender] = useState('ذكر');
  const [birthDate, setBirthDate] = useState('');
  const [address, setAddress] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [prevSchool, setPrevSchool] = useState('');
  const [prevStage, setPrevStage] = useState('');
  const [prevAverage, setPrevAverage] = useState('');
  const [regReason, setRegReason] = useState('جديد');

  // Teacher extra fields
  const [degree, setDegree] = useState('بكالوريوس');
  const [specialty, setSpecialty] = useState('');
  const [university, setUniversity] = useState('');
  const [college, setCollege] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [jobTitle, setJobTitle] = useState('مدرس');
  const [hireDate, setHireDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [subjects, setSubjects] = useState('');
  const [bioCv, setBioCv] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('حجم الصورة يجب أن لا يتجاوز 2 ميجابايت');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      if (role === 'student') {
        await api('student.register', {
          profile: {
            full_name: fullName,
            mother_name: motherName,
            gender,
            birth_date: birthDate,
            address,
            guardian_name: guardianName,
            guardian_phone: guardianPhone,
            photo_data_url: photoDataUrl,
            prev_school: prevSchool,
            prev_stage: prevStage,
            prev_average: prevAverage,
            reg_reason: regReason,
          },
        });
      } else {
        await api('teacher.register', {
          profile: {
            full_name: fullName,
            gender,
            birth_date: birthDate,
            degree,
            specialty,
            university,
            college,
            grad_year: gradYear,
            job_title: jobTitle,
            hire_date: hireDate,
            start_date: startDate,
            subjects,
            bio_cv: bioCv,
            phone,
            whatsapp,
            email,
            address,
            photo_data_url: photoDataUrl,
            pin: pin || undefined,
          },
        });
      }
      onComplete();
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {role === 'student' ? 'تسجيل بيانات الطالب لأول مرة' : 'تسجيل بيانات المدرس لأول مرة'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              رقم الهوية: <span className="font-mono tabular-nums text-slate-800">{formatIdGrouped(id)}</span>
              {role === 'student' && ' · الصف والشعبة محددان مسبقاً من الإدارة'}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            تسجيل الخروج
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
              {photoDataUrl ? (
                <img src={photoDataUrl} alt="صورة شخصية" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-slate-400">صورة</span>
              )}
            </div>
            <div>
              <label className="inline-flex items-center gap-2 px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>رفع الصورة الشخصية</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} className="hidden" />
              </label>
              <p className="text-xs text-slate-500 mt-1">صورة خاصة تُعرض فقط وفق مصفوفة الصلاحيات</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">الاسم الرباعي *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">الجنس</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="ذكر">ذكر</option>
                <option value="أنثى">أنثى</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                تاريخ الميلاد {role === 'student' ? '*' : ''}
              </label>
              <input
                type="date"
                required={role === 'student'}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
              />
            </div>

            {role === 'student' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">اسم الأم</label>
                  <input
                    type="text"
                    value={motherName}
                    onChange={(e) => setMotherName(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">سبب التسجيل</label>
                  <select
                    value={regReason}
                    onChange={(e) => setRegReason(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="جديد">جديد</option>
                    <option value="نقل">نقل</option>
                    <option value="إعادة">إعادة</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">اسم ولي الأمر</label>
                  <input
                    type="text"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">رقم هاتف ولي الأمر *</label>
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    placeholder="07700000000"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">العنوان السكني</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">المدرسة السابقة (اختياري)</label>
                  <input
                    type="text"
                    value={prevSchool}
                    onChange={(e) => setPrevSchool(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">المرحلة السابقة</label>
                    <input
                      type="text"
                      value={prevStage}
                      onChange={(e) => setPrevStage(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">المعدل</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={prevAverage}
                      onChange={(e) => setPrevAverage(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الشهادة</label>
                  <select
                    value={degree}
                    onChange={(e) => setDegree(e.target.value)}
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
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الجامعة</label>
                  <input
                    type="text"
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكلية وسنة التخرج</label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={college}
                      onChange={(e) => setCollege(e.target.value)}
                      placeholder="الكلية"
                      className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={gradYear}
                      onChange={(e) => setGradYear(e.target.value)}
                      placeholder="2015"
                      className="px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">العنوان الوظيفي</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">المواد التي يدرّسها</label>
                  <input
                    type="text"
                    value={subjects}
                    onChange={(e) => setSubjects(e.target.value)}
                    placeholder="الرياضيات، الفيزياء"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">تاريخ التعيين</label>
                  <input
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">تاريخ المباشرة بالمدرسة</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">رقم الواتساب</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">العنوان السكني</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">السيرة الذاتية المختصرة</label>
                  <textarea
                    rows={3}
                    value={bioCv}
                    onChange={(e) => setBioCv(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    رمز PIN شخصي (4 أرقام {requireTeacherPin ? '— مستحسن للحماية الإضافية' : '— اختياري'})
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-40 px-3.5 py-2 border border-slate-300 rounded-lg font-mono text-center tracking-widest text-sm"
                  />
                </div>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#0F294A] hover:bg-[#163864] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{loading ? 'جارٍ حفظ البيانات...' : 'حفظ البيانات وتفعيل الحساب'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
