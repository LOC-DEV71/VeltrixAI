export const MAX_CLONE_BYTES = 4 * 1024 * 1024;
export const MIN_CLONE_SECONDS = 3;
export const MAX_CLONE_SECONDS = 8;

export interface CloneAudio {
  sampleRate: number; length: number; numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

// A canonical mono PCM16 WAV avoids float/extensible WAV incompatibilities.
export function encodeCloneSample(audio: CloneAudio) {
  const duration = audio.length / audio.sampleRate;
  // Audio export/resampling can append a few frames to an otherwise 8s clip.
  // Trim at most 50ms; never silently accept a genuinely longer recording.
  if (!Number.isFinite(duration) || duration < MIN_CLONE_SECONDS || duration > MAX_CLONE_SECONDS + .05) {
    throw new Error(`Mẫu dài ${Number.isFinite(duration) ? duration.toFixed(2) : '?'} giây. Hãy chọn đoạn ghi âm từ 3 đến 8 giây.`);
  }
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 16000 || audio.sampleRate > 48000 || ![1, 2].includes(audio.numberOfChannels)) {
    throw new Error('Mẫu phải có 1–2 kênh, tần số từ 16 đến 48 kHz.');
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const frames = Math.min(audio.length, MAX_CLONE_SECONDS * audio.sampleRate);
  const output = new ArrayBuffer(44 + frames * 2); const view = new DataView(output);
  const label = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, frames * 2, true);
  let energy = 0; let first = -1; let last = -1;
  for (let i = 0; i < frames; i++) {
    const value = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
    if (!Number.isFinite(value)) throw new Error('Mẫu âm thanh bị hỏng. Vui lòng chọn file khác.');
    const sample = Math.max(-1, Math.min(1, value)); energy += sample * sample;
    if (Math.abs(sample) > .01) { if (first < 0) first = i; last = i; }
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  if (Math.sqrt(energy / frames) < .001 || first < 0 || (last - first) / audio.sampleRate < 3) {
    throw new Error('Mẫu quá nhỏ tiếng hoặc chưa có đủ 3 giây lời nói. Hãy dùng bản thu rõ tiếng dài khoảng 4–8 giây.');
  }
  return { blob: new Blob([output], { type: 'audio/wav' }), duration: frames / audio.sampleRate };
}

export async function prepareCloneSample(file: File) {
  if (!file.size) throw new Error('File âm thanh rỗng.');
  if (file.size > MAX_CLONE_BYTES) throw new Error('Mẫu âm thanh tối đa 4 MB.');
  const source = await file.arrayBuffer(); const header = new Uint8Array(source, 0, Math.min(12, source.byteLength));
  const text = (start: number) => String.fromCharCode(...header.slice(start, start + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('File này chưa phải WAV hợp lệ. Hãy xuất hoặc chuyển bản thu sang WAV trước khi tải lên.');
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(source); }
    catch { throw new Error('Không đọc được file WAV. Hãy xuất lại bản thu rồi thử lại.'); }
    return encodeCloneSample(decoded);
  } finally { await context.close().catch(() => {}); }
}

export function cloneErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    CLONE_PLAN_REQUIRED: 'Cần gói Plus hoặc Pro để tạo giọng clone.',
    CLONE_CONSENT_REQUIRED: 'Vui lòng xác nhận đồng ý nhân bản và quyền sử dụng giọng. Nếu đã xác nhận, hãy đóng rồi mở lại hộp thoại.',
    INVALID_INPUT: 'Thông tin tạo giọng chưa hợp lệ. Kiểm tra tên giọng và chọn lại file WAV.',
    CLONE_SAMPLE_TOO_LARGE: 'Mẫu âm thanh tối đa 4 MB.',
    CLONE_SAMPLE_DURATION_INVALID: 'Mẫu âm thanh phải dài từ 3 đến 8 giây.',
    CLONE_SAMPLE_FORMAT_INVALID: 'Mẫu phải là WAV PCM16, 1–2 kênh, tần số 16–48 kHz.',
    CLONE_SAMPLE_INVALID: 'Mẫu phải là WAV rõ tiếng, dài 3–8 giây.',
    INVALID_TTS_WAV: 'File WAV không hợp lệ hoặc bị hỏng. Hãy xuất lại bản thu.',
    TTS_AUDIO_DURATION_INVALID: 'Thời lượng file không hợp lệ. Hãy dùng đoạn WAV từ 3 đến 8 giây.',
    CLONE_INPUT_REJECTED: 'Không tạo được giọng từ mẫu này. Hãy chọn bản thu rõ tiếng, không có nhạc nền.',
    IDEMPOTENCY_CONFLICT: 'Nội dung đã thay đổi trong lần thử lại. Hãy đóng và mở lại hộp thoại.',
    TTS_NOT_CONFIGURED: 'Dịch vụ tạo giọng chưa được khởi động.',
    CLOUDINARY_NOT_CONFIGURED: 'Dịch vụ lưu mẫu âm thanh chưa sẵn sàng.',
  };
  return (code && messages[code]) || 'Không tạo được giọng. Vui lòng thử lại.';
}
