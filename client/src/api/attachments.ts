import { post } from './client';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface UploadedImage {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

// Uploads an image (PNG, JPEG, GIF, WebP) and returns its public URL for ![](url).
export async function uploadImage(projectKey: string, file: File, taskId?: string): Promise<UploadedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image trop lourde (8 Mo maximum).');
  const data = await readAsDataUrl(file);
  const r = await post<{ attachment: UploadedImage }>(`/projects/${projectKey}/attachments`, { name: file.name || 'image.png', data, taskId });
  return r.attachment;
}
