# 从源码构建 DeskCal 中文版

## 环境

- Windows 10 或 Windows 11 x64，已安装 Microsoft Edge WebView2。
- Node.js 22.12 或更高版本。锁文件中的 Vite 也支持 Node.js 20.19 及以上的 20.x 版本。
- Rust 稳定版，目标为 `x86_64-pc-windows-msvc`。安装 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载和 Windows SDK。

[Tauri 的 Windows 构建环境说明](https://v2.tauri.app/start/prerequisites/)

## 开发与测试

在仓库根目录打开 PowerShell。

```powershell
npm.cmd ci
npm.cmd run dev
```

`npm.cmd run dev` 使用模拟数据在浏览器预览界面。需要启动桌面应用时，使用 `npm.cmd run tauri -- dev`。

```powershell
npm.cmd run build
cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
```

## 打包

公开版使用各自的 Google OAuth 客户端。在构建公开安装包前，确认仓库根目录和 `src-tauri` 目录均无含凭据的 `.env`，构建进程未设置 `DESKCAL_GOOGLE_CLIENT_ID` 或 `DESKCAL_GOOGLE_CLIENT_SECRET`。该项目会把这些值嵌进主程序。

发布时可在同一个 PowerShell 窗口设置下面的路径映射，移除 Rust 产物中的本机源码和依赖缓存绝对路径。编译后仍应解包检查实际发布的主程序。

```powershell
$repoPath = (Get-Location).Path
$cargoPath = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
$pathFlags = @(
    '--remap-path-prefix'
    "$repoPath=/deskcal"
    '--remap-path-prefix'
    "$($repoPath.Replace('\', '/'))=/deskcal"
    '--remap-path-prefix'
    "$cargoPath=/cargo"
    '--remap-path-prefix'
    "$($cargoPath.Replace('\', '/'))=/cargo"
)
$env:CARGO_ENCODED_RUSTFLAGS = $pathFlags -join [char]31
```

[Cargo 环境变量](https://doc.rust-lang.org/cargo/reference/environment-variables.html) · [Rust 路径映射](https://doc.rust-lang.org/rustc/remap-source-paths.html)

```powershell
npm.cmd ci
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis --no-sign --ci -- --locked
```

安装包生成在 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。Tauri 首次打包会获取 NSIS 和配套组件。中文版的 NSIS 模板位于 `src-tauri/nsis/`，用于设置新安装的默认目录 `%LOCALAPPDATA%\Deskcal-zh`。

GitHub Actions 的 CI 流程用于检查前端和 Rust 构建。发布安装包时，手动创建 GitHub Release 并附上安装包、SHA-256 和原 [LICENSE](../LICENSE) 中的版权及许可声明。
