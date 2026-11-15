import { defaults, type Prefs } from "./types";

export const readingPalettes = [
  { name: "棕金羊皮", background: "#8b765b", paper: "#8b765b", ink: "#ffdaa4" },
  { name: "暖杏", background: "#eeeae3", paper: "#faf7f0", ink: "#383b35" },
  { name: "云白", background: "#edf0f2", paper: "#ffffff", ink: "#303a43" },
  { name: "豆青", background: "#dbe4d8", paper: "#eef3e9", ink: "#344536" },
  { name: "雾蓝", background: "#dce4ea", paper: "#eff4f7", ink: "#334655" },
  { name: "暮粉", background: "#e9dddd", paper: "#faf0ec", ink: "#554141" },
  { name: "深夜", background: "#161e25", paper: "#202a33", ink: "#c5cdd2" },
];

export function normalizePrefs(
  value?: Omit<Partial<Prefs>, "mode"> & { mode?: string },
): Prefs {
  const old = value && value.readingVersion !== 2;
  const prefs = { ...defaults, ...value };
  return {
    ...prefs,
    uiLanguage: ["zh-CN", "en", "ja", "es", "ru"].includes(prefs.uiLanguage) ? prefs.uiLanguage : "zh-CN",
    font: ["readestWenKaiTC", "readestNotoTC", "readestGuanKiap", "notoNaskhArabic"].includes(prefs.font) ? "QingKai" : prefs.font,
    readingVersion: 2,
    readerBrightness: Number.isFinite(prefs.readerBrightness) ? Math.max(30, Math.min(100, prefs.readerBrightness)) : 100,
    paperBackground: prefs.paperBackground === "soft" || prefs.paperBackground === "vintage" ? prefs.paperBackground : "plain",
    paperBackgroundMotion: prefs.paperBackgroundMotion !== false,
    textHeightPercent: Number.isFinite(prefs.textHeightPercent) ? Math.max(50, Math.min(100, prefs.textHeightPercent)) : 100,
    mode: prefs.mode === "scroll" ? "scroll" : "single",
    spacing: old ? 0 : Math.max(-0.5, Math.min(2, prefs.spacing)),
    readerBackground: /^#[0-9a-f]{6}$/i.test(prefs.readerBackground)
      ? prefs.readerBackground
      : defaults.readerBackground,
    presets: (prefs.presets || []).map((preset) => ({
      ...preset,
      values: {
        ...preset.values,
        mode: preset.values.mode === "scroll" ? "scroll" : "single",
        ...(old ? { spacing: 0, readingVersion: 2 } : {}),
      },
    })),
  };
}

export function isDark(color: string): boolean {
  const rgb = color.replace("#", "");
  return (
    parseInt(rgb.slice(0, 2), 16) * 0.2126 +
      parseInt(rgb.slice(2, 4), 16) * 0.7152 +
      parseInt(rgb.slice(4, 6), 16) * 0.0722 <
    140
  );
}

export function readerWidth(viewport: number, scale: number): number {
  return Math.floor(
    Math.max(
      280,
      Math.min(
        viewport - (viewport < 900 ? 56 : 144),
        (800 * scale) / 100,
        1000,
      ),
    ),
  );
}
