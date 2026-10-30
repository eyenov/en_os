# EnOS 设计说明

这份文档记录实现层面的取舍，方便继续迭代。产品使用说明见 [README](../README.md)。

---

## 1. 目标与非目标

**目标**

- 把任意一段英文转成 8 个可完成的雅思微任务，每一步 ≤ 5 分钟；
- 每一步都有「点击 + 语音」两条交互路径；
- 通关判定可量化、可解释、可复现；
- 没有 API Key 也能完整使用；
- 一份可打印的独立报告。

**非目标**

- 不做账号、班级、教师端；
- 不做完整的雅思模考或官方评分；
- 不训练语音模型，不做音素级评分；
- 不做公网多租户服务（默认只绑定本机）。

---

## 2. 状态机

```
┌─────────┐  开始   ┌──────────────┐  第 1 步  ┌─────────────┐
│  home   │ ──────▶ │   session    │ ────────▶ │  step n (0-7)│
└─────────┘         │ currentIndex │           └──────┬──────┘
     ▲              └──────────────┘                  │ 达标 + 下一步
     │                     │                          ▼
     │ 保存退出            │ 第 8 步完成         ┌─────────────┐
     └─────────────────────┘ ──────────────────▶ │ report.html │
                                                  └─────────────┘
```

会话对象（localStorage `enos.session.current.v1`）：

```js
{
  id, version, createdAt, updatedAt, mode, sceneId, band,
  input:   { text, words, sentences, sourceLabel },
  analysis:{ targetWords, grammar, points, stats, ... },
  words:   [8 × entry],
  steps:   [8 × step | null],
  results: { [index]: { completed, score, checks, evidence, timeSpent, source } },
  currentIndex,
  targets: { steps, minutes, vocabExposures, grammarExposures, listeningAccuracy, ... },
  summary, status
}
```

步骤在 **首次进入时** 才生成（`buildLocalStep`），随后如果 AI 开启，异步请求改写；这样「下一步」既天然承接已学内容，也不会因为预生成 8 步而阻塞首屏。

---

## 3. 步骤生成契约

`STEP_SPECS` 固定 8 条，每条：

```js
{ key, module, kind, title, focus, minutes, difficulty }
```

`kind` 决定渲染器、payload 形状与 rubric。所有 payload 共享两个字段：

- `instruction`：给学习者的一句任务说明；
- `hint` / `tip`：提示按钮内容。

校验函数 `applyAIStep(step, candidate)`：

1. 候选必须包含 kind 对应的必填字段；
2. 字符串字段非空、数组字段长度与类型正确；
3. `options` 必须 4 个唯一项，`answerIndex ∈ [0,3]`；
4. `audioText` / `sentence` / `passage` 必须包含目标词（防止模型跑题）；
5. 通过后逐字段覆盖，否则整体回退到本地版本。

**提示词策略**：把本地 payload 当作模板，要求模型「保持相同的键和类型」，只改写内容。这比从零生成 schema 更稳定，也让本地与 AI 两条路径共用同一套渲染器。

---

## 4. 评分与通关

rubric 项的类型与归一化：

| 类型 | 达标条件 | 得分比例 |
| --- | --- | --- |
| `bool` | 真 | 1 / 0 |
| `ratio` | `actual ≥ target` | `min(actual/target, 1)` |
| `count` | `actual ≥ target` | `min(actual/target, 1)` |
| `range` | `min ≤ actual ≤ max` | 区间内 1，否则按缺口衰减 |
| `band` | `actual ≥ target` | `clamp((actual-4.5)/3.5)` |

```
completed = every(item.met)
score     = 100 × Σ(wᵢ·ratioᵢ) / Σwᵢ
```

报告里的 `overall` 是 **已完成步骤得分的平均**，`band = roundHalf(4.5 + overall/100×3.5)`。写作 Band 与听力/阅读正确率进入 achievements 表，但不会重复加权到 overall，避免「同一件事算两次」。

**为什么不用总分直接判定通关**：总分会被容易的任务抬高，掩盖某个卡点。逐项通关能保证「听写没到 80% 就不能走」，更符合练习而非考试的场景。

---

## 5. 本地引擎如何生成可用的内容

不依赖模型时，质量来自三件事：

