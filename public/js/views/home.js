import { aiReady, extractArticle, loadBank, searchTopic } from '../api.js';
import { getCurrentSession, clearCurrentSession, getSettings, listSessions, saveCurrentSession, saveSettings } from '../store.js';
import { createSession, MODULE_MAP, STEP_SPECS } from '../engine.js';
import { BANDS, SCENES, getScene } from '../scenes.js';
import { Listener, parseCommand, recognitionSupported, stopSpeaking } from '../speech.js';
import { formatDate, h, icon, modal, toast } from '../ui.js';
import { sceneArt } from '../art.js';

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const EXAMPLES = [
  {
    label: '城市与交通',
    text: 'Urban planners increasingly argue that cities should abandon the idea of building wider roads. Instead, they advocate investing in public transport and shaded walking routes. A recent study found that streets with trees are used more often, even when the distance is the same.',
  },
  {
    label: '科技与注意力',
    text: 'Smartphones have changed the way people wait. A spare minute is now filled with a screen, and many of us assume that this is harmless. Yet researchers suggest that constant switching makes it harder to concentrate on a single task, even after the phone is put away.',
  },
  {
    label: '自然与气候',
    text: 'Along the coast, the wetland acts as a natural barrier against storms. When the mangroves were removed for development, flooding became more frequent. Local volunteers now cultivate seedlings and monitor how quickly the habitat recovers. Their data will help planners decide where building should be limited.',
  },
];

