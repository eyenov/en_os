# EnOS

面向个人的英文内容学习工作台。左侧仅保留 **YouTube、播客、图书** 三个内容入口，设置位于底部。无需账号，打开后直接检索、播放或阅读。

前端使用原生 JavaScript ES Modules，后端使用 Node.js HTTP 服务，没有前端构建步骤。本项目需要联网，不是离线课程或考试评分系统。

## 快速开始

使用 **Node.js 24.5 或更新版本**、pnpm，以及现代 Chrome / Edge 浏览器。

```sh
pnpm install --frozen-lockfile
pnpm start
```

尚未安装 pnpm 时，可将命令中的 `pnpm` 替换为 `npx --yes pnpm@10`，无需全局安装。

打开 <http://127.0.0.1:8787>。默认只监听本机；不能通过直接打开 HTML 文件来使用服务端功能。

模型密钥不是播放和阅读的前置条件。没有 YouTube Data API Key 时会尝试网页检索；没有模型密钥时，字幕翻译会尝试 Google 免费接口。视频内问答需要模型密钥。

## YouTube

- 关键词检索、按频道筛选，显示视频预览、时长和字幕状态。
- 在工作台内播放，支持拖动调整播放器与字幕的宽度比例。
- 英文逐词高亮、中文逐字进度，点击句子或单词跳转。
- 优先使用可用的中文字幕，缺失时分批翻译；可导出带时间标记的双语 Markdown。
- 视频下方的 Agent 使用视频与字幕上下文回答问题，不提供独立通用对话页。

![YouTube 播放器与双语字幕](docs/screenshots/video-detail.png)

不是每个视频都有字幕、可嵌入或可在当前地区播放。人工字幕缺少词级时间时，高亮是句内估算；字幕提取也可能受 YouTube 的验证和接口变化影响。

## 播客

内置两个提供 WebVTT 字幕的公开频道：

| 频道 | RSS |
| --- | --- |
| Podnews Daily | <https://podnews.net/rss> |
| Podnews Weekly Review | <https://feeds.buzzsprout.com/1538779.rss> |

- 浏览频道与单集，播放、暂停、跳句、重听当前句及 0.75–2 倍速。
- 动态波形支持定位；字幕按音频时钟更新，并保留源字幕中的停顿和词级时间戳。
- 桌面使用左右双语字幕，手机使用逐句双语排列。
- 标题栏提供单集详情、跟随播放设置、字幕校准和双语 SRT 下载。
- 校准范围为 -3 至 3 秒，正值延后字幕、负值提前字幕，按单集保存在浏览器。

![播客播放器与同步字幕](docs/screenshots/podcast-watch.png)

音频通过同源代理流式传输，支持单段 Range 请求。动态广告、片头差异或蓝牙延迟仍可能需要手动校准；只有句级时间的字幕无法还原真实逐词发音边界。

## 语音跟读

YouTube 和播客播放器的标题栏都提供麦克风入口。字幕准备好后点击开启，从当前词开始练习，不需要模型 API Key。

- **由朗读推进**：英文高亮与中文进度随识别结果更新；读得快慢会影响静音视频的推进，停下来时画面与字幕等待，不按原视频速度自动往前走。
- **原声静音**：视频仅显示画面；播客音频保持暂停，时间轴随朗读定位，避免原声干扰识别。
- **保持当前位置可见**：自动定位当前词，包括长句中后半部分；手机跟读时暂时收起 Agent，保留视频和单列双语字幕。
- **随时调整**：点击字幕或单词重新定位，重读当前句、跳到下一句，或暂停麦克风后继续。控制条显示识别文字、下一词、当前练习段进度和估算练习速度。
- **退出恢复**：结束跟读恢复此前的静音、倍速和播放状态。切换内容、离开页面、完成当前段时关闭识别；切到后台会暂停麦克风，返回后需手动继续。

![视频语音跟读](docs/screenshots/video-shadowing.png)

![播客语音跟读](docs/screenshots/podcast-shadowing.png)

使用支持 `SpeechRecognition` / `webkitSpeechRecognition` 的浏览器，推荐 Chrome / Edge，并允许麦克风权限。必须通过本机 `localhost` / `127.0.0.1` 或 HTTPS 访问；不支持的浏览器会禁用入口。

识别默认使用英语 `en-US`。本应用不录制、保存或上传麦克风音频，识别文字只保留在当前练习内；**浏览器自身的识别服务可能把音频发送到其服务器**，是否联网、可用地区与隐私政策由浏览器决定。服务端代理不会自动代理这条浏览器识别链路。

这是字幕位置匹配，不是发音或口音评分。原生识别有延迟，缩写、数字和附近漏词会尝试对齐，但误识别仍可能让进度停住；可重读或点击目标词重新定位。网络错误会保留静音和进度，允许重连；权限拒绝则退出跟读并恢复音频设置，不自动播放原声。

## 图书

