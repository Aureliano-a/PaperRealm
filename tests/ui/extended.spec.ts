import { test, expect } from "@playwright/test";
test("selection, annotation, search, continuous mode and fallback settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await page.locator(".text-line").first().waitFor();
  await page
    .locator(".text-line")
    .nth(1)
    .evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild!, 0);
      r.setEnd(el.firstChild!, 8);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    });
  await page.locator(".reading-stage").dispatchEvent("mouseup");
  await expect(page.getByText("收藏此刻")).toBeVisible();
  await page.getByPlaceholder("写下你的批注（可选）").fill("这段话值得记住");
  await page.getByRole("button", { name: "保存摘录" }).click();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.locator(".reader-panel>button").nth(5).click();
  const before = await page.locator(".page-nav span").textContent();
  await page.getByLabel("阅读模式").selectOption("scroll");
  await expect(page.locator(".scroll-pages")).toBeVisible();
  await page.locator(".reader-panel>button").first().click();
  await expect
    .poll(() => page.locator(".reading-stage").evaluate((e) => e.scrollTop))
    .toBeLessThan(60);
  await page.getByLabel("阅读模式").selectOption("single");
  await expect(page.locator(".single-reading>.reading-page")).toHaveCount(1);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".page-nav span")).not.toHaveText(before!);
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator("nav").getByRole("button", { name: "阅读记忆馆" }).click();
  await expect(page.getByLabel("编辑批注")).toHaveValue("这段话值得记住");
  await page.getByPlaceholder("人物 / 地点 / 关系名称").fill("林知");
  await page
    .getByPlaceholder("你的记录，例如：林知与陈远是朋友")
    .fill("已读章节中的主人公");
  await page.getByRole("button", { name: "建立索引" }).click();
  await expect(page.locator(".trail-record")).toHaveCount(1);
  await page.locator("nav").getByRole("button", { name: "设置中心" }).click();
  await page.getByRole("switch", { name: "阅读轻动效" }).click();
  await page.getByRole("switch", { name: "低性能模式" }).click();
  await page.locator("nav").getByRole("button", { name: "私人藏书室" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await page.getByLabel("阅读模式").selectOption("single");
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".curl-canvas canvas")).toHaveCount(0);
  const old = await page.locator(".page-nav span").textContent();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".page-nav span")).not.toHaveText(old!);
});
test("sustained reading accumulates local time and data backup restores", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await page.waitForTimeout(10500);
  await page.getByRole("button", { name: "返回书库" }).click();
  const book = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("paperrealm-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<any>((resolve) => {
      const r = db.transaction("records").objectStore("records").get("books");
      r.onsuccess = () => resolve(r.result[0]);
    });
  });
  expect(book.seconds).toBeGreaterThanOrEqual(10);
  expect(
    Object.values(book.daily).reduce((a: any, b: any) => a + b, 0),
  ).toBeGreaterThanOrEqual(10);
  expect(book.text).toBeUndefined();
});
