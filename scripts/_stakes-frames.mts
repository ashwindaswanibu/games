import puppeteer from "puppeteer-core";
const dir = "/private/tmp/claude-501/-Users-ashwindaswani-algotrading/b6f4c122-b99f-4e59-84be-defd82f2f1cc/scratchpad/stakes";
const times = (process.argv[2] ?? "0.6,2.6,4.5,6.2,7.5,9.8,11.8,12.6,15.4,17.2,19.6,22.6,26.6,29.6").split(",").map(Number);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`file://${dir}/index.html#record`, { waitUntil: "networkidle0" });
await page.evaluate(async () => { await document.fonts.ready; });
for (const t of times) {
  await page.evaluate((t) => (window as unknown as { render(t: number): void }).render(t), t).catch((e) => { console.log(errors.join("\n")); throw e; });
  await page.screenshot({ path: `${dir}/k-${t.toFixed(1)}.png` });
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
