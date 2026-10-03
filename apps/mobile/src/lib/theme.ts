import { useColorScheme } from "react-native";

/**
 * C1 Mockup colors, the same tokens as the web dashboard. Status colors
 * (good / warning / critical) are reserved for ScamShield state and always
 * appear with a label or an icon, never as color alone.
 */
export interface Theme {
  dark: boolean;
  surface: string;
  card: string;
  sunken: string;
  ink: string;
  muted: string;
  line: string;
  brand: string;
  brandStrong: string;
  brandTint: string;
  onBrand: string;
  good: string;
  goodTrack: string;
  warning: string;
  warningTrack: string;
  critical: string;
  criticalTrack: string;
  idle: string;
  idleTrack: string;
}

const light: Theme = {
  dark: false,
  surface: "#f2f5f4",
  card: "#ffffff",
  sunken: "#f6f8f7",
  ink: "#14201f",
  muted: "#5a6a68",
  line: "#dde4e2",
  brand: "#0b6b63",
  brandStrong: "#08524c",
  brandTint: "#e3f1ef",
  onBrand: "#ffffff",
  good: "#0ca30c",
  goodTrack: "#d8f1d8",
  warning: "#fab219",
  warningTrack: "#fdeec8",
  critical: "#d03b3b",
  criticalTrack: "#f7dada",
  idle: "#9aa8a6",
  idleTrack: "#e7eceb",
};

const dark: Theme = {
  dark: true,
  surface: "#101514",
  card: "#1a2120",
  sunken: "#151b1a",
  ink: "#edf2f1",
  muted: "#9fb0ad",
  line: "#2c3736",
  brand: "#3fb5a8",
  brandStrong: "#63cabd",
  brandTint: "#17302d",
  onBrand: "#06201d",
  good: "#0ca30c",
  goodTrack: "#153a18",
  warning: "#fab219",
  warningTrack: "#46340a",
  critical: "#d03b3b",
  criticalTrack: "#4a1c1c",
  idle: "#6f7f7c",
  idleTrack: "#26302f",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
