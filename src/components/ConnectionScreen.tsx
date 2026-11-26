import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  BaseApiError,
  callAppsScript,
  configureBackend,
  formatErrorAr,
  getBackendState,
  resetBackendDetection,
} from '../lib/api.ts';
import { APPS_SCRIPT_FILES, downloadClientBundleZip } from '../lib/clientExports.ts';

interface ConnectionScreenProps {
  error: unknown;
  onRetrySuccess: () => Promise<void>;
}

export function ConnectionScreen({ error, onRetrySuccess }: ConnectionScreenProps) {
  const initialState = getBackendState();
  const [scriptUrl, setScriptUrl] = useState(initialState.appsScriptUrl);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusError, setStatusError] = useState('');
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [copiedFile, setCopiedFile] = useState('');

  const isHtmlAuthError = error instanceof BaseApiError && error.code === 'APPS_SCRIPT_HTML_AUTH';
  const errorText = formatErrorAr(error);
  const currentFile = APPS_SCRIPT_FILES[activeFileIdx];

  async function handleTestAndConnect(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = scriptUrl.trim();
    if (!cleaned.startsWith('https://script.google.com/')) {
      setStatusError('يجب أن يبدأ رابط Web App بـ https://script.google.com/macros/s/...');
      setStatusMsg('');
      return;
    }
    setTesting(true);
    setStatusError('');
    setStatusMsg('جارٍ اختبار الاتصال مع Google Apps Script...');
    try {
      await callAppsScript(cleaned, 'school.public');
      configureBackend('apps_script', cleaned);
      setStatusMsg('تم التحقق من الاتصال بنجاح! جارٍ فتح النظام...');
      await onRetrySuccess();
    } catch (err) {
      setStatusMsg('');
      setStatusError(formatErrorAr(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleRetryLocalOrAuto() {
    setTesting(true);
    setStatusError('');
    resetBackendDetection();
    try {
      await onRetrySuccess();
    } catch (err) {
      setStatusError(formatErrorAr(err));
    } finally {
      setTesting(false);
    }
  }

  function handleCopyFile(name: string, content: string) {
    navigator.clipboard?.writeText(content);
    setCopiedFile(name);
    setTimeout(() => setCopiedFile(''), 2200);
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-[#B8860B]">نظام base لإدارة المدرسة · تشخيص الاتصال</div>
              <h1 className="text-xl font-bold text-[#0F294A]">ربط الواجهة بخادم Google Apps Script</h1>
              <p className="text-sm text-slate-600">
                الواجهة تعمل كـ Static SPA على Vercel وتحتاج إلى نشر Web App من Google Apps Script بصلاحية وصول مفتوحة للاستعلامات العامة.
              </p>
            </div>
            <button
              type="button"
              disabled={testing}
              onClick={handleRetryLocalOrAuto}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
              <span>إعادة فحص الاتصال</span>
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <div className="font-bold text-amber-950">سبب تعذّر الاتصال الحالي</div>
              <p className="text-amber-900 leading-relaxed">{statusError || errorText}</p>
              {isHtmlAuthError && (
                <p className="text-xs text-amber-800 pt-1">
                  ملاحظة فنية: الخادم أعاد صفحة تسجيل دخول Google (HTML) بدلاً من JSON، وهذا يعني أن إعداد النشر في Apps Script مضبوط حالياً على «أنا فقط» وليس «الجميع (Anyone)».
                </p>
              )}
            </div>
          </div>

          <form onSubmit={handleTestAndConnect} className="space-y-2">
            <label className="block text-sm font-semibold text-slate-800">رابط Google Apps Script Web App (/exec)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="url"
                  dir="ltr"
                  required
                  value={scriptUrl}
                  onChange={(e) => setScriptUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full pr-9 pl-3 py-2.5 border border-slate-300 rounded-lg font-mono text-xs bg-white focus:outline-none focus:border-[#0F294A]"
                />
              </div>
              <button
                type="submit"
                disabled={testing}
                className="px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-sm font-semibold rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                {testing ? 'جارٍ الاختبار...' : 'اختبار الاتصال والدخول'}
              </button>
            </div>
            {statusMsg && <div className="text-xs font-semibold text-emerald-700">{statusMsg}</div>}
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0F294A]" />
              <h2 className="text-base font-bold text-slate-900">خطوات تفعيل النشر في Google Sheets (دقيقة واحدة)</h2>
            </div>
            <button
              type="button"
              onClick={() => downloadClientBundleZip()}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#B8860B] hover:bg-[#9E7208] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تنزيل حزمة الشيفرات الكاملة (.zip)</span>
            </button>
          </div>

          <ol className="list-decimal list-inside space-y-2 text-sm text-slate-700 leading-relaxed">
            <li>
              افتح جدول Google Sheets الخاص بالمدرسة، ثم ادخل إلى{' '}
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">Extensions → Apps Script</span>.
            </li>
            <li>
              أضف الملفات الستة أدناه بنفس الأسماء داخل محرر Apps Script (انسخ محتوى كل ملف بالضغط على زر النسخ):{' '}
              <span className="font-mono text-xs text-slate-900">router.gs · auth.gs · data.gs · grades.gs · admin.gs · backup.gs</span>.
            </li>
            <li>
              من أعلى اليمين اختر{' '}
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">Deploy → Manage deployments → Edit (أيقونة القلم) → New version</span>:
              <div className="mt-1.5 mr-5 text-xs text-slate-800 space-y-1">
                <div>
                  • Execute as (التنفيذ بصفتي): <strong className="text-[#0F294A]">Me (حسابك)</strong>
                </div>
                <div>
                  • Who has access (من لديه صلاحية الوصول): <strong className="text-emerald-700">Anyone (الجميع)</strong> — ضروري لكي يقبل طلبات الموقع بدون تحويلها لصفحة تسجيل دخول Google.
                </div>
              </div>
            </li>
            <li>بعد النشر، اضغط على زر «اختبار الاتصال والدخول» أعلاه لبدء معالج تأسيس المدرسة مباشرة.</li>
          </ol>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {APPS_SCRIPT_FILES.map((f, idx) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => setActiveFileIdx(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono border cursor-pointer ${
                      activeFileIdx === idx
                        ? 'bg-[#0F294A] text-white border-[#0F294A]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleCopyFile(currentFile.name, currentFile.content)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                {copiedFile === currentFile.name ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700">تم نسخ {currentFile.name}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ {currentFile.name}</span>
                  </>
                )}
              </button>
            </div>

            <div className="text-xs text-slate-500">{currentFile.labelAr}</div>
            <pre
              dir="ltr"
              className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs font-mono overflow-x-auto max-h-72 leading-relaxed"
            >
              {currentFile.content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
