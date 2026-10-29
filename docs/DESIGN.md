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

## 8. 前端结构

- **无框架**：`h()` 生成 DOM，视图函数返回 `{ el, cleanup }`，路由切换时调用 cleanup 释放定时器、麦克风、朗读；
- **状态**：`store.js` 封装 localStorage，写入失败时回退到内存 Map；
- **语音**：`speech.js` 封装 TTS 队列与 `Listener`，统一错误文案；
- **插图**：`art.js` 用 8 个场景的 SVG 构造器 + 种子微调，CSS 只负责浮动动画；
- **可访问性**：按钮语义、`aria-label`、数字键 1–4 选项、`aria-live` 反馈、跳过导航、焦点样式。

### 计时

`setInterval` 每秒累加，但只在 `document.visibilityState === 'visible'` 时计时；单步进入时重置为 5:00，超时显示 `+mm:ss` 并记录，不阻塞通关。

### 报告渲染

报告页是独立 HTML，不复用 SPA 路由。数据来自 `localStorage`；旧的会话若没有 `summary`，会用 `summarizeSession` 现算。AI 叙事异步追加，不阻塞首屏。

---

## 9. 安全模型

| 风险 | 措施 |
| --- | --- |
| Key 泄漏到第三方 | Key 只发给本机 `/api`，由本机转发；无第三方 SDK、无遥测 |
| Key 落盘/日志 | 服务端不持久化、不打印请求体 |
| 跨站调用本机 API | 校验 `Origin` 与 `Host` 一致；CSP `connect-src 'self'` |
| 路径穿越 | 静态路径 resolve 后必须位于 `public/` 或 `data/` |
| XSS | 用户内容全部走 `textContent`；`innerHTML` 只用于内置图标与场景 SVG |
| 资源滥用 | 2 MB body、240 req/min/IP、上游超时 |
| 公网暴露 | 默认 `127.0.0.1`；README 明确不建议公网 |

---

## 10. 测试策略

- **纯函数**：引擎、评分、指令解析不依赖 DOM，可直接在 Node 跑；
- **契约测试**：对 8 种 kind 检查必填字段、选项合法性、答案范围；
- **阈值测试**：0.79 / 0.80、Band 5.5 / 6.0 等边界；
- **服务端集成**：自建 mock provider，覆盖非流式、SSE、错误码、搜索、静态安全；
- **浏览器端到端**：CDP 驱动 Chrome，真实走完 8 步，检查控制台异常、报告结构与截图；
- **AI 路径**：本地 mock provider 验证流式对话、写作评分、报告叙事与单步改写；
- **移动端**：390 px 视口 + 水平溢出审计。

测试不依赖外网；唯一需要外部网络的是真实服务商与 SpeechRecognition。

---

## 11. 已知取舍

| 取舍 | 原因 | 代价 |
| --- | --- | --- |
| 无框架、无构建 | 零依赖、易部署、易读 | 大型视图需要手写 DOM helper |
| localStorage 存报告 | 无需后端数据库、隐私简单 | 换设备不同步、有配额上限 |
| 本地模板兜底 | 无 Key 也能完整学习 | 内容不如模型多样 |
| 词级跟读评分 | 浏览器 API 限制 | 不能给音素级反馈 |
| 程序化 SVG 插图 | 离线、无版权、体积小 | 不是个性化 AI 图片 |
| 固定 8 步 | 好控制时长与报告结构 | 不能按输入长度自动伸缩（后续可加） |

---

## 12. 继续迭代的入口

- 新任务类型：在 `engine.js` 加 `STEP_SPECS` / `RUBRICS` / builder，在 `views/tasks.js` 加渲染器；
- 新场景：在 `scenes.js` 加一项，并在 `art.js` 加对应 SVG 构造器；
- 新词表：替换 `data/core100.json`，保持字段约定即可；
- 新服务商：在 `server/providers.mjs` 注册，补 `search` 策略；
- 官方评分对齐：替换 `scoring.js` 的 `scoreWriting` 与 `engine.js` 的 rubric。
