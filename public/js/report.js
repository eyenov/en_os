import { aiReady, chat } from './api.js';
import { summarizeSession, reportPrompt } from './engine.js';
import { getSessionById, getSettings, updateStoredSession } from './store.js';
import { getScene } from './scenes.js';
import { formatDate, h, icon, toast } from './ui.js';
import { formatDuration } from './scoring.js';

const id = new URLSearchParams(window.location.search).get('id');
const root = document.getElementById('report');

function firstSentence(text = '') {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean;
}

function radarChart(modules) {
  const size = 300;
  const center = size / 2;
  const radius = 96;
  const count = modules.length;
  const angleFor = (index) => -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const point = (index, value) => {
    const angle = angleFor(index);
    return [center + Math.cos(angle) * radius * value, center + Math.sin(angle) * radius * value];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((ring) => {
    const points = modules.map((_, index) => point(index, ring).map((value) => value.toFixed(1)).join(',')).join(' ');
    return `<polygon points="${points}" fill="none" stroke="#e2dacb" stroke-width="1"/>`;
  }).join('');
  const axes = modules.map((_, index) => {
    const [x, y] = point(index, 1);
    return `<line x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2dacb" stroke-width="1"/>`;
  }).join('');
  const shape = modules.map((module, index) => point(index, Math.max(0.06, (module.score ?? 0) / 100)).map((value) => value.toFixed(1)).join(',')).join(' ');
  const dots = modules.map((module, index) => {
    const [x, y] = point(index, Math.max(0.06, (module.score ?? 0) / 100));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="${module.color}"/>`;
  }).join('');
  const labels = modules.map((module, index) => {
    const [x, y] = point(index, 1.2);
    const anchor = Math.abs(x - center) < 20 ? 'middle' : x > center ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-family="Segoe UI, sans-serif" fill="#70695d">${module.name} ${module.score ?? '—'}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="四项能力雷达图">
    ${rings}${axes}
    <polygon points="${shape}" fill="rgba(73,56,239,0.16)" stroke="#4938ef" stroke-width="1.8"/>
    ${dots}${labels}
  </svg>`;
}

function moduleAccuracy(module) {
  if (module.score === null) return '未开始';
  if (module.id === 'writing') return module.accuracy ? `Band ${Number(module.accuracy).toFixed(1)}` : '待评分';
  return `${Math.round((module.accuracy || 0) * 100)}%`;
}

function achievementPercent(item) {
  const target = Number(item.target) || 1;
  return Math.max(0, Math.min(100, (Number(item.actual) / target) * 100));
}

function render(session) {
  if (!session) {
    root.append(h('div', { class: 'empty-page' },
      h('p', { class: 'eyebrow' }, '报告不存在'),
      h('h1', {}, '这份报告可能已经被清理。'),
      h('p', { class: 'lede' }, '报告保存在生成它的浏览器里。换设备或清空本机数据后，就无法再打开。'),
      h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
        h('a', { class: 'btn btn-primary', href: '/' }, '开始新的学习'),
        h('a', { class: 'btn btn-ghost', href: '/#/reports' }, '全部报告'),
      ),
    ));
    return;
  }

  const summary = session.summary || summarizeSession(session);
  const scene = getScene(session.sceneId);
  const band = summary.band;
  const minutes = summary.totalSeconds >= 60 ? Math.round(summary.totalSeconds / 60) : '<1';
  const text = firstSentence(session.input?.text);
  const headline = text.length > 74 ? `${text.slice(0, 74)}…` : text;

  const heroStats = [
    ['综合得分', String(summary.overall)],
    ['估算 Band', Number(band).toFixed(1)],
    ['学习时长', `${minutes} 分钟`],
    ['词汇接触', `${summary.vocab.exposures} 次`],
  ];

  /* ---------- section 1: input & goals ---------- */
  const inputSection = h('section', { class: 'card report-section' },
    h('h2', {}, h('span', { class: 'num' }, '1'), '这次学了什么'),
    h('p', { class: 'section-note' }, '报告的起点是你的原始输入；所有任务与判定都从这里生长出来。'),
    h('div', { class: 'quote-block' }, text, h('div', { class: 'q-meta' },
      `${session.sourceLabel || '自定义文本'} · ${session.input.words || summary.analysis.stats.words} 词 · ${session.input.sentences || summary.analysis.stats.sentences} 句 · 目标 Band ${session.band} · ${scene.name}场景`)),
    h('div', { class: 'report-grid-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '雅思考点拆解'),
        h('div', { style: 'display:grid;gap:10px' }, summary.analysis.points.map((point) => h('div', {},
          h('div', { class: 'badge accent' }, point.label),
          h('p', { class: 'small muted', style: 'margin-top:4px' }, point.detail),
        )))),
      h('div', { class: 'panel' },
        h('h3', {}, '本次目标'),
        h('div', { class: 'check-list' },
          h('div', { class: 'check-item met' }, h('span', { class: 'check-box' }), h('span', {}, `8 个微任务，每步 ≤ 5 分钟`)),
          h('div', { class: 'check-item met' }, h('span', { class: 'check-box' }), h('span', {}, `核心词 ${summary.vocab.core.length} 个，词汇接触目标 ${summary.vocab.target} 次`)),
          h('div', { class: 'check-item met' }, h('span', { class: 'check-box' }), h('span', {}, `语法接触目标 ${summary.grammar.target} 次`)),
          h('div', { class: 'check-item met' }, h('span', { class: 'check-box' }), h('span', {}, `听力 / 阅读 ≥ 80%，口语 ≥ 75%，写作 ≥ Band 6.0`)),
        ),
        h('div', { class: 'callout', style: 'margin-top:12px', html: `${icon('target', 16)}<span>通关判定由“点击或语音完成 + 正确率 / 评分”共同决定，不是只看是否翻到下一页。</span>` })),
    ),
  );

  /* ---------- section 2: overview ---------- */
  const achievementRows = summary.achievements.map((item) => {
    const percent = achievementPercent(item);
    return h('tr', {},
      h('td', {}, item.label),
      h('td', { style: 'min-width:110px' },
        h('div', { class: 'bar' }, h('i', { class: item.met ? 'ok' : 'warn', style: `width:${percent}%` })),
      ),
      h('td', {}, `${item.actual}${item.unit === '%' ? '%' : item.unit === 'Band' ? '' : ` ${item.unit}`} / ${item.target}${item.unit === '%' ? '%' : item.unit === 'Band' ? '' : ` ${item.unit}`}`),
    );
  });

  const overviewSection = h('section', { class: 'card report-section' },
    h('h2', {}, h('span', { class: 'num' }, '2'), '目标 vs 达成'),
    h('p', { class: 'section-note' }, '量化标准在开始时就确定：词汇、语法、四项正确率与写作 Band。'),
    h('div', { class: 'report-grid-2' },
      h('div', { class: 'panel' }, h('h3', {}, '达成度'), h('table', { class: 'metric-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '指标'), h('th', {}, '进度'), h('th', {}, '实际 / 目标'))),
        h('tbody', {}, achievementRows),
      )),
      h('div', { class: 'panel radar-panel' },
        h('h3', {}, '四项能力雷达'),
        h('div', { html: radarChart(summary.moduleStats) }),
        h('div', { class: 'radar-legend' }, summary.moduleStats.map((module) => h('span', {},
          h('i', { style: `background:${module.color}` }), `${module.name} ${module.score ?? '—'}`))),
      ),
    ),
    h('div', { class: 'module-report-grid' }, summary.moduleStats.map((module) => {
      const steps = summary.timeline.filter((item) => item.module === module.id);
      return h('div', { class: 'module-report', style: `--mod-color:${module.color};--mod-soft:${module.soft}` },
        h('div', { class: 'mr-head' },
          h('span', { class: 'mr-icon', html: icon(module.icon, 16) }),
          h('div', {}, h('div', { class: 'mr-name' }, module.name), h('div', { class: 'mr-en' }, module.en)),
          h('div', { class: 'mr-score' }, module.score == null ? '—' : String(module.score), h('small', {}, ' /100')),
        ),
        h('div', { class: 'mr-bar' }, h('i', { style: `width:${module.score || 0}%` })),
        h('div', { class: 'mr-meta' }, `${module.completed}/${steps.length} 步达标 · ${moduleAccuracy(module)}`),
        h('div', { class: 'mr-why' }, module.why),
        h('div', { class: 'check-list', style: 'margin-top:2px' }, steps.map((item) => h('div', { class: `check-item ${item.completed ? 'met' : ''}` },
          h('span', { class: 'check-box' }),
          h('span', {}, `${item.title} · ${item.word}`, h('em', { class: 'ci-detail' }, `${item.score} 分 · ${formatDuration(item.timeSpent)}`)),
        ))),
      );
    })),
  );

  /* ---------- section 3: vocab & grammar ---------- */
  const vocabSection = h('section', { class: 'card report-section' },
    h('h2', {}, h('span', { class: 'num' }, '3'), '词汇与语法清单'),
    h('p', { class: 'section-note' }, `词汇接触 ${summary.vocab.exposures}/${summary.vocab.target} 次，去重后 ${summary.vocab.unique} 个词与词块；语法点 ${summary.grammar.points.length} 个。`),
    h('h3', { style: 'margin-top:16px' }, `核心词 · ${summary.vocab.core.length} 个`),
    summary.vocab.core.length
      ? h('div', { class: 'vocab-grid' }, summary.vocab.core.map((word) => h('div', { class: 'vocab-item core' },
        h('div', { class: 'vi-word' }, word.word),
        h('div', { class: 'vi-ipa' }, word.ipa),
        h('div', { class: 'vi-zh' }, `${word.pos} ${word.zh}`),
      )))
      : h('p', { class: 'small faint' }, '还没有完成的核心词。'),
    h('h3', { style: 'margin-top:18px' }, `衍生词块 · ${summary.vocab.derived.length} 个（去重）`),
    h('div', { class: 'derived-grid' }, summary.vocab.derived.map((item) => h('span', {}, item.term,
      h('em', {}, item.type === 'chunk' ? 'chunk' : item.type === 'family' ? 'family' : item.type === 'scene' ? 'scene' : 'syn')))),
    h('h3', { style: 'margin-top:20px' }, `语法点 · ${summary.grammar.points.length} 个`),
    h('div', { class: 'report-grid-2', style: 'margin-top:10px' }, summary.grammar.points.map((point) => h('div', { class: 'panel' },
      h('h3', {}, point.name),
      h('p', { class: 'mono small', style: 'color:var(--accent)' }, point.pattern),
      h('p', { class: 'small muted', style: 'margin-top:4px' }, point.tip),
      h('p', { class: 'small', style: 'margin-top:6px;font-family:var(--serif)' }, point.example),
    ))),
  );

  /* ---------- section 4: timeline ---------- */
  const timelineSection = h('section', { class: 'card report-section' },
    h('h2', {}, h('span', { class: 'num' }, '4'), '8 步学习路径'),
    h('p', { class: 'section-note' }, '每一步的时长、得分与是否达标，都来自当时的真实操作。'),
    h('div', { class: 'timeline' }, summary.timeline.map((item) => h('div', { class: `timeline-item ${item.completed ? 'done' : ''}` },
      h('span', { class: 'ti-dot' }),
      h('div', {},
        h('div', { class: 'ti-title' }, `${String(item.index + 1).padStart(2, '0')} · ${item.title} · ${item.word}`),
        h('div', { class: 'ti-meta' }, `${summary.moduleStats.find((module) => module.id === item.module)?.name || ''} · ${formatDuration(item.timeSpent)}`),
      ),
      h('div', { class: 'ti-score' }, item.completed ? `${item.score} 分` : '未完成'),
    ))),
  );

  /* ---------- section 5: coaching ---------- */
  const narrativeHost = h('div', { class: 'ai-narrative' });
  const coachingSection = h('section', { class: 'card report-section' },
    h('h2', {}, h('span', { class: 'num' }, '5'), '下一轮怎么练'),
    h('div', { class: 'report-grid-2', style: 'margin-top:12px' },
      h('div', { class: 'panel' },
        h('h3', {}, '做得好的'),
        h('ul', { class: 'strength-list', style: 'list-style:none;padding:0;margin:0' }, summary.strengths.map((item) => h('li', {}, item))),
      ),
      h('div', { class: 'panel' },
        h('h3', {}, '下一轮优先'),
        h('ul', { class: 'strength-list', style: 'list-style:none;padding:0;margin:0' }, summary.next.map((item) => h('li', {}, item))),
      ),
    ),
    narrativeHost,
  );

  root.append(
    h('div', { class: 'report-topbar' },
      h('div', { class: 'page-head', style: 'margin:0' },
        h('p', { class: 'eyebrow' }, 'Learning Report'),
        h('h1', {}, '这一轮，你把一句话走成了四项能力。'),
      ),
    ),
    h('section', { class: 'report-hero' },
      h('div', {},
        h('p', { class: 'eyebrow' }, `${scene.name}场景 · ${formatDate(session.finishedAt || session.createdAt)}`),
        h('h1', {}, headline || '一段输入，四项进展。'),
        h('p', { class: 'rh-sub' }, `目标 Band ${session.band} · 实际完成 ${summary.completedSteps}/${summary.totalSteps} 步 · ${session.mode === 'local' ? '本地引擎' : 'AI 增强'} · 用时 ${minutes} 分钟`),
        h('div', { class: 'rh-badge' }, h('span', { html: icon('sparkles', 14) }), `综合 Band 估算 ${Number(band).toFixed(1)}`),
      ),
      h('div', { class: 'rh-stats' }, heroStats.map(([label, value]) => h('div', { class: 'rh-stat' },
        h('strong', {}, value), h('span', {}, label)))),
    ),
    h('div', { class: 'report-body' },
      inputSection,
      overviewSection,
      vocabSection,
      timelineSection,
      coachingSection,
      h('div', { class: 'report-foot' },
        h('span', {}, `报告生成于 ${formatDate(session.finishedAt || new Date())} · 会话 ${session.id}`),
        h('span', {}, 'EnOS · 8 步 × 5 分钟'),
      ),
    ),
  );

  loadNarrative(session, summary, narrativeHost);
}

async function loadNarrative(session, summary, host) {
  if (!aiReady(getSettings())) {
    host.remove();
    return;
  }
  host.append(h('h3', {}, h('span', { html: icon('sparkles', 15) }), 'AI 教练总结'),
    h('p', { class: 'small muted' }, '正在根据本轮数据写一段总结…'));
  try {
    const prompt = reportPrompt(session, summary);
    const data = await chat({
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      json: true,
      maxTokens: 700,
      temperature: 0.5,
    });
    const parsed = (() => {
      const cleaned = String(data.content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      try { return JSON.parse(cleaned); } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; } }
        return null;
      }
    })();
    if (!parsed?.summaryZh) {
      host.remove();
      return;
    }
    host.replaceChildren(
      h('h3', {}, h('span', { html: icon('sparkles', 15) }), parsed.headline || 'AI 教练总结'),
      h('p', {}, parsed.summaryZh),
      Array.isArray(parsed.strengths) && parsed.strengths.length ? h('p', { class: 'small' }, `优势：${parsed.strengths.join('；')}`) : null,
      Array.isArray(parsed.nextSteps) && parsed.nextSteps.length ? h('p', { class: 'small' }, `下一步：${parsed.nextSteps.join('；')}`) : null,
    );
    session.narrative = parsed;
    updateStoredSession(session);
  } catch (error) {
    host.remove();
    console.warn('narrative failed', error);
  }
}

function exportJSON(session) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `enos-report-${session.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 JSON', 'ok', 1800);
}

document.getElementById('print-btn')?.addEventListener('click', () => window.print());
document.getElementById('export-btn')?.addEventListener('click', () => {
  const session = getSessionById(id);
  if (session) exportJSON(session);
  else toast('报告不存在', 'err');
});

const session = getSessionById(id);
if (session && !session.summary) {
  session.summary = summarizeSession(session);
  updateStoredSession(session);
}
if (session) document.title = `${session.summary?.overall ?? ''} 分 · 学习报告 · EnOS`;
render(session);
