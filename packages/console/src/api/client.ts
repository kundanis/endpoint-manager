const BASE = "/api";

interface RequestOptions extends RequestInit {
  json?: unknown;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const { json, headers, ...rest } = options;

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: json !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body, keep the generic message
    }
    throw new Error(message);
  }
  return res;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: "POST", json }),
  put: <T>(path: string, json?: unknown) => request<T>(path, { method: "PUT", json }),
  patch: <T>(path: string, json?: unknown) => request<T>(path, { method: "PATCH", json }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // POSTs JSON and saves the binary response as a file, named from Content-Disposition.
  postDownload: async (path: string, json: unknown, fallbackFilename: string) => {
    const res = await send(path, { method: "POST", json });
    const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = match?.[1] ?? fallbackFilename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
