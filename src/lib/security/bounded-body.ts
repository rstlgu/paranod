export async function readBoundedBody(
  request: Request,
  maxBytes = 1_000_000
): Promise<string> {
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw new RangeError('Payload too large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // A cloned request shares a tee: awaiting cancellation can wait forever
        // for the unread original branch. Reject promptly and cancel in background.
        void reader.cancel().catch(() => undefined);
        throw new RangeError('Payload too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}
