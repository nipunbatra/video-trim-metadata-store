const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface UploadResult {
  id: string;
  name: string;
  webViewLink: string;
}

export async function downloadFile(
  fileId: string,
  token: string,
  expectedSize: number,
  onProgress: (received: number, total: number) => void,
): Promise<Blob> {
  const r = await fetch(
    `${API}/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);

  const total = Number(r.headers.get('Content-Length') ?? expectedSize);
  const reader = r.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  return new Blob(chunks as BlobPart[]);
}

export interface UploadMeta {
  name: string;
  mimeType: string;
  description?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

/**
 * Resumable upload: required for large files, survives transient network
 * errors (each 8 MB chunk is retried independently).
 */
export async function resumableUpload(
  blob: Blob,
  meta: UploadMeta,
  token: string,
  onProgress: (sent: number, total: number) => void,
): Promise<UploadResult> {
  const start = await fetch(
    `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': meta.mimeType,
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify(meta),
    },
  );
  if (!start.ok) {
    throw new Error(`Upload init failed (HTTP ${start.status}): ${await start.text()}`);
  }
  const sessionUri = start.headers.get('Location');
  if (!sessionUri) throw new Error('Upload init returned no session URI');

  const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB, required by the API
  let offset = 0;
  for (let attempt = 0; offset < blob.size; ) {
    const end = Math.min(offset + CHUNK, blob.size);
    const piece = blob.slice(offset, end);
    let r: Response;
    try {
      r = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
        },
        body: piece,
      });
    } catch (e) {
      if (++attempt > 5) throw e;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
      offset = await queryUploadOffset(sessionUri, blob.size);
      continue;
    }
    if (r.status === 308) {
      const range = r.headers.get('Range'); // "bytes=0-8388607"
      offset = range ? Number(range.split('-')[1]) + 1 : end;
      attempt = 0;
      onProgress(offset, blob.size);
    } else if (r.ok) {
      onProgress(blob.size, blob.size);
      return (await r.json()) as UploadResult;
    } else if (r.status >= 500 && attempt < 5) {
      attempt++;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
      offset = await queryUploadOffset(sessionUri, blob.size);
    } else {
      throw new Error(`Upload failed (HTTP ${r.status}): ${await r.text()}`);
    }
  }
  throw new Error('Upload ended unexpectedly');
}

async function queryUploadOffset(sessionUri: string, total: number): Promise<number> {
  const r = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}` },
  });
  if (r.status === 308) {
    const range = r.headers.get('Range');
    return range ? Number(range.split('-')[1]) + 1 : 0;
  }
  return 0;
}

/** Small helper for the JSON metadata sidecar (multipart, single request). */
export async function uploadSmallFile(
  content: string,
  meta: UploadMeta,
  token: string,
): Promise<UploadResult> {
  const boundary = 'meta_sidecar_boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const r = await fetch(
    `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!r.ok) throw new Error(`Sidecar upload failed (HTTP ${r.status})`);
  return (await r.json()) as UploadResult;
}
