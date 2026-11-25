// تنسيق الأوقات: يحوّل أي صيغة قادمة من الخادم/Google Sheets إلى HH:MM (24 ساعة)
// يعالج: "08:00" ، "1:30 PM" ، "١:٣٠ م" ، وكذلك نص Date الطويل
// مثل "Sat Dec 30 1899 13:30:00 GMT+0257 (التوقيت العربي الرسمي)"

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function latinDigits(s: string): string {
  return s
    .replace(/[\u200e\u200f\u202a-\u202e\u061c]/g, '')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function parseHHMM(val: unknown): string | null {
  if (val === undefined || val === null || val === '') return null;

  if (typeof val === 'number') {
    if (val >= 0 && val < 1) {
      const t = Math.round(val * 1440) % 1440;
      return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
    }
    return null;
  }

  const s = latinDigits(String(val)).replace(/[\u00a0\u202f]/g, ' ').trim();

  // نص Date الطويل — الساعة تسبق كلمة GMT مباشرة
  const g = /(\d{1,2}):(\d{2}):\d{2}\s*GMT/.exec(s);
  if (g) return `${pad2(Number(g[1]))}:${g[2]}`;

  // ISO
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(s);
  if (iso) return `${iso[1]}:${iso[2]}`;

  let h: number;
  let mi: string;
  let suffix = '';
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|ص|م)?$/i.exec(s);
  if (m) {
    h = Number(m[1]);
    mi = m[2];
    suffix = (m[3] || '').toUpperCase();
  } else {
    m = /^(AM|PM|ص|م)\s*(\d{1,2}):(\d{2})(?::\d{2})?$/i.exec(s);
    if (!m) return null;
    suffix = m[1].toUpperCase();
    h = Number(m[2]);
    mi = m[3];
  }
  if ((suffix === 'PM' || suffix === 'م') && h < 12) h += 12;
  if ((suffix === 'AM' || suffix === 'ص') && h === 12) h = 0;
  if (h < 0 || h > 23 || Number(mi) > 59) return null;
  return `${pad2(h)}:${mi}`;
}

export function normalizeHHMM(val: unknown, fallback: string): string {
  return parseHHMM(val) ?? fallback;
}
