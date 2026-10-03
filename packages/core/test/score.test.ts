import { describe, expect, it } from "vitest";
import {
  CAUTION_THRESHOLD, SCAM_THRESHOLD, TACTICS, TACTIC_POINTS, crossed, meterBand, scoreCall, stateForScore,
  type ScoreInput, type Tactic,
} from "../src";

const base: ScoreInput = { tactics: [], verdicts: [], callerReported: false, digitsMatched: false };
const score = (over: Partial<ScoreInput>): number => scoreCall({ ...base, ...over });

describe("scoreCall: every row of the scoring table (section 3.2)", () => {
  const rows: [Tactic, number][] = [
    ["unusual_payment", 25],
    ["credential_request", 25],
    ["remote_access", 20],
    ["bank_impersonation", 15],
    ["government_impersonation", 15],
    ["secrecy", 15],
    ["refund_overpayment", 15],
    ["urgency", 10],
    ["stay_on_line", 10],
  ];

  it.each(rows)("%s is worth +%i", (tactic, points) => {
    expect(score({ tactics: [tactic] })).toBe(points);
  });

  it("covers every tactic in the type", () => {
    expect(rows.map(([t]) => t).sort()).toEqual([...TACTICS].sort());
    expect(Object.keys(TACTIC_POINTS).sort()).toEqual([...TACTICS].sort());
  });

  it("each claim proven false is +30", () => {
    expect(score({ verdicts: [{ claimTrue: false }] })).toBe(30);
    expect(score({ verdicts: [{ claimTrue: false }, { claimTrue: false }] })).toBe(60);
  });

  it("each claim proven true is -10", () => {
    expect(score({ tactics: ["unusual_payment"], verdicts: [{ claimTrue: true }] })).toBe(15);
    expect(score({ tactics: ["unusual_payment"], verdicts: [{ claimTrue: true }, { claimTrue: true }] })).toBe(5);
  });

  it("caller number in the reported-scams list is +20", () => {
    expect(score({ callerReported: true })).toBe(20);
  });

  it("customer reading 4+ digits matching their real account is +25", () => {
    expect(score({ digitsMatched: true })).toBe(25);
  });

  it("each tactic counts once per call", () => {
    expect(score({ tactics: ["urgency", "urgency", "urgency"] })).toBe(10);
    expect(score({ tactics: ["urgency", "secrecy", "urgency", "secrecy"] })).toBe(25);
  });

  it("sums every signal", () => {
    expect(
      score({ tactics: ["bank_impersonation", "urgency"], verdicts: [{ claimTrue: false }, { claimTrue: true }], callerReported: true }),
    ).toBe(15 + 10 + 30 - 10 + 20);
  });
});

describe("scoreCall: clamp to 0..100", () => {
  it("never goes below 0", () => {
    expect(score({ verdicts: [{ claimTrue: true }] })).toBe(0);
    expect(score({ verdicts: [{ claimTrue: true }, { claimTrue: true }, { claimTrue: true }] })).toBe(0);
  });

  it("never goes above 100", () => {
    expect(score({ tactics: [...TACTICS] })).toBe(100);
    expect(score({ tactics: [...TACTICS], verdicts: [{ claimTrue: false }, { claimTrue: false }], callerReported: true, digitsMatched: true })).toBe(100);
  });

  it("an empty call scores 0", () => {
    expect(score({})).toBe(0);
  });
});

describe("stateForScore", () => {
  it("is listening below 40", () => {
    expect(stateForScore(0)).toBe("listening");
    expect(stateForScore(39)).toBe("listening");
  });
  it("is caution from 40 to 69", () => {
    expect(stateForScore(40)).toBe("caution");
    expect(stateForScore(69)).toBe("caution");
  });
  it("is scam_likely at 70 and up", () => {
    expect(stateForScore(70)).toBe("scam_likely");
    expect(stateForScore(100)).toBe("scam_likely");
  });
  it("meter bands follow the same thresholds", () => {
    expect([meterBand(39), meterBand(40), meterBand(69), meterBand(70)]).toEqual(["green", "amber", "amber", "red"]);
  });
});

describe("crossed", () => {
  it("is true only when the score moves up through the threshold", () => {
    expect(crossed(35, 40, CAUTION_THRESHOLD)).toBe(true);
    expect(crossed(40, 55, CAUTION_THRESHOLD)).toBe(false);
    expect(crossed(60, 70, SCAM_THRESHOLD)).toBe(true);
    expect(crossed(0, 100, SCAM_THRESHOLD)).toBe(true);
    expect(crossed(75, 60, SCAM_THRESHOLD)).toBe(false);
    expect(crossed(70, 90, SCAM_THRESHOLD)).toBe(false);
  });
});
