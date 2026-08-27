export class ApiError extends Error {
  status: number;
  code?: string;
  row?: number;

  constructor(status: number, message: string, code?: string, row?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.row = row;
  }
}

async function parseErrorBody(res: Response): Promise<{ error?: string; code?: string; row?: number }> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body.code, body.row);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};

/** File uploads never set Content-Type manually — the browser needs to add the multipart boundary itself. */
export async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiError(res.status, body.error || `Upload failed (${res.status})`, body.code, body.row);
  }
  return (await res.json()) as T;
}
