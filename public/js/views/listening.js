import { aiReady, chat } from '../api.js';
import {
  clearCurrentListening,
  getCurrentListening,
  getSettings,
  listListeningSessions,
  saveCurrentListening,
  saveListeningSession,
} from '../store.js';
import {
  buildDialoguePrompt,
  buildListeningResult,
  localDialogue,
  normaliseRole,
  parseDialogue,
  resolveChunks,
} from '../dialogue.js';
import {
  Listener,
  parseListeningCommand,
  pauseSpeaking,
  recognitionSupported,
  resumeSpeaking,
  speak,
  stopSpeaking,
  ttsSupported,
} from '../speech.js';
import { formatDuration } from '../scoring.js';
import { clearLessonVocabulary, setLessonVocabulary } from '../lookup.js';
import { h, icon, toast } from '../ui.js';

const PHASES = [
  { id: 'preview', label: '① 预读文本' },
  { id: 'slow', label: '② 慢速讲解' },
  { id: 'blind', label: '③ 盲听' },
  { id: 'intensive', label: '④ 精听回放' },
];

const TOPIC_EXAMPLES = ['在咖啡店点单', '校园生活', '一次求职面试', '城市里的共享单车'];
const BANDS = [5, 5.5, 6, 6.5];

const ROLE_COLORS = {
  主语: { color: '#2563eb', soft: '#dbeafe' },
  谓语: { color: '#0f7a5a', soft: '#dcfce7' },
  宾语: { color: '#b45309', soft: '#fef3c7' },
  表语: { color: '#c2410c', soft: '#ffedd5' },
  定语: { color: '#db2777', soft: '#fce7f3' },
  状语: { color: '#7c3aed', soft: '#ede9fe' },
  补语: { color: '#0891b2', soft: '#cffafe' },
  从句: { color: '#4338ca', soft: '#e0e7ff' },
  连接词: { color: '#475569', soft: '#e2e8f0' },
  主句: { color: '#1d4ed8', soft: '#dbeafe' },
  疑问句: { color: '#7c3aed', soft: '#ede9fe' },
  句子: { color: '#6b7280', soft: '#f3f4f6' },
  意群: { color: '#6b7280', soft: '#f3f4f6' },
};

function roleStyle(role) {
  return ROLE_COLORS[normaliseRole(role)] || ROLE_COLORS.意群;
}

function freshStats() {
  return { seconds: 0, slowPlays: 0, normalPlays: 0, blindPass: 0, replays: 0, voice: 0, heard: [] };
}

function sourceLabel(source) {
  return source === 'ai' ? 'AI 生成' : '本地模板';
}

