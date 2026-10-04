## Inspiration

Our inspiration for **Watchdog** came from seeing our grandparents struggle to determine whether a phone call is a scam before sending money to someone. As AI deepfakes and voice cloning become increasingly convincing, it is becoming harder to rely on simply recognizing a caller's voice or identity.

We wanted to build a solution that could **understand what is actually being said during a call**, identify social-engineering tactics as they happen, and most importantly, help prevent someone from losing money.

## What it does

**Watchdog** is a real-time scam-call defense system that joins suspicious calls as a silent third participant and analyzes the conversation as it happens.

It detects tactics such as **impersonation, urgency, threats, payment requests, and requests for sensitive information**, then displays a live risk score and specific warnings to the user.

Watchdog goes one step further: it connects the call's risk level directly to a mock banking application. If a user attempts to send money while they are on a high-risk call, Watchdog's policy engine **holds the transfer instead of allowing the money to move**.

Our goal is to move from simply saying *"this might be a scam"* to actually **protecting the user's money while the scam is happening**.

## How we built it

Watchdog uses **Twilio Media Streams** to ingest live call audio, **Grok Voice** for transcription, **Gemini** to analyze conversation segments and generate risk scores, and **ElevenLabs** to deliver warnings during critical moments.

We use **SpacetimeDB as the real-time backbone** of the application. The live transcript, risk score, detected signals, and call state are stored in SpacetimeDB, allowing our web and mobile applications to **subscribe directly to updates rather than constantly polling the server**. This lets new transcript segments and risk changes appear in the app with very low latency while the conversation is happening.

SpacetimeDB also stores transfer intents and powers the policy engine that determines whether a transaction can proceed. Approved transfers are passed to **Capital One Nessie**, while high-risk transfers are held and eventually expire.

**Neon Postgres** provides durable storage for call history, audit logs, users, devices, and post-call reports.

## Challenges we ran into

One of our biggest challenges was **connecting the frontend and backend**, since different parts of the system were being developed somewhat independently. This meant we had to stitch together the work our teammates had done, align the data structures and APIs, and make sure the frontend could correctly react to the live state coming from the backend.

Getting the real-time pieces to work together was especially important because transcript segments, risk scores, and transfer states all needed to appear in the application as they changed. **SpacetimeDB's subscription model helped bridge this gap**, allowing the frontend to subscribe directly to backend state rather than repeatedly polling for updates.

We also had to make sure the financial flow was more than just a visual simulation. Transfer requests had to pass through Watchdog's policy engine before reaching Nessie, so that a high-risk call could actually prevent the transfer from going through.

## Accomplishments that we're proud of

We're most proud that Watchdog connects **AI-based scam detection directly to financial protection**.

We built a working pipeline that can:

- Transcribe and analyze a live phone conversation.
- Detect escalating social-engineering tactics.
- Stream transcript and risk updates to the application in near real time.
- Display actionable warnings to the victim.
- Connect call risk to a financial policy engine.
- Automatically hold a transfer during a high-risk call.
- Prevent the held transfer from reaching the Nessie banking ledger.
- Record the event for a post-call audit report.

Rather than stopping at *"scam detected,"* Watchdog demonstrates **"your money was protected."**

## What we learned

We learned how important **real-time state and low latency** are when building applications around live conversations. AI analysis is only useful if its output reaches the user quickly enough to influence their decision.

We also learned that detection and enforcement should be connected. A warning system can still fail if the user is able to immediately transfer their money anyway. By putting Watchdog's policy engine directly in the transfer path, the risk detected during the call can actually affect what the financial system allows.

Finally, working with SpacetimeDB showed us how useful **subscriptions and reactive state** can be for applications where multiple clients need to see rapidly changing information simultaneously.

## What's next

We would like to make Watchdog robust enough for real-world use by improving transcription and analysis latency, reducing false positives, supporting more languages and noisy calls, and incorporating additional signals beyond conversation content.

We also envision expanding Watchdog beyond phone calls to protect users from social engineering across **text messages, emails, remote-support sessions, and other channels**.

Ultimately, we want Watchdog to become a financial safety layer that can recognize when someone is being manipulated and **intervene before their money is gone**.