1. **100 条人工撰写的核心词句**：每条都保证例句包含目标词原形，带有搭配、同义词、词族；
2. **确定性模板**：听力挖空、听写词块、同义替换选项、判断题改写都由词条数据 + 种子随机生成；
3. **场景包**：场景提供设定、人物、道具与主题词，用于提示、对话、写作任务和插图。

`shuffle` 使用 `mulberry32(hash(sessionId + index))`，同一会话同一题在刷新前保持稳定，测试也可复现。

`read_inference` 采用 TRUE / FALSE / NOT GIVEN 形式：一半用同义替换改写（TRUE），一半加否定（FALSE），NOT GIVEN 作为干扰项。这比「编一个推理题」更接近真实雅思阅读，也避免本地生成不自然的选项。

---

## 6. AI 失败矩阵

| 调用 | 超时 | 失败处理 | 用户可见 |
| --- | --- | --- | --- |
| 单步改写 | 90s | 保留本地，标「本地初稿」 | 静默 |
| 陪练流 | 180s | 切脚本化回复 | Toast |
| 跟读反馈 | 90s | 仅本地逐词 | 静默 |
| 写作评分 | 90s | 保留本地 Band | Toast |
| 报告叙事 | 90s | 删除叙事卡片 | 静默 |
| 听力对话生成 | 90s | 用本地模板对话 | Toast + 徽标 |
| 单词释义 | 90s | 本课词 / 核心词 / 基础词，未收录则提示 | 浮层内提示 |
| 搜索整理（仅截取失败时） | 90s | 用检索摘要拼接 | 警告 |
| 原文抓取 | 12s/页 | 换下一条结果 | 警告 |
| 搜索本身 | 8–25s | 维基 → DDG → 模型 → 报错 | 明确错误 |

原则：**AI 永远不能阻塞学习**。任何非关键路径失败都退回本地，并保留用户已输入的内容。

---

## 7. 搜索

```
中文话题 ──有 Key──▶ 英文检索词
                          │
native ──fail──▶ Wikipedia ──fail──▶ DuckDuckGo
   └────────────── items ───────────────┘
                          │
          抓取前 3 条网页正文（article / main / <p>）
                          │
              句子边界截取 150–220 词英文
                          ▼
              excerpt（mode=excerpt，原文）
                          │ 全部失败
                  ┌───────┴────────┐
              有 Key            无 Key
        模型整理 rewrite     摘要拼接 snippets
```

- 原文优先：只有截取失败才让模型介入，UI 明确标注「AI 整理（非原文）」或「摘要拼接（非原文）」；
- 中文话题需要 Key 才会转成英文检索词，否则按原词检索，通常拿不到英文原文；
- 完全失败且没有 Key：`SEARCH_UNAVAILABLE`，提示直接粘贴；检索无结果但有 Key：模型生成泛读，`degraded: true`；
- 抓取只接受 http/https，拒绝内网地址；正文上限 1.5 MB，单页 12 秒超时，不执行页面脚本。

截取长度 150–220 词，按英文句号 / 问号 / 叹号收尾，正好够一次精读与 8 步拆解，也不会把半句话塞进学习任务。

---

## 8. 听力实验室

独立于 8 步主流程，路由 `#/listening`，目标是「底子差也能先听懂一句」。

### 阶段

| 阶段 | 行为 | 交互 |
| --- | --- | --- |
| 预读 | 全文 EN + ZH；每句一个结构开关 | 点句播放、展开成分图 |
| 慢速讲解 | 0.7× 逐句朗读，自动展开当前句成分与关键词 | 上一句 / 下一句、自动连播 |
| 盲听 | 0.95× 连播，默认隐藏文本 | 暂停 / 跳句 / 随机；播完自动进入精听 |
| 精听回放 | 逐句重听 | 0.7×、显示中文、随机一句 |
| 结果 | 全文 + 对照翻译 + 统计 | 复制 / 打印 / 再练 |

### 数据契约

```json
{"title":"...","lines":[{"speaker":"A","text":"...","zh":"...","structure":"...",
  "chunks":[{"text":"...","role":"主语"}],
  "words":[{"term":"...","pos":"n.","zh":"...","gloss":"...","usage":"..."}],
  "grammar":"..."}]}
```

