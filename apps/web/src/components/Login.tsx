import { useState, type FormEvent } from "react";
import { Button } from "./ui";

// SPEC-QUESTION: the spec puts login out of scope. This screen was asked for
// afterwards. It is a front door for the demo, not security: the check runs in
// the browser, and the database itself still accepts anonymous connections.
const DEMO_USER = "margaret";
const DEMO_PASSWORD = "demo1234";
const KEY = "c1mockup.signedIn";

export function isSignedIn(): boolean {
  try {
    if (window.localStorage.getItem(KEY) === "1") return true;
    // Older builds used sessionStorage; keep that session and promote it.
    if (window.sessionStorage.getItem(KEY) === "1") {
      window.localStorage.setItem(KEY, "1");
      window.sessionStorage.removeItem(KEY);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function signOut(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable in private windows; signing out still reloads the page.
  }
  window.location.reload();
}

const field = "w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-brand";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (user.trim().toLowerCase() !== DEMO_USER || password !== DEMO_PASSWORD) {
      setError("That username and password don't match. Use the demo sign-in shown below.");
      return;
    }
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Without storage the sign-in simply lasts until the page reloads.
    }
    onSignedIn();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden="true">
            <rect width="32" height="32" rx="8" className="fill-brand" />
            <path d="M5 12.5L16 6.5l11 6M8.5 15v7.5M16 15v7.5M23.5 15v7.5M6 25.5h20" fill="none" className="stroke-on-brand" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xl font-semibold tracking-tight text-ink">
            C1 <span style={{ color: "var(--accent)" }}>Mockup</span>
          </span>
        </div>

        <h1 className="text-lg font-semibold text-ink">Sign in</h1>
        <p className="mb-5 text-sm text-muted">Online banking with Watchdog built in.</p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="user" className="mb-1 block text-xs font-medium text-muted">Username</label>
            <input id="user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus required className={field} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className={field} />
          </div>
          {error && <p className="text-sm text-ink" role="alert">{error}</p>}
          <Button type="submit" variant="primary" className="py-2.5">Sign in</Button>
        </form>

        <p className="mt-5 rounded-lg bg-sunken px-3 py-2.5 text-xs text-muted">
          Demo sign-in: <strong className="text-ink">{DEMO_USER}</strong> / <strong className="text-ink">{DEMO_PASSWORD}</strong>
        </p>
        <p className="mt-4 text-center text-xs text-muted">Demo app. Mock data from the Capital One Nessie hackathon API.</p>
      </div>
    </div>
  );
}
