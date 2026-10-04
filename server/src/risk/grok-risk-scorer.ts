import { config } from '../config.js';

export type RiskAssessment = {
  riskScore: number;
  signalType: string;
  warningMessage?: string;
  signals: string[];
};

const SYSTEM_PROMPT = `You are ScamShield, a real-time scam-call defense engine.
Analyze phone conversation transcript chunks for social-engineering tactics:
impersonation (bank, IRS, police), urgency, threats, payment/wire requests,
gift cards, crypto, OTP/verification-code requests, remote-access requests.

Respond ONLY with valid JSON matching this schema:
{
  "risk_score": <integer 0-100>,
  "signal_type": <primary signal slug, e.g. "otp_request", "impersonation", "urgency", "payment_demand", "none">,
  "signals": [<all detected signal slugs>],
  "warning_message": <short victim-facing warning or null>,
  "reasoning": <one sentence for logs>
}

Escalate risk as tactics stack. OTP/code requests during a suspicious call should be 85+.
Never decrease risk sharply unless the conversation clearly becomes benign.`;

export async function scoreTranscriptRisk(
  transcript: string,
  priorRiskScore: number
): Promise<RiskAssessment> {
  if (!config.xaiApiKey) {
    return {
      riskScore: priorRiskScore,
      signalType: 'none',
      signals: [],
    };
  }

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.xaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.xaiChatModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            prior_risk_score: priorRiskScore,
            transcript_chunk: transcript,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grok risk API ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Grok risk API returned empty content');
  }

  const parsed = JSON.parse(content) as {
    risk_score?: number;
    signal_type?: string;
    signals?: string[];
    warning_message?: string | null;
    reasoning?: string;
  };

  const riskScore = Math.max(
    0,
    Math.min(100, Math.round(Number(parsed.risk_score ?? priorRiskScore)))
  );

  if (parsed.reasoning) {
    console.log(`[grok-risk] ${parsed.reasoning} → ${riskScore}%`);
  }

  return {
    riskScore,
    signalType: parsed.signal_type ?? 'none',
    signals: parsed.signals ?? [],
    warningMessage: parsed.warning_message ?? undefined,
  };
}