- 10–12 句、每句一句、总 200–280 词；
- 生成提示词只包含用户话题与目标 Band，**不注入首页场景**；首句自然点明话题，并禁止新增无关地点、时间、人物或主观评价；
- 对话按真实交流写：说话人有符合话题的角色，有追问、短反应与缩写；短句（如 "Really?"）允许 1 个词，单轮也可包含一到两句短句；
- `parseDialogue` 校验：8–14 句、正文必须是英文、`zh` 必须含中文，不合格的行直接丢弃；
- `chunks` 是 2–4 段连续原文，角色限定在 主语 / 谓语 / 宾语 / 表语 / 定语 / 状语 / 补语 / 从句 / 连接词 / 意群；模型给的片段不是原句子串时，`resolveChunks()` 回退到逗号切分的意群，保证不吞标点；
- `words` 支持单词、词组与搭配，`gloss` 是英文语义，`usage` 是英文使用场景 / 搭配，`zh` 是中文；
- 不合格或没有 Key → `localDialogue()` 本地模板，UI 标注「本地模板」；本地模板与 AI 使用同一套字段。

### 结构标注

- 每句一个「句子结构 / 收起结构」按钮；预读默认收起，慢速进入时自动展开当前句，精听默认收起可逐句打开；
- 展开后用彩色下划线与成分标签呈现 `chunks`，颜色按角色固定（蓝主语、绿谓语、琥珀宾语、靛从句等）；
- 详情区展示整句结构说明、语法点，以及每个关键词的英文语义 / 使用场景与中文翻译；
- 盲听阶段不显示任何文本与标注。

### 语音控制

独立解析器 `parseListeningCommand`，不改变 8 步的 `parseCommand`。支持播放 / 暂停 / 停止、上一句 / 下一句、第 N 句、随机一句、慢速 / 正常语速、显示 / 隐藏文本、生成结果。点麦克风时先暂停音频，避免 TTS 被识别成指令。

### 播放模型

- 每个对话轮次是一条播放单位（生成时允许一轮 1–2 个短句），`speechSynthesis` 的 `rate` 为 0.68 / 0.95；不强制指定 `voice`，使用浏览器默认英文音色，避免某些 SAPI / 在线音色被选中后无声；
- **词级同步**：默认 **逐词模式** —— `speakWords()` 把每个词作为独立 utterance 入队，`onstart` 一响就高亮对应词，因此高亮与声音严格同步，代价是发音被切成单词。播放器可切换「整句」：整句自然朗读，只使用 `boundary` 事件做词级同步，且只认 `name=word` 的边界；句级/无边界时只保留整句高亮，不估算、不猜词。`cancel()` 后强制 `resume()`，避免 Chrome 暂停状态导致下一次无声。
- 盲听自动连播，句间停顿 420ms；
- 状态（对话、阶段、当前句、统计）存在 `enos.listening.current.v1`，结果存在 `enos.listening.sessions.v1`（最多 8 份）。

---

## 9. 鼠标取词

- 顶部开关，默认开启，状态存 `settings.lookup`；
- 事件委托在 `#app`：`pointermove` 防抖 260ms → `caretRangeFromPoint` 找到文本节点 → 左右扩展到英文词；
- 输入框、下拉框、`data-no-lookup` 区域与触屏设备跳过；
- 命中顺序：听力本课 `words`（带英文语义与用法）→ `data/core100.json` → 内置功能词表 → `/api/word`（AI，需 Key）→ 未收录提示；
- 浮层展示词性 / 音标、中文、英文语义、用法、例句、TTS 朗读与来源；
- AI 词条缓存到 `enos.lookup.cache.v1`，服务端另有 600 条内存缓存；
- 隐私：只有本地词库找不到且配置了 Key 时，才把单词发给所选服务商。

---

## 10. 前端结构

- **无框架**：`h()` 生成 DOM，视图函数返回 `{ el, cleanup }`，路由切换时调用 cleanup 释放定时器、麦克风、朗读；
- **状态**：`store.js` 封装 localStorage，写入失败时回退到内存 Map；
- **语音**：`speech.js` 封装 TTS 队列、暂停/恢复与 `Listener`，统一错误文案；8 步与听力各有一个指令解析器；
- **听力实验室**：`views/listening.js` 管阶段、播放与结果；`dialogue.js` 是纯函数（提示词、校验、本地模板、结果文本），可直接单测；
- **取词**：`lookup.js` 独立管理光标取词、词表命中、AI 兜底与浮层，视图无需给文本加标记；
- **插图**：`art.js` 用 8 个场景的 SVG 构造器 + 种子微调，CSS 只负责浮动动画；
- **可访问性**：按钮语义、`aria-label`、数字键 1–4 选项、`aria-live` 反馈、跳过导航、焦点样式。

