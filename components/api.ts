"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    // 로그인이 풀렸으면 로그인 화면으로 돌아간다
    window.dispatchEvent(new CustomEvent("kmc:session-expired"));
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `요청을 처리하지 못했습니다 (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