export async function renderHome(ctx) {
  const settings = getSettings();
  const active = getCurrentSession();
  const sessions = listSessions();
  let text = '';
  let sourceLabel = '自定义文本';
  let sceneId = getScene(settings.scene).id;
  let band = settings.band || 6.5;
  let mode = 'text';
  let query = '';
  let listener = null;
  let searchBusy = false;
  let busyExcerpt = false;

  const el = h('div', { class: 'home' });

  const textarea = h('textarea', {
    class: 'input-area',
    id: 'learning-input',
    rows: '5',
    placeholder: 'Paste a sentence, a paragraph, or a short news story in English…',
    'aria-label': '学习输入',
    oninput: (event) => {
      text = event.target.value;
      sourceLabel = '自定义文本';
      updateStart();
      updateCount();
    },
  });

  const count = h('span', { class: 'char-count' }, '0 / 8000');
  const startBtn = h('button', { class: 'btn btn-primary btn-lg', id: 'start-learning', type: 'button', disabled: true, onclick: start }, '开始学习', h('span', { html: icon('arrowRight', 18) }));
  const modeHint = h('div', { class: 'mode-hint' });

  function updateCount() {
    count.textContent = `${text.length} / 8000`;
    count.classList.toggle('over', text.length > 8000);
  }

  function updateStart() {
    const ready = text.trim().length >= 12 && /[A-Za-z]{3,}/.test(text);
    startBtn.disabled = !ready;
  }

  function applyText(next, label) {
    text = next;
    sourceLabel = label;
    textarea.value = next;
    updateCount();
    updateStart();
  }

  async function start() {
    if (startBtn.disabled) return;
    if (text.length > 8000) return toast('输入过长，请控制在 8000 字符以内。', 'err');
    startBtn.disabled = true;
    startBtn.innerHTML = `<span class="spinner"></span> 正在拆解…`;
    try {
      const { words } = await loadBank();
      const session = createSession({
        text,
        sceneId,
        band: Number(band),
        bank: words,
        mode: aiReady() ? 'ai' : 'local',
        sourceLabel,
      });
      saveCurrentSession(session);
      saveSettings({ scene: sceneId, band: Number(band) });
      stopSpeaking();
      ctx.navigate('session');
    } catch (error) {
      toast(error.message || '无法生成学习任务', 'err');
      startBtn.disabled = false;
      startBtn.innerHTML = `开始学习 <span>${icon('arrowRight', 18)}</span>`;
    }
  }

  async function runSearch() {
    if (searchBusy) return;
    const value = String(queryInput?.value ?? query ?? '').trim();
    query = value;
    if (value.length < 2) return toast('先输入一个话题，例如 “urban gardening”。', 'err');
    searchBusy = true;
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<span class="spinner dark"></span> 检索中`;
    resultsBox.innerHTML = '';
    resultsBox.append(h('div', { class: 'search-note' }, '正在联网检索，并抓取正文、按句子边界截取英文原文…'));
    try {
      const data = await searchTopic(value, { count: 5, summarize: true });
      renderSearchResults(data);
    } catch (error) {
      resultsBox.innerHTML = '';
      resultsBox.append(h('div', { class: 'callout warn', html: `${icon('info', 16)}<span>${error.message}</span>` }));
      toast(error.message, 'err');
    } finally {
      searchBusy = false;
      searchBtn.disabled = false;
      searchBtn.innerHTML = '搜索并精读';
    }
  }

  function renderSearchResults(data) {
    resultsBox.innerHTML = '';
    const sourceLabel = {
      deepseek: 'DeepSeek 搜索',
      kimi: 'Kimi 搜索',
      zhipu: '智谱搜索',
      wikipedia: '维基百科',
      duckduckgo: '网页检索',
      'ai-generated': 'AI 生成（非实时）',
    }[data.source] || data.source;
    const modeLabel = data.mode === 'excerpt'
      ? { text: `原文截取${data.articleMeta?.wordCount ? ` · ${data.articleMeta.wordCount} 词` : ''}`, kind: 'ok' }
      : data.mode === 'rewrite'
        ? { text: 'AI 整理（非原文）', kind: 'warn' }
        : data.mode === 'snippets'
          ? { text: '摘要拼接（非原文）', kind: 'warn' }
          : null;

    if (data.translated && data.usedQuery) {
      resultsBox.append(h('div', { class: 'search-note' },
        `中文话题已转成英文检索词：`, h('strong', {}, data.usedQuery)));
    }
    if (data.warnings?.length) {
      resultsBox.append(h('div', { class: 'callout warn', html: `${icon('info', 16)}<span>${data.warnings.join(' ')}</span>` }));
    }
    if (!data.article) {
      resultsBox.append(h('div', { class: 'search-note' }, '没有找到可用内容，换个更具体的话题试试。'));
      return;
    }
    resultsBox.append(h('div', { class: 'search-note' },
      h('span', { class: 'badge accent' }, `来源：${sourceLabel}`),
      modeLabel ? h('span', { class: `badge ${modeLabel.kind}`, style: 'margin-left:6px' }, modeLabel.text) : null,
      h('span', {}, data.mode === 'excerpt'
        ? ' 点击任意结果，抓取该篇原文并直接开始学习。'
        : ' 点击任意结果可尝试抓取原文；也可以直接用下面的整理稿。')));
    if (data.mode === 'excerpt') {
      resultsBox.append(h('details', { class: 'excerpt-preview' },
        h('summary', {}, `预览原文${data.articleMeta?.title ? `：${data.articleMeta.title}` : ''}`),
        h('p', {}, `${data.article.slice(0, 600)}${data.article.length > 600 ? '…' : ''}`)));
    }
    const usable = /\b[A-Za-z]{3,}\b/.test(data.article);
    if (!usable) {
      resultsBox.append(h('div', { class: 'callout warn', html: `${icon('info', 16)}<span>没有截取到英文原文。中文话题需要配置 API Key 自动转成英文检索词，或直接输入英文关键词。</span>` }));
    }
    data.items?.forEach((item) => {
      const button = h('button', { class: 'search-result', type: 'button' },
        h('strong', {}, item.title || data.query),
        h('span', {}, item.snippet || ''),
        h('em', {}, `${item.site || item.engine || 'web'} · 点击截取原文`));
      button.addEventListener('click', () => useOriginal(item, button, data));
      resultsBox.append(button);
    });
    resultsBox.append(h('button', {
      class: 'btn btn-soft btn-sm',
      type: 'button',
      disabled: !usable,
      onclick: () => startWithArticle(data),
    }, data.mode === 'excerpt' ? '用这篇原文开始学习' : '使用整理稿（非原文）'));
  }

  async function useOriginal(item, button, data) {
    if (busyExcerpt) return;
    if (!item.url) return toast('这条结果没有可抓取的链接。', 'err');
    busyExcerpt = true;
    const previous = button.innerHTML;
    button.disabled = true;
    button.classList.add('busy');
    button.innerHTML = `<strong>正在抓取原文…</strong><span>${item.site || item.url}</span>`;
    try {
      const cached = data?.mode === 'excerpt' && data.article && item.url === data.articleMeta?.url;
      const article = cached
        ? { excerpt: data.article, wordCount: data.articleMeta.wordCount, url: item.url, title: data.articleMeta.title }
        : await extractArticle(item.url);
      const label = article.url ? hostOf(article.url) : item.site || '网页';
      applyText(article.excerpt, `原文截取 · ${label}`);
      if (startBtn.disabled) {
        button.disabled = false;
        button.classList.remove('busy');
        button.innerHTML = previous;
        return toast('这篇没有截取到足够的英文，换一篇试试。', 'err');
      }
      toast(`已截取 ${article.wordCount} 词英文原文，准备开始学习。`, 'ok');
      await start();
      if (button.isConnected) {
        button.disabled = false;
        button.classList.remove('busy');
        button.innerHTML = previous;
      }
    } catch (error) {
      button.disabled = false;
      button.classList.remove('busy');
      button.innerHTML = previous;
      toast(error.message || '抓取原文失败。', 'err');
    } finally {
      busyExcerpt = false;
    }
  }

  async function startWithArticle(data) {
    if (!data.article) return;
    const label = data.mode === 'excerpt'
      ? `原文截取 · ${data.articleMeta?.site || hostOf(data.articleMeta?.url || '') || data.usedQuery || data.query}`
      : `联网整理 · ${data.usedQuery || data.query}`;
    applyText(data.article, label);
    if (startBtn.disabled) return toast('这篇内容不是足够的英文，换一篇试试。', 'err');
    await start();
  }

  /* ---------- Voice input ---------- */
  function buildMic() {
    const label = h('span', {}, recognitionSupported ? '语音输入' : '浏览器不支持语音');
    const btn = h('button', {
      class: 'mic-btn',
      type: 'button',
      disabled: !recognitionSupported,
      onclick: () => toggleMic(btn, label),
    }, h('span', { html: icon('mic', 15) }), h('span', { class: 'mic-dot' }), label);
    return { btn, label };
  }

  function resetMic(btn, label) {
    btn.classList.remove('recording');
    label.textContent = '语音输入';
    if (!text) updateCount();
  }

  function toggleMic(btn, label) {
    if (!recognitionSupported) return toast('请使用 Chrome 或 Edge 打开，才能使用语音输入。', 'err');
    if (listener?.active) {
      listener.stop();
      return;
    }
    stopSpeaking();
    listener = new Listener({
      lang: 'en-US',
      onInterim: (value) => {
        count.textContent = `${text.length} + ${value.length} / 8000`;
      },
      onResult: (value) => {
        const command = parseCommand(value);
        if (command?.intent === 'search' && command.query) {
          switchTab('search');
          query = command.query;
          queryInput.value = command.query;
          runSearch();
          return;
        }
        const next = `${text}${text && !text.endsWith(' ') ? ' ' : ''}${value}`.trim();
        applyText(next, '语音输入');
      },
      onEnd: () => resetMic(btn, label),
      onError: (message) => {
        toast(message, 'err');
        resetMic(btn, label);
      },
    });
    if (listener.start()) {
      btn.classList.add('recording');
      label.textContent = '正在聆听…点击停止';
      toast('可以直接说一段英文；说 “search for …” 可以联网找素材。', 'info', 4200);
    }
  }

  const textMic = buildMic();
  const voiceMic = buildMic();

  /* ---------- Tabs ---------- */
  const textPanel = h('div', { class: 'text-panel' },
    h('div', { class: 'textarea-wrap' }, textarea),
    h('div', { class: 'input-tools' },
      textMic.btn,
      h('span', { class: 'spacer' }),
      count,
      h('button', { class: 'link-btn', type: 'button', onclick: () => { applyText('', '自定义文本'); textarea.focus(); } }, '清空'),
    ),
    h('div', { class: 'example-chips' },
      h('span', { class: 'tiny faint', style: 'padding:7px 0' }, '试试：'),
      EXAMPLES.map((example) => h('button', { class: 'chip', type: 'button', onclick: () => { applyText(example.text, example.label); textarea.focus(); } }, example.label)),
    ),
  );

  const queryInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search a topic, e.g. urban gardening, sleep science…',
    'aria-label': '搜索话题',
    oninput: (event) => { query = event.target.value; },
    onkeydown: (event) => { if (event.key === 'Enter') runSearch(); },
  });
  const searchBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: runSearch }, '搜索并精读');
  const resultsBox = h('div', { class: 'search-results' });
  const searchPanel = h('div', { class: 'search-panel hidden' },
    h('div', { class: 'search-row' }, queryInput, searchBtn),
    h('div', { class: 'search-note' }, '检索 → 抓取网页正文 → 按句子边界截取 150–220 词英文原文。中文话题需配置 API Key 才会自动转成英文检索词；没有 Key 时请直接输入英文。'),
    resultsBox,
  );

  const voicePanel = h('div', { class: 'search-panel hidden' },
    h('div', { class: 'callout', html: `${icon('mic', 16)}<span>点击下面的按钮开始说话。系统会把听到的英文写进输入框；说 “search for …” 则会自动进入联网检索。</span>` }),
    h('div', { style: 'margin-top:12px' }, voiceMic.btn),
  );

  const tabs = [
    { id: 'text', label: '粘贴文本', icon: 'pen' },
    { id: 'voice', label: '语音输入', icon: 'mic' },
    { id: 'search', label: '联网搜索', icon: 'search' },
  ];
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });

  function switchTab(next) {
    mode = next;
    tabBar.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === next));
    textPanel.classList.toggle('hidden', next !== 'text');
    searchPanel.classList.toggle('hidden', next !== 'search');
    voicePanel.classList.toggle('hidden', next !== 'voice');
    if (next === 'search') queryInput.focus();
    if (next === 'voice' && recognitionSupported) toast('点击“语音输入”按钮开始说话。', 'info', 2400);
  }

  for (const tab of tabs) {
    tabBar.append(h('button', {
      class: `tab${tab.id === 'text' ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'data-tab': tab.id,
      onclick: () => switchTab(tab.id),
    }, h('span', { html: icon(tab.icon, 15) }), tab.label));
  }

  const sceneGrid = h('div', { class: 'scene-grid' });
  for (const scene of SCENES) {
    sceneGrid.append(h('button', {
      class: `scene-chip${scene.id === sceneId ? ' active' : ''}`,
      type: 'button',
      'aria-pressed': scene.id === sceneId ? 'true' : 'false',
      onclick: () => {
        sceneId = scene.id;
        sceneGrid.querySelectorAll('.scene-chip').forEach((chip) => {
          const on = chip.dataset.scene === scene.id;
          chip.classList.toggle('active', on);
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        artBox.innerHTML = sceneArt(scene.id, { caption: true });
        saveSettings({ scene: scene.id });
      },
      'data-scene': scene.id,
    },
    h('span', { class: 'scene-emoji' }, scene.emoji),
    h('span', { class: 'scene-name' }, scene.name),
    h('span', { class: 'scene-en' }, scene.en)));
  }

  const bandSelect = h('select', {
    class: 'select',
    'aria-label': '目标分数',
    onchange: (event) => { band = Number(event.target.value); saveSettings({ band }); },
  }, BANDS.map((item) => h('option', { value: item.value, selected: Number(item.value) === Number(band) }, item.label)));

  const artBox = h('div', { class: 'hero-art' });
  artBox.innerHTML = sceneArt(sceneId, { caption: true });

  modeHint.innerHTML = aiReady()
    ? `${icon('sparkles', 14)}<span>AI 会按「${getScene(sceneId).name}」场景改写每一步</span>`
    : `${icon('info', 14)}<span>本地引擎也能完整学完；配置 API Key 后启用 AI 场景改写</span>`;

  const paletteCard = h('div', { class: 'card input-card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', {}, '把今天的英文交给 EnOS'),
        h('p', {}, '一句话、一段文章或一条新闻。系统会找出雅思考点，拆成 8 个不超过 5 分钟的任务。'),
      ),
      h('span', { class: 'badge accent' }, '100 核心词库'),
    ),
    tabBar,
    textPanel,
    searchPanel,
    voicePanel,
    h('div', { class: 'scene-block' },
      h('h4', {}, '学习场景 ', h('span', {}, '决定例子、插图、对话与写作任务')),
      sceneGrid,
    ),
    h('div', { class: 'start-row' },
      h('label', { class: 'field-inline' }, '目标分数 ', bandSelect),
      modeHint,
      h('span', { class: 'spacer' }),
      startBtn,
    ),
  );

  const resume = active && active.status === 'active'
    ? h('div', { class: 'resume-banner' },
      h('p', {}, h('strong', {}, '上次学习还没走完。'), ` 停在「${MODULE_MAP[STEP_SPECS.find((spec) => spec.key === active.steps?.[active.currentIndex]?.key)?.module]?.name || '第 1 步'}」附近，继续只需再点几下。`),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.navigate('session') }, '继续学习'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await modal({ title: '放弃这次学习？', body: '当前步骤记录会被清空，已完成的报告不受影响。', actions: [{ label: '取消', value: false }, { label: '放弃', value: true, primary: true }] });
        if (ok) { clearCurrentSession(); renderView(); }
      } }, '重新开始'),
    )
    : null;

  const routeStrip = h('div', { class: 'route-strip' }, STEP_SPECS.map((spec, index) => {
    const module = MODULE_MAP[spec.module];
    return h('div', { class: 'route-step', style: `--step-color:${module.color}` },
      h('div', { class: 'rs-index' }, `0${index + 1}`),
      h('div', { class: 'rs-title' }, spec.title),
      h('div', { class: 'rs-module' }, module.name),
      h('div', { class: 'rs-time' }, `${spec.minutes} 分钟`));
  }));

  const recent = sessions.slice(0, 3);
  const recentCard = h('div', { class: 'card recent-card' },
    h('div', { class: 'recent-head' },
      h('div', {}, h('h3', {}, '最近的学习'), h('p', { class: 'small muted' }, '报告会一直留在这台设备上。')),
      h('a', { class: 'link-btn', href: '#/reports' }, '全部报告 →'),
    ),
    recent.length
      ? h('div', { class: 'recent-list' }, recent.map((session) => h('a', { class: 'recent-item', href: `/report.html?id=${encodeURIComponent(session.id)}` },
        h('div', { class: 'ri-main' },
          h('div', { class: 'ri-title' }, session.input?.text?.replace(/\s+/g, ' ').slice(0, 70) || '未命名学习'),
          h('div', { class: 'ri-meta' }, `${getScene(session.sceneId).name}场景 · ${formatDate(session.finishedAt || session.createdAt)} · ${session.summary?.completedSteps ?? 0}/8 步`),
        ),
        h('div', { class: 'ri-score' }, String(session.summary?.overall ?? '—')),
        h('span', { html: icon('chevronRight', 16) }),
      )))
      : h('div', { class: 'empty-note' }, '还没有完成的学习。先试试上面的示例，8 步之后就能看到报告。'),
  );

  const view = h('div', {},
    resume,
    h('section', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow' }, 'IELTS 7000 · 100 core words · 8 micro-tasks'),
        h('h1', {}, '一句英文，', h('br'), '走完雅思', h('em', {}, '四项'), '。'),
        h('p', { class: 'lede' }, '输入你正在读的英文。EnOS 会接着这段话，按听力 → 阅读 → 口语 → 写作，由易到难生成 8 个 5 分钟任务；每步都支持点击与语音。'),
        h('div', { class: 'hero-meta' },
          h('span', { class: 'chip' }, '🎧 听写与辨音'),
          h('span', { class: 'chip' }, '📖 同义替换'),
          h('span', { class: 'chip' }, '🎙 跟读评分'),
          h('span', { class: 'chip' }, '✍️ 可背诵小段'),
        ),
      ),
      artBox,
    ),
    h('div', { class: 'home-stack' },
      paletteCard,
      h('div', { class: 'card route-card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h3', {}, '本次学习路线'), h('p', { class: 'small muted' }, '固定 8 步、每步 ≤ 5 分钟；完成判定达标后才解锁“下一步”。')),
          h('span', { class: 'badge' }, '约 40 分钟'),
        ),
        routeStrip,
      ),
      recentCard,
    ),
  );

  el.append(view);
  textarea.value = text;
  updateCount();
  updateStart();

  function renderView() {
    ctx.navigate('home');
    // force a re-render even if the hash did not change
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  return {
    el,
    title: 'EnOS · 一句英文，走完雅思四项',
    cleanup() {
      listener?.abort();
      stopSpeaking();
    },
  };
}