### 计时

`setInterval` 每秒累加，但只在 `document.visibilityState === 'visible'` 时计时；单步进入时重置为 5:00，超时显示 `+mm:ss` 并记录，不阻塞通关。

### 报告渲染

报告页是独立 HTML，不复用 SPA 路由。数据来自 `localStorage`；旧的会话若没有 `summary`，会用 `summarizeSession` 现算。AI 叙事异步追加，不阻塞首屏。

---

## 11. 安全模型

| 风险 | 措施 |
| --- | --- |
| Key 泄漏到第三方 | Key 只发给本机 `/api`，由本机转发；无第三方 SDK、无遥测 |
| Key 落盘/日志 | 服务端不持久化、不打印请求体 |
| 跨站调用本机 API | 校验 `Origin` 与 `Host` 一致；CSP `connect-src 'self'` |
| 路径穿越 | 静态路径 resolve 后必须位于 `public/` 或 `data/` |
| XSS | 用户内容全部走 `textContent`；`innerHTML` 只用于内置图标与场景 SVG |
| 资源滥用 | 2 MB body、240 req/min/IP、上游超时 |
| 查词外发 | 本地词库命中不外发；只有未命中且配置 Key 时才向所选服务商发送单个单词 |
| 公网暴露 | 默认 `127.0.0.1`；README 明确不建议公网 |

---

## 12. 测试策略

- **纯函数**：引擎、评分、指令解析、听力对话校验、取词分词不依赖 DOM，可直接在 Node 跑；
- **契约测试**：对 8 种 kind 检查必填字段、选项合法性、答案范围；
- **阈值测试**：0.79 / 0.80、Band 5.5 / 6.0 等边界；
- **服务端集成**：自建 mock provider，覆盖非流式、SSE、错误码、搜索、静态安全；
- **浏览器端到端**：CDP 驱动 Chrome，真实走完 8 步，检查控制台异常、报告结构与截图；
- **AI 路径**：本地 mock provider 验证流式对话、写作评分、报告叙事与单步改写；
- **移动端**：390 px 视口 + 水平溢出审计。

测试不依赖外网；唯一需要外部网络的是真实服务商与 SpeechRecognition。

---

## 13. 已知取舍

| 取舍 | 原因 | 代价 |
| --- | --- | --- |
| 无框架、无构建 | 零依赖、易部署、易读 | 大型视图需要手写 DOM helper |
| localStorage 存报告 | 无需后端数据库、隐私简单 | 换设备不同步、有配额上限 |
| 本地模板兜底 | 无 Key 也能完整学习 | 内容不如模型多样 |
| 词级跟读评分 | 浏览器 API 限制 | 不能给音素级反馈 |
| 程序化 SVG 插图 | 离线、无版权、体积小 | 不是个性化 AI 图片 |
| 固定 8 步 | 好控制时长与报告结构 | 不能按输入长度自动伸缩（后续可加） |

---

## 14. 继续迭代的入口

- 新任务类型：在 `engine.js` 加 `STEP_SPECS` / `RUBRICS` / builder，在 `views/tasks.js` 加渲染器；
- 新场景：在 `scenes.js` 加一项，并在 `art.js` 加对应 SVG 构造器；
- 新词表：替换 `data/core100.json`，保持字段约定即可；
- 新服务商：在 `server/providers.mjs` 注册，补 `search` 策略；
- 官方评分对齐：替换 `scoring.js` 的 `scoreWriting` 与 `engine.js` 的 rubric。

---

## 15. 视频精听管线

