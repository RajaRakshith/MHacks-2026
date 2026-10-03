/**
 * The hardware side of the bridge. Two implementations:
 *   FreeWili  - FREE-WILi over USB serial
 *   Keyboard  - Enter is a press, "l" + Enter is a long press (no hardware needed)
 *
 * The FREE-WILi serial protocol here follows Intrepid's reference Python
 * library (github.com/freewili/freewili-python, freewili/fw_serial.py):
 * menu commands on the display processor's serial port, with replies and
 * events framed as "[...]".
 */
// SPEC-QUESTION: written from the library source, not tested on a device.
// Confirm the port (FREEWILI_PORT) and that the display shows the text.

import { createInterface } from "node:readline";
import type { ShieldState } from "@scamshield/core";
import { SHIELD_STATE_LABELS } from "@scamshield/core";

export interface DeviceEvents {
  onPress: () => void;
  onLongPress: () => void;
}

export interface Device {
  /** Shows the ScamShield state and its color. */
  show(state: ShieldState): void;
  close(): void;
}

export const LONG_PRESS_MS = 1000;

/** State colors, as dim RGB for the board LEDs. */
const LED: Record<ShieldState, [number, number, number]> = {
  idle: [6, 6, 6],
  listening: [0, 40, 0],
  caution: [50, 28, 0],
  scam_likely: [60, 0, 0],
};
const LED_COUNT = 7;

const CTRL_B_DISABLE_MENU = "\x02";
const BUTTON_EVENT_INTERVAL_MS = 50;

/** Turns press and release samples into one press or one long press. */
export class PressTracker {
  private downAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private fired = false;

  constructor(private readonly events: DeviceEvents, private readonly longPressMs = LONG_PRESS_MS) {}

  sample(pressed: boolean): void {
    if (pressed && this.downAt === null) {
      this.downAt = Date.now();
      this.fired = false;
      // Fire the long press while the button is still held, without waiting for release.
      this.timer = setTimeout(() => {
        this.fired = true;
        this.events.onLongPress();
      }, this.longPressMs);
    } else if (!pressed && this.downAt !== null) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.downAt = null;
      if (!this.fired) this.events.onPress();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * Parses "[*button 0E027CA91437D2F5 7450 0 0 0 0 1 1]": timestamp, sequence,
 * five button states (gray, yellow, green, blue, red), then a success flag.
 * Returns true when any button is down, or null for other frames.
 */
export function parseButtonFrame(frame: string): boolean | null {
  const m = /^\[\*button\s+\S+\s+\d+\s+([01])\s+([01])\s+([01])\s+([01])\s+([01])\b/.exec(frame.trim());
  if (!m) return null;
  return m.slice(1, 6).some((v) => v === "1");
}

interface SerialLike {
  write(data: string): void;
  on(event: "data", cb: (chunk: Buffer) => void): void;
  on(event: "error", cb: (e: Error) => void): void;
  close(): void;
}

class FreeWili implements Device {
  private buffer = "";
  private readonly tracker: PressTracker;

  constructor(private readonly port: SerialLike, events: DeviceEvents) {
    this.tracker = new PressTracker(events);
    port.on("data", (chunk) => this.read(chunk.toString("ascii")));
    port.on("error", (e) => console.error(`[button] Serial error: ${e.message}`));
    port.write(CTRL_B_DISABLE_MENU);
    // g) GUI functions, o) button events every N ms (0 turns them off).
    port.write(`g\no\n${BUTTON_EVENT_INTERVAL_MS}\n`);
  }

  private read(text: string): void {
    this.buffer += text;
    for (;;) {
      const start = this.buffer.indexOf("[");
      const end = this.buffer.indexOf("]", start);
      if (start < 0 || end < 0) break;
      const pressed = parseButtonFrame(this.buffer.slice(start, end + 1));
      this.buffer = this.buffer.slice(end + 1);
      if (pressed !== null) this.tracker.sample(pressed);
    }
    if (this.buffer.length > 4096) this.buffer = this.buffer.slice(-1024);
  }

  show(state: ShieldState): void {
    // g) GUI functions, p) show text on the display.
    this.port.write(`g\np\nScamShield: ${SHIELD_STATE_LABELS[state]}\n`);
    // g) GUI functions, s) set board LED: "<index> <red> <green> <blue>".
    const [r, g, b] = LED[state];
    for (let i = 0; i < LED_COUNT; i++) this.port.write(`g\ns\n${i} ${r} ${g} ${b}\n`);
  }

  close(): void {
    this.tracker.stop();
    this.port.write("g\no\n0\n");
    this.port.close();
  }
}

class Keyboard implements Device {
  private readonly rl = createInterface({ input: process.stdin });

  constructor(events: DeviceEvents) {
    console.log('[button] Keyboard mode: press Enter for a button press, type "l" then Enter for a long press.');
    this.rl.on("line", (line) => (line.trim().toLowerCase() === "l" ? events.onLongPress() : events.onPress()));
  }

  show(state: ShieldState): void {
    console.log(`[button] screen: ${SHIELD_STATE_LABELS[state]}`);
  }

  close(): void {
    this.rl.close();
  }
}

/** Opens the FREE-WILi, or falls back to the keyboard when it is not there. */
export async function openDevice(events: DeviceEvents, forceKeyboard: boolean): Promise<Device> {
  if (forceKeyboard) return new Keyboard(events);

  try {
    const { SerialPort } = await import("serialport");
    let path = (process.env.FREEWILI_PORT ?? "").trim();
    if (!path) {
      const ports = await SerialPort.list();
      const match = ports.filter((p) => /free.?wili|intrepid/i.test(`${p.manufacturer ?? ""} ${(p as { friendlyName?: string }).friendlyName ?? ""} ${p.pnpId ?? ""}`));
      // The device exposes two serial ports (main and display processors). Buttons and the screen are on the display one.
      path = (match.find((p) => /display/i.test(`${p.pnpId ?? ""}`)) ?? match[match.length - 1])?.path ?? "";
      if (!path) {
        console.warn(`[button] No FREE-WILi found among ${ports.length} serial port(s). Set FREEWILI_PORT (for example /dev/ttyACM1).`);
        return new Keyboard(events);
      }
    }
    const port = new SerialPort({ path, baudRate: 1_000_000 });
    await new Promise<void>((resolve, reject) => {
      port.once("open", () => resolve());
      port.once("error", reject);
    });
    console.log(`[button] FREE-WILi connected on ${path}`);
    return new FreeWili(port as unknown as SerialLike, events);
  } catch (e) {
    console.warn(`[button] Could not open the FREE-WILi (${e instanceof Error ? e.message : String(e)}).`);
    return new Keyboard(events);
  }
}