目录来自 [hehonghui/awesome-english-ebooks](https://github.com/hehonghui/awesome-english-ebooks)，目前按 The Economist、The New Yorker、The Atlantic、Wired 四类组织，期数以实时目录为准。

- 按杂志筛选和浏览期刊。
- 有 EPUB 的条目可在工作台内阅读，支持章节目录、上一章和下一章。
- 按源仓库实际提供的格式下载 EPUB、PDF 或 MOBI；PDF / MOBI 不提供在线解析。
- 服务端按需下载 EPUB，提取纯文本章节，不把外部 HTML 或脚本直接嵌入页面。

![图书目录](docs/screenshots/books-library.png)

目录和解析结果使用有期限、有数量上限的服务端内存缓存，重启后失效。首次阅读大文件可能较慢；GitHub 限流、源文件删除、加密或不兼容 EPUB 都可能导致无法打开。

以上截图来自浏览器回归中的固定样例，不代表线上库存或字幕服务的实时可用性。媒体版权属于各自权利人；本项目不打包外刊文件，请确认访问、阅读和下载符合内容授权及当地法律。

## 设置与密钥

底部设置入口可配置模型服务商、API Key、Base URL、模型名称和 YouTube 搜索 Key，并提供连接测试、恢复默认和清空本机数据。

支持 DeepSeek、Kimi / Moonshot、智谱、MiMo 及兼容 OpenAI `/chat/completions` 的自定义服务。默认模型与候选模型不保证适用于每个账号，以服务商实际开放为准。

也可以在启动前设置环境变量，避免把密钥保存到浏览器：

| 服务商 | 密钥变量 | 可选服务端地址变量 |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| Kimi | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |
| 智谱 | `ZHIPU_API_KEY` | `ZHIPU_BASE_URL` |
| MiMo | `MIMO_API_KEY` | `MIMO_BASE_URL` |
| 自定义 | `CUSTOM_API_KEY` | `CUSTOM_BASE_URL` |

环境密钥只能用于对应服务端配置的 Base URL。若使用代理网关，应同时配置该服务商的地址变量；仅在页面更改地址不能转发环境密钥。显式填写的浏览器密钥会发送至所选地址，因此只应使用可信服务。

Base URL 必须使用 HTTPS，本地 `localhost`、`127.0.0.1` 和 `::1` 调试服务允许 HTTP；地址不得含用户名、密码、查询参数或片段。模型请求不跟随重定向。

| 其他变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | 本机服务端口 |
| `HOST` | `127.0.0.1` | 监听地址，建议保持默认 |
| `YOUTUBE_API_KEY` | 未设置 | YouTube Data API v3 搜索密钥 |
| `YOUTUBE_COOKIE` | 未设置 | 可选 YouTube 请求 Cookie，属于敏感信息 |
| `YOUTUBE_PROXY` | 未设置 | Node 出站 HTTP(S) 代理 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 未设置 | 通用出站代理 |
| `NO_PROXY` | 本机地址 | 不走代理的地址，已有设置会保留 |

PowerShell 代理示例：

```powershell
$env:YOUTUBE_PROXY = 'http://127.0.0.1:13480'
pnpm start
```

也可以在根目录创建已被 Git 忽略的 `proxy.config.json`：

```json
{ "proxy": "http://127.0.0.1:13480" }
```

启动器会启用 Node 的 `NODE_USE_ENV_PROXY`。代理作用于服务端出站请求，不会替浏览器的 YouTube iframe、视频或封面设置代理；浏览器仍须能访问相关站点。

## 隐私与安全边界

- 浏览器配置保存在此站点的 `localStorage`，密钥是明文，不应保存在共享设备。清空本机数据不会删除服务端环境变量。
- 模型翻译与问答会把字幕上下文和问题发送到所选模型服务商，可能产生费用。关闭模型开关不等于离线：免费翻译仍可能把字幕发送给 Google。
- YouTube 播放器会直接连接 Google；服务端还会按功能访问 YouTube、Google 翻译、播客发布方和 GitHub。请勿输入不应外发的敏感内容。
- 服务没有账号或远程访问鉴权。Host / 来源校验、限流与 CSP 只是纵深防护，不能替代鉴权；不要直接暴露到公网或不可信局域网。
- JSON 请求只接受对象，最大 2 MiB；静态文件限制在 `public/` 内，并检查真实路径。
- 播客资源及每次重定向均校验受信域名；RSS / VTT 最大 4 MiB。增加新发布方时需同步审查域名和 CSP。
- EPUB 下载最大 64 MiB，单条目解压最大 8 MiB，声明的总展开大小最大 128 MiB，目录最多 4096 条；超限文件拒绝解析。

## 开发与验证

```sh
pnpm dev
pnpm check
pnpm test
pnpm smoke
pnpm smoke:mobile
```

`dev` 使用 Node watch 模式并沿用代理启动配置。`check` 解析保留模块并检查相对依赖和工作台资源，不执行应用；Node 的 VM Modules 实验性提示是预期输出。

单元与服务端测试不依赖真实模型或公开视频。浏览器回归需先启动服务、安装本机 Chrome / Edge，并使用 Node.js 24+；可用 `CHROME_PATH` 指定浏览器、`ENOS_URL` 指定工作台地址。

浏览器回归使用固定视频、音频、图书及模拟语音事件，验证侧栏、设置、字幕同步、波形、下载、跟读静音/语速/滚动、识别恢复和响应式布局，不验证实际人声识别准确率或第三方服务始终可用。截图及检查结果输出到被忽略的 `.shots/`。

图标资源保存在 `public/`。`pnpm icons` 使用本机浏览器从 `icon-mark.png` 重新生成 SVG、PNG 和多尺寸 ICO，保留左上 K 与右下原始曲线的组合。

## 目录结构

```text
public/
  videos.html          工作台唯一应用入口
  404.html             未找到页面
  css/                 基础控件与媒体布局
  js/                  API、设置、字幕同步、语音跟读和工作台控制器
server/                HTTP、模型、YouTube、播客、图书与词级时间处理
scripts/               模块检查、浏览器回归与图标生成
tests/                 当前功能及安全边界回归
docs/screenshots/      当前三类内容的示例截图
```

代码按 [MIT License](LICENSE) 分发；第三方内容与资源遵循各自的授权。