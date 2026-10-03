import type { IScene } from '../models/Scene';

// Keep database fields and internal revisions out of the public scenes contract.
export const toSceneResponse = (scene: Pick<IScene, '_id' | 'order' | 'title' | 'narration' | 'estimatedDuration' | 'imagePrompt' | 'videoPrompt'>) => ({
  id: String(scene._id),
  order: scene.order,
  title: scene.title || (scene.order === 1 ? 'Hook mở đầu' : `Cảnh ${scene.order}`),
  narration: scene.narration,
  estimatedDuration: scene.estimatedDuration,
  imagePrompt: scene.imagePrompt ?? '',
  videoPrompt: scene.videoPrompt ?? '',
});
