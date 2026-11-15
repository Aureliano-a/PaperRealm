import { test, expect } from "@playwright/test";

test("reader colors, comfortable spacing, chapter shortcuts and saved appearance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(page.locator(".text-line").first()).toBeVisible();
  await expect(page.locator(".single-reading>.reading-page")).toHaveCount(1);
  await expect(page.locator(".spine,.curl-layer,.dogear,.ritual")).toHaveCount(
    0,
  );
  expect(
    await page.getByLabel("阅读模式").locator("option").allTextContents(),
  ).toEqual(["单栏分页", "连续阅读"]);
  await expect(page.locator(".text-line").first()).toHaveCSS(
    "letter-spacing",
    "normal",
  );
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.locator(".reader-location")).toContainText("第2章");
  const original = await page
    .locator(".text-line")
    .first()
    .getAttribute("data-offset");
  await page.getByRole("button", { name: "阅读外观", exact: true }).click();
  await page.getByRole("button", { name: "配色：深夜" }).click();
  await expect(page.locator(".reader-modern")).toHaveCSS(
    "background-color",
    "rgb(22, 30, 37)",
  );
  await expect(page.locator(".reading-page")).toHaveCSS(
    "background-color",
    "rgb(32, 42, 51)",
  );
  await expect(page.locator(".text-line").first()).toHaveAttribute(
    "data-offset",
    original!,
  );
  await page.screenshot({ path: "test-results/reader-night-settings.png" });
  await page.getByLabel("界面背景", { exact: true }).fill("#e2e7ec");
  await page.getByLabel("正文底色", { exact: true }).fill("#f3f7fa");
  await page.getByLabel("文字颜色", { exact: true }).fill("#293d4e");
  await expect(page.locator(".reader-modern")).toHaveCSS(
    "background-color",
    "rgb(226, 231, 236)",
  );
  await page.getByLabel("字号", { exact: true }).fill("24");
  await page.getByLabel("字间距", { exact: true }).fill("-0.25");
  await expect(page.locator(".text-line").first()).toHaveCSS(
    "letter-spacing",
    "-0.25px",
  );
  await page.getByRole("button", { name: "恢复舒适排版" }).click();
  await expect(page.getByLabel("字间距", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "添加书签", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "移除书签", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/reader-custom-color.png" });
  await page.reload();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "移除书签", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reader-modern")).toHaveCSS(
    "background-color",
    "rgb(226, 231, 236)",
  );
  await expect(page.locator(".reading-page")).toHaveCSS(
    "color",
    "rgb(41, 61, 78)",
  );
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.locator(".reader-footer")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader-footer")).toBeVisible();
  expect(errors).toEqual([]);
});

test("continuous reading navigates both ways and stays virtualized", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "添加原创体验读本" }).click();
  await page.getByRole("button", { name: "继续阅读", exact: true }).click();
  await page.getByLabel("阅读模式").selectOption("scroll");
  await expect(page.locator(".scroll-pages")).toBeVisible();
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.locator(".reader-location")).toContainText("第2章");
  const before = await page.locator(".page-nav span").textContent();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".page-nav span")).not.toHaveText(before!);
  await page.locator(".reading-stage").hover();
  await page.mouse.wheel(0, 1800);
  await expect
    .poll(() => page.locator(".reading-stage").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(1800);
  expect(await page.locator(".reading-page").count()).toBeLessThanOrEqual(8);
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.locator(".reader-panel>button").first().click();
  await expect
    .poll(() => page.locator(".reading-stage").evaluate((e) => e.scrollTop))
    .toBeLessThan(30);
  await page.locator(".reader-panel>button").first().click();
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.locator(".reading-stage").hover();
  await page.mouse.wheel(0, 1000);
  await expect(page.locator(".page-nav span")).not.toHaveText(/^1 \/ /);
});
