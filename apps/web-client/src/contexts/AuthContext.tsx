import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';
import {FreeIpNotice} from '../components/FreeIpNotice';
import {isFreeIpDenied} from '../utils/freeIpPolicy';

interface AuthContextType {
  user: any;
  loading: boolean;
  loginOtp: (email: string, purpose: string) => Promise<string>;
  verifyOtp: (email: string, challengeId: string, code: string, purpose: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [freeIpDenied, setFreeIpDenied] = useState(false);
  const showPolicyDenial = (error: unknown) => {if (isFreeIpDenied(error)) setFreeIpDenied(true); throw error;};

  useEffect(() => {
    // Check session on mount, but first fetch CSRF token
    api.get('/v1/auth/csrf')
      .then(() => api.get('/users/me'))
      .then(res => setUser(res.data.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const loginOtp = async (email: string, purpose: string) => {
    const res = await api.post('/v1/auth/otp/request', { email, purpose });
    return res.data.data.challengeId;
  };

  const verifyOtp = async (email: string, challengeId: string, code: string, purpose: string) => {
    await api.post('/v1/auth/otp/verify', { email, challengeId, code, purpose }).catch(showPolicyDenial);
    await refreshUser();
  };

  const loginGoogle = async (credential: string) => {
    await api.post('/v1/auth/google', { credential }).catch(showPolicyDenial);
    await refreshUser();
  };

  const logout = async () => {
    await api.post('/v1/auth/logout');
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const res = await api.get('/users/me');
      setUser(res.data.data);
    } catch (err) {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginOtp, verifyOtp, loginGoogle, logout, refreshUser }}>
      {children}
      {freeIpDenied && <FreeIpNotice onClose={() => setFreeIpDenied(false)} />}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
