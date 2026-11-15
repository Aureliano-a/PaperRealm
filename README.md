# PaperRealm 纸境

面向 Windows 的离线 TXT 阅读器。React + TypeScript + Vite + Tauri 2 + Rust + SQLite。包含真实细分网格纸页弯曲、个人藏书室、动态书桌、字体与纸张预览、装帧工坊及本地阅读记录。

## 使用成品

交付目录中的 `PaperRealm_1.0.0_x64-setup.exe` 为 Windows x64 NSIS 安装包；`PaperRealm-Windows/paperrealm.exe` 为可直接启动的桌面程序。已有 WebView2 的 Windows 11 可以离线运行。安装包在缺少 WebView2 时会尝试下载微软运行时，因此全新离线电脑需要提前安装 WebView2。

应用不需要账号、API Key 或云端服务。第一次打开为空书库，可导入 TXT，也可自行点击“添加原创体验读本”。体验读本是此项目编写的测试故事，不是预置假数据。

## 运行源码

要求：Windows 10/11 x64、Node.js 22.12+（本次使用 bundled Node）、pnpm 11、Rust stable MSVC、Visual Studio Build Tools 2022 的 C++ 桌面开发工作负载及 Windows SDK、WebView2 Runtime。

```powershell
pnpm install --frozen-lockfile
pnpm desktop        # Tauri 原生开发窗口
pnpm dev            # 仅浏览器开发预览 http://127.0.0.1:1420
pnpm test           # 核心测试
pnpm test:e2e       # 使用本机 Edge 的端到端测试
pnpm bundle         # 生产 NSIS 安装包
```

通用脚本：`scripts/develop.ps1`、`scripts/build.ps1`。`scripts/build-local.ps1` 是本次交付机器的工具链定位脚本，其他机器请使用通用脚本。`pnpm-lock.yaml` 与 `src-tauri/Cargo.lock` 固定本次依赖解析结果。

官方构建前置条件：https://v2.tauri.app/start/prerequisites/

默认安装包输出：`src-tauri/target/release/bundle/nsis/`。本次使用工作区独立的 `CARGO_TARGET_DIR` 构建后复制到交付目录。

## 功能与操作

- 批量选择或拖入 TXT；自动编码检测以及 UTF-8、GBK、GB18030、UTF-16 LE/BE 手动指定。导入后仍可在书籍编辑面板从原始字节副本重新解码。
- 内容 SHA-256 去重，保留书名、作者、分类、标签、收藏、阅读状态、封面和进度。全文检索入口与三种书库视图。
- 双页、单页与虚拟化连续滚动。双页外边缘按住拖动，未达到阈值回弹；点击边缘、底部箭头或键盘左右 / PageUp / PageDown / 空格翻页。
- Three.js 64×20 细分网格弯曲，独立正反面 CanvasTexture、光照、柔影；静态正文为可选择 DOM。WebGL 不可用或关闭动画时仍可阅读。
- 双页纸书宽度受限，窗口小于 1040 CSS px 自动单页。字号和书本大小独立设置。
- 章节、进度、全文搜索、折角书签、选择摘录及批注、全屏与专注模式。阅读位置保存为原文偏移及 48 字上下文。
- OpenCC-JS 本地词典提供原文、简体、通用繁体、台湾繁体、香港繁体；转换不修改原始内容，另存 TXT 从设置操作。
- 四种程序绘制的书桌氛围：午后书房、夜雨窗前、极简墨夜、古典藏书室。书本开合、桌面选书、章节及书签快捷入口、低性能模式、静态或关闭背景。
- 清楷正文 / 雅致字体、系统字体预设、自定义字体导入、六套纸色、自定义纸色文字色、可保存字体预设。
- 装帧实时编辑与自动保存，封面与藏书展示 PNG 导出，阅读时光胶囊 PNG 导出。
- 阅读时长、首次 / 最近阅读时间、访问章节记录、七日图表、摘录与手动故事索引。故事检索严格截止当前原文位置。
- JSON 完整书库与阅读数据导出 / 合并恢复；同 ID 的已有书籍不会被备份覆盖。

