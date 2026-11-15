import { useEffect, useState } from "react";
import { fonts } from "./types";

const candidates = [
  { key: "localMiSans", local: "MiSans", label: "MiSans · 系统字体" },
  { key: "localHuiwen", local: "Huiwen-MinchoGBK", label: "汇文明朝体 · 系统字体" },
  { key: "localKingHwa", local: "KingHwa_OldSong", label: "京华老宋体 · 系统字体" },
  { key: "localFangSong", local: "FangSong", label: "仿宋 · 系统字体" },
  { key: "localKaiTi", local: "KaiTi", label: "楷体 · 系统字体" },
  { key: "localSimHei", local: "SimHei", label: "黑体 · 系统字体" },
];
let loadPromise: Promise<void> | undefined;
function loadAvailable() {
  return (loadPromise ??= Promise.all(candidates.map(async (item) => {
    try {
      const face = new FontFace(`PaperRealm ${item.key}`, `local("${item.local}")`);
      await face.load();
      document.fonts.add(face);
      fonts[item.key] = { name: item.label, css: `"PaperRealm ${item.key}", "PaperRealm QingKai", serif` };
    } catch { /* A missing optional system font is not listed. */ }
  })).then(() => {}));
}
export function useLocalReadestFonts() {
  const [, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    void loadAvailable().then(() => { if (active) refresh(v => v + 1); });
    return () => { active = false; };
  }, []);
}
