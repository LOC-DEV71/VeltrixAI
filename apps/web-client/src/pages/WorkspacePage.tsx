import React, { useState, useEffect } from 'react';
import { Plus, FolderOpen, MoreHorizontal, Calendar } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { api } from '../api';
import toast from 'react-hot-toast';
import { Modal, Input as ModalInput, Pagination } from 'antd';

interface Project {
  _id: string;
  name: string;
  createdAt: string;
}

export const WorkspacePage: React.FC = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Không gian sáng tạo';

  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [action, setAction] = useState<{ type: 'rename' | 'delete'; project: Project } | null>(null);
  const [inputName, setInputName] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const openAction = (type: 'rename' | 'delete', project: Project) => {
    setMenuId(null);
    setAction({ type, project });
    setInputName(type === 'rename' ? project.name : '');
    setActionError('');
  };

  const submitAction = async () => {
    if (!action || saving) return;
    if (action.type === 'delete' ? inputName !== action.project.name : !inputName.trim() || inputName.trim().length > 200) return;
    setSaving(true);
    setActionError('');
    try {
      if (action.type === 'rename') {
        const res = await api.patch(`/projects/${action.project._id}`, { name: inputName.trim() });
        setProjects(previous => previous.map(project => project._id === action.project._id ? res.data.data : project));
        toast.success('Đã đổi tên dự án');
      } else {
        await api.delete(`/projects/${action.project._id}`, { data: { confirmName: inputName } });
        setProjects(previous => previous.filter(project => project._id !== action.project._id));
        if (projects.length === 1 && page > 1) setPage(previous => previous - 1);
        else setReload(previous => previous + 1);
        toast.success('Đã xóa dự án');
      }
      setAction(null);
    } catch (err: any) {
      setActionError(err.response?.data?.error?.message || 'Không thể cập nhật dự án. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api.get('/projects', { params: { page, limit: 10 }, signal: controller.signal })
      .then(res => { setProjects(res.data.data); setTotal(res.data.meta.total); })
      .catch(() => {
        if (controller.signal.aborted) return;
        toast.error('Lỗi khi tải danh sách dự án');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reload]);

  return (
    <div className="p-8 max-w-7xl mx-auto w-full flex flex-col gap-12" onClick={() => setMenuId(null)}>
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-[var(--color-text-main)]">Nội dung gần đây</h1>
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-medium">{total} dự án</span>
          </div>
          <span className="text-sm text-[var(--color-text-sub)]">Cập nhật tự động</span>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center text-sm text-gray-500">Đang tải dữ liệu...</div>
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div 
                key={project._id} 
                className="bg-white rounded-xl border border-[var(--color-border)] p-5 hover:shadow-sm transition-shadow flex flex-col h-[160px] cursor-pointer"
                onClick={async () => {
                  try {
                    const cRes = await api.get(`/contents?projectId=${project._id}`);
                    const existing = cRes.data.data[0];
                    if (existing) {
                      window.location.href = `/content?id=${existing._id}`;
                    } else {
                      toast.error('Dự án này chưa có nội dung!');
                    }
                  } catch (err) {
                    toast.error('Lỗi khi tải nội dung');
                  }
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 bg-green-50 text-green-700">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    Sẵn sàng
                  </div>
                  <div className="relative" onClick={event => event.stopPropagation()}>
                  <button type="button" aria-label={`Thao tác dự án ${project.name}`} aria-expanded={menuId === project._id}
                    onClick={() => setMenuId(menuId === project._id ? null : project._id)} className="text-gray-400 hover:text-gray-600 p-1">
                    <MoreHorizontal size={16} />
                  </button>
                  {menuId === project._id && (
                    <div role="menu" className="absolute right-0 top-8 z-20 min-w-36 bg-white border border-gray-200 rounded-lg shadow-lg p-1">
                      <button role="menuitem" className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 rounded" onClick={() => openAction('rename', project)}>Đổi tên</button>
                      <button role="menuitem" className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded" onClick={() => openAction('delete', project)}>Xóa dự án</button>
                    </div>
                  )}
                  </div>
                </div>
                <h3 className="font-semibold text-[var(--color-text-main)] text-sm mb-auto line-clamp-2 leading-relaxed">
                  {project.name}
                </h3>
                <div className="flex items-center justify-between text-xs text-[var(--color-text-sub)] mt-4">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(project.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 flex flex-col items-center justify-center min-h-[320px]">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100 mb-6">
              <FolderOpen className="text-gray-400" size={24} />
            </div>
            <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-2">Bạn chưa có nội dung nào</h3>
            <p className="text-[var(--color-text-sub)] mb-8 text-center max-w-sm text-sm">
              Bắt đầu tạo bài viết kịch bản, chuyển đổi văn bản thành giọng đọc và quản lý toàn bộ nội dung tại đây.
            </p>
            <Button variant="outline" className="gap-2 font-medium">
              <Plus size={16} className="text-[var(--color-primary)]" />
              Bắt đầu viết ngay
            </Button>
          </div>
        )}
      </div>
      <Pagination current={page} total={total} pageSize={10} showSizeChanger={false} onChange={setPage} hideOnSinglePage />
      <Modal open={Boolean(action)} title={action?.type === 'delete' ? 'Xóa dự án' : 'Đổi tên dự án'}
        onCancel={() => { if (!saving) setAction(null); }} onOk={submitAction}
        okText={action?.type === 'delete' ? 'Xóa dự án' : 'Lưu tên'} cancelText="Hủy"
        confirmLoading={saving} closable={!saving} mask={{ closable: !saving }}
        cancelButtonProps={{ disabled: saving }}
        okButtonProps={{ danger: action?.type === 'delete', disabled: !action || (action.type === 'delete' ? inputName !== action.project.name : !inputName.trim() || inputName.trim().length > 200) }}>
        {action?.type === 'delete' && <p className="mb-4">Nhập chính xác tên <strong>{action.project.name}</strong> để xác nhận xóa dự án và gỡ nội dung khỏi Workspace.</p>}
        <label htmlFor="project-action-name" className="block mb-2">{action?.type === 'delete' ? 'Tên dự án xác nhận' : 'Tên dự án'}</label>
        <ModalInput id="project-action-name" value={inputName} onChange={event => setInputName(event.target.value)}
          disabled={saving} onPressEnter={submitAction} autoFocus autoComplete="off"
          maxLength={action?.type === 'rename' ? 200 : undefined} />
        {actionError && <p role="alert" className="text-red-600 mt-3">{actionError}</p>}
      </Modal>
    </div>
  );
};
