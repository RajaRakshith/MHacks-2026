import { useState } from "react";
import { useSpacetimeDB } from "spacetimedb/react";
import { AccountPanel } from "./components/AccountPanel";
import { HeldPanel } from "./components/HeldPanel";
import { Login, isSignedIn, signOut } from "./components/Login";
import { ShieldPanel } from "./components/ShieldPanel";

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path
          d="M5 12.5L16 6.5l11 6M8.5 15v7.5M16 15v7.5M23.5 15v7.5M6 25.5h20"
          fill="none"
          className="stroke-on-brand"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg font-semibold tracking-tight text-ink">C1 <span style={{ color: "var(--accent)" }}>Mockup</span></span>
    </span>
  );
}

export function App() {
  const { isActive, connectionError } = useSpacetimeDB();
  const [signedIn, setSignedIn] = useState(isSignedIn);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1" role="status">
            <span className={`size-2 rounded-full ${isActive ? "bg-good" : "bg-idle"}`} aria-hidden="true" />
            {isActive ? "Live" : connectionError ? "Offline" : "Connecting…"}
          </span>
          <button type="button" onClick={signOut} className="rounded-full border border-line bg-card px-2.5 py-1 text-ink hover:bg-sunken">Sign out</button>
        </div>
      </header>

      {connectionError && !isActive && (
        <p className="mb-4 rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink" role="alert">
          Cannot reach the database. Start everything with <code className="rounded bg-sunken px-1 py-0.5">pnpm dev</code>.
        </p>
      )}

      {/* Three panels side by side at 1024px and wider; stacked below that. */}
      <main className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <AccountPanel />
        <ShieldPanel />
        <HeldPanel />
      </main>

      <footer className="mt-6 text-center text-xs text-muted">Demo app. Mock data from the Capital One Nessie hackathon API.</footer>
    </div>
  );
}
