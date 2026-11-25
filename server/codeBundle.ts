import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

export async function generateProjectBundleZip(): Promise<Buffer> {
  const zip = new JSZip();

  const appsScript = zip.folder('apps_script')!;
  const gsDir = path.resolve(process.cwd(), 'apps_script');
  if (fs.existsSync(gsDir)) {
    for (const file of fs.readdirSync(gsDir)) {
      if (file.endsWith('.gs')) {
        appsScript.file(file, fs.readFileSync(path.join(gsDir, file), 'utf8'));
      }
    }
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

  return zip.generateAsync({ type: 'nodebuffer' });
}
