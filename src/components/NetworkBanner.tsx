import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { subscribeNetwork } from '../lib/api.ts';

// شريط تنبيه عام يظهر عند ضعف أو انقطاع الشبكة، ويختفي تلقائياً عند عودة الاتصال
export function NetworkBanner() {
  const [apiOffline, setApiOffline] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const unsub = subscribeNetwork(setApiOffline);
    const on = () => setBrowserOffline(false);
    const off = () => setBrowserOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      unsub();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!apiOffline && !browserOffline) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[100] bg-red-700 text-white text-sm px-4 py-2.5 flex items-center justify-center gap-2 shadow-lg no-print"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        {browserOffline
          ? 'لا يوجد اتصال بالإنترنت — بعض العمليات لن تعمل حتى يعود الاتصال'
          : 'ضعف أو انقطاع في الشبكة — تعذر الوصول إلى الخادم، سيُعاد المحاولة عند تحسّن الاتصال'}
      </span>
    </div>
  );
}
