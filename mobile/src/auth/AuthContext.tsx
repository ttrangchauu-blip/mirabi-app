import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiRequest, configureSessionHandlers, getSession, NetworkError, newIdempotencyKey, setSession } from '../api/client';
import { clearSession, loadSession, saveSession } from './tokenStorage';
import { isSessionExpired, SESSION_EXPIRED_MESSAGE } from './messages';
import { normalizeEmail } from './validation';
import type { PetId } from '../pets';
import type { GradeId } from '../studyProfile';

export type User = { id:number; email:string; role?: 'user' | 'admin'; display_name:string; level:number; xp:number; coins:number; gems:number; avatar_theme:string;
  /** Species id from src/pets.ts. The pet is adopted once it has a name. */ pet:string; pet_name:string|null; onboarded:boolean; daily_tasks_selected:boolean;
  /** Learning profile (src/studyProfile.ts): null for accounts created before registration asked for it. */
  age?: number | null; school_grade?: GradeId | null };
type TokenResponse = { access_token:string; refresh_token:string; token_type:string; expires_in:number; user:User };
export type LoginStreakClaim = { current_streak: number; longest_streak: number; last_login_date: string; should_show_popup: boolean;
  daily_exp_awarded: number; milestone_exp_awarded: number; already_claimed: boolean };
type LoginResponse = TokenResponse & { login_streak?: LoginStreakClaim | null };

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The popup is shown only when the backend says so and sent usable numbers; never from guessed data. */
export function streakPopupFrom(claim: LoginStreakClaim | null | undefined): LoginStreakClaim | null {
  if (!claim || claim.should_show_popup !== true) return null;
  if (!isCount(claim.current_streak) || claim.current_streak < 1 || !isCount(claim.longest_streak)) return null;
  if (!isCount(claim.daily_exp_awarded) || !isCount(claim.milestone_exp_awarded)) return null;
  return claim;
}

export type AuthStatus = 'restoring' | 'restoreFailed' | 'signedOut' | 'signedIn';
/** Call to switch the app to the signed-in state (lets screens show a success state first). */
export type CommitSession = () => void;

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  /** One-off message for the login screen, e.g. after the session expired. */
  notice: string | null;
  clearNotice: () => void;
  setUser: (user: User) => void;
  /** `attemptId` is sent as Idempotency-Key; reuse it when retrying an attempt whose outcome is unknown. */
  login: (email: string, password: string, attemptId?: string) => Promise<{ commit: CommitSession; loginStreak: LoginStreakClaim | null }>;
  /** Daily streak popup. Set only when the backend records today's first login or app open; token refresh never sets it. */
  streakPopup: LoginStreakClaim | null;
  dismissStreakPopup: () => void;
  /** Creates the account only; the user signs in afterwards from the pre-filled login screen. */
  register: (input: RegisterInput) => Promise<void>;
  adoptPet: (pet: PetId, name: string) => Promise<void>;
  selectDailyTasks: (taskIds: string[]) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  retryRestore: () => void;
};

