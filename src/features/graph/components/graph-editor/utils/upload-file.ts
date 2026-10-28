'use client';

export interface UploadTempFileResult {
  url: string;
}

export interface UploadTempFileArgs {
  file: File;
  onProgress?: (percent: number) => void;
}

function parseErrorMessage(args: { status: number; responseText: string }) {
  if (args.status === 413) return 'File is too large. Maximum size is 50MB.';
  try {
    const errorData = JSON.parse(args.responseText) as { error?: string };
    if (errorData?.error) return errorData.error;
  } catch {
    // ignore
  }
  return `Upload failed: ${args.status}`;
}

export async function uploadTempFileWithProgress(
  args: UploadTempFileArgs
): Promise<UploadTempFileResult> {
  const formData = new FormData();
  formData.append('file', args.file);

  return await new Promise<UploadTempFileResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      args.onProgress?.(percentComplete);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as UploadTempFileResult;
          if (!parsed?.url) {
            reject(new Error('Invalid response'));
            return;
          }
          resolve(parsed);
        } catch {
          reject(new Error('Invalid response'));
        }
        return;
      }

      console.error('[upload-temp] upload failed', {
        status: xhr.status,
        responseText: xhr.responseText
      });
      reject(new Error(parseErrorMessage({ status: xhr.status, responseText: xhr.responseText })));
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'));
    });

    xhr.open('POST', '/api/upload/temp');
    xhr.send(formData);
  });
}
