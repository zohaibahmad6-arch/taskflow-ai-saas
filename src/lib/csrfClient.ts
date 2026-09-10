"use client";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Fetch wrapper for client components that attaches the CSRF header on mutating requests. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = readCookie("pa_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
