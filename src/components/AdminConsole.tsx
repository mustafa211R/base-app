import React, { useEffect, useState } from 'react';
import {
  Plug,
  School,
  UserCog,
  Layers,
  KeyRound,
  CreditCard,
  Shield,
  Database,
  Archive,
  Table,
  LogOut,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type {
  ClassRow,
  IdRow,
  PermissionRow,
  PublicSchoolData,
  SchoolConfig,
  StageRow,
  SubjectRow,
} from '../../shared/types.ts';
import { api, formatErrorAr } from '../lib/api.ts';
import { AdminScreensPart1 } from './AdminScreensPart1.tsx';
import { AdminScreensPart2 } from './AdminScreensPart2.tsx';

interface AdminConsoleProps {
  publicData: PublicSchoolData;
  onRefreshPublic: () => Promise<void>;
  onLogout: () => void;
}

interface DashboardData {
  config: SchoolConfig;
  counts: {
    studentsCount: number;
    teachersCount: number;
    classesCount: number;
    stagesCount: number;
    subjectsCount: number;
    totalIds: number;
    unusedIds: number;
    registeredIds: number;
    disabledIds: number;
    gradesEvaluated: number;
    passed: number;
    failed: number;
  };
}

const SIDEBAR_ITEMS = [
  { id: 1, label: '1. الاتصال والتهيئة', short: 'الاتصال', icon: Plug },
  { id: 2, label: '2. بيانات المدرسة', short: 'المدرسة', icon: School },
  { id: 3, label: '3. بيانات المدير', short: 'المدير', icon: UserCog },
  { id: 4, label: '4. الصفوف والشعب', short: 'الشعب', icon: Layers },
  { id: 5, label: '5. توليد الهويات', short: 'الهويات', icon: KeyRound },
  { id: 6, label: '6. بطاقات الهويات', short: 'البطاقات', icon: CreditCard },
  { id: 7, label: '7. الصلاحيات والخصوصية', short: 'الصلاحيات', icon: Shield },
  { id: 8, label: '8. إدارة البيانات', short: 'البيانات', icon: Database },
  { id: 9, label: '9. النسخ الاحتياطي والسنة', short: 'النسخ', icon: Archive },
  { id: 10, label: 'الأوراق الـ 14 الحية', short: 'الأوراق', icon: Table },
] as const;

export function AdminConsole({ publicData, onRefreshPublic, onLogout }: AdminConsoleProps) {
  const [screen, setScreen] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10>(1);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [classes, setClasses] = useState<Array<ClassRow & { stage_name?: string; students_count?: number }>>([]);
  const [subjects, setSubjects] = useState<Array<SubjectRow & { stage_name?: string }>>([]);
  const [idsList, setIdsList] = useState<Array<IdRow & { class_label?: string; person_name?: string }>>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [adminProfile, setAdminProfile] = useState<Record<string, unknown> | null>(null);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    try {
      const [dash, stg, cls, sub, ids, perms, adm] = await Promise.all([
        api<DashboardData>('admin.dashboard'),
        api<StageRow[]>('admin.stagesList'),
        api<Array<ClassRow & { stage_name?: string; students_count?: number }>>('admin.classesList'),
        api<Array<SubjectRow & { stage_name?: string }>>('admin.subjectsList'),
        api<Array<IdRow & { class_label?: string; person_name?: string }>>('ids.list'),
        api<PermissionRow[]>('perm.list'),
        api<Record<string, unknown> | null>('admin.profileGet'),
      ]);
      setDashboard(dash);
      setStages(stg);
      setClasses(cls);
      setSubjects(sub);
      setIdsList(ids);
      setPermissions(perms);
      setAdminProfile(adm);
      await onRefreshPublic();
    } catch (err) {
      setErrorMsg(formatErrorAr(err));
    }
  }

  function handleSuccess(msg: string) {
    setErrorMsg('');
    setSuccessMsg(msg);
  }

  function handleError(err: unknown) {
    setSuccessMsg('');
    setErrorMsg(formatErrorAr(err));
  }

  const activeItem = SIDEBAR_ITEMS.find((s) => s.id === screen)!;
  const passRate =
    dashboard && dashboard.counts.gradesEvaluated > 0
      ? Math.round((dashboard.counts.passed / dashboard.counts.gradesEvaluated) * 100)
      : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="no-print bg-[#0F294A] text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-bold text-base sm:text-lg whitespace-nowrap shrink-0">
              base — إدارة المدرسة
            </span>
            <span className="hidden sm:inline text-slate-400">/</span>
            <span className="hidden sm:inline text-sm text-slate-200 truncate">{activeItem.label}</span>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Desktop Sidebar matching PDF Figure 2-1 */}
        <aside className="no-print hidden lg:flex lg:flex-col w-64 bg-[#0F294A] text-slate-200 border-l border-slate-800 p-3 shrink-0">
          <div className="px-3 py-2 text-xs text-slate-400 border-b border-white/10 mb-2">
            شاشات نظام الإدارة
          </div>
          <nav className="space-y-1 flex-1">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSuccessMsg('');
                    setErrorMsg('');
                    setScreen(item.id);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-right transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#B8860B] text-white'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile/Tablet Screen Switcher */}
        <div className="no-print lg:hidden bg-white border-b border-slate-200 overflow-x-auto px-3 py-2 flex items-center gap-1.5">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSuccessMsg('');
                setErrorMsg('');
                setScreen(item.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                screen === item.id
                  ? 'bg-[#0F294A] text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {item.short}
            </button>
          ))}
        </div>

        {/* Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto space-y-5">
          {/* KPI Summary Strip */}
          {dashboard && (
            <div className="no-print grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">الطلاب المسجلون</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {dashboard.counts.studentsCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">المدرسون</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {dashboard.counts.teachersCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">هويات غير مستخدمة</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#B8860B] mt-1">
                  {dashboard.counts.unusedIds}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">نسبة النجاح المرصودة</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                  {passRate === null ? '—' : `${passRate}%`}
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="no-print p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {screen <= 5 ? (
            <AdminScreensPart1
              screen={screen as 1 | 2 | 3 | 4 | 5}
              publicData={publicData}
              config={dashboard?.config || null}
              stages={stages}
              classes={classes}
              idsList={idsList}
              adminProfile={adminProfile}
              onSuccess={handleSuccess}
              onError={handleError}
              onRefreshAll={refreshAll}
            />
          ) : (
            <AdminScreensPart2
              screen={screen as 6 | 7 | 8 | 9 | 10}
              publicData={publicData}
              config={dashboard?.config || null}
              stages={stages}
              classes={classes}
              subjects={subjects}
              idsList={idsList}
              permissions={permissions}
              onSuccess={handleSuccess}
              onError={handleError}
              onRefreshAll={refreshAll}
            />
          )}
        </main>
      </div>
    </div>
  );
}
