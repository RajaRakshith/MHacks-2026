import { CAUTION_THRESHOLD, SCAM_THRESHOLD, meterBand } from "@watchdog/core";

const FILL = { green: "bg-good", amber: "bg-warning", red: "bg-critical" } as const;
const TRACK = { green: "bg-good-track", amber: "bg-warning-track", red: "bg-critical-track" } as const;
const BAND_LABEL = { green: "Low risk", amber: "Caution", red: "Scam likely" } as const;

/**
 * Risk meter, 0 to 100. Green below 40, amber 40 to 69, red 70 and up.
 * The fill carries the severity and the track is a lighter step of the same
 * color, so the state reads across the whole bar. The number and the band
 * label are always shown: color never carries the meaning alone.
 */
export function RiskMeter({ score, active }: { score: number; active: boolean }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const band = meterBand(value);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold leading-none text-ink">{active ? value : "–"}</span>
          <span className="text-sm text-muted">/ 100 risk</span>
        </p>
        <span className="text-sm font-medium text-ink">{active ? BAND_LABEL[band] : "No call"}</span>
      </div>

      <div
        role="meter"
        aria-label="Scam risk"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={active ? value : 0}
        aria-valuetext={active ? `${value} out of 100, ${BAND_LABEL[band]}` : "No call in progress"}
        className={`relative mt-3 h-3 overflow-hidden rounded-full ${active ? TRACK[band] : "bg-idle-track"}`}
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${active ? FILL[band] : "bg-idle"}`}
          style={{ width: `${active ? value : 0}%` }}
        />
        {/* Threshold ticks: a 2px surface gap at 40 and 70. */}
        <span className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `${CAUTION_THRESHOLD}%` }} />
        <span className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `${SCAM_THRESHOLD}%` }} />
      </div>

      <div className="relative mt-1 h-4 text-[11px] text-muted" aria-hidden="true">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${CAUTION_THRESHOLD}%` }}>{CAUTION_THRESHOLD}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${SCAM_THRESHOLD}%` }}>{SCAM_THRESHOLD}</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}
