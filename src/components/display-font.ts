import { Bodoni_Moda } from "next/font/google";

/**
 * The full-screen games' display face (Fade to Color, Degrees of Separation, Lexicon): a Didone, the
 * high-contrast serif of film title cards. Text and figures use the app's Geist and Geist Mono (set
 * on `<html>`). Self-hosted by next/font; `DISPLAY_FONT_VARS` on a screen's root defines
 * `--cb-display`. Only latin is preloaded: the latin-ext files stay in the CSS behind their
 * unicode-range, so they download only when a name needs one of their letters.
 */
const display = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--cb-display",
  display: "swap",
});

export const DISPLAY_FONT_VARS = display.variable;
