import type { AuthSession, PublicSchoolData } from '../../shared/types.ts';
import { DEFAULT_APPS_SCRIPT_URL } from '../config.ts';
import { downloadClientBundleZip, exportSheetsDataToXlsx } from './clientExports.ts';

export type BackendMode = 'local' | 'apps_script';

const SCRIPT_URL_STORAGE_KEY = 'base_apps_script_url';

function loadSavedScriptUrl(): string {
  try {
    if (typeof window !== 'undefined') {
      const paramUrl = new URLSearchParams(window.location.search).get('api')?.trim();
      if (paramUrl && paramUrl.startsWith('https://script.google.com/macros/s/')) {
        window.localStorage.setItem(SCRIPT_URL_STORAGE_KEY, paramUrl);
        return paramUrl;
      }
      const saved = window.localStorage.getItem(SCRIPT_URL_STORAGE_KEY);
      if (saved && saved.startsWith('https://script.google.com/macros/s/')) return saved;
    }
  } catch {
    // ignore storage access issues
  }
  return DEFAULT_APPS_SCRIPT_URL;
}

// Keep auth token strictly in JS memory (never localStorage/sessionStorage)
let memoryToken: string | null = null;
let onSessionExpiredCallback: (() => void) | null = null;
let activeMode: BackendMode | null = null;
let activeAppsScriptUrl: string = loadSavedScriptUrl();

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export function setOnSessionExpired(cb: () => void) {
  onSessionExpiredCallback = cb;
}

export function getBackendState(): { mode: BackendMode | null; appsScriptUrl: string } {
  return { mode: activeMode, appsScriptUrl: activeAppsScriptUrl };
}

export function configureBackend(mode: BackendMode, appsScriptUrl?: string) {
  activeMode = mode;
  if (appsScriptUrl && appsScriptUrl.trim()) {
    activeAppsScriptUrl = appsScriptUrl.trim();
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SCRIPT_URL_STORAGE_KEY, activeAppsScriptUrl);
      }
    } catch {
      // ignore
    }
  }
}

export function resetBackendDetection() {
  activeMode = null;
}

export class BaseApiError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  constructor(code: string, meta?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.meta = meta;
  }
}

