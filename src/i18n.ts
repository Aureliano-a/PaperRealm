import translations from './ui-translations.json';

export const uiLanguages = [
  ['zh-CN', '简体中文'], ['en', 'English · 英语'], ['ja', '日本語 · 日语'],
  ['es', 'Español · 西班牙语'], ['ru', 'Русский · 俄语'],
] as const;
let activeLanguage = 'zh-CN';
export function setLanguage(value: string) {
  activeLanguage = uiLanguages.some(([code]) => code === value) ? value : 'zh-CN';
}
export function tr(source: string): string {
  return (translations as Record<string, Record<string, string>>)[activeLanguage]?.[source] || source;
}
export function trFormat(source: string, ...values: unknown[]): string {
  return tr(source).replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''));
}
