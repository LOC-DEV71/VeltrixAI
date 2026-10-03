import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { WorkspaceTour } from './WorkspaceTour';

export const AppLayout: React.FC = () => {
  return (
    <div className="h-screen flex flex-col font-sans bg-[var(--color-bg-base)] text-[var(--color-text-main)] overflow-hidden">
      <Header />
      <WorkspaceTour />
      <div className="flex flex-1 mt-[64px] h-[calc(100vh-64px)] min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 h-full overflow-y-auto flex flex-col relative">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
