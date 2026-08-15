import type { SegmentResponse, UploadResponse } from './types';

// Same-origin by default. Point this at your backend if it's hosted
// elsewhere, e.g. process.env.NEXT_PUBLIC_API_BASE = "http://localhost:8000"
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json();
}

// fetch() has no upload-progress event, so uploads that need a % bar go
// through XMLHttpRequest instead, which fires 'progress' during the send.
function postWithProgress<T>(
  path: string,
  body: unknown,
  onProgress?: (pct: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error(`${path}: invalid JSON response`));
        }
      } else {
        reject(new Error(`${path} failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error(`${path}: network error`));

    xhr.send(JSON.stringify(body));
  });
}

export const api = {
  createSession: () => post<{ session_id: string }>('/api/session', {}),

  upload: (sessionId: string, imageDataUrl: string) =>
    post<UploadResponse>('/api/upload', { session_id: sessionId, image: imageDataUrl }),

  uploadWithProgress: (sessionId: string, imageDataUrl: string, onProgress: (pct: number) => void) =>
    postWithProgress<UploadResponse>(
      '/api/upload',
      { session_id: sessionId, image: imageDataUrl },
      onProgress
    ),

  segment: (sessionId: string, x: number, y: number) =>
    post<SegmentResponse>('/api/segment', { session_id: sessionId, x, y }),

  remove: (sessionId: string, x: number, y: number) =>
    post<SegmentResponse>('/api/remove', { session_id: sessionId, x, y }),

  undo: (sessionId: string) =>
    post<SegmentResponse>('/api/undo', { session_id: sessionId }),
  clear: (sessionId: string) =>
    post<SegmentResponse>('/api/clear', { session_id: sessionId }),

  recompose: (sessionId: string) =>
    post<SegmentResponse>('/api/recompose', { session_id: sessionId }),
};