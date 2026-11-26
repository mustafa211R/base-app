import React, { useEffect, useState } from 'react';
import { CalendarOff, Clock, Plus, Trash2 } from 'lucide-react';
import type { LeaveRow, LeaveType } from '../../shared/types.ts';
import { api, LEAVE_TYPE_LABELS } from '../lib/api.ts';

interface LeavesManagerProps {
  search: string;
  onSuccess: (msg: string) => void;
  onError: (err: unknown) => void;
}

interface LeavesListResponse {
  todayDate: string;
  teachers: Array<{ teacher_id: string; full_name: string; specialty?: string }>;
  leaves: LeaveRow[];
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h} ساعة ` : ''}${m ? `${m} دقيقة` : ''}`.trim() || '—';
}

export function LeavesManager({ search, onSuccess, onError }: LeavesManagerProps) {
  const [data, setData] = useState<LeavesListResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const [teacherId, setTeacherId] = useState('');
  const [type, setType] = useState<LeaveType>('leave');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hours, setHours] = useState('1');
  const [mins, setMins] = useState('0');
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const res = await api<LeavesListResponse>('leaves.list');
      setData(res);
      setDateFrom((v) => v || res.todayDate);
      setDateTo((v) => v || res.todayDate);
    } catch (err) {
      onError(err);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isHourly = type === 'hourly';
  const totalMinutes = Math.max(0, Number(hours || 0) * 60 + Number(mins || 0));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherId) return;
    setBusy(true);
    try {
      await api('leaves.create', {
        teacher_id: teacherId,
        type,
        date_from: dateFrom,
        date_to: isHourly ? dateFrom : dateTo,
        minutes: isHourly ? totalMinutes : 0,
        reason: reason.trim(),
      });
      setReason('');
      await load();
      onSuccess(
        isHourly
          ? 'تم منح الإجازة الزمنية — ستُفتح بصمة الانصراف للمدرس مبكراً بالمدة المحددة'
          : 'تم تسجيل الإجازة/الغياب وحظر بصمة المدرس في الأيام المحددة'
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('حذف هذا السجل؟ سيعود المدرس قادراً على البصمة في هذه الأيام.')) return;
    setBusy(true);
    try {
      await api('leaves.delete', { leave_id: id });
      await load();
      onSuccess('تم حذف السجل');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const q = search.trim().toLowerCase();
  const rows = (data?.leaves || []).filter(
    (l) => !q || l.teacher_name.toLowerCase().includes(q) || l.teacher_id.includes(q) || l.date_from.includes(q)
  );
  const today = data?.todayDate || '';

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <CalendarOff className="w-4 h-4 text-[#B8860B]" />
          <h3 className="font-bold text-slate-900 text-sm">تسجيل إجازة أو غياب أو إجازة زمنية</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1 text-xs text-slate-600">
            <span>المدرس</span>
            <select
              required
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="">— اختر المدرس —</option>
              {(data?.teachers || []).map((t) => (
                <option key={t.teacher_id} value={t.teacher_id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-600">
            <span>النوع</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="leave">إجازة (تحظر البصمة طوال اليوم)</option>
              <option value="sick">إجازة مرضية (تحظر البصمة)</option>
              <option value="absence">غياب (تحظر البصمة)</option>
              <option value="hourly">إجازة زمنية (تفتح الانصراف المبكر)</option>
            </select>
          </label>

          {isHourly ? (
            <label className="space-y-1 text-xs text-slate-600">
              <span>اليوم</span>
              <input
                type="date"
                required
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                dir="ltr"
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-slate-600">
                <span>من تاريخ</span>
                <input
                  type="date"
                  required
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    if (dateTo < e.target.value) setDateTo(e.target.value);
                  }}
                  className="w-full px-2 py-2 border border-slate-300 rounded-lg text-sm"
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>إلى تاريخ</span>
                <input
                  type="date"
                  required
                  min={dateFrom}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2 py-2 border border-slate-300 rounded-lg text-sm"
                  dir="ltr"
                />
              </label>
            </div>
          )}
        </div>

        {isHourly && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
            <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
              <Clock className="w-4 h-4" />
              <span>مدة الإجازة الزمنية: كم يُسمح للمدرس بالانصراف قبل نهاية الدوام؟</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={0}
                max={10}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-20 px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                dir="ltr"
              />
              <span className="text-xs text-slate-600">ساعة</span>
              <input
                type="number"
                min={0}
                max={59}
                value={mins}
                onChange={(e) => setMins(e.target.value)}
                className="w-20 px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                dir="ltr"
              />
              <span className="text-xs text-slate-600">دقيقة</span>
              <span className="text-xs text-slate-500 mr-2">= {formatDuration(totalMinutes)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="السبب / ملاحظة (اختياري)"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            type="submit"
            disabled={busy || !teacherId || (isHourly && totalMinutes < 1)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-[#0F294A] hover:bg-[#163864] disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{busy ? 'جارٍ الحفظ...' : 'حفظ'}</span>
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm">سجل الإجازات والغيابات</h3>
          <span className="text-xs text-slate-500">{rows.length} سجل</span>
        </div>
        <table className="w-full text-xs text-right">
          <thead>
            <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
              <th className="py-2.5 px-4">المدرس</th>
              <th className="py-2.5 px-4">النوع</th>
              <th className="py-2.5 px-4 text-center">من</th>
              <th className="py-2.5 px-4 text-center">إلى</th>
              <th className="py-2.5 px-4 text-center">المدة</th>
              <th className="py-2.5 px-4">السبب</th>
              <th className="py-2.5 px-4 text-center">الحالة</th>
              <th className="py-2.5 px-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  لا توجد إجازات أو غيابات مسجلة
                </td>
              </tr>
            ) : (
              rows.map((l) => {
                const active = l.date_from <= today && today <= l.date_to;
                const upcoming = l.date_from > today;
                return (
                  <tr key={l.leave_id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{l.teacher_name}</td>
                    <td className="py-2.5 px-4">{LEAVE_TYPE_LABELS[l.type] || l.type}</td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums" dir="ltr">{l.date_from}</td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums" dir="ltr">{l.type === 'hourly' ? '—' : l.date_to}</td>
                    <td className="py-2.5 px-4 text-center">{l.type === 'hourly' ? formatDuration(l.minutes) : '—'}</td>
                    <td className="py-2.5 px-4 text-slate-600">{l.reason || '—'}</td>
                    <td className="py-2.5 px-4 text-center">
                      <span className={active ? 'text-emerald-700 font-semibold' : upcoming ? 'text-sky-700' : 'text-slate-400'}>
                        {active ? 'ساري اليوم' : upcoming ? 'قادم' : 'منتهي'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete(l.leave_id)}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
