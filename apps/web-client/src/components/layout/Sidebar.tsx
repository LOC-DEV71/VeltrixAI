import { errorMessage } from '../../utils/userMessages';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { Plus, LayoutDashboard, PenTool, Volume2, Mic2, Star, Sparkles, Settings, SlidersHorizontal, CreditCard, User, HelpCircle, LogOut, ChevronRight, Wand2 } from 'lucide-react';
import { Button } from '../ui/Button';

import { useAuth } from '../../contexts/AuthContext';
import { OPEN_WORKSPACE_TOUR } from './WorkspaceTour';
import {supportUrl} from '../../utils/supportUrl';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      toast.error('Lỗi khi đăng xuất');
    }
  };
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast.error('Vui lòng nhập tên dự án');
      return;
    }
    setIsCreating(true);
    try {
      // Create Project
      const pRes = await api.post('/projects', { name: newProjectName });
      const projectId = pRes.data.data._id;
      
      // Create Content Draft
      const cRes = await api.post('/contents', { projectId, rawText: '' });
      const contentId = cRes.data.data._id;
      
      setIsCreateModalOpen(false);
      setNewProjectName('');
      toast.success('Đã tạo dự án thành công!');
      navigate(`/content?id=${contentId}`);
    } catch (err: any) {
      toast.error('Lỗi khi tạo dự án: ' + errorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside className="w-[224px] shrink-0 bg-white border-r border-[var(--color-border)] h-full flex flex-col justify-between z-50 select-none relative">
      <div className="p-4 flex flex-col gap-2 flex-1 overflow-y-auto">
        <Button data-tour="create-project" className="w-full gap-2 justify-center mb-2" size="md" onClick={() => setIsCreateModalOpen(true)}>
          <Plus size={18} />
          Tạo Dự án mới
        </Button>
        <div className="flex flex-col gap-1 mt-2">
          {/* Section 1: Studio / Project */}
          <div className="px-3 mb-1 mt-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Studio / Dự án</span>
          </div>
          {[
            { name: 'Quản lý Workspace', path: '/workspace', icon: <LayoutDashboard size={20} /> },
            { name: 'Studio Viết kịch bản', path: '/content', icon: <PenTool size={20} /> },
            { name: 'Video tự động', path: '/auto-video', icon: <Wand2 size={20} /> }
          ].map((item) => {
            const isActive = location.pathname.startsWith(item.path) && item.path !== '#';
            return (
              <Link
                key={item.name}
                to={item.path}
                data-tour={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                  isActive 
                    ? 'bg-indigo-50 text-[var(--color-primary)]' 
                    : 'text-[var(--color-text-sub)] hover:bg-gray-50 hover:text-[var(--color-text-main)]'
                }`}
              >
                {item.icon}
                {item.name}
              </Link>
            );
          })}

          {/* Section 2: Independent Tools */}
          <div className="px-3 mb-1 mt-4">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Công cụ tiện ích</span>
          </div>
          {[
            { name: 'Text to Speech (TTS)', path: '/tts', icon: <Volume2 size={20} /> },
            { name: 'Quản lý Giọng đọc', path: '/voices', icon: <Mic2 size={20} /> }
          ].map((item) => {
            const isActive = location.pathname.startsWith(item.path) && item.path !== '#';
            return (
              <Link
                key={item.name}
                to={item.path}
                data-tour={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                  isActive 
                    ? 'bg-indigo-50 text-[var(--color-primary)]' 
                    : 'text-[var(--color-text-sub)] hover:bg-gray-50 hover:text-[var(--color-text-main)]'
                }`}
              >
                {item.icon}
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>

      <div data-tour="credits" className="p-4 border-t border-[var(--color-border)] relative" ref={dropdownRef}>
        <button type="button" onClick={() => { setIsDropdownOpen(false); window.dispatchEvent(new Event(OPEN_WORKSPACE_TOUR)); }} className="flex items-center gap-2 text-sm text-indigo-600 mb-4 rounded-lg py-2 hover:bg-indigo-50 w-full"><HelpCircle size={16} /> Hướng dẫn nhanh</button>
        
        {isDropdownOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-4 w-[240px] bg-white rounded-2xl shadow-[0_15px_40px_-5px_rgba(0,0,0,0.2)] border border-[var(--color-border)] py-2 z-[999] animate-in fade-in slide-in-from-bottom-2">
            <Link to="/account/profile" onClick={() => setIsDropdownOpen(false)} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                  {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-[var(--color-text-main)] truncate max-w-[130px]">{user?.displayName}</span>
                  <span className="text-xs text-[var(--color-text-sub)]">Tài khoản cá nhân</span>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
            
            <div className="py-1">
              <Link to="/pricing" onClick={()=>setIsDropdownOpen(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer">
                <Sparkles size={16} /> Nâng cấp gói
              </Link>
              <Link to="/account/preferences" onClick={() => setIsDropdownOpen(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer">
                <SlidersHorizontal size={16} /> Tùy chỉnh cá nhân
              </Link>
              <Link to="/account/profile" onClick={() => setIsDropdownOpen(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer">
                <User size={16} /> Hồ sơ
              </Link>
              <Link to="/account/settings" onClick={() => setIsDropdownOpen(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors border-b border-gray-100 cursor-pointer">
                <Settings size={16} /> Cài đặt
              </Link>
              <Link to="/account/billing" onClick={()=>setIsDropdownOpen(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer">
                <CreditCard size={16} /> Thanh toán
              </Link>
            </div>
            
            <div className="py-1">
              <div className="relative group/help">
                <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <HelpCircle size={16} /> Trợ giúp
                  </div>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
                {/* Invisible hover bridge */}
                <div className="absolute top-0 left-full w-4 h-full z-[1000]" />
                <div className="absolute top-0 left-[calc(100%+8px)] w-[200px] bg-white rounded-xl shadow-[0_15px_40px_-5px_rgba(0,0,0,0.2)] border border-[var(--color-border)] py-2 opacity-0 invisible group-hover/help:opacity-100 group-hover/help:visible transition-all translate-x-2 group-hover/help:translate-x-0 z-[1001]">
                  <Link to="/docs" className="w-full flex items-center px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer text-left">
                    Tài liệu hướng dẫn
                  </Link>
                  <div className="h-[1px] bg-gray-100 my-1 mx-3" />
                  {supportUrl && <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="w-full flex items-center px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer text-left">
                    Trung tâm hỗ trợ
                  </a>}
                  <Link to="/chinh-sach-dieu-khoan" className="w-full flex items-center px-4 py-2.5 text-sm text-[var(--color-text-main)] hover:bg-gray-50 transition-colors cursor-pointer text-left">
                    Chính sách & Điều khoản
                  </Link>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <LogOut size={16} /> Đăng xuất
              </button>
            </div>
          </div>
        )}

        <button type="button" aria-label="Menu tài khoản" aria-expanded={isDropdownOpen}
          className="flex w-full text-left items-center gap-3 mb-4 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        >
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
            {user?.displayName?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--color-text-main)]">{user?.displayName}</span>
            <span className="text-xs text-[var(--color-text-sub)]">Số dư: {user?.credits?.total?.toLocaleString() ?? '0'} Credit</span>
          </div>
        </button>
        <Button variant="outline" className="w-full gap-2 justify-center text-gray-700" onClick={()=>navigate('/pricing')}>
          <Star size={16} className="text-orange-400" />
          Nâng cấp
        </Button>
      </div>

      {/* Create Project Modal */}
      {isCreateModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-2">Tạo Dự án mới</h3>
            <p className="text-sm text-[var(--color-text-sub)] mb-4">Nhập tên dự án để bắt đầu kịch bản của bạn.</p>
            
            <input 
              type="text"
              autoFocus
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm mb-6 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              placeholder="Ví dụ: Kịch bản Review Phim Kẻ Trộm Mặt Trăng"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            />
            
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)}>Hủy</Button>
              <Button onClick={handleCreateProject} disabled={isCreating}>
                {isCreating ? 'Đang tạo...' : 'Tạo Dự án'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
};