```
关键词 ─▶ /api/youtube/search ─┬─ Data API v3（有 Key）
                               └─ 公开结果页 ytInitialData（无 Key）
                                        │
/videos.html  ◀── items（缩略图/标题/频道/时长/CC） ─┘
     │ 点击
     ▼
/watch.html?v=ID
     ├─ 浏览器 iframe API ──▶ YouTube 播放器（getCurrentTime 每 90ms）
     └─ /api/youtube/captions
             ├─ watch 页 ytInitialPlayerResponse.captionTracks
             ├─ timedtext JSON3（英文）
             ├─ timedtext tlang=zh-Hans（官方中文）
             └─ AI 逐句翻译（官方中文为空时）
```

### 15.1 搜索

- API 模式：`search.list` + `videos.list`（时长、播放量），`videoEmbeddable=true` 减少不可嵌入结果；
- 网页模式：从 `ytInitialData` 递归收集 `videoRenderer`，并兼容新的 `lockupViewModel`（`contentId` + `lockupMetadataViewModel` + `thumbnailViewModel`）；
- 两个模式都按 `videoId` 去重；API 失败会降级网页并在结果顶部显示 warning，而不是直接失败；
- 结果缓存 3 分钟，字幕缓存 10 分钟。

### 15.2 字幕与词级时间

`timedtext?fmt=json3` 的 `events[].segs[]`：

- 自动字幕通常带 `segs[].tOffsetMs`，直接换算成绝对起点；词尾取下一个 seg 的起点或事件结束；
- 人工字幕没有 offset，按词长权重把整句时间分给每个词（每个词至少 60ms）；
- 事件先保留原始时间，再 `mergeCues` 合并为 ≤92 字符、≤8 秒的可读行，合并时把词数组拼接起来，所以高亮仍是词级；
- 中文轨道同样解析、合并，再按时间重叠对齐到英文行；没有重叠时取 2.5 秒内最近的一句。

2026 年起 YouTube 对 `timedtext` 强制 PoToken：没有 token 时返回空 `200`。因此直接解析为空时会调用可选依赖 `get-youtube-transcript`，由 BotGuard 铸造视频绑定的 token，再以 `&pot=...&c=WEB` 重新请求。该工具返回句级 segment，`segmentsToCues()` 再按词长把每句时间分给单词；没有安装依赖或 token 铸造失败时显示明确原因，而不是空白字幕。

YouTube 的机器人验证是**瞬时**的：同一个视频可能第一次 `LOGIN_REQUIRED`，几秒后正常。因此 watch 页会换两种 URL 重试，PoToken 助手也会重试一次；`LOGIN_REQUIRED` / `CAPTION_FETCH_FAILED` / `NO_CAPTIONS` **都不写入缓存**，只有成功结果才缓存，避免一次误判把字幕锁死十分钟。

### 15.3 播放同步

- 不使用定时器估算播放位置，而是轮询 `player.getCurrentTime()`；
- 只在 `activeCue` 改变时做 DOM 大改（切换行、滚动、缓存当前行的词与字节点）；同一个 cue 内只切换当前词与中文字符数；
- 中文字符高亮按句内进度：`ceil(字数 × progress)`，避免中文没有空格时无法逐词；
- 点击行跳到行首，点击单词跳到词首；自动滚动可以关闭；字幕窗口独立滚动，不影响页面。

### 15.4 翻译

优先使用 YouTube 官方 `tlang=zh-Hans`（零成本、时间对齐好）。为空时自动翻译：

- 配置了模型 Key：前端按 200 句分块调用 `/api/youtube/translate`；服务端用当前 chat 服务商，每 25 句一批，要求返回等长 JSON 数组；
- 没有模型 Key（或模型调用失败）：调用 `/api/youtube/translate-free`，服务端用 Google Translate 公开接口，每 20 句一批，并在每行前加 `[[n]]` 编号，回填到对应 cue；不需要 Key；
- 校验条数，不符就报错让用户重试；模型结果与免费结果都缓存 30 分钟，避免重复计费/请求；
- 字幕页加载后自动触发，不要求用户先点按钮；失败时显示「重试翻译」。

### 15.5 安全与降级

