import React, { useEffect, useState } from 'react';
import type { AuthSession, PublicSchoolData } from '../shared/types.ts';
import { api, setAuthToken, setOnSessionExpired } from './lib/api.ts';
import { FirstTimeRegister, RolePortal } from './components/RolePortal.tsx';
import { WebsiteViews } from './components/WebsiteViews.tsx';
import { AdminConsole } from './components/AdminConsole.tsx';
import { EducationPortal } from './components/EducationPortal.tsx';
import { ConnectionScreen } from './components/ConnectionScreen.tsx';

export default function App() {
  const [publicData, setPublicData] = useState<PublicSchoolData | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  async function refreshPublic() {
    try {
      const data = await api<PublicSchoolData>('school.public');
      setLoadError(null);
      setPublicData(data);
      if (data.initialized && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('role') === 'guest') {
          setGuestMode(true);
        }
      }
    } catch (err) {
      setLoadError(err);
    }
  }

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
