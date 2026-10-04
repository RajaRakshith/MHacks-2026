import { useRef, useState, type FormEvent } from "react";
import { postRelay } from "../lib/relay";
import { AnalysisPanel } from "./AnalysisPanel";
import { ShieldPanel } from "./ShieldPanel";
import { Button, Panel } from "./ui";

const EXAMPLES = [
  "Hi, this is Officer Daniels with the IRS. There is a warrant out for your arrest.",
  "You need to pay $3,000 in Apple gift cards today or you will be arrested.",
  "Do not tell anyone at the store what the cards are for.",
  "Hi Grandma, it's your dentist's office confirming Tuesday at 2.",
];

const SAMPLE_SCRIPT = `Caller: Hello, this is Mark from your bank's security team.
You: Oh, hello. Is something wrong?
Caller: We refunded $900 to your account by mistake this morning.
You: I didn't see that.
Caller: You need to send it back today by wire or your account will be frozen.
You: How do I do that?
Caller: Stay on the line with me, and don't tell anyone at the branch.`;

interface ScriptLine {
  speaker: "caller" | "customer";
  text: string;
}

/** "Caller: ..." and "You: ..." lines. A line with no label continues as the caller. */
function parseScript(script: string): ScriptLine[] {
  return script
    .split("\n")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = /^(caller|scammer|them|you|me|customer|margaret)\s*[:\-]\s*(.*)$/i.exec(raw);
      if (!m) return { speaker: "caller" as const, text: raw };
      const who = m[1]!.toLowerCase();
      return { speaker: who === "you" || who === "me" || who === "customer" || who === "margaret" ? ("customer" as const) : ("caller" as const), text: m[2]! };
    })
    .filter((line) => line.text !== "");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [next, setNext] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stop = useRef(false);

  const lines = parseScript(script);
  const upNext = lines[next];

  async function sendLine(line: string, who: "caller" | "customer"): Promise<boolean> {
    setBusy(true);
    setLast(null);
    const reply = await postRelay("/type", { text: line, speaker: who });
    setBusy(false);
    if (!reply.ok) {
      setLast(reply.error ?? "Could not send the line.");
      return false;
    }
    setLast(`Analyzed in ${reply.ms} ms. Score ${reply.score}.`);
    return true;
  }

  async function send(line: string) {
    if (!line.trim() || busy) return;
    if (await sendLine(line, speaker)) setText("");
  }

  async function sendNext() {
    if (!upNext || busy) return;
    if (await sendLine(upNext.text, upNext.speaker)) setNext(next + 1);
  }

  /** A blank conversation: a new empty call, the script rewound, the boxes cleared. */
  async function reset() {
    stop.current = true;
    setBusy(true);
    const reply = await postRelay("/type/reset", {});
    setBusy(false);
    setNext(0);
    setText("");
    setLast(reply.ok ? "New conversation started." : reply.error ?? "Could not reset.");
  }

  async function playAll() {
    stop.current = false;
    setPlaying(true);
    for (let i = next; i < lines.length && !stop.current; i++) {
      const line = lines[i]!;
      if (!(await sendLine(line.text, line.speaker))) break;
      setNext(i + 1);
      // A pause between lines, like a real conversation, and gentle on Gemini's rate limit.
      await sleep(2500);
    }
    setPlaying(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <main className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Panel
        title="Type a line of the call"
        aside={
          <span className="flex gap-2">
            <Button onClick={() => void reset()} disabled={busy}>Reset conversation</Button>
            <a href="/" className="inline-flex items-center rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium text-ink hover:bg-sunken">
              ← Back
            </a>
          </span>
        }
      >
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

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Or prepare a whole conversation</p>
          <label htmlFor="script" className="text-xs text-muted">
            One line each. Start a line with <strong>Caller:</strong> or <strong>You:</strong>
          </label>
          <textarea
            id="script"
            value={script}
            onChange={(e) => {
              setScript(e.target.value);
              setNext(0);
            }}
            rows={9}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs leading-relaxed text-ink focus:outline-2 focus:outline-offset-1 focus:outline-brand"
          />
          <p className="text-sm text-ink" role="status">
            {upNext ? (
              <>
                Next ({next + 1} of {lines.length}): <strong>{upNext.speaker === "caller" ? "Caller" : "You"}</strong>: {upNext.text}
              </>
            ) : lines.length > 0 ? (
              "All lines sent."
            ) : (
              "No lines yet."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void sendNext()} disabled={busy || playing || !upNext}>Send next line</Button>
            {playing ? (
              <Button onClick={() => (stop.current = true)}>Stop</Button>
            ) : (
              <Button onClick={() => void playAll()} disabled={busy || !upNext}>Play the rest</Button>
            )}
            <Button onClick={() => setNext(0)} disabled={busy || playing || next === 0}>Back to line 1</Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
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
      <AnalysisPanel />
    </main>
  );
}
