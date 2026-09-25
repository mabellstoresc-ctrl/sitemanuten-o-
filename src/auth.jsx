import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onApiEvent } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = carregando, null = deslogado

  const refresh = useCallback(async () => {
    try {
      const { user } = await api('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const offA = onApiEvent('unauthorized', () => setUser(null));
    const offB = onApiEvent('mustChange', () => setUser((u) => (u ? { ...u, must_change_password: true } : u)));
    return () => {
      offA();
      offB();
    };
  }, []);

  const value = useMemo(() => {
    const can = (module, action = 'ver') => {
      if (!user) return false;
      if (user.is_master) return true;
      return Boolean(user.permissions?.[module]?.includes(action));
    };
    return {
      user,
      setUser,
      refresh,
      can,
      async login(username, password, remember) {
        const { user } = await api('/auth/login', { method: 'POST', body: { username, password, remember } });
        setUser(user);
        return user;
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        setUser(null);
        window.location.hash = '#/';
      },
    };
  }, [user, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
