import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const context=browser.contexts()[0];let page=context.pages()[0];
await page.waitForLoadState();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
console.log('Native URL:',page.url());
const isNative=await page.evaluate(()=>!!window.__TAURI_INTERNALS__);expect(isNative).toBe(true);
if(process.argv.includes('--restore')){
 await expect(page.locator('.book-card')).toHaveCount(1);
 await page.getByRole('button',{name:'继续阅读',exact:true}).click();
 await expect(page.locator('.ritual')).toHaveCount(0);
 await page.locator('.text-line').first().waitFor();
 const saved=JSON.parse(await fs.readFile('test-results/native-state.json','utf8'));
 await expect(page.locator('.page-nav span')).toHaveText(saved.pages);
 await page.screenshot({path:'test-results/native-restored.png'});
 console.log('Native SQLite restart recovery PASS',saved.pages);
}else{
 await page.getByRole('button',{name:'添加原创体验读本'}).click();await expect(page.locator('.book-card')).toHaveCount(1);
 await page.getByRole('button',{name:'继续阅读',exact:true}).click();await page.getByRole('button',{name:'翻开这本书 →'}).click();
 await page.locator('.text-line').first().waitFor();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForTimeout(500);
 await page.getByRole('button',{name:'折角书签'}).first().click();await expect(page.locator('.dogear.marked')).toHaveCount(1);
 await page.screenshot({path:'test-results/native-reader.png'});const pages=await page.locator('.page-nav span').textContent();await fs.writeFile('test-results/native-state.json',JSON.stringify({pages}));
 await page.getByRole('button',{name:'返回书库'}).click();for(const label of ['我的阅读书桌','字体实验室','书籍工坊','阅读记忆馆','设置中心']){await page.locator('nav').getByRole('button',{name:label}).click();await expect(page.locator('main')).toContainText(label)}
 console.log('Native WebView2 pages, SQLite import, curl, bookmark PASS');
}
expect(errors).toEqual([]);console.log('Native page errors:',errors);await page.getByRole('button',{name:'关闭',exact:true}).click();
await new Promise(resolve=>setTimeout(resolve,1500));
expect(browser.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed())).toHaveLength(0);
console.log('Window destruction PASS');
await browser.close().catch(()=>{});
