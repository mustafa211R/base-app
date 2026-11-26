import { useCallback, useState } from 'react';
import type { AuthSession } from '../../shared/types.ts';

// نحفظ الجلسة والموضع في sessionStorage: تبقى بعد تحديث الصفحة وتُمحى عند إغلاق التبويب.
const SESSION_KEY = 'base_session_v1';
const GUEST_KEY = 'base_guest_v1';
const UI_PREFIX = 'base_ui_';

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): AuthSession | null {
  try {
    const raw = store()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    return s && typeof s.token === 'string' && s.token && s.role ? s : null;
  } catch {
    return null;
  }
}

export function loadGuest(): boolean {
  try {
    return store()?.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistAuthState(session: AuthSession | null, guest: boolean) {
  const st = store();
  if (!st) return;
  try {
    if (session) st.setItem(SESSION_KEY, JSON.stringify(session));
    else st.removeItem(SESSION_KEY);
    if (guest && !session) st.setItem(GUEST_KEY, '1');
    else st.removeItem(GUEST_KEY);
    if (!session && !guest) {
      // عند الخروج نمسح مواضع الواجهة المحفوظة
      for (let i = st.length - 1; i >= 0; i--) {
        const k = st.key(i);
        if (k && k.startsWith(UI_PREFIX)) st.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

// useState يحفظ قيمته في sessionStorage (للتبويبات والشاشات الحالية)
export function usePersistentState<T extends string | number>(
  key: string,
  initial: T,
  allowed?: readonly T[]
): [T, (v: T) => void] {
  const fullKey = UI_PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = store()?.getItem(fullKey);
      if (raw !== null && raw !== undefined) {
        const v = (typeof initial === 'number' ? Number(raw) : raw) as T;
        if (!allowed || allowed.includes(v)) return v;
      }
    } catch {
      // ignore
    }
    return initial;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        store()?.setItem(fullKey, String(v));
      } catch {
        // ignore
      }
    },
    [fullKey]
  );
  return [value, set];
}
