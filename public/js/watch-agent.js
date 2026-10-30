import { aiReady, chatStream, getHealth } from './api.js';
import { getSettings } from './store.js';

function clock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function mountAgent({ videoId, getState }) {
  const panel = document.getElementById('agent-panel');
  if (!panel) return { refresh: () => {} };
  const messagesEl = document.getElementById('agent-messages');
  const form = document.getElementById('agent-form');
  const input = document.getElementById('agent-input');
  const sendBtn = document.getElementById('agent-send');
  const clearBtn = document.getElementById('agent-clear');
  const statusEl = document.getElementById('agent-status');
  const hintEl = document.getElementById('agent-hint');
  const suggestionButtons = Array.from(document.querySelectorAll('#agent-suggestions button'));

  const history = [];
  let available = false;
  let busy = false;
  let lastAvailable = null;

  function welcomeNode() {
    if (!available) {
      return el('div', { class: 'agent-welcome' },
        el('strong', {}, '配置模型 Key 后开始对话'),
        el('p', {}, 'Agent 可以解释当前句的语法、总结视频、挑出值得记的表达。'),
        el('p', {}, el('a', { href: '/#/settings' }, '去设置页配置 API Key →'), ' 然后刷新这一页。'),
      );
    }
    return el('div', { class: 'agent-welcome' },
      el('strong', {}, '我会跟着视频上下文回答'),
      el('p', {}, '播放到哪里，我就把当前句和附近字幕一起带进上下文。可以问语法、词汇、总结或雅思表达。'),
    );
  }

  function scroll() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text, options = {}) {
    const bubble = el('div', {
      class: `agent-msg ${role}${options.pending ? ' pending' : ''}${options.error ? ' error' : ''}`,
    },
    el('span', { class: 'agent-role' }, role === 'user' ? 'You' : 'EnOS Agent'),
    el('span', { class: 'agent-content' }, text));
    messagesEl.append(bubble);
    scroll();
    return bubble;
  }

  function reset() {
    history.length = 0;
    messagesEl.replaceChildren(welcomeNode());
    scroll();
  }

  function setAvailability(value) {
    available = value;
    input.disabled = !value;
    sendBtn.disabled = !value;
    suggestionButtons.forEach((button) => { button.disabled = !value; });
    statusEl.textContent = value ? '结合当前句、字幕和播放位置回答' : '需要配置模型 Key 才能对话';
    hintEl.textContent = value ? 'Enter 发送 · Shift + Enter 换行' : '配置 API Key 后可用 · 支持流式回答';
    if (lastAvailable !== value) {
      lastAvailable = value;
      reset();
    }
  }

  function buildContext() {
    const state = getState() || {};
    const cues = Array.isArray(state.cues) ? state.cues : [];
    const now = Number(state.currentTime) || 0;
    let index = cues.findIndex((cue) => now >= cue.start && now < cue.end);
    if (index < 0) index = cues.findIndex((cue) => cue.start >= now);
    if (index < 0) index = Math.max(0, cues.length - 1);
    const from = Math.max(0, index - 3);
    const to = Math.min(cues.length, index + 7);
    const nearby = cues.slice(from, to)
      .map((cue) => `[${clock(cue.start)}] ${cue.en}${cue.zh ? ` / ${cue.zh}` : ''}`)
      .join('\n');
    const full = cues
      .map((cue) => `[${clock(cue.start)}] ${cue.en}${cue.zh ? ` / ${cue.zh}` : ''}`)
      .join('\n');
    const transcript = full.length <= 12_000
      ? full
      : `${full.slice(0, 6000)}\n[... middle omitted ...]\n${nearby}\n[... end ...]\n${full.slice(-3000)}`;
    const current = cues[index];
    return [
      'You are the EnOS video learning agent. Help a Chinese IELTS learner understand a YouTube video.',
      'Answer in natural Simplified Chinese unless the user asks for English. Be concise but specific.',
      'Explain grammar, vocabulary or pronunciation by quoting the original line. Do not invent video content.',
      `Video: ${state.captions?.title || 'YouTube video'}${state.captions?.channel ? ` · ${state.captions.channel}` : ''}`,
      `URL: https://www.youtube.com/watch?v=${videoId}`,
      `Playback position: ${clock(now)}${state.captions?.duration ? ` / ${state.captions.duration}` : ''}`,
      current ? `Current line: ${current.en}${current.zh ? ` / ${current.zh}` : ''}` : 'Current line: (none yet)',
      `Transcript:\n${transcript || '(subtitles are still loading)'}`,
      'If the transcript does not contain the answer, say so and offer general language help instead.',
    ].join('\n');
  }

  async function send(text) {
    const question = String(text || '').trim();
    if (!question || busy) return;
    if (!available) {
      addMessage('assistant', '还没有配置模型 Key。先在设置页填入 Key，然后刷新这一页。', { error: true });
      return;
    }

    busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '回答中…';
    input.value = '';
    addMessage('user', question);
    history.push({ role: 'user', content: question });
    const bubble = addMessage('assistant', '', { pending: true });
    const content = bubble.querySelector('.agent-content');

    try {
      const full = await chatStream({
        messages: [
          { role: 'system', content: buildContext() },
          ...history.slice(-10),
        ],
        maxTokens: 900,
        temperature: 0.45,
        onDelta: (partial) => {
          bubble.classList.remove('pending');
          content.textContent = partial;
          scroll();
        },
      });
      bubble.classList.remove('pending');
      content.textContent = full || '（Agent 没有返回内容）';
      if (full) history.push({ role: 'assistant', content: full });
      scroll();
    } catch (error) {
      bubble.classList.remove('pending');
      bubble.classList.add('error');
      content.textContent = `请求失败：${error.message || '请稍后重试'}`;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      input.focus();
    }
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(130, input.scrollHeight)}px`;
  });
  clearBtn?.addEventListener('click', reset);
  suggestionButtons.forEach((button) => {
    button.addEventListener('click', () => send(button.dataset.prompt));
  });

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function refresh() {
    await getHealth(true).catch(() => null);
    setAvailability(aiReady(getSettings()));
  }

  reset();
  refresh();
  return { refresh, reset };
}
