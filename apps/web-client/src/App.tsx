import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppLayout } from './components/layout/AppLayout';
import { WorkspacePage } from './pages/WorkspacePage';
import { TTSPage } from './pages/TTSPage';
import { ContentEditorPage } from './pages/ContentEditorPage';
import { ScenesPage } from './pages/ScenesPage';
import { VoicesPage } from './pages/voices/VoicesPage';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { DocsPage } from './pages/DocsPage';
import { DeveloperPage } from './pages/DeveloperPage';
import {PricingPage} from './pages/PricingPage';
import { AccountPage } from './pages/AccountPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GoogleOAuthProvider } from '@react-oauth/google';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { user, loading } = useAuth();
  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace state={{returnTo:location.pathname+location.search}} />;
  return <>{children}</>;
};

const VoicesLayout = () => {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8">Đang tải...</div>;
  if (user) return <AppLayout />;
  return <div className="min-h-screen bg-slate-50"><header className="flex justify-between items-center px-8 py-5 bg-white border-b"><Link to="/" className="font-bold text-xl">Veltrix AI</Link><Link to="/login" state={{ returnTo: '/voices' }} className="text-indigo-600">Đăng nhập</Link></header><Outlet /></div>;
};
const App: React.FC = () => {
  // Define a mock client id or read from env. Must be valid for real use, but this allows rendering.
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '1029384756-dummy.apps.googleusercontent.com';

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
    <AuthProvider>
      <Toaster position="top-right" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/chinh-sach-dieu-khoan" element={<PoliciesPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route element={<VoicesLayout />}><Route path="/voices" element={<VoicesPage />} /></Route>
          
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/content" element={<ContentEditorPage />} />
            <Route path="/content/scenes" element={<ScenesPage />} />
            <Route path="/tts" element={<TTSPage />} />
            <Route path="/account" element={<Navigate to="/account/profile" replace />} />
            <Route path="/account/profile" element={<AccountPage />} />
            <Route path="/account/preferences" element={<AccountPage />} />
            <Route path="/account/settings" element={<AccountPage />} />
            <Route path="/account/billing" element={<AccountPage />} />
          </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
