import { Bodoni_Moda, League_Gothic } from "next/font/google";

/**
 * The home's two display families (spec §3.2). Geist and Geist Mono are already on <html>.
 *
 * League Gothic is the hero's face: the month and the numeral are fitted to its measured metrics
 * (`src/components/home/type-metrics.ts`), so it loads with `display: block` and is preloaded (the
 * opening covers the first paint of the day anyway).
 *
 * Bodoni Moda is the italic voice. Its options match Fade to Color's (`theater/fonts.ts`) exactly,
 * so both screens share the same self-hosted files.
 */
const display = League_Gothic({ subsets: ["latin"], variable: "--font-display", display: "block", preload: true });

const voice = Bodoni_Moda({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-voice",
  display: "swap",
});

/** Class names that define `--font-display` and `--font-voice` on the home's root. */
export const HOME_FONT_VARS = `${display.variable} ${voice.variable}`;
