import { extractOfficeXml } from './office-preview-archive';

self.onmessage = (
  event: MessageEvent<{ bytes: Uint8Array; kind: 'docx' | 'xlsx' | 'pptx' }>
) => {
  try {
    self.postMessage({
      files: extractOfficeXml(event.data.bytes, event.data.kind)
    });
  } catch {
    self.postMessage({
      error:
        'Preview unavailable: protected, damaged or overly complex document.'
    });
  }
};
