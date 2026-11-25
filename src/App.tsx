import React, { useEffect, useRef, useState } from 'react';
import type { AuthSession, PublicSchoolData } from '../shared/types.ts';
import { api, isNetworkError, setAuthToken, setOnSessionExpired } from './lib/api.ts';
import { FirstTimeRegister, RolePortal } from './components/RolePortal.tsx';
import { WebsiteViews } from './components/WebsiteViews.tsx';
import { AdminConsole } from './components/AdminConsole.tsx';
import { EducationPortal } from './components/EducationPortal.tsx';
import { ConnectionScreen } from './components/ConnectionScreen.tsx';
import { NetworkBanner } from './components/NetworkBanner.tsx';
import { NetworkErrorScreen } from './components/NetworkErrorScreen.tsx';
import { loadGuest, loadSession, persistAuthState } from './lib/persist.ts';

export default function App() {
  return (
    <>
      <NetworkBanner />
      <AppContent />
    </>
  );
}

function AppContent() {
  const [publicData, setPublicData] = useState<PublicSchoolData | null>(null);
  const [session, setSession] = useState<AuthSession | null>(() => {
    const saved = loadSession();
    if (saved) setAuthToken(saved.token); // استعادة الجلسة بعد تحديث الصفحة
    return saved;
  });
  const [guestMode, setGuestMode] = useState(() => loadGuest());
  const [loadError, setLoadError] = useState<unknown>(null);
  const [showSetup, setShowSetup] = useState(false);
  const hasDataRef = useRef(false);

  async function refreshPublic() {
    try {
      const data = await api<PublicSchoolData>('school.public');
      hasDataRef.current = true;
      setLoadError(null);
      setShowSetup(false);
      setPublicData(data);
      if (data.initialized && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('role') === 'guest') {
          setGuestMode(true);
        }
      }
    } catch (err) {
      // بعد أول تحميل ناجح لا نُسقط المستخدم إلى شاشة الإعداد بسبب فشل عابر؛
      // يكفي شريط الشبكة العام وتبقى البيانات الحالية معروضة.
      if (hasDataRef.current) return;
      setLoadError(err);
    }
  }

  useEffect(() => {
    persistAuthState(session, guestMode);
  }, [session, guestMode]);

  useEffect(() => {
    setOnSessionExpired(() => {
      setSession(null);
      setGuestMode(false);
    });
    refreshPublic();
  }, []);

  async function handleLogout() {
    if (session) {
      try {
        await api('auth.logout');
      } catch {
        // ignore
      }
    }
    setAuthToken(null);
    setSession(null);
    setGuestMode(false);
    refreshPublic();
  }

  if (loadError && isNetworkError(loadError) && !showSetup) {
    return (
      <NetworkErrorScreen
        onRetry={async () => {
          await refreshPublic();
        }}
        onOpenSetup={() => setShowSetup(true)}
      />
    );
  }

  if (loadError) {
    return (
      <ConnectionScreen
        error={loadError}
        onRetrySuccess={async () => {
          setLoadError(null);
          await refreshPublic();
        }}
      />
    );
  }

  if (!publicData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500">جارٍ تحميل نظام base...</div>
      </div>
    );
  }

  if (guestMode && !session) {
    return (
      <WebsiteViews
        role="guest"
        session={null}
        publicData={publicData}
        onLogout={() => setGuestMode(false)}
      />
    );
  }

  if (!session) {
    return (
      <RolePortal
        publicData={publicData}
        onAuthenticated={(sess) => setSession(sess)}
        onEnterGuest={() => setGuestMode(true)}
        onRefreshPublic={refreshPublic}
      />
    );
  }

  if ((session.role === 'student' || session.role === 'teacher') && !session.registered) {
    return (
      <FirstTimeRegister
        role={session.role}
        id={session.id}
        requireTeacherPin={publicData.require_teacher_pin}
        onComplete={() => {
          setSession({ ...session, registered: true });
          refreshPublic();
        }}
        onLogout={handleLogout}
      />
    );
  }

  if (session.role === 'admin') {
    return (
      <AdminConsole
        publicData={publicData}
        onRefreshPublic={refreshPublic}
        onLogout={handleLogout}
      />
    );
  }

  if (session.role === 'education') {
    return (
      <EducationPortal
        publicData={publicData}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <WebsiteViews
      role={session.role}
      session={session}
      publicData={publicData}
      onLogout={handleLogout}
    />
  );
}
