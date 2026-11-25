import React from 'react';
import { Code2, ExternalLink } from 'lucide-react';

export const DEVELOPER_NAME = 'الأستاذ مصطفى رحيم فندي';
export const DEVELOPER_URL = 'https://mustafa211r.github.io/';

export function DeveloperCard() {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#0F294A] text-[#C59B27] flex items-center justify-center shrink-0">
            <Code2 className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-[#9A7008]">قسم المطور والتطوير البرمجي</div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">{DEVELOPER_NAME}</h3>
            <p className="text-xs sm:text-sm text-slate-600">
              تصميم وتطوير نظام base لإدارة المدرسة وبوابات الإشراف والدرجات والحضور الإلكتروني.
            </p>
          </div>
        </div>
        <a
          href={DEVELOPER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F294A] hover:bg-[#163864] text-white text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors"
        >
          <span>زيارة موقع المطور</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </section>
  );
}

export function DeveloperFooter() {
  return (
    <footer className="no-print py-4 px-6 border-t border-slate-200 bg-white text-center text-xs text-slate-600">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>نظام base لإدارة المدرسة · جميع البيانات محمية بصلاحيات الحقول على الخادم</span>
        <span className="flex items-center gap-1.5">
          <span>تطوير:</span>
          <a
            href={DEVELOPER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#0F294A] hover:text-[#B8860B] underline underline-offset-2"
          >
            {DEVELOPER_NAME}
          </a>
        </span>
      </div>
    </footer>
  );
}