- 只允许固定 YouTube 域名与 11 位 `videoId`，不接受用户传入任意抓取地址；
- 播放器脚本 / iframe 通过 CSP `script-src` / `frame-src` 白名单放行；缩略图放行 `i.ytimg.com`；
- 视频不可嵌入、没有字幕、字幕接口为空、翻译失败都有独立提示，不阻塞播放器；
- 服务端拿不到字幕时，浏览器仍可直接播放 iframe，只是没有高亮；
- 需要代理时由 `server/start.mjs` 把 `YOUTUBE_PROXY` / `HTTPS_PROXY` 转为 Node 24 的 `NODE_USE_ENV_PROXY=1`，让服务端搜索、BotGuard、字幕请求走同一出口；浏览器自身的 iframe 与缩略图仍由浏览器代理设置决定。

### 15.6 页面结构与 Agent

- 视频页顶部只渲染视频标题，频道、时长、播放量、字幕来源标签和 eyebrow 全部不显示；
- 视频页取消通用 1180px 居中容器，左右只保留 12–26px 安全边距，所以播放器贴左、字幕窗口铺到最右；
- 播放器右侧把手用 Pointer Events 拖动，更新 `.watch-layout` 的 `--watch-player`（fr 比例）；字幕有 420px 最小宽度，视频保持 16:9；比例写入 `enos.watch.playerRatio.v1`，双击/Home 重置，≤860px 隐藏把手；
- 播放器贴最左，字幕窗口铺满右侧；每条字幕是一行三列：时间 / English / 中文，`align-items: baseline` 与统一的 1.7 行高让两侧按较长的一侧自然撑高；
- 播放器下方是视频 Agent，右侧字幕保持 sticky；播放器下方不再保留时间栏、当前句卡片或使用说明；`fitWatchViewport()` 按初始视口计算 Agent 与字幕高度，让两者底边贴在首屏底部（最小 280px / 420px），消息区 `overflow-y:auto` 内部滚动，输入框固定在底部；
- Agent 通过 `watch-agent.js` 挂载，调用现有 `/api/chat` 流式接口；发送时把视频标题、频道、当前播放时间、当前句和完整字幕（超过 12k 字符时截取开头/当前段/结尾）拼进 system prompt；
- Agent 没有 Key 时禁用输入并给出设置入口；有 Key 时支持流式气泡、快捷问题、清空会话；
- 字幕面板提供「导出 MD」：标题、频道、视频 URL、时长、导出日期，以及 `时间 | English | 中文` 表格，使用 Blob 下载。

### 15.7 测试

- `tests/youtube.test.mjs` 覆盖两种搜索结果结构、JSON3 词级时间、无 offset 的均分、合并、官方中文对齐、瞬时登录重试与失败不缓存；
- `scripts/video-check.mjs` 用 CDP 注入 fixture，验证两列字幕、当前词/中文字符高亮、无横向溢出，并生成截图；
- 真实网络下通过本机代理验证了搜索、PoToken 字幕与播放器错误码；代理出口被 YouTube 标记时返回 `LOGIN_REQUIRED`，页面给出可操作提示。

---

## 16. 视频工作台

`/videos.html` 换成独立的左右工作台，不复用学习页的顶部导航：

- 最左 76px 浅色工具栏只保留 **视频 / 对话**；激活态用青绿浅底；旧的学习、听力、报告、设置入口不进入这个工作台；
- 顶部 42px 标签条：**YouTube / 播客 / 图书**；播客与图书暂未接入，只显示占位；
- 视频视图 = 250px 频道导航树 + 右侧预览。导航树可整体收起（`≤ 0px` 列宽，标签条出现“频道”按钮恢复），频道节点也可展开视频子列表；
- 预览卡片使用真实缩略图与 `title / channel / description / views / published / duration / CC`；
- 点击预览不再跳旧 `/watch.html`，而是在右侧内容区切到 in-pane detail：左上 YouTube iframe（中间拖动分割线调整宽度，保持 16:9），下面 Agent，右侧 English / 中文两列字幕；「← 视频列表」返回；
- 频道从搜索结果按 `channel` 分组，选频道即时过滤右侧；搜索框复用 `/api/youtube/search`；
- 对话视图是独立 chat shell，消息区滚动、输入框固定底部；未配置模型 Key 时显示设置入口。

---

## 17. 播客管线

播客资源使用两个公开的 Podcasting 2.0 源，RSS 中同时有音频 enclosure 和 `podcast:transcript` WebVTT：

- Podnews Daily：`https://podnews.net/rss`
- Podnews Weekly Review：`https://feeds.buzzsprout.com/1538779.rss`

服务端 `server/podcasts.mjs`：

