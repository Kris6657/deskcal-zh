# DeskCal 中文版隐私说明

DeskCal 中文版在用户的 Windows 电脑上运行。日历由 Google、Apple iCloud 或用户添加的 iCal 订阅提供。项目没有数据收集服务，应用不包含广告、使用统计或崩溃上报。

## 数据保存

| 数据 | 本地位置 |
| --- | --- |
| 账号邮箱、iCloud 账号标识和 iCal 订阅网址 | `%APPDATA%\com.nochiski.deskcal.zhcn\accounts.json` |
| 日历列表和日程缓存，包括标题、时间、地点、说明和提醒 | `%APPDATA%\com.nochiski.deskcal.zhcn\cache.json` |
| 应用设置及用户填写的 Google OAuth 客户端配置 | `%APPDATA%\com.nochiski.deskcal.zhcn\settings.json` |
| 窗口位置和大小 | `%APPDATA%\com.nochiski.deskcal.zhcn\window.json` |
| Google 刷新令牌和 iCloud App 专用密码 | Windows 凭据管理器，服务标识为 `com.nochiski.deskcal.zhcn` |
| 运行日志，可能含有日程标题和错误信息 | `%LOCALAPPDATA%\com.nochiski.deskcal.zhcn\logs\` |

## 数据使用

- 连接 Google 日历时，应用通过 Google 登录并连接 Google Calendar API。`openid` 和 `email` 用于识别所连接的账号，`calendar.readonly` 用于读取日历和日程，`calendar.events` 用于同步用户在应用中进行的日程编辑和邀请回复。
- 连接 iCloud 时，应用用 Apple ID 和 App 专用密码连接 Apple 的 CalDAV 服务，并向该服务同步用户的日程编辑。
- 添加 iCal 订阅后，应用会访问所填写的地址下载日历。私密订阅网址应按凭据保管。

## 断开连接和清理

- 在「设置」→「账号」断开连接，可删除该账号在本机保存的令牌或 App 专用密码，并清除该账号的日程缓存。
- 如需移除本地配置和日志，先断开已连接的账号，再卸载应用并清理上面列出的中文版目录。
- Google 账号的服务授权可在 [Google 账号权限页](https://myaccount.google.com/permissions) 撤销。
