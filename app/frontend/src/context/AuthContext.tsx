import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authAPI, SESSION_EXPIRED_EVENT } from '../services/api';
import type { CurrentUser, MeResponse, UserRole } from '../services/api';

interface Organisation {
  id: number;
  name: string;
  slug: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  /** The logged-in account, or null when anonymous */
  user: CurrentUser | null;
  role: UserRole | null;
  organisation: Organisation | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch identity from the server (e.g. after accepting an invite) */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await authAPI.me());
    } catch {
      setMe(null);
    }
  }, []);

  // Load identity on mount
  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  // When any API call fails with an expired session, drop to anonymous;
  // the RequireAuth route guard then redirects to /login preserving the
  // current location, so the user comes straight back after logging in.
  useEffect(() => {
    const handleSessionExpired = () => {
      setMe((current) => (current ? { ...current, authenticated: false, user: null, role: null } : null));
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await authAPI.login(email, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await authAPI.logout();
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: me?.authenticated ?? false,
        isLoading,
        user: me?.user ?? null,
        role: me?.role ?? null,
        organisation: me?.organisation ?? null,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Capability flags derived from the current role. Components check these
 * (never role strings) so the mapping lives in one place. UI gating is a
 * courtesy — the backend independently enforces every permission.
 */
export function usePermissions() {
  const { user, role, isAuthenticated } = useAuth();
  const rank = role === 'admin' ? 2 : role === 'editor' ? 1 : role === 'viewer' ? 0 : -1;
  return {
    user,
    role,
    isAuthenticated,
    /** Create/edit/delete surveys, sightings and media */
    canEditSurveys: rank >= 1,
    /** Admin page: devices, locations, survey types, surveyors, species,
     * users & invites. */
    canAccessAdmin: rank >= 2,
    /** Sign self up to scheduled surveys (any signed-in account) */
    canSelfSignUp: user !== null,
  };
}
