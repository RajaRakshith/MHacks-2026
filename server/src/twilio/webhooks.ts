import { config } from '../config.js';

function wsBaseUrl(): string {
  const url = new URL(config.publicUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

/** TwiML for inbound/outbound calls that pipes audio to our media stream WS. */
export function buildStreamTwiml(params: {
  userId?: string;
  callerNumber?: string;
}): string {
  const streamUrl = `${wsBaseUrl()}/twilio/media-stream`;
  const userId = params.userId ?? 'demo-user';
  const callerNumber = params.callerNumber ?? '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="userId" value="${escapeXml(userId)}" />
      <Parameter name="callerNumber" value="${escapeXml(callerNumber)}" />
    </Stream>
  </Connect>
</Response>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
