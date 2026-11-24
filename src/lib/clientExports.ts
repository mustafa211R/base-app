import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import routerGs from '../../apps_script/router.gs?raw';
import authGs from '../../apps_script/auth.gs?raw';
import dataGs from '../../apps_script/data.gs?raw';
import gradesGs from '../../apps_script/grades.gs?raw';
import adminGs from '../../apps_script/admin.gs?raw';
import backupGs from '../../apps_script/backup.gs?raw';

export interface AppsScriptSourceFile {
  name: string;
  labelAr: string;
  content: string;
}

export const APPS_SCRIPT_FILES: AppsScriptSourceFile[] = [
  { name: 'router.gs', labelAr: 'الموجّه ونقطة الدخول (router.gs)', content: routerGs },
  { name: 'auth.gs', labelAr: 'المصادقة وLuhn والجلسات (auth.gs)', content: authGs },
  { name: 'data.gs', labelAr: 'الأوراق والطلاب والمدرسون (data.gs)', content: dataGs },
  { name: 'grades.gs', labelAr: 'الدرجات والحسابات التلقائية (grades.gs)', content: gradesGs },
  { name: 'admin.gs', labelAr: 'إدارة المراحل والشعب والهويات (admin.gs)', content: adminGs },
  { name: 'backup.gs', labelAr: 'النسخ الاحتياطي ونهاية السنة (backup.gs)', content: backupGs },
];

const SHEET_ORDER = [
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

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportSheetsDataToXlsx(
  sheetsData: Record<string, Array<Record<string, unknown>>>,
  filename: string
) {
  const wb = XLSX.utils.book_new();
  const names = SHEET_ORDER.filter((n) => n in sheetsData).concat(
    Object.keys(sheetsData).filter((n) => !SHEET_ORDER.includes(n))
  );
  for (const sheet of names) {
    const rows = sheetsData[sheet] || [];
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBlobDownload(blob, filename);
}

export async function downloadClientBundleZip() {
  const zip = new JSZip();
  const appsScriptFolder = zip.folder('apps_script')!;
  for (const file of APPS_SCRIPT_FILES) {
    appsScriptFolder.file(file.name, file.content);
  }

  const pyApp = zip.folder('app')!;
  pyApp.file(
    'api.py',
    `import json
import requests

class BaseApi:
    def __init__(self, url, token=None):
        self.url, self.token = url, token

    def call(self, action, **params):
        body = {"action": action, "token": self.token, **params}
        r = requests.post(
            self.url,
            data=json.dumps(body),
            headers={"Content-Type": "text/plain;charset=utf-8"},
            timeout=90,
        )
        r.raise_for_status()
        res = r.json()
        if not res.get("ok"):
            raise RuntimeError(res.get("error", "UNKNOWN_ERROR"))
        return res.get("data")
`
  );

  pyApp.file(
    'ids.py',
    `import secrets

def luhn_check_digit(body: str) -> str:
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return str((10 - total % 10) % 10)

def make_ids(count: int, length: int, existing: set) -> list:
    """length = 16 للطلاب، 8 للمدرسين"""
    out = []
    while len(out) < count:
        body = ''.join(secrets.choice('0123456789') for _ in range(length - 1))
        full = body + luhn_check_digit(body)
        if full not in existing:
            existing.add(full)
            out.append(full)
    return out

def luhn_valid(num: str) -> bool:
    return num.isdigit() and luhn_check_digit(num[:-1]) == num[-1]
`
  );

  pyApp.file(
    'stages.json',
    JSON.stringify(
      {
        primary: ['الأول الابتدائي', 'الثاني الابتدائي', 'الثالث الابتدائي', 'الرابع الابتدائي', 'الخامس الابتدائي', 'السادس الابتدائي'],
        middle: ['الأول المتوسط', 'الثاني المتوسط', 'الثالث المتوسط'],
        prep: ['الرابع الإعدادي', 'الخامس الإعدادي', 'السادس الإعدادي'],
        secondary: ['الأول المتوسط', 'الثاني المتوسط', 'الثالث المتوسط', 'الرابع الإعدادي', 'الخامس الإعدادي', 'السادس الإعدادي'],
        vocational: ['الأول المهني', 'الثاني المهني', 'الثالث المهني'],
      },
      null,
      2
    )
  );

  zip.file(
    'README.md',
    `# نظام base لإدارة المدرسة
حزمة الملفات المصدرية المتوافقة مع الدليل الشامل:
- apps_script/ : شيفرات Google Apps Script الكاملة (router.gs, auth.gs, data.gs, grades.gs, admin.gs, backup.gs)
- app/ : وحدات تطبيق Python (api.py, ids.py, stages.json)
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, 'base-system-bundle.zip');
}
