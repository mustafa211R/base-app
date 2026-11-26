export function luhnCheckDigit(body: string): string {
  let total = 0;
  for (let i = body.length - 1, idx = 0; i >= 0; i--, idx++) {
    let d = Number(body[i]);
    if (idx % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return String((10 - (total % 10)) % 10);
}

export function luhnValid(raw: string): boolean {
  const num = raw.replace(/\D/g, '');
  if (!/^\d+$/.test(num) || num.length < 2) return false;
  return luhnCheckDigit(num.slice(0, -1)) === num[num.length - 1];
}

export function normalizeIdDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function formatIdGrouped(raw: string): string {
  const digits = normalizeIdDigits(raw);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}
