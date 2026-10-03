import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

export const audioUrl = (path: string) => `${(api.defaults.baseURL || '/api').replace(/\/$/, '')}${path.replace(/^\/api/, '')}`;
export const pendingJob = (job: any) => ['QUEUED', 'PROCESSING'].includes(job?.status);
export function useTtsData(projectId?: string) {
  const voicePage=useRef(1);const [hasMoreVoices,setHasMoreVoices]=useState(false),[voicesBusy,setVoicesBusy]=useState(false);
  const mergeVoices=(rows:any[])=>setVoices(old=>Array.from(new Map([...old,...rows].map(v=>[v.id,v])).values()));
  const loadMoreVoices=async()=>{if(voicesBusy)return;setVoicesBusy(true);try{const r=await api.get('/voices',{params:{page:voicePage.current+1,limit:10}});voicePage.current++;mergeVoices([...r.data.data.systemVoices,...r.data.data.cloneVoices]);setHasMoreVoices(voicePage.current*10<r.data.data.total);}catch{setConfigError('Không tải được giọng.');}finally{setVoicesBusy(false);}};
  const [page,setPage]=useState(1),[total,setTotal]=useState(0);
  const [voices, setVoices] = useState<any[]>([]); const [jobs, setJobs] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null); const [error, setError] = useState('');
  const [configError, setConfigError] = useState('');
  const { refreshUser } = useAuth(); const refresh = useRef(refreshUser); refresh.current = refreshUser;
  const previous = useRef<any[]>([]); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const historyPath = projectId ? `/tts/history?projectId=${encodeURIComponent(projectId)}` : '/tts/history?page='+page+'&limit=10';
  const reload = useCallback(async () => {
    const signal = abort.current?.signal; if (!signal || signal.aborted) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      const response = await api.get(historyPath, { signal }); if (signal.aborted) return;
      const next = response.data.data.jobs;
      const ids=[...new Set<string>(next.map((j:any)=>j.voiceId).filter(Boolean))];for(let i=0;i<ids.length;i+=10){const r=await api.get('/voices',{params:{ids:ids.slice(i,i+10).join(',')},signal});if(!signal.aborted)mergeVoices([...r.data.data.systemVoices,...r.data.data.cloneVoices]);}
      if (previous.current.some(old => pendingJob(old) && next.some((job: any) => job.id === old.id && !pendingJob(job)))) await refresh.current();
      setTotal(response.data.data.total);previous.current = next; setJobs(next); setError('');
      if (next.some(pendingJob)) timer.current = setTimeout(() => void reload(), 2000);
    } catch {
      if (!signal.aborted) { setError('Không tải được lịch sử audio.'); timer.current = setTimeout(() => void reload(), 5000); }
    }
  }, [historyPath]);
  useEffect(() => {
    const controller = new AbortController(); abort.current = controller; previous.current = []; setJobs([]);
    Promise.all([api.get('/voices', { signal: controller.signal }), api.get('/tts/config', { signal: controller.signal })])
      .then(([v, c]) => { if (!controller.signal.aborted) { voicePage.current=1;mergeVoices([...v.data.data.systemVoices, ...(v.data.data.cloneVoices || [])]);setHasMoreVoices(v.data.data.total>10); setConfig(c.data.data); setConfigError(''); } })
      .catch(() => { if (!controller.signal.aborted) setConfigError('Không tải được giọng đọc hoặc cấu hình TTS.'); });
    void reload();
    return () => { controller.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [reload]);
  return { hasMoreVoices,loadMoreVoices,voicesBusy,page,setPage,total,voices, config, jobs, reload, error: configError || error, refreshCredits: () => refresh.current() };
}

export async function downloadAudio(path: string, filename: string) {
  const response = await api.get(path.replace(/^\/api/, ''), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