export async function renderListening(ctx) {
  const settings = getSettings();
  const saved = getCurrentListening();

  let dialogue = saved?.dialogue || null;
  let phase = saved?.phase || 'preview';
  let current = Number.isInteger(saved?.current) ? saved.current : 0;
  let stats = saved?.stats
    ? { ...freshStats(), ...saved.stats, heard: [...(saved.stats.heard || [])] }
    : freshStats();
  let finishedAt = saved?.finishedAt || null;
  let resultSession = phase === 'result' && dialogue ? { ...dialogue, stats, finishedAt } : null;
  let band = dialogue?.band || 5.5;

  let mounted = true;
  let generating = false;
  let playing = false;
  let paused = false;
  let rateMode = 'normal';
  let reveal = false;
  let showZh = true;
  let autoAdvance = false;
  const openStructures = new Set();
  let listener = null;
  let topicListener = null;
  let playTimer = null;
  let clockId = null;

  if (dialogue) {
    current = Math.max(0, Math.min(dialogue.lines.length - 1, current));
  }
  setLessonVocabulary(dialogue);

  /* ---------- setup ---------- */

  const bandSelect = h('select', {
    class: 'select',
    'aria-label': '听力难度',
    onchange: (event) => { band = Number(event.target.value); },
  }, BANDS.map((value) => h('option', { value, selected: Number(value) === Number(band) }, `Band ${value.toFixed(1)}`)));

  const topicLang = h('select', {
    class: 'select select-sm',
    'aria-label': '语音识别语言',
    title: '语音输入话题时使用的语言',
  },
  h('option', { value: 'zh-CN' }, '中文'),
  h('option', { value: 'en-US' }, 'English'));

  const topicInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: '输入话题或问题，例如：在咖啡店点单 / 为什么城市需要更多树？',
    'aria-label': '听力话题',
    onkeydown: (event) => { if (event.key === 'Enter') generate(); },
  });

  const topicMic = h('button', {
    class: 'mic-btn',
    type: 'button',
    disabled: !recognitionSupported,
    title: recognitionSupported ? '说出话题，自动填入输入框' : '当前浏览器不支持语音识别',
    onclick: toggleTopicMic,
  }, h('span', { html: icon('mic', 15) }), h('span', { class: 'mic-dot' }), '说话题');

  const generateBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    onclick: generate,
  }, h('span', { html: icon('sparkles', 16) }), '生成对话');

  const genStatus = h('div', { class: 'tiny faint', style: 'margin-top:10px;min-height:16px' });

  const exampleChips = h('div', { class: 'listen-examples' },
    h('span', { class: 'tiny faint' }, '试试：'),
    TOPIC_EXAMPLES.map((topic) => h('button', {
      class: 'chip',
      type: 'button',
      onclick: () => { topicInput.value = topic; topicInput.focus(); },
    }, topic)));

  const setupCard = h('section', { class: 'card listen-setup' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'STEP 0 · 选一个话题'),
        h('h2', {}, '输入你想练的话题或问题'),
        h('p', {}, '对话只围绕你的输入生成：先看文本，再慢速逐句讲解结构、单词和语法，接着正常语速盲听，最后逐句精听。')),
      h('span', { class: 'badge accent' }, '约 5 分钟')),
    h('div', { class: 'listen-topic-row' }, topicInput, topicMic, topicLang),
    h('div', { class: 'listen-options' },
      h('label', { class: 'field-inline' }, '难度 ', bandSelect),
      h('span', { class: 'small muted' }, '生成只围绕你输入的话题或问题，不套用首页场景；中文话题需要 API Key。')),
    exampleChips,
    h('div', { style: 'margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, generateBtn, genStatus),
    !ttsSupported ? h('div', { class: 'callout warn', style: 'margin-top:12px', html: `${icon('info', 16)}<span>当前浏览器不支持语音朗读，仍可阅读文本与对照翻译，但无法播放音频。建议使用 Chrome 或 Edge。</span>` }) : null,
  );

  /* ---------- work ---------- */

  const workHead = h('div', { class: 'listen-head' });
  const phaseBar = h('div', { class: 'listen-phases', role: 'tablist', 'aria-label': '练习阶段' });
  const stage = h('div', { class: 'listen-stage' });

  const prevBtn = h('button', { class: 'lp-btn', type: 'button', 'aria-label': '上一句', title: '上一句', onclick: () => move(-1) }, h('span', { html: icon('arrowLeft', 17) }));
  const playBtn = h('button', { class: 'lp-main', type: 'button', 'aria-label': '播放', onclick: togglePlay });
  const nextBtn = h('button', { class: 'lp-btn', type: 'button', 'aria-label': '下一句', title: '下一句', onclick: () => move(1) }, h('span', { html: icon('arrowRight', 17) }));
  const position = h('span', { class: 'lp-pos' }, '第 1 / 12 句');
  const rateBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: toggleRate }, '正常 0.95×');
  const randomBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: randomLine }, '随机一句');
  const revealBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: toggleReveal }, '显示文本');
  const autoLabel = h('label', { class: 'check-inline auto-label' },
    h('input', { type: 'checkbox', onchange: (event) => { autoAdvance = event.target.checked; } }),
    '自动连播');
  const finishBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: finish }, '生成练习结果');

  const player = h('div', { class: 'listen-player' },
    prevBtn, playBtn, nextBtn, position,
    rateBtn, randomBtn, revealBtn, autoLabel,
    h('span', { class: 'spacer' }),
    finishBtn);

  const voiceBtn = h('button', {
    class: 'btn btn-ghost btn-sm',
    type: 'button',
    onclick: toggleVoice,
    disabled: !recognitionSupported,
  }, h('span', { html: icon('mic', 16) }), '语音控制');

  const heardLine = h('div', { class: 'voice-heard' }, recognitionSupported
    ? '点麦克风说指令（会先暂停音频）：播放、暂停、下一句、随机一句、第 4 句、慢速、生成结果。'
    : '当前浏览器不支持语音识别，请用按钮控制。');

  const voiceRow = h('div', { class: 'listen-voice' },
    voiceBtn,
    heardLine,
    h('div', { class: 'voice-commands' },
      ['播放', '暂停', '下一句', '上一句', '随机一句', '第 4 句', '慢速', '正常语速', '显示文本', '生成结果'].map((text) => h('span', {}, text))));

  const workCard = h('section', { class: 'card listen-work hidden' },
    workHead,
    h('div', { class: 'listen-body' }, phaseBar, stage),
    player,
    voiceRow);

  /* ---------- result ---------- */

  const resultCard = h('section', { class: 'card listen-result hidden' });

  /* ---------- recent ---------- */

  const recentCard = h('section', { class: 'card listen-recent hidden' });

  const el = h('div', { class: 'listening' },
    h('section', { class: 'listen-hero' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'LISTENING LAB · 5 MIN'),
        h('h1', {}, '听力，从', h('em', {}, '听懂一句'), '开始。'),
        h('p', { class: 'lede' }, '一个话题，一段 12 句的双人对话。先预读，再慢速逐句拆结构、讲生词；然后正常语速盲听；最后逐句精听。练完得到全文与对照翻译。')),
      h('div', { class: 'listen-hero-mark', html: icon('headphones', 46) })),
    setupCard,
    workCard,
    resultCard,
    recentCard);

  /* ---------- state helpers ---------- */

  function persist() {
    if (!dialogue) return;
    saveCurrentListening({
      dialogue,
      phase,
      current,
      stats: { ...stats, heard: [...stats.heard] },
      finishedAt: phase === 'result' ? finishedAt : null,
    });
  }

  function setStats(next) {
    stats = { ...freshStats(), ...next, heard: [...(next.heard || [])] };
  }

  function startClock() {
    if (clockId || phase === 'result') return;
    clockId = setInterval(() => {
      if (!mounted || phase === 'result' || document.visibilityState !== 'visible') return;
      stats.seconds += 1;
      paintClock();
      if (stats.seconds % 10 === 0) persist();
    }, 1000);
  }

  function stopClock() {
    if (clockId) clearInterval(clockId);
    clockId = null;
  }

  /* ---------- rendering ---------- */

  function paint() {
    setupCard.classList.toggle('hidden', Boolean(dialogue) || Boolean(resultSession) || phase === 'result');
    workCard.classList.toggle('hidden', !dialogue || phase === 'result');
    resultCard.classList.toggle('hidden', phase !== 'result' || !resultSession);
    paintHead();
    paintPhases();
    paintStage();
    paintPlayer();
    paintClock();
    paintResult();
    paintRecent();
  }

  function paintHead() {
    if (!dialogue) return;
    workHead.replaceChildren(
      h('div', {},
        h('p', { class: 'eyebrow' }, 'LISTENING LAB'),
        h('h2', {}, dialogue.title),
        h('p', { class: 'small muted' }, `${dialogue.topic || '未命名话题'} · ${dialogue.lines.length} 句 · Band ${Number(dialogue.band).toFixed(1)}`)),
      h('div', { class: 'listen-head-side' },
        h('span', { class: `badge ${dialogue.source === 'ai' ? 'accent' : 'warn'}` }, sourceLabel(dialogue.source)),
        h('span', { class: 'badge' }, `已练 ${formatDuration(stats.seconds)}`),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: regenerate }, '重新生成'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: resetAll }, '换话题')));
    if (dialogue.source === 'local') {
      workHead.append(h('p', { class: 'listen-local-note tiny faint' }, '本地模板是通用对话；配置 API Key 后会按你的话题重新生成。'));
    }
  }

  function paintClock() {
    if (!dialogue) return;
    const badge = workHead.querySelector('.listen-head-side .badge:nth-child(2)');
    if (badge) badge.textContent = `已练 ${formatDuration(stats.seconds)}`;
  }

  function paintPhases() {
    phaseBar.replaceChildren(...PHASES.map((item) => h('button', {
      class: `phase-btn${phase === item.id ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': phase === item.id ? 'true' : 'false',
      onclick: () => setPhase(item.id),
    }, item.label)));
  }

  function paintPlayer() {
    if (!dialogue) return;
    const total = dialogue.lines.length;
    playBtn.innerHTML = playing ? icon('pause', 18) : icon('play', 18);
    playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    position.textContent = `第 ${current + 1} / ${total} 句`;
    rateBtn.textContent = rateMode === 'slow' ? '慢速 0.7×' : '正常 0.95×';
    rateBtn.setAttribute('aria-pressed', rateMode === 'slow' ? 'true' : 'false');
    revealBtn.classList.toggle('hidden', phase !== 'blind');
    revealBtn.textContent = reveal ? '隐藏文本' : '显示文本';
    autoLabel.classList.toggle('hidden', phase !== 'slow');
    finishBtn.disabled = phase === 'result';
  }

  function lineDots() {
    return h('div', { class: 'line-dots', role: 'group', 'aria-label': '播放位置（第几句）' },
      dialogue.lines.map((_, index) => h('button', {
        class: `line-dot${index === current ? ' active' : ''}${stats.heard.includes(index) ? ' heard' : ''}`,
        type: 'button',
        'aria-label': `跳到第 ${index + 1} 句`,
        onclick: () => jumpTo(index),
      }, String(index + 1))));
  }

  function roleLabel(role) {
    const normalised = normaliseRole(role);
    return normalised || '意群';
  }

  function annotatedSentence(line, big = false) {
    const chunks = resolveChunks(line.text, line.chunks);
    return h('div', { class: `syn-sentence${big ? ' big' : ''}` },
      chunks.map((chunk) => {
        const style = roleStyle(chunk.role);
        return h('span', {
          class: 'syn-chunk',
          style: `--syn:${style.color};--syn-soft:${style.soft}`,
        },
        h('span', { class: 'syn-text' }, chunk.text),
        h('span', { class: 'syn-label' }, roleLabel(chunk.role)));
      }));
  }

  function sentenceView(line, { open = false, big = false } = {}) {
    if (!open) return h('p', { class: `ll-en${big ? ' big' : ''}` }, line.text);
    return annotatedSentence(line, big);
  }

  function structureToggle(index) {
    const open = openStructures.has(index);
    return h('button', {
      class: `link-btn syn-toggle${open ? ' active' : ''}`,
      type: 'button',
      'aria-expanded': open ? 'true' : 'false',
      onclick: (event) => {
        event.stopPropagation();
        toggleStructure(index);
      },
    }, open ? '收起结构' : '句子结构');
  }

  function toggleStructure(index) {
    if (openStructures.has(index)) openStructures.delete(index);
    else openStructures.add(index);
    paintStage();
  }

  function wordCards(line) {
    const words = line.words || [];
    if (!words.length) return null;
    return h('div', { class: 'syn-words' }, words.map((word) => h('div', { class: 'syn-word-card' },
      h('div', { class: 'sw-head' },
        h('strong', {}, word.term),
        word.pos ? h('span', { class: 'pos' }, word.pos) : null,
        word.zh ? h('span', { class: 'zh' }, word.zh) : null),
      word.gloss ? h('p', { class: 'sw-row' },
        h('span', { class: 'sw-key' }, '语义'),
        h('span', { class: 'sw-en' }, word.gloss)) : null,
      word.usage ? h('p', { class: 'sw-row' },
        h('span', { class: 'sw-key' }, '用法'),
        h('span', { class: 'sw-en' }, word.usage)) : null)));
  }

  function detailPanel(line, index) {
    if (!openStructures.has(index)) return null;
    const words = wordCards(line);
    return h('div', { class: 'syn-detail', onclick: (event) => event.stopPropagation() },
      line.structure ? h('p', { class: 'syn-row' },
        h('span', { class: 'syn-key' }, '结构'),
        h('span', {}, line.structure)) : null,
      line.grammar ? h('p', { class: 'syn-row' },
        h('span', { class: 'syn-key' }, '语法'),
        h('span', {}, line.grammar)) : null,
      words,
      !line.structure && !line.grammar && !words
        ? h('p', { class: 'small muted' }, '这句暂无解析。')
        : null);
  }

  function paintStage() {
    if (!dialogue) { stage.replaceChildren(); return; }
    if (phase === 'preview') stage.replaceChildren(renderPreview());
    else if (phase === 'slow') stage.replaceChildren(renderSlow());
    else if (phase === 'blind') stage.replaceChildren(renderBlind());
    else if (phase === 'intensive') stage.replaceChildren(renderIntensive());
    else stage.replaceChildren();
  }

  function renderPreview() {
    const list = h('div', { class: 'listen-lines' });
    dialogue.lines.forEach((line, index) => {
      const open = openStructures.has(index);
      list.append(h('article', { class: `listen-line${index === current ? ' active' : ''}` },
        h('div', { class: 'll-top' },
          h('span', { class: `ll-speaker${line.speaker === 'B' ? ' b' : ''}` }, line.speaker),
          h('span', { class: 'll-index' }, `第 ${index + 1} 句`),
          h('span', { class: 'spacer' }),
          structureToggle(index),
          h('button', { class: 'link-btn', type: 'button', onclick: () => playIndex(index, { mode: 'normal' }) }, '播放')),
        sentenceView(line, { open }),
        h('p', { class: 'll-zh' }, line.zh),
        detailPanel(line, index)));
    });
    list.append(h('div', { class: 'listen-next' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => setPhase('slow') },
        '开始慢速讲解 ', h('span', { html: icon('arrowRight', 16) }))));
    return list;
  }

  function renderSlow() {
    const line = dialogue.lines[current];
    const open = openStructures.has(current);
    return h('div', { class: 'listen-slow' },
      lineDots(),
      h('article', { class: 'listen-line active' },
        h('div', { class: 'll-top' },
          h('span', { class: `ll-speaker${line.speaker === 'B' ? ' b' : ''}` }, line.speaker),
          h('span', { class: 'll-index' }, `第 ${current + 1} 句`),
          h('span', { class: 'spacer' }),
          structureToggle(current),
          h('span', { class: 'badge' }, rateMode === 'slow' ? '慢速 0.7×' : '正常 0.95×')),
        sentenceView(line, { open, big: true }),
        h('p', { class: 'll-zh' }, line.zh),
        detailPanel(line, current),
        h('div', { class: 'slow-actions' },
          h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => playIndex(current, { mode: 'slow' }) },
            h('span', { html: icon('play', 15) }), '播放本句'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => playIndex(current, { mode: 'normal' }) },
            h('span', { html: icon('volume', 15) }), '正常语速'))),
      h('div', { class: 'slow-nav' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: current === 0, onclick: () => playIndex(current - 1, { mode: 'slow', open: true }) },
          h('span', { html: icon('arrowLeft', 15) }), '上一句'),
        h('span', { class: 'small muted' }, '听完讲解再点“下一句”，也可以说“下一句”'),
        h('button', { class: 'btn btn-soft btn-sm', type: 'button', disabled: current === dialogue.lines.length - 1, onclick: () => playIndex(current + 1, { mode: 'slow', open: true }) },
          '下一句 ', h('span', { html: icon('arrowRight', 15) }))));
  }

  function renderBlind() {
    const done = stats.blindPass > 0;
    return h('div', { class: 'listen-blind' },
      h('div', { class: 'blind-panel' },
        h('div', { class: 'blind-icon', html: icon('headphones', 26) }),
        h('h3', {}, done ? '再听一遍，确认细节' : '盲听：不看文本，只听'),
        h('p', { class: 'small muted' }, '正常语速连播，一句接一句。播完自动进入精听；可以随时暂停、上一句、下一句，或说“随机一句”。'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => playIndex(0, { mode: 'normal' }) },
          h('span', { html: icon('play', 16) }), done ? '再盲听一遍' : '开始盲听')),
      h('div', { class: 'blind-progress' }, `第 ${current + 1} / ${dialogue.lines.length} 句 · ${done ? '已完成盲听' : '盲听中请先别看文本'}`),
      lineDots(),
      reveal
        ? h('div', { class: 'blind-text' }, dialogue.lines.map((line, index) => h('p', { class: index === current ? 'active' : '' },
          h('span', { class: 'll-index' }, `${index + 1}.`), ` ${line.text}`)))
        : h('p', { class: 'tiny faint', style: 'text-align:center' }, '文本已隐藏；点播放器“显示文本”可以对照。'));
  }

  function renderIntensive() {
    const list = h('div', { class: 'listen-lines' });
    dialogue.lines.forEach((line, index) => {
      const open = openStructures.has(index);
      const row = h('div', {
        class: `listen-line${index === current ? ' active' : ''}`,
        role: 'button',
        tabindex: '0',
        onclick: () => playIndex(index, { mode: 'normal' }),
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            playIndex(index, { mode: 'normal' });
          }
        },
      },
      h('div', { class: 'll-top' },
        h('span', { class: `ll-speaker${line.speaker === 'B' ? ' b' : ''}` }, line.speaker),
        h('span', { class: 'll-index' }, `第 ${index + 1} 句`),
        h('span', { class: 'spacer' }),
        structureToggle(index),
        h('button', {
          class: 'link-btn',
          type: 'button',
          onclick: (event) => {
            event.stopPropagation();
            playIndex(index, { mode: 'slow' });
          },
        }, '0.7× 慢速')),
      sentenceView(line, { open }),
      showZh ? h('p', { class: 'll-zh' }, line.zh) : null,
      detailPanel(line, index));
      list.append(row);
    });
    return h('div', { class: 'listen-intensive' },
      h('div', { class: 'intensive-bar' },
        h('span', { class: 'small muted' }, '点任意句子重听；也可以用语音说“第 5 句”“随机一句”。'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox',
            checked: showZh,
            onchange: (event) => { showZh = event.target.checked; paintStage(); },
          }),
          '显示中文'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: randomLine }, '随机一句')),
      lineDots(),
      list);
  }

  function paintResult() {
    if (phase !== 'result' || !resultSession) { resultCard.replaceChildren(); return; }
    const data = buildListeningResult(resultSession);
    const session = resultSession;
    const statsCards = [
      ['用时', formatDuration(stats.seconds)],
      ['听过句子', `${stats.heard.length}/${session.lines.length}`],
      ['慢速讲解', `${stats.slowPlays} 次`],
      ['盲听', stats.blindPass > 0 ? '完成' : '未完成'],
      ['回放 / 随机', `${stats.replays} 次`],
      ['语音指令', `${stats.voice} 次`],
    ];
    resultCard.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, 'PRACTICE RESULT'),
          h('h2', {}, session.title),
          h('p', { class: 'small muted' }, `${session.topic || '未命名话题'} · ${session.lines.length} 句 · Band ${Number(session.band).toFixed(1)} · ${sourceLabel(session.source)}`)),
        h('span', { class: 'badge ok' }, '已生成全文与对照')),
      h('div', { class: 'result-stats' }, statsCards.map(([label, value]) => h('div', { class: 'rs-item' },
        h('b', {}, value), h('span', {}, label)))),
      h('div', { class: 'result-lines' }, data.lines.map((line) => h('div', { class: 'result-line' },
        h('div', { class: 'rl-head' },
          h('span', { class: 'll-index' }, line.number),
          h('span', { class: `ll-speaker${line.speaker === 'B' ? ' b' : ''}` }, line.speaker)),
        h('p', { class: 'rl-en' }, line.text),
        h('p', { class: 'rl-zh' }, line.zh)))),
      h('div', { class: 'result-actions no-print' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: copyResult }, h('span', { html: icon('book', 16) }), '复制全文 + 对照'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => window.print() }, h('span', { html: icon('printer', 16) }), '打印 / 存 PDF'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: replaySame }, h('span', { html: icon('refresh', 16) }), '再练一次'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: resetAll }, '换个话题')));
  }

  function paintRecent() {
    const sessions = listListeningSessions();
    if (!sessions.length) {
      recentCard.classList.add('hidden');
      recentCard.replaceChildren();
      return;
    }
    recentCard.classList.remove('hidden');
    recentCard.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {},
          h('h3', {}, '最近的听力练习'),
          h('p', { class: 'small muted' }, '全文和对照翻译保存在本机，最多 8 份。'))),
      h('div', { class: 'recent-list' }, sessions.map((session) => h('button', {
        class: 'recent-item',
        type: 'button',
        onclick: () => openRecent(session),
      },
      h('div', { class: 'ri-main' },
        h('div', { class: 'ri-title' }, session.title),
        h('div', { class: 'ri-meta' }, `${session.topic || '未命名'} · ${formatDuration(session.stats?.seconds || 0)} · ${session.lines?.length || 0} 句`)),
      h('div', { class: 'ri-score' }, sourceLabel(session.source)),
      h('span', { html: icon('chevronRight', 16) })))),
    );
  }

  /* ---------- playback ---------- */

  function markHeard(index) {
    if (!stats.heard.includes(index)) stats.heard.push(index);
  }

  function clampIndex(index) {
    return Math.max(0, Math.min(dialogue.lines.length - 1, index));
  }

  function clearPlayTimer() {
    if (playTimer) clearTimeout(playTimer);
    playTimer = null;
  }

  function playIndex(index, { mode = rateMode, open = false } = {}) {
    if (!dialogue) return;
    if (!ttsSupported) return toast('当前浏览器不支持语音朗读，可先阅读文本。', 'err');
    clearPlayTimer();
    stopSpeaking();
    current = clampIndex(index);
    if (open && phase === 'slow') openStructures.add(current);
    rateMode = mode === 'slow' ? 'slow' : 'normal';
    playing = true;
    paused = false;
    markHeard(current);
    if (mode === 'slow') stats.slowPlays += 1;
    else if (phase !== 'blind') stats.normalPlays += 1;
    persist();
    paintStage();
    paintPlayer();
    paintClock();
    const line = dialogue.lines[current];
    speak(line.text, {
      rate: rateMode === 'slow' ? 0.68 : 0.95,
      lang: 'en-GB',
      onEnd: handleLineEnd,
    });
  }

  function handleLineEnd() {
    playing = false;
    if (!mounted) return;
    if (phase === 'blind') {
      if (current < dialogue.lines.length - 1) {
        playTimer = setTimeout(() => playIndex(current + 1, { mode: 'normal' }), 420);
        paintPlayer();
        return;
      }
      stats.blindPass += 1;
      phase = 'intensive';
      rateMode = 'normal';
      reveal = true;
      toast('盲听完成，进入精听：点任意句子反复听。', 'ok', 2600);
      persist();
      paint();
      return;
    }
    if (autoAdvance && phase === 'slow' && current < dialogue.lines.length - 1) {
      playTimer = setTimeout(() => playIndex(current + 1, { mode: 'slow', open: true }), 1500);
    }
    paintPlayer();
  }

  function togglePlay() {
    if (playing) {
      pauseSpeaking();
      playing = false;
      paused = true;
      paintPlayer();
      return;
    }
    if (paused) {
      resumeSpeaking();
      paused = false;
      playing = true;
      paintPlayer();
      return;
    }
    playIndex(current, { mode: phase === 'slow' ? 'slow' : rateMode });
  }

  function move(delta) {
    if (!dialogue) return;
    const next = clampIndex(current + delta);
    if (next === current) return;
    playIndex(next, { mode: phase === 'slow' ? 'slow' : rateMode, open: phase === 'slow' });
  }

  function jumpTo(index) {
    playIndex(index, { mode: phase === 'slow' ? 'slow' : 'normal', open: phase === 'slow' });
  }

  function randomLine() {
    if (!dialogue) return;
    if (dialogue.lines.length < 2) return playIndex(0, { mode: rateMode });
    let next = current;
    while (next === current) next = Math.floor(Math.random() * dialogue.lines.length);
    stats.replays += 1;
    playIndex(next, { mode: rateMode });
  }

  function toggleRate() {
    rateMode = rateMode === 'slow' ? 'normal' : 'slow';
    if (playing) playIndex(current, { mode: rateMode });
    paintPlayer();
  }

  function toggleReveal() {
    reveal = !reveal;
    if (phase === 'blind') paintStage();
    paintPlayer();
  }

  function stopPlayback() {
    clearPlayTimer();
    stopSpeaking();
    playing = false;
    paused = false;
    paintPlayer();
  }

  function setPhase(next) {
    if (!dialogue) return;
    clearPlayTimer();
    stopSpeaking();
    playing = false;
    paused = false;
    phase = next;
    if (next === 'preview' || next === 'blind' || next === 'intensive') openStructures.clear();
    if (next === 'slow') {
      rateMode = 'slow';
      current = clampIndex(current);
      openStructures.add(current);
    }
    if (next === 'blind') {
      rateMode = 'normal';
      reveal = false;
      current = 0;
    }
    if (next === 'intensive') {
      rateMode = 'normal';
      reveal = true;
    }
    persist();
    paint();
    if (next === 'slow') playIndex(current, { mode: 'slow', open: true });
  }

  /* ---------- voice ---------- */

  function describeCommand(command) {
    const labels = { play: '播放', pause: '暂停', stop: '停止', next: '下一句', prev: '上一句', repeat: '重播', random: '随机一句', slow: '慢速', normal: '正常语速', show: '显示文本', hide: '隐藏文本', finish: '生成结果' };
    if (command.intent === 'line') return `第 ${command.index + 1} 句`;
    return labels[command.intent] || command.intent;
  }

  function executeCommand(command) {
    stats.voice += 1;
    if (command.intent === 'play') {
      if (paused) {
        resumeSpeaking();
        paused = false;
        playing = true;
        paintPlayer();
      } else if (!playing) {
        playIndex(current, { mode: phase === 'slow' ? 'slow' : rateMode });
      }
      return;
    }
    if (command.intent === 'pause') {
      clearPlayTimer();
      if (playing) {
        pauseSpeaking();
        playing = false;
        paused = true;
        paintPlayer();
      }
      return;
    }
    if (command.intent === 'stop') return stopPlayback();
    if (command.intent === 'next') return move(1);
    if (command.intent === 'prev') return move(-1);
    if (command.intent === 'repeat') {
      stats.replays += 1;
      return playIndex(current, { mode: rateMode });
    }
    if (command.intent === 'random') return randomLine();
    if (command.intent === 'slow') {
      rateMode = 'slow';
      if (playing) playIndex(current, { mode: 'slow' });
      else paintPlayer();
      return;
    }
    if (command.intent === 'normal') {
      rateMode = 'normal';
      if (playing) playIndex(current, { mode: 'normal' });
      else paintPlayer();
      return;
    }
    if (command.intent === 'show') {
      reveal = true;
      paintStage();
      paintPlayer();
      return;
    }
    if (command.intent === 'hide') {
      reveal = false;
      paintStage();
      paintPlayer();
      return;
    }
    if (command.intent === 'line') return jumpTo(command.index);
    if (command.intent === 'finish') return finish();
  }

  function toggleVoice() {
    if (!recognitionSupported) return toast('请使用 Chrome 或 Edge 使用语音控制。', 'err');
    if (listener?.active) {
      listener.stop();
      return;
    }
    clearPlayTimer();
    if (playing) {
      pauseSpeaking();
      playing = false;
      paused = true;
      paintPlayer();
    }
    listener = new Listener({
      lang: 'zh-CN',
      continuous: false,
      onResult: (value) => {
        const command = parseListeningCommand(value);
        if (!command) {
          heardLine.textContent = `没听懂：“${value.slice(0, 30)}”，可以说“下一句”或“随机一句”。`;
          return;
        }
        heardLine.textContent = `“${value.slice(0, 26)}” → ${describeCommand(command)}`;
        executeCommand(command);
      },
      onInterim: (value) => { heardLine.textContent = `听到：${value}`; },
      onEnd: () => { voiceBtn.classList.remove('listening'); },
      onError: (message) => {
        voiceBtn.classList.remove('listening');
        if (message) toast(message, 'err');
      },
    });
    if (listener.start()) {
      voiceBtn.classList.add('listening');
      heardLine.textContent = '正在聆听指令…（说完会自动继续，媒体键也可控制）';
    }
  }

  function toggleTopicMic() {
    if (!recognitionSupported) return toast('请使用 Chrome 或 Edge 使用语音输入。', 'err');
    if (topicListener?.active) {
      topicListener.stop();
      return;
    }
    topicListener = new Listener({
      lang: topicLang.value || 'zh-CN',
      continuous: false,
      onResult: (value) => {
        const topic = value.trim();
        if (!topic) return;
        topicInput.value = topic;
        toast(`已填入话题：${topic}`, 'ok');
      },
      onInterim: (value) => { genStatus.textContent = `听到：${value}`; },
      onEnd: () => { topicMic.classList.remove('listening'); genStatus.textContent = ''; },
      onError: (message) => {
        topicMic.classList.remove('listening');
        if (message) toast(message, 'err');
      },
    });
    if (topicListener.start()) {
      topicMic.classList.add('listening');
      genStatus.textContent = '正在听你说话题…';
    }
  }

  /* ---------- generation ---------- */

  async function generate() {
    const topic = topicInput.value.trim();
    if (topic.length < 2) return toast('先输入一个话题，例如“在咖啡店点单”。', 'err');
    if (generating) return;
    generating = true;
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class="spinner dark"></span> 生成中…`;
    genStatus.textContent = aiReady(settings)
      ? 'AI 正在写 12 句对话，并加上翻译、结构讲解和关键词…'
      : '未配置 API Key，将使用本地对话模板。';
    try {
      let next = null;
      if (aiReady(settings)) {
        try {
          const prompt = buildDialoguePrompt(topic, { band });
          const data = await chat({
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            json: true,
            maxTokens: 4800,
            temperature: 0.45,
          });
          next = parseDialogue(data.content, { topic, band, source: 'ai' });
          if (!next) throw new Error('返回的对话格式不完整');
        } catch (error) {
          toast(`AI 生成失败，已改用本地模板：${error.message}`, 'err', 5200);
        }
      }
      if (!mounted) return;
      if (!next) next = localDialogue(topic, { band });
      dialogue = next;
      phase = 'preview';
      current = 0;
      openStructures.clear();
      setLessonVocabulary(dialogue);
      setStats(freshStats());
      finishedAt = null;
      resultSession = null;
      clearPlayTimer();
      stopSpeaking();
      playing = false;
      paused = false;
      saveCurrentListening({ dialogue, phase, current, stats: { ...stats, heard: [] } });
      startClock();
      paint();
      toast(next.source === 'ai' ? '对话已生成，先预读一遍。' : '已生成本地模板对话。', 'ok');
    } finally {
      generating = false;
      generateBtn.disabled = false;
      generateBtn.innerHTML = `${icon('sparkles', 16)}生成对话`;
      genStatus.textContent = '';
    }
  }

  /* ---------- result actions ---------- */

  async function copyResult() {
    if (!resultSession) return;
    const data = buildListeningResult(resultSession);
    const text = `${resultSession.title}\n\n${data.bilingual}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制全文与对照翻译。', 'ok');
    } catch {
      toast('复制失败，请手动选择文本。', 'err');
    }
  }

  function finish() {
    if (!dialogue) return;
    clearPlayTimer();
    stopSpeaking();
    playing = false;
    paused = false;
    stopClock();
    listener?.abort();
    voiceBtn.classList.remove('listening');
    finishedAt = new Date().toISOString();
    const snapshot = {
      id: dialogue.id,
      topic: dialogue.topic,
      title: dialogue.title,
      band: dialogue.band,
      source: dialogue.source,
      createdAt: dialogue.createdAt,
      lines: dialogue.lines,
      stats: { ...stats, heard: [...stats.heard] },
      finishedAt,
    };
    resultSession = { ...snapshot, stats: { ...stats, heard: [...stats.heard] } };
    phase = 'result';
    saveListeningSession(snapshot);
    saveCurrentListening({ dialogue, phase, current, stats: { ...stats, heard: [...stats.heard] }, finishedAt });
    paint();
    toast('练习结果已生成：全文 + 对照翻译。', 'ok');
  }

  function replaySame() {
    if (!dialogue) return;
    phase = 'preview';
    current = 0;
    openStructures.clear();
    setStats(freshStats());
    finishedAt = null;
    resultSession = null;
    reveal = false;
    rateMode = 'normal';
    playing = false;
    paused = false;
    saveCurrentListening({ dialogue, phase, current, stats: { ...stats, heard: [] } });
    startClock();
    paint();
  }

  function regenerate() {
    if (!dialogue) return;
    const topic = dialogue.topic || topicInput.value.trim();
    if (!topic) return toast('先输入一个话题。', 'err');
    topicInput.value = topic;
    toast('正在按同一话题重新生成…', 'info', 2200);
    generate();
  }

  function resetAll() {
    clearPlayTimer();
    stopSpeaking();
    listener?.abort();
    topicListener?.abort();
    stopClock();
    dialogue = null;
    phase = 'preview';
    current = 0;
    openStructures.clear();
    setStats(freshStats());
    finishedAt = null;
    resultSession = null;
    playing = false;
    paused = false;
    listener?.abort();
    topicListener?.abort();
    voiceBtn.classList.remove('listening');
    topicMic.classList.remove('listening');
    reveal = false;
    clearCurrentListening();
    clearLessonVocabulary();
    paint();
    topicInput.focus();
  }

  function openRecent(session) {
    if (!session?.lines?.length) return;
    clearPlayTimer();
    stopSpeaking();
    playing = false;
    paused = false;
    listener?.abort();
    voiceBtn.classList.remove('listening');
    dialogue = {
      id: session.id,
      topic: session.topic,
      title: session.title,
      band: session.band,
      source: session.source,
      createdAt: session.createdAt,
      lines: session.lines,
    };
    setLessonVocabulary(dialogue);
    setStats(session.stats || freshStats());
    finishedAt = session.finishedAt || null;
    phase = 'result';
    current = 0;
    openStructures.clear();
    resultSession = { ...dialogue, stats, finishedAt };
    stopClock();
    saveCurrentListening({ dialogue, phase, current, stats: { ...stats }, finishedAt });
    paint();
  }

  /* ---------- boot ---------- */

  if (dialogue && phase !== 'result') startClock();
  if (dialogue && phase === 'slow') openStructures.add(current);
  paint();

  return {
    el,
    title: '听力实验室 · EnOS',
    cleanup() {
      mounted = false;
      clearPlayTimer();
      stopClock();
      listener?.abort();
      topicListener?.abort();
      stopSpeaking();
      if (dialogue) persist();
    },
  };
}