export const ERROR_MESSAGES_AR: Record<string, string> = {
  INVALID_CREDENTIALS: 'بيانات الدخول غير صحيحة',
  TOO_MANY_ATTEMPTS: 'تم تجاوز عدد المحاولات المسموح (5 محاولات). يرجى الانتظار 15 دقيقة',
  SESSION_EXPIRED: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً',
  FORBIDDEN: 'غير مسموح — لا تملك الصلاحية لهذا الإجراء',
  NOT_FOUND: 'السجل المطلوب غير موجود',
  MISSING_FIELD: 'يرجى تعبئة جميع الحقول الإلزامية',
  INVALID_GRADE: 'يجب أن تكون الدرجة بين 0 و 100',
  ALREADY_REGISTERED: 'تم تسجيل هذه الهوية مسبقاً',
  ALREADY_SETUP: 'تم إعداد حساب المدير مسبقاً',
  INVALID_ID_FORMAT: 'صيغة الهوية أو رقم التحقق (Luhn) غير صحيحة',
  INVALID_USERNAME: 'اسم المستخدم يجب أن يكون 4 أحرف فأكثر',
  WEAK_PASSWORD: 'كلمة المرور يجب أن تكون 8 رموز فأكثر',
  INVALID_MAP_URL: 'رابط خرائط جوجل يجب أن يبدأ بـ https://maps أو https://goo.gl/maps',
  DUPLICATE_SECTION: 'هذه الشعبة موجودة مسبقاً لنفس الصف',
  DUPLICATE_SUBJECT: 'هذه المادة مضافة مسبقاً لنفس المرحلة',
  DUPLICATE_ASSIGNMENT: 'هذا الإسناد مسجل مسبقاً',
  STAGE_HAS_CLASSES: 'لا يمكن حذف صف يحتوي على شعب مرتبطة به',
  CLASS_IN_USE: 'لا يمكن حذف شعبة مرتبطة بهويات أو طلاب',
  HAS_GRADES_ARCHIVE_FIRST: 'لا يمكن نقل الطالب لمرحلة أخرى ولديه درجات؛ يجب إنهاء السنة والأرشفة أولاً',
  INVALID_PHOTO_FORMAT: 'صيغة الصورة غير مدعومة (PNG / JPG / WEBP فقط)',
  PHOTO_TOO_LARGE: 'حجم الصورة يتجاوز الحد المسموح (2 ميجابايت)',
  ALREADY_CHECKED_IN: 'تم تسجيل بصمة الحضور لهذا اليوم مسبقاً',
  NOT_CHECKED_IN: 'يرجى تسجيل بصمة الحضور أولاً قبل تسجيل الانصراف',
  ALREADY_CHECKED_OUT: 'تم تسجيل بصمة الانصراف لهذا اليوم مسبقاً',
  ATTENDANCE_LOCKED: 'تم إغلاق البصمة الحضورية لحسابك من قِبل مدير المدرسة — يرجى مراجعة الإدارة',
  ATTENDANCE_DAY_CLOSED: 'تم تسجيل هذا اليوم كغياب أو إجازة من قِبل الإدارة ولا يمكن البصم فيه',
  EDUCATION_DISABLED: 'لم يتم تفعيل كود قسم التربية من قبل مدير المدرسة بعد',
  INVALID_TIME_FORMAT: 'وقت الدوام المحفوظ في الإعدادات تالف أو غير صالح — يرجى من المدير فتح إعدادات المدرسة وإعادة حفظ أوقات البصمة',
  INVALID_STATUS: 'الحالة المختارة غير صالحة',
  BAD_JSON: 'صيغة الطلب المرسل غير صالحة',
  UNKNOWN_ACTION: 'الإجراء المطلوب غير مدعوم في خادم Apps Script — تأكد من نشر أحدث إصدار من الشيفرات الـ 6',
  APPS_SCRIPT_HTML_AUTH:
    'رابط Google Apps Script أعاد صفحة تسجيل دخول HTML بدلاً من استجابة JSON — يرجى ضبط «من لديه صلاحية الوصول (Who has access)» على «الجميع (Anyone)» ونشر إصدار جديد',
  APPS_SCRIPT_NETWORK:
    'تعذر الوصول إلى خادم Google Apps Script — تحقق من صحة الرابط أو صلاحية النشر (Anyone)',
  APPS_SCRIPT_URL_MISSING: 'لم يتم تحديد رابط Google Apps Script Web App',
  SERVER_ERROR: 'حدث خطأ غير متوقع في الخادم',
};

export const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  in_review: 'قيد المتابعة',
  resolved: 'تمت المعالجة',
};

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  on_time: 'بالوقت',
  late: 'متأخر',
  absent: 'غائب',
  excused_leave: 'إجازة',
};

export function formatErrorAr(err: unknown): string {
  if (err instanceof BaseApiError) {
    return ERROR_MESSAGES_AR[err.code] || err.code;
  }
  if (err instanceof Error) {
    return ERROR_MESSAGES_AR[err.message] || err.message;
  }
  return 'حدث خطأ غير متوقع';
}

export async function detectBackend(): Promise<BackendMode> {
  if (activeMode) return activeMode;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const res = await fetch('/api/health', { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = (await res.json()) as { ok?: boolean; data?: { name?: string } };
        if (json.ok && json.data?.name === 'base-api') {
          activeMode = 'local';
          return 'local';
        }
      }
    }
  } catch {
    clearTimeout(timer);
  }

  activeMode = 'apps_script';
  return 'apps_script';
}

export async function callAppsScript<T = unknown>(
  url: string,
  action: string,
  payload: Record<string, unknown> = {},
  token?: string | null
): Promise<T> {
  const targetUrl = url.trim();
  if (!targetUrl) {
    throw new BaseApiError('APPS_SCRIPT_URL_MISSING');
  }

  let res: Response;
  try {
    // Google Apps Script requires text/plain + token in body to prevent CORS OPTIONS preflight
    res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action,
        ...(token ? { token } : {}),
        ...payload,
      }),
    });
  } catch {
    throw new BaseApiError('APPS_SCRIPT_NETWORK');
  }

  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype html')) {
    throw new BaseApiError('APPS_SCRIPT_HTML_AUTH', { status: res.status });
  }

  let out: { ok: boolean; data?: T; error?: string; meta?: Record<string, unknown> };
  try {
    out = JSON.parse(trimmed) as { ok: boolean; data?: T; error?: string; meta?: Record<string, unknown> };
  } catch {
    throw new BaseApiError('SERVER_ERROR');
  }

  if (!out.ok) {
    if (out.error === 'SESSION_EXPIRED') {
      memoryToken = null;
      if (onSessionExpiredCallback) onSessionExpiredCallback();
    }
    throw new BaseApiError(out.error || 'SERVER_ERROR', out.meta);
  }

  return out.data as T;
}

