import { test, expect, chromium } from "@playwright/test";
test("125%, 150%, 200% simulated DPI and offline local assets", async ({
  browser,
}) => {
  for (const [scale, width, height] of [
    [1.25, 1536, 864],
    [1.5, 1280, 720],
    [2, 1920, 1080],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    const page = await ctx.newPage();
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") {
        external.push(url.href);
        void route.abort();
      } else void route.continue();
    });
    await page.goto("http://127.0.0.1:1420");
    await page.getByRole("button", { name: "添加原创体验读本" }).click();
    await page.getByRole("button", { name: "继续阅读", exact: true }).click();
    await page.locator(".text-line").first().waitFor();
    expect(
      await page
        .locator(".text-line")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(60);
    expect(
      await page
        .locator(".reading-page")
        .first()
        .evaluate((el) => {
          const paper = el.getBoundingClientRect();
          return Array.from(el.querySelectorAll(".text-line")).every(
            (l) => l.getBoundingClientRect().bottom < paper.bottom,
          );
        }),
    ).toBe(true);
    expect(
      (await page.locator(".single-reading").boundingBox())!.width,
    ).toBeLessThanOrEqual(1320);
    expect(external).toEqual([]);
    await ctx.close();
  }
});
test("WebGL unavailable still reads and turns pages", async () => {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--disable-webgl"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".text-line").first()).toBeVisible();
  const before = await page.locator(".page-nav span").textContent();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".page-nav span")).not.toHaveText(before!);
  await browser.close();
});
