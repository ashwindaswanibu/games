import { Bodoni_Moda } from "next/font/google";

/**
 * The movie screens' display face (Fade to Color, Degrees of Separation): a Didone, the
 * high-contrast serif of film title cards. Text and figures use the app's Geist and Geist Mono (set
 * on `<html>`). Self-hosted by next/font; `DISPLAY_FONT_VARS` on a screen's root defines
 * `--cb-display`.
 */
const display = Bodoni_Moda({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--cb-display",
  display: "swap",
});

export const DISPLAY_FONT_VARS = display.variable;
