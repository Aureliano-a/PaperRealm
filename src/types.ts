export type Chapter = { title: string; offset: number };
export type Mark = {
  id: string;
  offset: number;
  context: string;
  note: string;
  created: number;
  kind: "bookmark" | "quote";
  color?: string;
  style?: "highlight" | "underline";
};
export type Style = {
  color: string;
  pattern: "arches" | "botanical" | "stars" | "plain";
  material: "cloth" | "leather" | "paper";
  gold: boolean;
  vertical: boolean;
  thickness: number;
  paperTexture: number;
};
export type Trail = {
  id: string;
  name: string;
  type: "人物" | "地点" | "关系";
  note: string;
  offset: number;
};
export type Book = {
  pdfSettings?: Partial<import('./pdfTypes').PdfSettings>;
  pdfPosition?: import('./pdfTypes').PdfPosition;
  pdfNotes?: import('./pdfTypes').PdfNote[];
  documentPageCount?: number;
  format?: "txt" | "epub" | "pdf";
  coverImage?: string;
  pdfCover?: { source: "auto" | "manual"; page: number } | { source: "generated" };
  documentLocation?: string;
  documentScale?: number;
  documentFit?: 'manual' | 'width' | 'page';
  documentRotation?: number;
  documentFontSize?: number;
  documentBookmarks?: { location: string; label: string; position?: import('./pdfTypes').PdfPosition }[];
  documentNotes?: { id:string; location:string; text:string; note:string }[];
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string;
  favorite: boolean;
  text: string;
  encoding: string;
  fileName: string;
  created: number;
  firstOpened?: number;
  lastRead?: number;
  completedAt?: number;
  offset: number;
  context: string;
  seconds: number;
  done: boolean;
  chapters: Chapter[];
  visited: number[];
  marks: Mark[];
  trail: Trail[];
  style: Style;
  daily: Record<string, number>;
  readingPrefs?: Partial<Prefs>;
  translationTarget?: string;
  narrationVoice?: string;
  narrationRate?: number;
};
export type Prefs = {
  uiLanguage: string;
  readerBrightness: number;
  readingVersion: number;
  readerBackground: string;
  customFontRevision?: number;
  font: string;
  size: number;
  weight: number;
  lineHeight: number;
  spacing: number;
  paragraph: number;
  punctuation: "original" | "full";
  theme: string;
  customPaper: string;
  customInk: string;
  mode: "single" | "scroll";
  columnsOnWide: boolean;
  referenceLayoutVersion?: number;
  paperBackground: "plain" | "soft" | "vintage";
  paperBackgroundMotion: boolean;
  simulatedFlip: boolean;
  conversion: "original" | "cn" | "t" | "tw" | "hk";
  scene: string;
  ambience: "dynamic" | "static" | "off";
  lowPower: boolean;
  sound: boolean;
  ambientSound: boolean;
  animation: boolean;
  bookSize: number;
  textHeightPercent: number;
  deskBook?: string;
  presets: { name: string; values: Partial<Prefs> }[];
};
export type Line = {
  direction?: "rtl" | "ltr";
  text: string;
  start: number;
  end: number;
  title: boolean;
  indent: boolean;
  y: number;
};
export type Page = { start: number; end: number; lines: Line[] };
export type Layout = {
  width: number;
  height: number;
  size: number;
  lineHeight: number;
  spacing: number;
  paragraph: number;
};
export const defaultStyle: Style = {
  color: "#355449",
  pattern: "botanical",
  material: "cloth",
  gold: true,
  vertical: false,
  thickness: 18,
  paperTexture: 0.2,
};
export const defaults: Prefs = {
  uiLanguage: "zh-CN",
  readerBrightness: 100,
  readingVersion: 2,
  readerBackground: "#8b765b",
  font: "QingKai",
  size: 20,
  weight: 400,
  lineHeight: 1.8,
  spacing: 0,
  paragraph: 12,
  punctuation: "original",
  theme: "custom",
  customPaper: "#8b765b",
  customInk: "#ffdaa4",
  mode: "single",
  columnsOnWide: true,
  paperBackground: "plain",
  paperBackgroundMotion: true,
  simulatedFlip: true,
  conversion: "original",
  scene: "afternoon",
  ambience: "dynamic",
  lowPower: false,
  sound: false,
  ambientSound: false,
  animation: true,
  bookSize: 100,
  textHeightPercent: 100,
  presets: [],
};
export const themes: Record<
  string,
  { name: string; paper: string; ink: string; edge: string }
