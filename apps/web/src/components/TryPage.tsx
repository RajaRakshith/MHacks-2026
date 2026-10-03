import { useState, type FormEvent } from "react";
import { postRelay } from "../lib/relay";
import { ShieldPanel } from "./ShieldPanel";
import { Button, Panel } from "./ui";

const EXAMPLES = [
  "Hi, this is Officer Daniels with the IRS. There is a warrant out for your arrest.",
  "You need to pay $3,000 in Apple gift cards today or you will be arrested.",
  "Do not tell anyone at the store what the cards are for.",
  "Hi Grandma, it's your dentist's office confirming Tuesday at 2.",
];

/**
 * TEMPORARY test page at /try. Type a line as if it had been transcribed from
 * a call, and watch what the analyzer makes of it in the ScamShield panel.
 * Delete this file, the /type relay endpoint, and the route in App.tsx when done.
 */
export function TryPage() {
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState<"caller" | "customer">("caller");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function send(line: string) {
    if (!line.trim() || busy) return;
    setBusy(true);
    setLast(null);
    const reply = await postRelay("/type", { text: line, speaker });
    setBusy(false);
    if (!reply.ok) setLast(reply.error ?? "Could not send the line.");
    else {
      setLast(`Analyzed in ${reply.ms} ms. Score ${reply.score}.`);
      setText("");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <main className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Panel title="Type a line of the call">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <fieldset className="flex gap-2">
            <legend className="mb-1 text-xs font-medium text-muted">Who said it</legend>
            {(["caller", "customer"] as const).map((s) => (
              <label
                key={s}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium text-ink ${speaker === s ? "border-brand bg-brand-tint" : "border-line bg-card"}`}
              >
                <input type="radio" name="speaker" value={s} checked={speaker === s} onChange={() => setSpeaker(s)} className="sr-only" />
                {s === "caller" ? "Caller" : "You (the customer)"}
              </label>
            ))}
          </fieldset>

          <label htmlFor="line" className="text-xs font-medium text-muted">What they said</label>
          <textarea
            id="line"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={3}
            placeholder="Type a sentence and press Enter"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-brand"
          />
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>{busy ? "Analyzing…" : "Send line"}</Button>
          {last && <p className="text-sm text-muted" role="status">{last}</p>}
        </form>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Try one</p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              className="rounded-lg border border-line bg-sunken px-3 py-2 text-left text-sm text-ink hover:bg-brand-tint"
            >
              {example}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted">
          The first line starts a call. Lines add up within that call, so press End call on the right to start fresh. Claims about deposits,
          charges, and bills are checked against Margaret's account.
        </p>
      </Panel>

      <ShieldPanel />
    </main>
  );
}
