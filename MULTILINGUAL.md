# 多语言和字体说明

在“设置中心 → 界面语言”中选择语言，设置保存到本地。界面语言词条位于 `src/ui-translations.json`，语言清单位于 `src/i18n.ts`；需要新增语言时，增加语言代码和词条，并在 `src/FontOptions.tsx` 添加适用字体分类。

界面文本词条通过机器翻译生成，尚需母语人工校对；部分动态消息和旧功能仍可能显示中文。阿拉伯语界面使用右到左布局，正文根据段落方向显示并按单词分页；复杂双向文本、图形翻页与窄窗口布局尚未完整验证。阿拉伯语正文目前回退为普通翻页。

Noto Naskh Arabic 从 Google Fonts 官方仓库获取，以 SIL OFL 1.1 分发，许可见 `licenses/readest-fonts/NotoNaskhArabic-OFL.txt`。其余字体及许可沿用项目中原有资源。
