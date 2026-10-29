import {
  applyAIStep,
  buildLocalStep,
  buildStepPrompt,
  evaluateStep,
  MODULES,
  MODULE_MAP,
  STEP_SPECS,
  summarizeSession,
} from '../engine.js';
import { aiReady, chat, loadBank } from '../api.js';
import {
  getCurrentSession,
  getSettings,
  saveCurrentSession,
  saveFinishedSession,
} from '../store.js';
import { getScene } from '../scenes.js';
import { Listener, parseCommand, recognitionSupported, stopSpeaking } from '../speech.js';
import { h, icon, toast } from '../ui.js';
import { sceneArt } from '../art.js';
import { renderTask } from './tasks.js';
import { formatDuration } from '../scoring.js';

export async function renderSession(ctx) {
  const session = getCurrentSession();
  if (!session) {
    return {
      el: h('div', { class: 'empty-page' },
        h('p', { class: 'eyebrow' }, '没有进行中的学习'),
        h('h1', {}, '先给 EnOS 一句话。'),
        h('p', { class: 'lede' }, '输入一段英文，系统会拆成 8 个 5 分钟任务；也可以从历史报告里回顾。'),
        h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
          h('a', { class: 'btn btn-primary', href: '#/home' }, '去输入'),
          h('a', { class: 'btn btn-ghost', href: '#/reports' }, '看报告'),
        ),
      ),
      title: 'EnOS · 学习',
    };
  }

  const { words: bank } = await loadBank();
  const settings = getSettings();
  const aiEnabled = aiReady(settings);
  const scene = getScene(session.sceneId);
  let index = Number.isInteger(session.currentIndex) ? session.currentIndex : 0;
  index = Math.max(0, Math.min(STEP_SPECS.length - 1, index));
  if (session.results?.[index]?.completed && index < STEP_SPECS.length - 1) {
    while (session.results?.[index]?.completed && index < STEP_SPECS.length - 1) index += 1;
  }

  let step = null;
  let progress = { checks: {}, evidence: {} };
  let evaluation = null;
  let elapsed = 0;
  let timerId = null;
  let timerLimit = 300;
  let timerRunning = false;
  let completedNotified = false;
  let listener = null;
  let continuousVoice = false;
  let mounted = false;
  let finished = false;
  let savingTimer = null;
  let lastTaskCleanup = null;

  /* ---------- shell ---------- */

  const railBox = h('div', { class: 'card session-rail' });
  const stepHead = h('div', { class: 'step-head' });
  const stepTitle = h('h1', { class: 'step-title' });
  const stepFocus = h('p', { class: 'step-focus' });
  const stepContext = h('div', { class: 'step-context' });
  const taskHost = h('div', { class: 'task' });
  const hintBox = h('div', { class: 'callout hidden', style: 'margin-top:14px' });
  const feedbackHost = h('div', {});
  const nextButton = h('button', { class: 'btn btn-primary next-btn', type: 'button', disabled: true, onclick: attemptNext }, '下一步');
  const remainingText = h('span', { class: 'remaining' });
  const footer = h('div', { class: 'step-footer' },
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-voice-hint': 'true', onclick: toggleHint }, h('span', { html: icon('bulb', 16) }), '提示'),
    h('span', { class: 'spacer' }),
    remainingText,
    nextButton,
  );
  const stepCard = h('div', { class: 'card step-card' }, stepHead, stepTitle, stepFocus, stepContext, taskHost, hintBox, feedbackHost, footer);

  const timerValue = h('div', { class: 'timer-big' }, '5:00');
  const timerTrack = h('div', { class: 'timer-track' }, h('div', { class: 'fill' }));
  const timerNote = h('div', { class: 'timer-note' }, '本步计时 · 超过 5 分钟也可以完成');
  const timerCard = h('div', { class: 'card side-card timer-box' },
    h('h4', {}, h('span', { html: icon('clock', 15) }), '本步计时'),
    timerValue,
    timerNote,
    timerTrack,
  );

  const checklist = h('div', { class: 'check-list' });
  const checklistCard = h('div', { class: 'card side-card' },
    h('h4', {}, h('span', { html: icon('target', 15) }), '通关条件'),
    h('div', { class: 'side-sub' }, '全部达标才会解锁「下一步」'),
    checklist,
  );

  const wordCard = h('div', { class: 'card side-card word-side' });
  const grammarCard = h('div', { class: 'card side-card' },
    h('h4', {}, h('span', { html: icon('book', 15) }), '本步语法'),
    h('div', { class: 'grammar-side' }),
  );

  const heardLine = h('div', { class: 'vs-heard' }, '点击右侧麦克风，说 “next step” 或 “下一步”');
  const voiceBtn = h('button', {
    class: 'voice-btn',
    type: 'button',
    'aria-label': '语音助手',
    onclick: toggleVoice,
  }, h('span', { html: icon('mic', 19) }));
  const voiceState = h('div', { class: 'voice-state' },
    h('div', { class: 'vs-title' }, '语音助手'),
    heardLine,
  );
  const voiceCard = h('div', { class: 'card side-card' },
    h('h4', {}, h('span', { html: icon('wave', 15) }), '语音助手'),
    h('div', { class: 'side-sub' }, '说选项、播放、提示或下一步'),
    h('div', { class: 'voice-bar', style: 'margin-top:10px' }, voiceBtn, voiceState),
    h('div', { class: 'voice-commands' },
      h('span', {}, '“play”'), h('span', {}, '“hint”'), h('span', {}, '“B”'), h('span', {}, '“next step”'), h('span', {}, '“下一步”'),
    ),
  );

  const sceneCard = h('div', { class: 'card scene-side' },
    h('div', { class: 'scene-art', html: sceneArt(scene.id, { seed: session.id }) }),
    h('div', { class: 'scene-side-foot' },
      h('div', {}, h('strong', {}, `${scene.name}场景`), h('div', {}, scene.placeholder || '内容会随步骤改写')),
      h('a', { href: '#/home', class: 'link-btn' }, '换场景'),
    ),
  );

  const side = h('aside', { class: 'session-side' },
    timerCard, checklistCard, wordCard, grammarCard, voiceCard, sceneCard,
  );
  const main = h('div', { class: 'session-main' }, stepCard);
  const grid = h('div', { class: 'session-grid' }, main, side);
  const stepMeta = h('div', { class: 'small muted' });

  const el = h('div', { class: 'session' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px' },
      stepMeta,
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: saveAndExit }, '保存并退出'),
    ),
    railBox,
    grid,
  );

  /* ---------- timer ---------- */

  function paintTimer() {
    const remaining = timerLimit - elapsed;
    const display = remaining >= 0 ? formatDuration(remaining) : `+${formatDuration(-remaining)}`;
    timerValue.textContent = display;
    const warn = remaining <= 45;
    timerValue.classList.toggle('warn', warn);
    timerTrack.firstChild.classList.toggle('warn', warn);
    timerTrack.firstChild.style.width = `${Math.max(0, Math.min(100, (remaining / timerLimit) * 100))}%`;
    timerNote.textContent = remaining >= 0 ? '本步计时 · 超过 5 分钟也可以完成' : '已超过 5 分钟，完成本步后再继续';
    const chip = stepHead.querySelector('#timer-chip');
    if (chip) {
      chip.innerHTML = `${icon('clock', 14)}<span>${display}</span>`;
      chip.classList.toggle('warn', warn);
    }
  }

  function startTimer(limit) {
    stopTimer();
    timerLimit = Math.max(60, limit * 60);
    elapsed = 0;
    paintTimer();
    timerRunning = true;
    let last = Date.now();
    timerId = setInterval(() => {
      const now = Date.now();
      const delta = Math.min(3, (now - last) / 1000);
      last = now;
      if (document.visibilityState === 'visible') {
        elapsed += delta;
        paintTimer();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    timerRunning = false;
  }

  /* ---------- rail ---------- */

  function renderRail() {
    const completed = Object.values(session.results || {}).filter((result) => result?.completed).length;
    const modules = h('div', { class: 'module-rail' });
    MODULES.forEach((module, moduleIndex) => {
      const steps = STEP_SPECS.filter((spec) => spec.module === module.id);
      const dots = h('div', { class: 'mn-steps' });
      steps.forEach((spec) => {
        const stepIndex = STEP_SPECS.findIndex((item) => item.key === spec.key);
        const done = Boolean(session.results?.[stepIndex]?.completed);
        const current = stepIndex === index;
        dots.append(h('span', { class: `dot${done ? ' done' : ''}${current ? ' current' : ''}` }));
      });
      const isCurrent = module.id === step?.module;
      modules.append(h('div', { class: `module-node${isCurrent ? ' current' : ''}`, style: `--mod-color:${module.color};--mod-soft:${module.soft}` },
        h('span', { class: 'mn-icon', html: icon(module.icon, 16) }),
        h('div', {}, h('div', { class: 'mn-name' }, module.name), dots),
      ));
    });
    railBox.replaceChildren(
      h('div', { class: 'rail-top' },
        h('div', { class: 'rail-label' }, `已完成 ${completed} / ${STEP_SPECS.length} 步`),
        h('div', { class: 'rail-label' }, `${Math.round((completed / STEP_SPECS.length) * 100)}%`),
      ),
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${(completed / STEP_SPECS.length) * 100}%` })),
      modules,
    );
  }

  /* ---------- step ---------- */

  function buildStep() {
    const existing = session.steps[index];
    if (existing?.key === STEP_SPECS[index].key) return existing;
    const created = buildLocalStep(session, index, bank);
    session.steps[index] = created;
    return created;
  }

  function paintHead() {
    const module = MODULE_MAP[step.module];
    const difficulty = h('span', { class: 'difficulty', 'aria-label': `难度 ${step.difficulty}` },
      [1, 2, 3, 4, 5].map((level) => h('i', { class: level <= step.difficulty ? 'on' : '' })));
    stepHead.replaceChildren(
      h('span', { class: 'module-chip', style: `--mod-color:${module.color};--mod-soft:${module.soft}` },
        h('span', { html: icon(module.icon, 14) }), `${module.name} · ${STEP_SPECS[index].title}`),
      h('span', { class: 'step-index' }, `STEP ${String(index + 1).padStart(2, '0')} / 08`),
      h('span', { class: 'badge', id: 'ai-badge', title: '内容生成方式' }, step.source === 'ai' ? 'AI 场景改写' : (aiEnabled ? '本地初稿' : '本地引擎')),
      h('span', { class: 'spacer' }),
      difficulty,
      h('span', { class: 'timer-chip', id: 'timer-chip', html: `${icon('clock', 14)}<span>5:00</span>` }),
    );
    stepTitle.textContent = step.title;
    stepFocus.textContent = step.focus;
    stepContext.textContent = step.contextLine;
    stepMeta.textContent = `第 ${index + 1} / ${STEP_SPECS.length} 步 · ${scene.name}场景 · 每步 ≤ 5 分钟`;
    stepHead.querySelector('.module-chip').style.setProperty('--mod-color', module.color);
    stepHead.querySelector('.module-chip').style.setProperty('--mod-soft', module.soft);
  }

  function paintWordCard() {
    const word = step.word;
    wordCard.replaceChildren(
      h('h4', {}, h('span', { html: icon('sparkles', 15) }), '本步核心词'),
      h('div', { class: 'word-head' },
        h('span', { class: 'word' }, word.word),
        h('span', { class: 'ipa' }, word.ipa),
        h('span', { class: 'pos' }, word.pos),
      ),
      h('div', { class: 'zh' }, word.zh),
      h('div', { class: 'ex' }, word.example),
      h('div', { class: 'derived-list' }, step.derived.map((item) => h('span', { class: 'derived-chip', title: item.note },
        item.term, h('em', {}, item.type === 'chunk' ? '搭配' : item.type === 'family' ? '词族' : item.type === 'scene' ? '场景' : '同义')))),
      h('div', { class: 'tiny faint', style: 'margin-top:8px' }, `本步扩展 ${step.derived.length} 个词块 · 目标每核心词 ×10`),
    );
  }

  function paintGrammar() {
    const host = grammarCard.querySelector('.grammar-side');
    host.replaceChildren(...step.grammarPoints.map((point) => h('div', { class: 'grammar-line' },
      h('strong', {}, point.name),
      h('span', {}, point.pattern),
    )));
    grammarCard.classList.toggle('hidden', !step.grammarPoints.length);
  }

  function updateChecklist() {
    evaluation = evaluateStep(step, progress);
    checklist.replaceChildren(...evaluation.items.map((item) => h('div', { class: `check-item ${item.met ? 'met' : ''}` },
      h('span', { class: 'check-box' }),
      h('span', {}, item.label, h('em', { class: 'ci-detail' }, item.display)),
    )));
    if (evaluation.completed) {
      checklist.append(h('div', { class: 'callout ok', style: 'margin-top:4px', html: `${icon('check', 15)}<span>本步达标，可以进入下一步。</span>` }));
    }
    nextButton.disabled = !evaluation.completed;
    nextButton.classList.toggle('ready', evaluation.completed);
    nextButton.textContent = index === STEP_SPECS.length - 1 ? '生成学习报告' : '下一步';
    remainingText.textContent = evaluation.completed ? '已完成' : `还差：${evaluation.remaining.join(' / ')}`;
    if (evaluation.completed && !completedNotified) {
      completedNotified = true;
      toast('本步达标，可以进入下一步。', 'ok', 2200);
    }
  }

  function onChange(patch) {
    progress.checks = { ...progress.checks, ...(patch.checks || {}) };
    progress.evidence = { ...progress.evidence, ...(patch.evidence || {}) };
    updateChecklist();
    saveSoon();
  }

  function saveSoon() {
    if (savingTimer) clearTimeout(savingTimer);
    savingTimer = setTimeout(() => {
      session.currentIndex = index;
      saveCurrentSession(session);
    }, 250);
  }

  function toggleHint() {
    const text = step.payload.hint || step.payload.tip || step.payload.instructions || '先听一遍，再逐词确认。';
    hintBox.innerHTML = `${icon('bulb', 16)}<span>${String(text).replace(/</g, '&lt;')}</span>`;
    hintBox.classList.toggle('hidden');
  }

  function renderStep({ keepTimer = false } = {}) {
    lastTaskCleanup?.();
    lastTaskCleanup = null;
    step = buildStep();
    progress = { checks: {}, evidence: {} };
    completedNotified = false;
    paintHead();
    paintWordCard();
    paintGrammar();
    hintBox.classList.add('hidden');
    feedbackHost.replaceChildren();
    const task = renderTask(step, {
      session,
      progress,
      aiEnabled,
      onChange,
    });
    lastTaskCleanup = task.cleanup || null;
    taskHost.replaceChildren(task.el);
    updateChecklist();
    renderRail();
    if (!keepTimer) startTimer(step.minutes || 5);
    session.currentIndex = index;
    saveCurrentSession(session);
    maybeEnhance();
  }

  function maybeEnhance() {
    if (!aiEnabled || step.source === 'ai' || step.aiAttempted) return;
    const targetIndex = index;
    step.aiAttempted = true;
    const badge = stepHead.querySelector('#ai-badge');
    if (badge) badge.textContent = 'AI 改写中…';
    const prompt = buildStepPrompt(session, step);
    chat({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      json: true,
      maxTokens: 1600,
      temperature: 0.65,
    }).then((data) => {
      if (!mounted || index !== targetIndex) return;
      const parsed = (() => {
        const cleaned = String(data.content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        try { return JSON.parse(cleaned); } catch {
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; } }
          return null;
        }
      })();
      const enhanced = applyAIStep(step, parsed);
      if (enhanced.source !== 'ai') {
        if (badge) badge.textContent = '本地初稿';
        return;
      }
      if (Object.keys(progress.checks).length || Object.keys(progress.evidence).length) {
        if (badge) badge.textContent = '本地初稿';
        return;
      }
      session.steps[index] = enhanced;
      saveCurrentSession(session);
      renderStep({ keepTimer: true });
      toast('AI 已按「' + scene.name + '」场景改写这一步。', 'ok', 2400);
    }).catch(() => {
      if (badge) badge.textContent = '本地初稿';
    });
  }

  /* ---------- voice ---------- */

  function executeCommand(command, raw) {
    if (!command) {
      heardLine.textContent = `没识别出指令：${raw.slice(0, 40)}`;
      return;
    }
    heardLine.textContent = `${raw.slice(0, 46)} → ${command.intent}`;
    if (command.intent === 'next') attemptNext();
    if (command.intent === 'play' || command.intent === 'repeat') {
      const play = taskHost.querySelector('[data-play]');
      if (play) play.click();
      else toast('本步没有可播放的音频。', 'info');
    }
    if (command.intent === 'hint') toggleHint();
    if (command.intent === 'stop') stopSpeaking();
    if (command.intent === 'report') {
      if (index === STEP_SPECS.length - 1 && evaluation?.completed) attemptNext();
      else toast('走完 8 步才能生成报告。', 'info');
    }
    if (command.intent === 'option') {
      const option = taskHost.querySelectorAll('.option-list .option')[command.index];
      if (option && !option.disabled) option.click();
      else toast('这一步没有可选的选项。', 'info');
    }
  }

  function toggleVoice() {
    if (!recognitionSupported) return toast('请使用 Chrome 或 Edge 使用语音助手。', 'err');
    if (listener?.active) {
      listener.stop();
      return;
    }
    stopSpeaking();
    listener = new Listener({
      lang: 'zh-CN',
      onResult: (value) => executeCommand(parseCommand(value), value),
      onInterim: (value) => { heardLine.textContent = `听到：${value}`; },
      onEnd: () => {
        voiceBtn.classList.remove('listening');
        if (continuousVoice) setTimeout(() => { if (mounted) toggleVoice(); }, 350);
      },
      onError: (message) => {
        voiceBtn.classList.remove('listening');
        toast(message, 'err');
      },
    });
    if (listener.start()) {
      voiceBtn.classList.add('listening');
      heardLine.textContent = '正在聆听指令…';
    }
  }

  /* ---------- navigation ---------- */

  function saveStepResult() {
    const result = {
      completed: evaluation.completed,
      score: evaluation.score,
      checks: { ...progress.checks },
      evidence: { ...progress.evidence },
      timeSpent: Math.max(1, Math.round(elapsed)),
      finishedAt: new Date().toISOString(),
      source: step.source,
    };
    session.results[index] = result;
    session.currentIndex = index;
    saveCurrentSession(session);
  }

  function attemptNext() {
    evaluation = evaluateStep(step, progress);
    if (!evaluation.completed) {
      toast(`还差：${evaluation.remaining.join(' / ')}`, 'err', 2600);
      return;
    }
    saveStepResult();
    if (index >= STEP_SPECS.length - 1) {
      finish();
      return;
    }
    index += 1;
    session.currentIndex = index;
    renderStep();
  }

  function finish() {
    finished = true;
    stopTimer();
    listener?.abort();
    stopSpeaking();
    session.summary = summarizeSession(session);
    session.status = 'done';
    session.finishedAt = new Date().toISOString();
    saveFinishedSession(session);
    window.location.assign(`/report.html?id=${encodeURIComponent(session.id)}`);
  }

  function saveAndExit() {
    saveStepResult();
    session.currentIndex = index;
    saveCurrentSession(session);
    stopTimer();
    listener?.abort();
    stopSpeaking();
    toast('已保存，下次可以从这一步继续。', 'ok');
    ctx.navigate('home');
  }

  /* ---------- keyboard ---------- */

  function onKeyDown(event) {
    if (event.target.matches('input, textarea, select')) return;
    if (/^[1-4]$/.test(event.key)) {
      const option = taskHost.querySelectorAll('.option-list .option')[Number(event.key) - 1];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      }
    }
  }

  /* ---------- boot ---------- */

  mounted = true;
  renderStep();
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__ENOS_DEBUG__ = {
      get step() { return step; },
      get progress() { return progress; },
      get session() { return session; },
      get evaluation() { return evaluation; },
    };
  }
  const kbHandler = (event) => onKeyDown(event);
  document.addEventListener('keydown', kbHandler);

  window.addEventListener('beforeunload', () => {
    if (step && evaluation && !evaluation.completed) saveCurrentSession(session);
  }, { once: true });

  return {
    el,
    title: `${step ? step.title : '学习'} · EnOS`,
    cleanup() {
      mounted = false;
      stopTimer();
      listener?.abort();
      stopSpeaking();
      lastTaskCleanup?.();
      document.removeEventListener('keydown', kbHandler);
      if (savingTimer) clearTimeout(savingTimer);
      if (step && !finished) {
        session.currentIndex = index;
        saveCurrentSession(session);
      }
    },
  };
}
