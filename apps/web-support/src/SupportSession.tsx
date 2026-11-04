import {createContext, useContext, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {clientUrl} from './config';
import {loadSharedSession, logoutSharedSession, SupportApiError} from './supportApi';
import type {SupportUser} from './supportApi';

type SessionState = 'loading' | 'ready' | 'signed-out' | 'error';
const context = createContext<{user: SupportUser | null; state: SessionState; error: string; recheck: () => Promise<void>; logout: () => Promise<void>} | null>(null);

export function supportLoginUrl(openChat = false) {
  if (!clientUrl) return null;
  const url = new URL('/login', clientUrl);
  const returnUrl = new URL(window.location.href);
  if (openChat) returnUrl.searchParams.set('chat', '1');
  url.searchParams.set('supportReturnTo', returnUrl.href);
  return url.href;
}

export function SupportSession({children}: {children: ReactNode}) {
  const [user, setUser] = useState<SupportUser | null>(null);
  const [state, setState] = useState<SessionState>('loading');
  const [error, setError] = useState('');
  const checkingRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  function recheck(): Promise<void> {
    if (checkingRef.current) return checkingRef.current;
    checkingRef.current = loadSharedSession().then(profile => {
      if (mountedRef.current) {setUser(profile); setState('ready'); setError('');}
    }, failure => {
      if (!mountedRef.current) return;
      setUser(null);
      if (failure instanceof SupportApiError && failure.status === 401) {
        setState('signed-out');
        setError('');
      } else {
        setState('error'); setError(failure instanceof Error ? failure.message : 'Không kiểm tra được phiên đăng nhập.');
      }
    }).finally(() => {checkingRef.current = null;});
    return checkingRef.current;
  }

  useEffect(() => {
    mountedRef.current = true;
    void recheck();
    const onFocus = () => {if (document.visibilityState === 'visible') void recheck();};
    const interval = window.setInterval(onFocus, 60000);
    window.addEventListener('focus', onFocus);
    return () => {mountedRef.current = false; window.clearInterval(interval); window.removeEventListener('focus', onFocus);};
  }, []);

  async function logout() {
    await logoutSharedSession();
    setUser(null); setState('signed-out');
    setError('');
  }

  // Reading Support is public; only AI chat depends on the optional Creator session.
  return <context.Provider value={{user, state, error, recheck, logout}}>{children}</context.Provider>;
}

export function useSupportSession() {
  const session = useContext(context);
  if (!session) throw new Error('Support session is required');
  return session;
}
