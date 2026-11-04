import React, { useEffect, useState } from 'react';
import { Modal } from 'antd';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { Dropdown } from '../ui/Dropdown';

/** datetime-local value ("2026-11-05T19:30") for a Date, in the browser's time zone. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export interface PublishSettings { title: string; privacy: 'private' | 'unlisted' | 'public'; playlistId: string; categoryId: string; publishAt: string | null }

/**
 * Settings shown before uploading a finished video: title, visibility, playlist, category and
 * "now" or a scheduled time. Nothing is uploaded until the user confirms.
 */
export const PublishDialog: React.FC<{ open: boolean; defaultTitle: string; busy: boolean; onCancel: () => void; onConfirm: (s: PublishSettings) => void }> = ({ open, defaultTitle, busy, onCancel, onConfirm }) => {
  const [title, setTitle] = useState(defaultTitle);
  const [privacy, setPrivacy] = useState<PublishSettings['privacy']>('private');
  const [when, setWhen] = useState<'now' | 'scheduled'>('now');
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [playlistId, setPlaylistId] = useState('');
  const [categoryId, setCategoryId] = useState('28');
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string; itemCount: number }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    api.get('/youtube/playlists').then((r) => {
      setPlaylists(r.data?.data?.playlists || []);
      setCategories(r.data?.data?.categories || []);
    }).catch(() => toast.error('Không tải được danh sách phát từ YouTube.'));
  }, [open, defaultTitle]);

  const scheduledDate = when === 'scheduled' ? new Date(at) : null;
  const scheduleError = scheduledDate && (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 10 * 60_000)
    ? 'Giờ đăng phải sau hiện tại ít nhất 10 phút.' : null;
  const titleError = !title.trim() ? 'Cần có tiêu đề.' : [...title].length > 100 ? 'YouTube giới hạn tiêu đề 100 ký tự.' : null;

  const confirm = () => {
    if (scheduleError || titleError) return;
    onConfirm({ title: title.trim(), privacy: when === 'scheduled' ? 'private' : privacy, playlistId, categoryId, publishAt: scheduledDate ? scheduledDate.toISOString() : null });
  };

  return (
    <Modal destroyOnHidden open={open} title="Đăng lên YouTube" onCancel={() => !busy && onCancel()} onOk={confirm}
      okText={busy ? 'Đang đăng…' : when === 'scheduled' ? 'Hẹn giờ đăng' : 'Đăng'} cancelText="Hủy" confirmLoading={busy}
      okButtonProps={{ disabled: !!scheduleError || !!titleError, danger: true }}>
      <div className="space-y-3.5 pt-1">
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="yt-title">Tiêu đề</label>
          <input id="yt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <p className={`text-[12px] ${titleError ? 'text-red-600' : 'text-slate-400'}`}>{titleError ?? `${[...title].length}/100`}</p>
        </div>

        <Dropdown label="Khi nào đăng" value={when} onChange={(e) => setWhen(e.target.value as 'now' | 'scheduled')}
          options={[{ label: 'Đăng ngay', value: 'now' }, { label: 'Hẹn giờ', value: 'scheduled' }]} />
        {when === 'scheduled' ? (
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="yt-at">Giờ công khai</label>
            <input id="yt-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} min={toLocalInput(new Date(Date.now() + 11 * 60_000))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <p className={`text-[12px] ${scheduleError ? 'text-red-600' : 'text-slate-500'}`}>
              {scheduleError ?? 'Video được tải lên ở chế độ riêng tư, YouTube tự công khai đúng giờ này.'}
            </p>
          </div>
        ) : (
          <Dropdown label="Chế độ hiển thị" value={privacy} onChange={(e) => setPrivacy(e.target.value as PublishSettings['privacy'])}
            options={[
              { label: 'Riêng tư (khuyên dùng để duyệt trước)', value: 'private' },
              { label: 'Không công khai', value: 'unlisted' },
              { label: 'Công khai', value: 'public' },
            ]} />
        )}

        <Dropdown label="Danh sách phát" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}
          options={[{ label: 'Không thêm vào danh sách phát', value: '' }, ...playlists.map((p) => ({ label: `${p.title} (${p.itemCount} video)`, value: p.id }))]} />
        {categories.length > 0 && (
          <Dropdown label="Danh mục" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={categories.map((c) => ({ label: c.title, value: c.id }))} />
        )}
        <p className="text-[12px] text-slate-500">Video được khai báo là có nội dung AI, ảnh bìa Thumbnail được tải lên kèm theo.</p>
      </div>
    </Modal>
  );
};