1. 拉取 RSS，按 `<item>` 提取 `title / description / pubDate / itunes:duration / itunes:image`；
2. 只保留同时有音频和 `text/vtt` transcript 的 episode，最多 24 集/频道；
3. `GET /api/podcasts/channels` 返回频道元数据；`GET /api/podcasts/episodes?channel=` 返回单集；`GET /api/podcasts/episode?channel=&episode=` 拉取 VTT 并解析；
4. VTT 解析支持 `HH:MM:SS.mmm` / `MM:SS.mmm`，跳过 cue 标识与 `<v>` 标签；有内嵌 `<00:...>` 词级时间时直接保留；没有时由 `server/word-timing.mjs` 在原始片段内按音节、功能词和标点停顿估算。短 cue 只在间隔 ≤0.12 秒时合并，绝不跨过真实停顿；
5. feed 缓存 10 分钟、VTT 缓存 30 分钟；音频经 `/api/podcasts/audio` 以 Range 流式代理（转发 `Range / Content-Range / Content-Length`，使用宽松 UA 避免 Buzzsprout 拒绝 Chrome UA），浏览器只访问同源地址；`img-src` 放行封面域。

前端播客视图：

- 左侧频道列表：圆形封面、频道名、集数徽标、下载最新一期；默认不展开单集，点击箭头展开；
- 右侧顶部自定义播放器：播放/暂停、时间、可点击/拖动的 Web Audio AnalyserNode 动态曲线；音频元素隐藏，MediaElementSource → Analyser → destination；
- 下方 English / 中文两列独立滚动，使用与视频页相同的 `normalizeCues / findCueIndex / findWordIndex / activeCharCount`，按**扣除输出延迟**后的播放时间做词级/逐字高亮；`AudioContext.outputLatency + baseLatency` 自动补偿，页面内的「字幕延迟」可再手动微调（±3 秒）；
- 点击字幕 seek 音频；中文复用视频翻译接口；长单集按 200 句分块并显示进度。

---

## 18. 图书管线

图书来自公开仓库 **hehonghui/awesome-english-ebooks**，只做目录索引和按需读取，不把杂志文件复制进本项目。

- `server/books.mjs` 请求一次 GitHub Git Trees API，按 `01_economist / 02_new_yorker / 04_atlantic / 05_wired` 归并日期目录与 `epub / pdf / mobi` 文件；目录缓存 30 分钟；
- `GET /api/books` 返回 4 个杂志频道和 106 期；
- `GET /api/books/read?category=&date=` 下载 EPUB，在内存中解析 ZIP central directory（stored/deflate）、`META-INF/container.xml`、OPF manifest/spine、NCX/nav 目录；
- XHTML 章节不直接回传，而是提取标题、段落、引用和列表为 `{type,text}` block；过滤广告、封面、目录页和 zlibrary 下载尾巴，避免脚本注入；
- `GET /api/books/file?category=&date=&format=` 通过服务端代理下载原始文件，带 `Content-Disposition`；
- 前端左侧杂志树过滤，右侧书卡；点卡片进入内嵌阅读器：左侧章节目录、右侧正文、上一章/下一章、顶部下载与 GitHub 源；
- 解析后的书缓存在内存中（最多 3 本），大 EPUB 在首次打开时可能需要 30–60 秒。

---

## 19. 品牌与图标

参考 `D:\code\toolforge\src-tauri\icons\icon.png` 的三条流动笔触（青绿、珊瑚、琥珀），EnOS 在其基础上加入「翻开的书」作为知识标识：

- 三条笔触保留参考图的有机曲线、圆角和留白；
- 左上角放一枚更小的浅色翻书标识，奶油书页 + 深 teal 细边 + 琥珀书页线，表达知识但不压过主图形；
- 主色：teal `#1ab49b`，深 teal `#0e8f78`，coral `#f57875`，amber `#f5c653`，纸色 `#fffdf8`；
- 站点 `--accent` 改为深 teal，`--accent-2` 改为 coral，`--lime` 改为 amber；页头增加三色渐变细线，首页 music 场景改为青绿色系；
- 资产：`public/icon.svg`、`icon-512.png`、`icon-192.png`、`icon-32.png`、`apple-touch-icon.png`、`favicon.svg`。
