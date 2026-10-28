import type { OSINTNodeData } from '@/features/graph/types';

export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const imageExtension = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(?:[?#].*)?$/i;

export function isImageFile(file: Pick<File, 'type' | 'name'>) {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file.name)
  );
}

export function validateImageFile(file: Pick<File, 'type' | 'name' | 'size'>) {
  if (
    !(
      IMAGE_FILE_ACCEPT.split(',').includes(file.type) ||
      (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name))
    )
  ) {
    throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  }
  if (file.size > 50 * 1024 * 1024)
    throw new Error('Maximum image size is 50MB.');
  if (!file.size) throw new Error('The image file is empty.');
}

export function prepareImageFile(file: File) {
  validateImageFile(file);
  if (file.type) return file;
  const extension = file.name.split('.').pop()!.toLowerCase();
  const mime =
    extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : `image/${extension}`;
  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified
  });
}

export function normalizeMediaUrl(value: string) {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Enter a valid HTTP or HTTPS image URL.');
  }
  return url.href;
}

export function isImageNode(data: OSINTNodeData) {
  return (
    data.type === 'media_url' &&
    (data.metadata?.mediaType === 'image' ||
      String(data.metadata?.mimeType ?? '').startsWith('image/') ||
      data.label.startsWith('data:image/') ||
      imageExtension.test(data.label))
  );
}

export function getMediaSource(data: OSINTNodeData) {
  // Older image drops stored a base64 label as well as the uploaded file URL.
  return isImageNode(data) && typeof data.metadata?.fileUrl === 'string'
    ? data.metadata.fileUrl
    : data.label;
}

export function uploadedImageData(
  data: OSINTNodeData,
  file: File,
  url: string
): OSINTNodeData {
  return {
    ...data,
    type: 'media_url',
    label: url,
    metadata: {
      ...data.metadata,
      url,
      fileUrl: url,
      mediaType: 'image',
      mimeType: file.type,
      filename: file.name,
      size: file.size,
      _uploading: false
    }
  };
}
