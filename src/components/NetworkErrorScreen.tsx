import React, { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

interface Props {
  onRetry: () => Promise<void> | void;
  onOpenSetup: () => void;
}

// تظهر عند فشل التحميل الأول بسبب الشبكة (وليس بسبب إعداد الرابط)
export function NetworkErrorScreen({ onRetry, onOpenSetup }: Props) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onOnline = () => void retry();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void retry(), 10000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-7 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-red-50 text-red-700 flex items-center justify-center">
          <WifiOff className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">ضعف أو انقطاع في الشبكة</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          تعذر الاتصال بالخادم. تأكد من اتصال جهازك بالإنترنت أو انتقل إلى مكان فيه تغطية أفضل،
          وسنعيد المحاولة تلقائياً كل بضع ثوانٍ.
        </p>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-60 text-white text-sm font-medium rounded-lg cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          <span>{busy ? 'جارٍ المحاولة...' : 'إعادة المحاولة الآن'}</span>
        </button>
        <div className="pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onOpenSetup}
            className="text-xs text-slate-400 hover:text-slate-600 underline cursor-pointer"
          >
            إعدادات ربط الخادم (للمسؤول فقط)
          </button>
        </div>
      </div>
    </div>
  );
}
