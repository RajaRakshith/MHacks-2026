/**
 * The one place the module makes HTTP calls. SpacetimeDB procedures are in
 * beta; if `ctx.http` changes, this is the only file to touch.
 *
 * Procedures are synchronous, and a procedure must finish its HTTP calls
 * before it opens a transaction. Nothing here touches the database.
 */

import { TimeDuration } from 'spacetimedb';

/** The part of `ctx.http` this module relies on. */
export interface Http {
  fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: TimeDuration }
  ): { status: number; text(): string };
}

export interface HttpResult {
  ok: boolean;
  /** 0 when the request never got a response. */
  status: number;
  text: string;
  /** Parsed body, or undefined when the body is not JSON. */
  json: unknown;
  error?: string;
}

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** Strips API keys from anything that might end up in a log or a table. */
export function redactSecrets(text: string): string {
  return text.replace(/([?&]key=)[^&\s)"']+/gi, '$1***').replace(/(x-goog-api-key["':\s]+)[^\s"',}]+/gi, '$1***');
}

export function httpJson(http: Http, url: string, options: HttpOptions = {}): HttpResult {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  try {
    const init: { method: string; headers: Record<string, string>; body?: string; timeout: TimeDuration } = {
      method,
      headers,
      timeout: TimeDuration.fromMillis(options.timeoutMs ?? 10_000),
    };
    if (body !== undefined) init.body = body;
    const res = http.fetch(url, init);
    const text = res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const ok = res.status >= 200 && res.status < 300;
    const result: HttpResult = { ok, status: res.status, text, json };
    if (!ok) result.error = `${method} ${redactSecrets(url)} returned ${res.status}`;
    return result;
  } catch (e) {
    return { ok: false, status: 0, text: '', json: undefined, error: redactSecrets(`${method} failed: ${String(e)}`) };
  }
}
