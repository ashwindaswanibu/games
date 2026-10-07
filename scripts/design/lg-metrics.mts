/**
 * Measures League Gothic in Chrome and prints `src/components/home/type-metrics.ts`.
 *
 * The home's hero is sized by CSS from these numbers (container units over em-relative metrics),
 * so nothing is measured in the browser and nothing shifts after the first paint. Re-run only if
 * the face changes:
 *
 *   npx tsx scripts/design/lg-metrics.mts > src/components/home/type-metrics.ts
 *
 * Needs Chrome (CHROME_PATH, default: the macOS install) and network access to Google Fonts,
 * which serves the same League Gothic file next/font self-hosts.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

interface Measured {
  capHeight: number;
  ascent: number;
  descent: number;
  months: Record<string, number>;
  dayInk: Record<string, number>;
  dayLsb: Record<string, number>;
  dayRsb: Record<string, number>;
}

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<html><head><link href="https://fonts.googleapis.com/css2?family=League+Gothic&display=block" rel="stylesheet"></head><body><span style="font-family:'League Gothic'">x</span></body></html>`,
      { waitUntil: "load" },
    );
    // A string, not a function: tsx's name helpers don't exist inside the page.
    const out = (await page.evaluate(`(async () => {
      const months = ${JSON.stringify(MONTHS)}, days = ${JSON.stringify(DAYS)};
      await document.fonts.load('400 1000px "League Gothic"');
      const c = document.createElement("canvas").getContext("2d");
      c.font = '400 1000px "League Gothic"';
      const r4 = (n) => Math.round(n * 10) / 10000;
      const h = c.measureText("0123456789");
      const result = { capHeight: r4(h.actualBoundingBoxAscent), ascent: r4(h.fontBoundingBoxAscent), descent: r4(h.fontBoundingBoxDescent), months: {}, dayInk: {}, dayLsb: {}, dayRsb: {} };
      for (const m of months) result.months[m] = r4(c.measureText(m).width);
      for (const d of days) {
        const t = c.measureText(d);
        result.dayInk[d] = r4(t.actualBoundingBoxLeft + t.actualBoundingBoxRight);
        result.dayLsb[d] = r4(-t.actualBoundingBoxLeft);
        result.dayRsb[d] = r4(t.width - t.actualBoundingBoxRight);
      }
      return result;
    })()`)) as Measured;
    process.stdout.write(render(out));
  } finally {
    await browser.close();
  }
}

function record(values: Record<string, number>): string {
  return `{\n${Object.entries(values)
    .map(([k, v]) => `  ${/^\d/.test(k) ? JSON.stringify(k) : k}: ${v},`)
    .join("\n")}\n}`;
}

function render(m: Measured): string {
  return `/**
 * League Gothic, measured in Chrome (\`scripts/design/lg-metrics.mts\`). Units are em. Generated: do
 * not edit by hand. The server passes the values the day needs as inline CSS variables
 * (\`--month-adv\`, \`--day-ink\`, \`--day-lsb\`, \`--day-rsb\`), so the hero is fitted by CSS alone.
 */

/** Digit height (ink ascent of the figures; the caps are a hair shorter). */
export const LG_CAP = ${m.capHeight};
/** The face's ascent and descent (hhea), for placing a baseline inside a line box. */
export const LG_ASCENT = ${m.ascent};
export const LG_DESCENT = ${m.descent};

/** Advance width of each month, uppercase. */
export const MONTH_ADVANCE: Readonly<Record<string, number>> = ${record(m.months)};

/** Ink width of each day numeral. */
export const DAY_INK: Readonly<Record<string, number>> = ${record(m.dayInk)};

/** Left side bearing of each day numeral (ink starts this far right of the pen). */
export const DAY_LSB: Readonly<Record<string, number>> = ${record(m.dayLsb)};

/** Right side bearing of each day numeral (ink ends this far left of the advance). */
export const DAY_RSB: Readonly<Record<string, number>> = ${record(m.dayRsb)};
`;
}

await main();