> = {
  parchment: {
    name: "羊皮纸",
    paper: "#e7d7b4",
    ink: "#463b2b",
    edge: "#99815d",
  },
  ivory: {
    name: "米白护眼",
    paper: "#f4efdf",
    ink: "#393c32",
    edge: "#b4a889",
  },
  forest: { name: "森林绿", paper: "#d9e3cf", ink: "#2f483c", edge: "#7c9273" },
  mist: { name: "雾蓝灰", paper: "#dce4e6", ink: "#33464e", edge: "#81979b" },
  sakura: { name: "樱花粉", paper: "#f2e1dd", ink: "#614849", edge: "#b89491" },
  night: { name: "墨夜黑", paper: "#282e2b", ink: "#c6c7b6", edge: "#111714" },
};
export const fonts: Record<string, { name: string; css: string }> = {
  readestWenKaiScreen: { name: "霞鹜文楷 · 屏幕版", css: '"PaperRealm WenKaiScreen", "PaperRealm QingKai", serif' },
  readestBitter: { name: "Bitter · 英文衬线", css: '"PaperRealm readestBitter", "PaperRealm QingKai", serif' },
  readestFiraCode: { name: "Fira Code · 英文等宽", css: '"PaperRealm readestFiraCode", "PaperRealm QingKai", monospace' },
  readestLiterata: { name: "Literata · 英文阅读衬线", css: '"PaperRealm readestLiterata", "PaperRealm QingKai", serif' },
  readestMerriweather: { name: "Merriweather · 英文阅读衬线", css: '"PaperRealm readestMerriweather", "PaperRealm QingKai", serif' },
  readestNotoSans: { name: "Noto Sans · 英文无衬线", css: '"PaperRealm readestNotoSans", "PaperRealm QingKai", sans-serif' },
  readestOpenSans: { name: "Open Sans · 英文无衬线", css: '"PaperRealm readestOpenSans", "PaperRealm QingKai", sans-serif' },
  readestRoboto: { name: "Roboto · 英文无衬线", css: '"PaperRealm readestRoboto", "PaperRealm QingKai", sans-serif' },
  readestRobotoSlab: { name: "Roboto Slab · 英文粗衬线", css: '"PaperRealm readestRobotoSlab", "PaperRealm QingKai", serif' },
  readestVollkorn: { name: "Vollkorn · 英文衬线", css: '"PaperRealm readestVollkorn", "PaperRealm QingKai", serif' },
  readestPTSans: { name: "PT Sans · 英文无衬线", css: '"PaperRealm readestPTSans", "PaperRealm QingKai", sans-serif' },
  readestPTSerif: { name: "PT Serif · 英文衬线", css: '"PaperRealm readestPTSerif", "PaperRealm QingKai", serif' },
  readestPTMono: { name: "PT Mono · 英文等宽", css: '"PaperRealm readestPTMono", "PaperRealm QingKai", monospace' },
  readestNotoSC: { name: "Noto Sans SC · 简体", css: '"PaperRealm readestNotoSC", "PaperRealm QingKai", sans-serif' },
  readestNotoJP: { name: "Noto Serif JP · 日文", css: '"PaperRealm readestNotoJP", "PaperRealm QingKai", serif' },
  readestSourceHan: { name: "思源宋体 · 简体", css: '"PaperRealm readestSourceHan", "PaperRealm QingKai", serif' },
  QingKai: { name: "清楷 · 正文", css: '"PaperRealm QingKai", serif' },
  QingKaiElegant: {
    name: "清楷 · 雅致",
    css: '"PaperRealm QingKai Elegant", serif',
  },
  song: { name: "雅宋", css: '"SimSun",serif' },
  sans: { name: "静黑", css: '"Microsoft YaHei",sans-serif' },
  soft: { name: "柔光", css: '"PaperRealm QingKai",serif' },
  night: { name: "夜读", css: '"Microsoft YaHei",sans-serif' },
  system: { name: "系统字体", css: "system-ui,sans-serif" },
  custom: { name: "自定义导入", css: '"UserFont",serif' },
};
