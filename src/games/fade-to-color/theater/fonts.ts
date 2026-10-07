import { Bodoni_Moda } from "next/font/google";

/**
 * The screen's display face, for the wordmark and the end title: a Didone, the high-contrast serif
 * of film title cards. Text and figures use the app's Geist and Geist Mono (set on `<html>`).
 * Self-hosted by next/font; `THEATER_FONT_VARS` on the root defines `--cb-display`.
 */
const display = Bodoni_Moda({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--cb-display",
  display: "swap",
});

export const THEATER_FONT_VARS = display.variable;
