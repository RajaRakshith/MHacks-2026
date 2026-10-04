import { useColorScheme } from "react-native";

/**
 * C1 Mockup colors: Capital One's navy blue, the same tokens as the web dashboard. Status colors
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
  surface: "#f2f5f8",
  card: "#ffffff",
  sunken: "#f5f7fa",
  ink: "#10222e",
  muted: "#566573",
  line: "#dbe2e8",
  brand: "#004977",
  brandStrong: "#003557",
  brandTint: "#e5eef4",
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
  surface: "#0d141a",
  card: "#16202a",
  sunken: "#111a22",
  ink: "#edf2f6",
  muted: "#9db0bf",
  line: "#283643",
  brand: "#5aa9d6",
  brandStrong: "#86c2e6",
  brandTint: "#132b3c",
  onBrand: "#04202f",
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
