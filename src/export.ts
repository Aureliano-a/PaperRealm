import { isTauri } from "@tauri-apps/api/core";
import type { Book } from "./types";
export async function saveFile(name: string, data: Blob | string) {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: "text/plain;charset=utf-8" })
      : data;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return true;
}
export function drawCover(
  ctx: CanvasRenderingContext2D,
  b: Book,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = b.style;
  ctx.fillStyle = s.color;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "#0008");
  g.addColorStop(0.07, "#fff1");
  g.addColorStop(0.12, "#0002");
  g.addColorStop(1, "#0001");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = s.gold ? "#d6bb79" : "#eee4c388";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 20, y + 20, w - 40, h - 40);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 25, y + 25, w - 50, h - 50);
  ctx.clip();
  ctx.globalAlpha = 0.25;
  if (s.pattern === "arches")
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(
        x + w / 2,
        y + h * 0.64,
        30 + i * 20,
        50 + i * 29,
        0,
        Math.PI,
        2 * Math.PI,
      );
      ctx.stroke();
    }
  if (s.pattern === "botanical")
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.ellipse(
        x + w * 0.5 + Math.sin(i) * 20,
        y + h * 0.58 + i * 8,
        9,
        26,
        i % 2 ? -0.7 : 0.7,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  if (s.pattern === "stars")
    for (let i = 0; i < 40; i++)
      ctx.fillRect(
        x + 30 + ((i * 67) % (w - 60)),
        y + 30 + ((i * 93) % (h - 60)),
        2,
        2,
      );
  ctx.restore();
  ctx.fillStyle = s.gold ? "#ead29c" : "#f3ecda";
  ctx.textAlign = "center";
  ctx.font = `${Math.min(36, w / 8)}px "PaperRealm QingKai Elegant",serif`;
  const title = Array.from(b.title);
  if (s.vertical) {
    title
      .slice(0, 12)
      .forEach((c, i) => ctx.fillText(c, x + w / 2, y + 70 + i * 32));
  } else {
    for (let i = 0; i < title.length; i += 8)
      ctx.fillText(
        title.slice(i, i + 8).join(""),
        x + w / 2,
        y + h * 0.25 + (i / 8) * 44,
      );
  }
  ctx.font = '14px "Microsoft YaHei"';
  ctx.fillText(b.author, x + w / 2, y + h * 0.78);
  ctx.font = "10px serif";
  ctx.fillText("P A P E R R E A L M", x + w / 2, y + h - 35);
}
export async function exportArt(b: Book, card = false) {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = card ? 1600 : 800;
  c.height = card ? 1000 : 1120;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ece4d2";
  x.fillRect(0, 0, c.width, c.height);
  drawCover(
    x,
    b,
    card ? 100 : 60,
    card ? 110 : 60,
    card ? 460 : 680,
    card ? 760 : 1000,
  );
  if (card) {
    x.textAlign = "left";
    x.fillStyle = "#4a5145";
    x.font = "22px sans-serif";
    x.fillText("纸境  /  阅读时光胶囊", 660, 180);
    x.font = '50px "PaperRealm QingKai Elegant",serif';
    x.fillText(b.title.slice(0, 18), 660, 290);
    x.font = '24px "PaperRealm QingKai",serif';
    const quote =
      b.marks.find((m) => m.kind === "quote")?.context ||
      "合上书，故事依然留在心里。";
    for (let i = 0; i < Math.min(quote.length, 120); i += 26)
      x.fillText(quote.slice(i, i + 26), 660, 410 + (i / 26) * 44);
    x.font = "20px sans-serif";
    x.fillText(
      `${b.done ? "阅读完成" : "阅读留念"} · ${new Date(b.completedAt || Date.now()).toLocaleDateString("zh-CN")}`,
      660,
      760,
    );
    x.fillText(
      `相伴 ${Math.round(b.seconds / 60)} 分钟 · ${b.visited.length} 个章节`,
      660,
      810,
    );
  }
  await saveFile(
    `${b.title}-${card ? "阅读纪念卡" : "藏书封面"}.png`,
    await new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (v) => (v ? resolve(v) : reject(Error("图片生成失败"))),
        "image/png",
      ),
    ),
  );
}

export async function exportShowcase(b: Book) {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 1200;
  const x = c.getContext("2d")!;
  const bg = x.createLinearGradient(0, 0, 1600, 1200);
  bg.addColorStop(0, "#e8e6d9");
  bg.addColorStop(1, "#bfc7b1");
  x.fillStyle = bg;
  x.fillRect(0, 0, 1600, 1200);
  x.save();
  x.translate(800, 560);
  x.rotate(-0.09);
  x.shadowColor = "#25332355";
  x.shadowBlur = 55;
  x.shadowOffsetX = 28;
  x.shadowOffsetY = 40;
  x.fillStyle = "#e3d9b8";
  x.fillRect(-235, -355, 500 + b.style.thickness, 730);
  x.shadowColor = "transparent";
  x.strokeStyle = "#b5ab8f";
  for (let i = 0; i < 700; i += 5) {
    x.beginPath();
    x.moveTo(260, -340 + i);
    x.lineTo(265 + b.style.thickness, -340 + i);
    x.stroke();
  }
  drawCover(x, b, -260, -370, 520, 740);
  x.restore();
  x.fillStyle = "#536449";
  x.textAlign = "center";
  x.font = '24px "PaperRealm QingKai",serif';
  x.fillText(b.title, 800, 1060);
  x.font = "14px Georgia";
  x.fillText("P A P E R R E A L M   ·   私 人 藏 书", 800, 1110);
  await saveFile(
    b.title + "-藏书展示.png",
    await new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (v) => (v ? resolve(v) : reject(Error("图片生成失败"))),
        "image/png",
      ),
    ),
  );
}
