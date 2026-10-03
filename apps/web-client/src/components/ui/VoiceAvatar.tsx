import { useState } from 'react';

export function VoiceAvatar({ name, gender, avatarUrl }: { name: string; gender: string; avatarUrl?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span aria-hidden="true" className={`w-12 h-12 shrink-0 rounded-full overflow-hidden inline-flex items-center justify-center font-bold text-lg ${gender === 'male' ? 'bg-blue-50 text-blue-600' : gender === 'female' ? 'bg-pink-50 text-pink-600' : 'bg-slate-100 text-slate-600'}`}>
    {avatarUrl && failed !== avatarUrl
      ? <img src={avatarUrl} alt="" width={48} height={48} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={() => setFailed(avatarUrl)} />
      : name.charAt(0)}
  </span>;
}
