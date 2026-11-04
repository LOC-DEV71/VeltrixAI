export type ChatImage = {name: string; url: string; base64: string; width: number; height: number};
export type ChatImagePreview = Omit<ChatImage, 'base64'>;
const MAX_BYTES = 3 * 1024 * 1024;

// The URL only previews this tab's File. Send bytes to Support, never this URL.
export async function prepareChatImage(file: File): Promise<ChatImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Chỉ nhận ảnh PNG, JPG hoặc WebP tĩnh.');
  if (!file.size || file.size > MAX_BYTES) throw new Error('Ảnh tối đa 3 MB. Hãy cắt vùng cần hỗ trợ hoặc chọn ảnh nhỏ hơn.');
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{width: number; height: number}>((resolve, reject) => {
      const image = new Image();
      const timer = window.setTimeout(() => {image.src = ''; reject(new Error('Không đọc được ảnh. Hãy chọn lại tệp.'));}, 10000);
      image.onload = () => {window.clearTimeout(timer); resolve({width:image.naturalWidth, height:image.naturalHeight});};
      image.onerror = () => {window.clearTimeout(timer); reject(new Error('Tệp ảnh bị lỗi hoặc trình duyệt không đọc được.'));};
      image.src = url;
    });
    if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 4096) throw new Error('Ảnh tối đa 4.096 pixel mỗi chiều. Hãy cắt vùng cần hỗ trợ.');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Không đọc được tệp ảnh. Hãy chọn lại.'));
      reader.readAsDataURL(file);
    });
    return {name:file.name || 'Ảnh từ clipboard', url, base64, ...dimensions};
  } catch (error) {URL.revokeObjectURL(url); throw error;}
}
