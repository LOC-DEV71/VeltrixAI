import { Voice } from '../models/Voice';

// Illustrations shipped with web-client; these are not photos of the speakers.
export const SYSTEM_VOICE_AVATARS: Record<string, string> = {
  'Hải Đăng': '/voice-avatars/hai-dang.svg',
  'Mai Anh': '/voice-avatars/mai-anh.svg',
  'Ngọc Trân': '/voice-avatars/ngoc-tran.svg',
  'Quang Sơn': '/voice-avatars/quang-son.svg',
  'Thái Sơn': '/voice-avatars/thai-son.svg',
  'Thùy Dung': '/voice-avatars/thuy-dung.svg',
};

export async function fillMissingSystemVoiceAvatars() {
  let updated = 0;
  for (const [providerVoiceId, avatarUrl] of Object.entries(SYSTEM_VOICE_AVATARS)) {
    const result = await Voice.updateOne({ provider: 'VIENEU_LOCAL', providerVoiceId, isSystem: true,
      $or: [{ avatarUrl: { $exists: false } }, { avatarUrl: null }, { avatarUrl: '' }],
    }, { $set: { avatarUrl } }, { runValidators: true });
    updated += result.modifiedCount;
  }
  return updated;
}
