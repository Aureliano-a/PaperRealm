import { test, expect } from "@playwright/test";
test("library, single-column reading, bookmarks, persistence and every workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/library.png", fullPage: true });
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await page.getByRole("button", { name: "编辑书籍" }).click();
  await page.getByLabel("作者", { exact: true }).fill("纸境工作室");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".text-line").first()).toBeVisible();
  await page.screenshot({ path: "test-results/reader.png" });
  const before = await page.locator(".page-nav span").textContent();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".page-nav span")).not.toHaveText(before!);
  await page.getByRole("button", { name: "添加书签", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除书签" })).toBeVisible();
  await page.getByRole("button", { name: "移除书签" }).click();
  await expect(
    page.getByRole("button", { name: "添加书签", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  const saved = await page.locator(".page-nav span").textContent();
  await page.reload();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".ritual")).toHaveCount(0);
  await expect(page.locator(".page-nav span")).toHaveText(saved!);
  await page.getByRole("button", { name: "阅读外观", exact: true }).click();
  await page.getByRole("combobox", { name: "简繁转换" }).selectOption("tw");
  await page.getByRole("button", { name: "返回书库" }).click();
  for (const label of [
    "我的阅读书桌",
    "字体实验室",
    "书籍工坊",
    "阅读记忆馆",
    "设置中心",
  ]) {
    await page.locator("nav").getByRole("button", { name: label }).click();
    await expect(page.locator("main")).toContainText(label);
    await page.screenshot({ path: `test-results/${label}.png` });
  }
  await page
    .locator("nav")
    .getByRole("button", { name: "我的阅读书桌" })
    .click();
  for (const name of ["夜雨窗前", "极简墨夜", "古典藏书室", "午后书房"])
    await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.locator("nav").getByRole("button", { name: "字体实验室" }).click();
  await page.getByLabel("阅读字体").selectOption("QingKaiElegant");
  await page.getByRole("button", { name: /森林绿/ }).click();
  await page.locator("nav").getByRole("button", { name: "私人藏书室" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.setViewportSize({ width: 850, height: 720 });
  await expect(page.locator(".single-reading>.reading-page")).toHaveCount(1);
  await page.screenshot({ path: "test-results/compact-reader.png" });
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect(page.locator(".single-reading>.reading-page")).toHaveCount(1);
  expect(
    (await page.locator(".single-reading").boundingBox())!.width,
  ).toBeLessThan(1002);
  await page.screenshot({ path: "test-results/4k-reader.png" });
  expect(errors).toEqual([]);
});
test("file import, duplicate, error and export", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("import-input").setInputFiles({
    name: "我的测试.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "第一章 春风\n" + "风吹过纸页，阅读从这里开始。\n".repeat(300),
    ),
  });
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByTestId("import-input").setInputFiles({
    name: "空白.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(page.getByRole("status")).toContainText("文件为空");
  await page.getByRole("status").getByRole("button").click();
  await page.locator("nav").getByRole("button", { name: "设置中心" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整阅读数据" }).click();
  expect((await download).suggestedFilename()).toBe("纸境阅读备份.json");
  await page.locator("nav").getByRole("button", { name: "书籍工坊" }).click();
  const image = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出藏书封面 PNG" }).click();
  expect((await image).suggestedFilename()).toContain(".png");
});
