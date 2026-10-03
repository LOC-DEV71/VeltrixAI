import {NotificationBell} from '../NotificationBell';
import React from 'react';
import { Search } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export const Header: React.FC = () => {
  const location = useLocation();
  
  const getBreadcrumbs = () => {
    if (location.pathname.startsWith('/account')) {
      const label = location.pathname.endsWith('/preferences') ? 'Tùy chỉnh cá nhân' : location.pathname.endsWith('/settings') ? 'Cài đặt' : 'Hồ sơ';
      return <><span className="text-gray-400">›</span><span className="text-[var(--color-text-main)] font-medium">{label}</span></>;
    }
    if (location.pathname.startsWith('/content/scenes')) {
      return (
        <>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-sub)]">Viết content</span>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-main)] font-medium">Kẻ Trộm Mặt Trăng 4</span>
        </>
      );
    }
    if (location.pathname.startsWith('/content')) {
      return (
        <>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-main)] font-medium">Viết content</span>
        </>
      );
    }
    if (location.pathname.startsWith('/workspace')) {
      return (
        <>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-main)] font-medium">Dự án của tôi</span>
        </>
      );
    }
    if (location.pathname.startsWith('/tts')) {
      return (
        <>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-main)] font-medium">Text to Speech</span>
        </>
      );
    }
    if (location.pathname.startsWith('/voices')) {
      return (
        <>
          <span className="text-gray-400">›</span>
          <span className="text-[var(--color-text-main)] font-medium">Giọng của tôi</span>
        </>
      );
    }
    return (
      <>
        <span className="text-gray-400">›</span>
        <span className="text-[var(--color-text-main)] font-medium">Dashboard</span>
      </>
    );
  };

  return (
    <header className="h-[64px] bg-white border-b border-[var(--color-border)] fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 pr-2">
          <img src="/logo-full.png" alt="Veltrix AI" className="h-[50px]" />
        </Link> 
        <div className="h-4 w-px bg-gray-300"></div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-sub)]">Workspace</span>
          {getBreadcrumbs()}
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="relative hidden md:block w-64">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-gray-400" />
          </div>
          <input 
            className="pl-9 h-9 w-full bg-white border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-main)] placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]" 
            placeholder="Tìm kiếm dự án..." 
          />
        </div>
        
        <NotificationBell/>
      </div>
    </header>
  );
};
