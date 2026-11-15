# PaperRealm

[简体中文](README.md)

PaperRealm is an offline-first Windows reader for local TXT, EPUB, and PDF books. TXT reading includes chapter detection, custom typography, paper themes, and bookmarks. The PDF reader offers multiple layouts, library cover detection, annotation browsing, and reading-position recovery. Optional DeepSeek translation requires an API key and sends text to the configured service. Basic reading works offline.

To build on Windows, install Node.js, pnpm, Rust with the MSVC toolchain, the Visual Studio C++ build tools and WebView2. Run `pnpm install --frozen-lockfile` and then `pnpm bundle` to build the NSIS installer. Running `pnpm desktop` opens the development application.

The project code is available under the MIT license in LICENSE. Fonts, dictionary data and bundled dependencies retain the licenses in licenses/.