export async function api<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const mode = await detectBackend();

  if (mode === 'apps_script') {
    return callAppsScript<T>(activeAppsScriptUrl, action, payload, memoryToken);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (memoryToken) {
    headers['Authorization'] = `Bearer ${memoryToken}`;
  }

  const res = await fetch('/api/base', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });

  const rawText = await res.text();
  if (rawText.trim().startsWith('<')) {
    throw new BaseApiError('SERVER_ERROR');
  }

  const out = JSON.parse(rawText) as { ok: boolean; data?: T; error?: string; meta?: Record<string, unknown> };
  if (!out.ok) {
    if (out.error === 'SESSION_EXPIRED') {
      memoryToken = null;
      if (onSessionExpiredCallback) onSessionExpiredCallback();
    }
    throw new BaseApiError(out.error || 'SERVER_ERROR', out.meta);
  }
  return out.data as T;
}

export async function downloadAuthorizedFile(endpoint: string, filename: string) {
  const mode = await detectBackend();
  if (mode === 'apps_script') {
    throw new BaseApiError('FORBIDDEN');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (memoryToken) {
    headers['Authorization'] = `Bearer ${memoryToken}`;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new BaseApiError('FORBIDDEN');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadExcelBackup(academicYear: string) {
  const filename = `base_backup_${academicYear || 'school'}.xlsx`;
  const mode = await detectBackend();
  if (mode === 'local') {
    await downloadAuthorizedFile('/api/backup/export', filename);
    return;
  }
  const sheetsData = await api<Record<string, Array<Record<string, unknown>>>>('backup.exportJson');
  exportSheetsDataToXlsx(sheetsData, filename);
}

export async function downloadProjectBundle() {
  const mode = await detectBackend();
  if (mode === 'local') {
    await downloadAuthorizedFile('/api/bundle/export', 'base-system-bundle.zip');
    return;
  }
  await downloadClientBundleZip();
}

export const SHIFT_LABELS: Record<string, string> = {
  morning: 'صباحي',
  noon: 'ظهري',
  evening: 'مسائي',
};

export const SCHOOL_TYPE_LABELS: Record<string, string> = {
  primary: 'ابتدائي',
  middle: 'متوسط',
  prep: 'إعدادي',
  secondary: 'ثانوي',
  vocational: 'مهني',
};

export const ENROLL_STATUS_LABELS: Record<string, string> = {
  official: 'رسمي',
  transferred: 'منقول',
  expelled: 'مفصول',
  graduated: 'متخرج',
};

export const ID_STATUS_LABELS: Record<string, string> = {
  unused: 'غير مستخدمة',
  registered: 'مسجّلة',
  disabled: 'معطّلة',
};

export function formatShifts(shiftStr: string): string {
  return shiftStr
    .split(',')
    .map((s) => SHIFT_LABELS[s.trim()] || s.trim())
    .filter(Boolean)
    .join(' · ');
}

export function normalizeTimeHHMM(val?: string | null): string {
  if (!val) return '';
  const cleaned = String(val)
    .replace(/[\u200e\u200f\u202a-\u202e\u061c]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .trim();
  const ampm = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|ص|م)/i.exec(cleaned);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2];
    const suf = ampm[3].toUpperCase();
    if ((suf === 'PM' || suf === 'م') && h < 12) h += 12;
    if ((suf === 'AM' || suf === 'ص') && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  const hm = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(cleaned);
  if (hm) {
    const h = Number(hm[1]);
    const min = Number(hm[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  return '';
}

export function formatTimeAr12(val?: string | null): string {
  const hhmm = normalizeTimeHHMM(val);
  if (!hhmm) return val ? String(val) : '—';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const period = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
}

export type { AuthSession, PublicSchoolData };