完整操作说明见 `用户使用说明.md`；实测范围及限制见 `测试结果.md` 和 `已知问题.md`。

## 数据设计

桌面端数据库：`%APPDATA%/com.paperrealm.reader/paperrealm.sqlite3`。SQLite 使用 WAL 与 `synchronous=FULL`。键值记录包含版本化书库元数据、各书原文内容、原始字节 Base64、副本字体和设置；正文只在导入或重新解码时写入，进度更新只写元数据。源文件从不被修改，删除源文件不影响阅读。

可通过 `PAPERREALM_DATA_DIR` 环境变量设置独立数据目录，用于便携存储或隔离测试。浏览器预览使用 IndexedDB，与桌面数据独立。

原文偏移基于去 BOM / 统一换行后的 JavaScript UTF-16 字符串索引，不是源文件字节索引。简繁转换仅改变显示；转换模式选择摘录时，为避免词组长度变化导致错位，会保留所选完整原文行。SQLite 的书籍记录、书签与文本仍绑定原文。

## 源码结构

```text
src/App.tsx                 应用外壳与书库 / 书桌 / 字体 / 工坊 / 记忆 / 设置页面
src/Reader.tsx              阅读布局、目录、搜索、摘录、原文锚点与阅读时间
src/PageCurl.tsx            Three.js 网格、正反面纹理、拖动与回弹
src/engine.ts               解码、章节识别、分页与位置恢复纯函数
src/pagination.worker.ts    独立 Worker 执行分页
src/store.ts + db.ts        Zustand 状态、串行持久化、SQLite / IndexedDB 桥接
src/conversion.ts           OpenCC-JS 本地转换
src/export.ts               封面、展示图、纪念卡与文件保存
src/types.ts + style.css    共享类型、主题、字体与设计令牌
src-tauri/src/main.rs       Tauri 窗口宿主、SQLite 原生指令
tests/                     核心单元测试与 Edge 端到端测试
scripts/                   构建、字体生成、许可收集、原生烟雾测试
public/fonts/              两个离线 WOFF2 字体
licenses/                  字体 OFL、第三方许可副本及依赖清单
```

## 字体来源和复现

清楷不是原创字库。它基于 **LXGW WenKai / 霞鹜文楷 Regular**，其上游为 Fontworks Klee；均使用 SIL OFL 1.1。正文版对简单字形横向缩放 98%、调整 advance/sidebearing；雅致版横向 96%、增加字距。复合字形保留结构，字重由浏览器合成。两者是有限的排版适配，并非逐字重新设计或专业字体工程验收。

原始版权与保留名称见 `licenses/LXGW-OFL.txt`。派生字体使用 PaperRealm QingKai / PaperRealm QingKai Elegant 名称，不以原字体保留名称命名。上游版权仍保存在字体元数据中。

```powershell
python -m pip install fonttools brotli
# 从上游 release 获取 LXGWWenKai-Regular.ttf 后：
python scripts/build-fonts.py path/to/LXGWWenKai-Regular.ttf
```

上游：https://github.com/lxgw/LxgwWenKai

图标使用 Lucide（ISC）；界面书桌、纹样、图表和封面由本地 CSS / Canvas 程序绘制，没有外部图片素材。完整 npm 与 Cargo 许可清单位于 `licenses/DEPENDENCIES.json`。

内置常用英汉词典基于 ECDICT 的常用词条子集，遵循 MIT 许可，版权声明和修改说明见 `licenses/ECDICT-MIT.txt` 与 `licenses/ECDICT-NOTICE.md`。


## PDF 1.35

PDF 已加入分块读取、画布上限、连续滚动、双页、坐标批注、翻译和连续朗读的代码。具体范围与未完成部分见 [PDF 更新清单](PDF-UPDATE-1.35.md)。依照用户要求未运行测试。


项目代码采用 MIT 许可证。字体、词典和第三方组件保留各自许可证，见 LICENSE 和 licenses/。首次公开版本的纸纹为程序生成的 SVG。
[English documentation](README.en.md)

