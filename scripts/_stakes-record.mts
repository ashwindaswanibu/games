// Records the sketch frame by frame (deterministic clock) into PNGs, then an animated WebP.
import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync } from "node:fs";
const dir = "/private/tmp/claude-501/-Users-ashwindaswani-algotrading/b6f4c122-b99f-4e59-84be-defd82f2f1cc/scratchpad/stakes";
const FPS = 20;
rmSync(`${dir}/frames`, { recursive: true, force: true }); mkdirSync(`${dir}/frames`);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto(`file://${dir}/index.html#record`, { waitUntil: "networkidle0" });
await page.evaluate(async () => { await document.fonts.ready; });
const duration = await page.evaluate(() => (window as unknown as { DURATION: number }).DURATION);
const n = Math.round(duration * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => (window as unknown as { render(t: number): void }).render(t), i / FPS);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await page.screenshot({ path: `${dir}/frames/${String(i).padStart(4, "0")}.png`, type: "png" });
}
await browser.close();
console.log(`${n} frames at ${FPS} fps`);
