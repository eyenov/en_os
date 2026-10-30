import { HttpError } from './providers.mjs';

export async function readLimitedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new HttpError(502, '远程资源超过允许的大小。', 'RESOURCE_TOO_LARGE');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new HttpError(502, '远程资源超过允许的大小。', 'RESOURCE_TOO_LARGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}