import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-card shadow-sm" aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
        {aside}
      </header>
      <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h3>;
}

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong",
  secondary: "border border-line bg-card text-ink hover:bg-sunken",
  danger: "border border-critical/50 bg-card text-ink hover:bg-critical-track",
  quiet: "text-brand-strong hover:bg-brand-tint",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-sunken px-3 py-4 text-center text-sm text-muted">{children}</p>;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  shield: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <path d="M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6l8-3z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true" {...stroke} strokeWidth={3}>
      <path d="M5 12.500l4.500 4.500L19 7.500" />
    </svg>
  ),
  cross: (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true" {...stroke} strokeWidth={3}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <path d="M12 4l9 16H3l9-16zM12 10v4M12 17.500v.010" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.500v.010" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  ),
};
