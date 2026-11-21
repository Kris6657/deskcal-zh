# DeskCal 中文版

DeskCal 是 Windows 桌面日历，可以同步 Google 日历、iCloud 日历和 iCal 订阅。中文版基于 [Nochiski 的 DeskCal v0.1.3](https://github.com/Nochiski/deskcal/releases/tag/v0.1.3)，提供简体中文界面、托盘菜单、提醒和安装器。

## 安装

1. 在本仓库的 Releases 页面下载 Windows x64 的 `-setup.exe` 安装包。
2. 双击安装包。新安装默认使用 `%LOCALAPPDATA%\Deskcal-zh`，仅为当前 Windows 用户安装。升级早期中文版时，安装器会保留已有安装位置。
3. 从开始菜单打开「DeskCal 中文版」。点击系统托盘图标可显示或隐藏窗口，右键可切换窗口模式、打开设置或退出。

支持 Windows 10 和 Windows 11 x64。中文版使用独立的配置和凭据，可以与上游版并存。

## 连接日历

在「设置」→「账号」中连接。日程的编辑权限取决于所连接的日历。

| 方式 | 用途 | 所需配置 |
| --- | --- | --- |
| Google 日历 | 查看和编辑日程、提醒、回复邀请，支持多个 Google 账号 | 公开安装包未嵌入 OAuth 客户端。先在 Google Cloud 启用 Google Calendar API，创建「桌面应用」类型的 OAuth 客户端，再到「高级设置（OAuth 客户端 ID 和密钥）」填写，随后点击「使用 Google 登录」。 |
| Apple（iCloud）日历 | 查看和编辑日程、提醒 | 使用 Apple ID 和 App 专用密码。可在 Apple 账号的「登录与安全」中生成 App 专用密码。 |
| iCal 订阅 | 用网址订阅只读日历 | 添加 `.ics` 或 `webcal://` 订阅地址。 |

## 常用操作

- 点击月历上方的箭头翻月，点击「今天」回到当月。拖动标题栏空白处可移动窗口。
- 点击「新建日程」，也可双击日期格。点击已有日程查看详情并在允许时编辑。
- Google 邀请可在日程详情中选择「接受」「拒绝」或「待定」。重复日程的回复只针对当前日期。参与者列表受 Google 的可见性设置限制。
- 在「设置」→「日历」中管理各日历的显示、颜色和提醒。在「提醒」中调整默认提醒和全天日程提醒时间。
- 在「设置」→「显示」中可选择「普通窗口」「桌面小组件」或「桌面背景」，也可设置「开机自启」。桌面背景模式仅供查看。
- iCloud 重复日程与 iCal 订阅为只读。当前不支持把日程移到另一份日历，iCal 订阅仅支持常用的重复规则。

## 数据位置

- 设置和日历缓存保存在 `%APPDATA%\com.nochiski.deskcal.zhcn\`。
- 日志保存在 `%LOCALAPPDATA%\com.nochiski.deskcal.zhcn\logs\`。
- Google 刷新令牌和 iCloud App 专用密码保存在 Windows 凭据管理器，使用独立标识 `com.nochiski.deskcal.zhcn`。详见 [隐私说明](PRIVACY.md)。

## 源码与许可

构建步骤见 [从源码构建](docs/BUILDING.md)。原项目版权归 Nochiski 所有，使用、修改和分发须遵循 [PolyForm Noncommercial 1.0.0](LICENSE) 及原版权声明。