type RegisterInput = { email: string; password: string; displayName?: string; age: number; schoolGrade: GradeId };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUserState] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [streakPopup, setStreakPopup] = useState<LoginStreakClaim | null>(null);
  const mounted = useRef(true);
  // Bumped on sign-out so a check-in answered after that can't show a popup for the old session.
  const sessionGeneration = useRef(0);
  const checkInKey = useRef<string | null>(null);
  const checkInFlight = useRef<Promise<void> | null>(null);

  const signOutLocally = useCallback(async (message: string | null) => {
    sessionGeneration.current += 1;
    setSession(null);
    await clearSession().catch(() => {});
    if (!mounted.current) return;
    setUserState(null);
    setStreakPopup(null);
    setNotice(message);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    configureSessionHandlers({
      onTokensRefreshed: (session) => saveSession(session),
      onSessionExpired: () => { void signOutLocally(SESSION_EXPIRED_MESSAGE); },
    });
    return () => configureSessionHandlers({});
  }, [signOutLocally]);

  /** Opening the app counts as the day's login. The backend records it once per day and decides about the popup. */
  const checkIn = useCallback(() => {
    if (checkInFlight.current) return checkInFlight.current;
    const generation = sessionGeneration.current;
    checkInFlight.current = (async () => {
      // Kept while the outcome is unknown, so a retry on the next app open can't lose the day's popup.
      checkInKey.current ??= newIdempotencyKey();
      try {
        const claim = await apiRequest<LoginStreakClaim>('/api/streak/check-in', { method: 'POST', auth: true,
          headers: { 'Idempotency-Key': checkInKey.current } });
        checkInKey.current = null;
        const popup = streakPopupFrom(claim);
        if (popup && mounted.current && generation === sessionGeneration.current) setStreakPopup(popup);
      } catch (e) {
        // Never blocks the app; without a valid answer there is simply no popup.
        if (!(e instanceof NetworkError)) checkInKey.current = null;
      }
    })().finally(() => { checkInFlight.current = null; });
    return checkInFlight.current;
  }, []);

  const restore = useCallback(async () => {
    setStatus('restoring');
    try {
      const stored = await loadSession();
      if (!stored) { setStatus('signedOut'); return; }
      setSession(stored);
      const me = await apiRequest<User>('/api/auth/me', { auth: true });
      if (!mounted.current) return;
      setUserState(me);
      setStatus('signedIn');
      void checkIn();
    } catch (e) {
      if (!mounted.current) return;
      // Keep a stored session for every restore failure except a refresh token the server
      // explicitly rejected. A temporary API/schema/permission error must not send the
      // user back to login; show retry/logout controls instead.
      if (getSession()) setStatus('restoreFailed');
      // apiRequest clears the in-memory session and calls onSessionExpired only after
      // the refresh endpoint confirms the token is invalid or expired.
      else setStatus('signedOut');
    }
  }, [checkIn]);

  // Coming back to the app (e.g. tapping its icon while it was in the background) is an app open too.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void checkIn(); });
    return () => sub.remove();
  }, [status, checkIn]);

  useEffect(() => {
    mounted.current = true;
    void restore();
    return () => { mounted.current = false; };
  }, [restore]);

  const startSession = useCallback(async (res: LoginResponse): Promise<{ commit: CommitSession; loginStreak: LoginStreakClaim | null }> => {
    const session = { accessToken: res.access_token, refreshToken: res.refresh_token };
    setSession(session);
    await saveSession(session);
    const popup = streakPopupFrom(res.login_streak);
    return { loginStreak: res.login_streak ?? null, commit: () => {
      setStreakPopup(popup);
      setUserState(res.user);
      setNotice(null);
      setStatus('signedIn');
    } };
  }, []);

  const login = useCallback(async (email: string, password: string, attemptId?: string) => {
    const res = await apiRequest<LoginResponse>('/api/auth/login', { method: 'POST', body: { email: normalizeEmail(email), password },
      headers: attemptId ? { 'Idempotency-Key': attemptId } : undefined });
    return startSession(res);
  }, [startSession]);

  const register = useCallback(async ({ email, password, displayName, age, schoolGrade }: RegisterInput) => {
    const body: Record<string, string | number> = { email: normalizeEmail(email), password };
    if (displayName?.trim()) body.display_name = displayName.trim();
    body.age = age;
    body.school_grade = schoolGrade;
    await apiRequest<User>('/api/auth/register', { method: 'POST', body });
  }, []);

  const adoptPet = useCallback(async (pet: PetId, name: string) => {
    setUserState(await apiRequest<User>('/api/pet', { method: 'PUT', body: { pet, name: name.trim() }, auth: true }));
  }, []);

  const selectDailyTasks = useCallback(async (taskIds: string[]) => {
    setUserState(await apiRequest<User>('/api/onboarding/daily-tasks', { method: 'PUT', body: { task_ids: taskIds }, auth: true }));
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      setUserState(await apiRequest<User>('/api/onboarding/complete', { method: 'POST', auth: true }));
    } catch (e) {
      if (isSessionExpired(e)) return;
      // The tour is optional: don't trap the user in it. It will simply show again on the next launch.
      setUserState((u) => (u ? { ...u, onboarded: true } : u));
    }
  }, []);

  const logout = useCallback(async () => {
    const session = getSession();
    // Revoke server-side first, but never let a network problem keep the user signed in locally.
    const revoke = session
      ? apiRequest('/api/auth/logout', { method: 'POST', body: { refresh_token: session.refreshToken }, timeoutMs: 5000 }).catch(() => {})
      : Promise.resolve();
    await Promise.all([revoke, signOutLocally(null)]);
  }, [signOutLocally]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const res = await apiRequest<{ message: string }>('/api/auth/password/forgot', { method: 'POST', body: { email: normalizeEmail(email) } });
    return res.message;
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    await apiRequest('/api/auth/password/reset', { method: 'POST', body: { token: token.trim(), new_password: newPassword } });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status, user, notice, streakPopup,
    clearNotice: () => setNotice(null),
    dismissStreakPopup: () => setStreakPopup(null),
    setUser: setUserState,
    login, register, adoptPet, selectDailyTasks, completeOnboarding, logout, requestPasswordReset, resetPassword,
    retryRestore: () => { void restore(); },
  }), [status, user, notice, streakPopup, login, register, adoptPet, selectDailyTasks, completeOnboarding, logout, requestPasswordReset, resetPassword, restore]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
