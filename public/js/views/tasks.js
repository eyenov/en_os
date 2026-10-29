import {
  buildTutorMessages,
  compareSpeech,
  containsWord,
  countWords,
  makeProgressCheck,
  scoreWriting,
  speakingFeedbackPrompt,
  writingFeedbackPrompt,
} from '../engine.js';
import { chat, chatStream } from '../api.js';
import { Listener, recognitionSupported, speak, stopSpeaking } from '../speech.js';
import { getSettings } from '../store.js';
import { h, icon, scoreRing, toast } from '../ui.js';

/* ---------- shared bits ---------- */

function playButton(text, { label = '播放句子', rate } = {}) {
  const wave = h('span', { class: 'sound-wave' }, h('i'), h('i'), h('i'), h('i'), h('i'));
  const button = h('button', {
    class: 'audio-btn',
    type: 'button',
    'data-play': 'true',
    onclick: () => {
      if (button.classList.contains('playing')) {
        stopSpeaking();
        button.classList.remove('playing');
        return;
      }
      const settings = getSettings();
      speak(text, {
        rate: rate ?? settings.voiceRate,
        lang: settings.voiceLang || 'en-GB',
        onStart: () => button.classList.add('playing'),
        onEnd: () => button.classList.remove('playing'),
        onError: () => button.classList.remove('playing'),
      });
    },
  }, h('span', { class: 'play-disc', html: icon('play', 14) }), label, wave);
  return button;
}

function feedback(ok, title, detail, actions = []) {
  return h('div', { class: `feedback ${ok ? 'ok' : 'no'}` },
    h('div', { class: 'fb-head' }, ok ? '✓' : '!', title),
    detail ? h('p', {}, detail) : null,
    actions.length ? h('div', { class: 'fb-actions' }, actions) : null,
  );
}

function optionsView(step, { onPick, disabled = false } = {}) {
  const buttons = [];
  const list = h('div', { class: 'option-list', role: 'group', 'aria-label': '选项' });
  step.payload.options.forEach((option, index) => {
    const button = h('button', {
      class: 'option',
      type: 'button',
      disabled,
      onclick: () => onPick?.(index, button),
    }, h('span', { class: 'option-key' }, 'ABCD'[index]), h('span', {}, option));
    buttons.push(button);
    list.append(button);
  });
  return { list, buttons };
}

function markWord(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b(${escaped})(?:s|es|ed|d|ing)?\\b`, 'i');
  const node = h('span', {});
  const parts = String(sentence).split(regex);
  for (const part of parts) {
    if (part && part.toLowerCase().startsWith(word.toLowerCase())) node.append(h('mark', {}, part));
    else node.append(document.createTextNode(part || ''));
  }
  return node;
}

function countRow(counter, { min, max, word = '' } = {}) {
  const status = h('span', {});
  const node = h('div', { class: 'count-row' }, counter, h('span', { class: 'spacer' }), status);
  const update = (value) => {
    const count = countWords(value);
    counter.textContent = `${count} 词`;
    if (min && max) {
      const ok = count >= min && count <= max;
      status.textContent = ok ? '长度达标' : count < min ? `还差 ${min - count} 词` : `超出 ${count - max} 词`;
      status.className = ok ? 'ok' : 'bad';
    }
  };
  return { node, update };
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

/* ---------- tasks ---------- */

function renderListenPick(step, ctx) {
  let attempts = 0;
  let solved = false;
  let selected = -1;
  const feedbackHost = h('div', {});
  const sentence = h('p', { class: 'sentence' }, step.payload.sentence, h('span', { class: 'zh' }, step.payload.zh || ''));
  const prompt = h('p', { class: 'instruction' }, step.payload.instruction);

  const { list, buttons } = optionsView(step, {
    onPick: (index, button) => {
      if (solved) return;
      selected = index;
      attempts += 1;
      const correct = index === step.payload.answerIndex;
      buttons.forEach((item, itemIndex) => {
        item.disabled = true;
        if (itemIndex === step.payload.answerIndex) item.classList.add('correct');
        else if (itemIndex === index) item.classList.add('wrong');
      });
      if (correct) {
        solved = true;
        feedbackHost.replaceChildren(feedback(true, '听对了', step.payload.explanation));
      } else {
        feedbackHost.replaceChildren(feedback(false, '再听一遍', `这次听到的是 “${step.payload.options[index]}”，但空格要填另一个词。${attempts >= 2 ? `提示：${step.payload.hint}` : '注意句子的搭配。'}`, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
            buttons.forEach((item) => {
              item.disabled = false;
              item.classList.remove('correct', 'wrong');
            });
            feedbackHost.replaceChildren();
          } }, '再试一次'),
        ]));
      }
      ctx.onChange({ checks: { answer: correct }, evidence: { selected, attempts } });
    },
  });

  return {
    el: h('div', { class: 'task-body' }, prompt, playButton(step.payload.audioText), sentence, list, feedbackHost),
  };
}

function renderDictation(step, ctx) {
  let attempts = 0;
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Type the 5 missing words in order…',
    'aria-label': '听写答案',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const feedbackHost = h('div', {});
  const diffHost = h('div', {});
  const submit = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: check }, '检查');
  const hintBtn = h('button', { class: 'link-btn', type: 'button' }, '看首字母提示');
  const hintBox = h('p', { class: 'small faint hidden' }, step.payload.hint);

  function check() {
    const value = input.value.trim();
    if (!value) return toast('先写下听到的内容。', 'err');
    attempts += 1;
    const result = compareSpeech(step.payload.answer, value);
    const accuracy = Math.round(result.accuracy * 100) / 100;
    const passed = result.accuracy >= 0.8;
    const words = step.payload.answer.split(/\s+/);
    const heard = new Set(value.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean));
    diffHost.replaceChildren(h('div', { class: 'diff-tokens' }, words.map((word) => h('span', {
      class: heard.has(word.toLowerCase().replace(/[^a-z']/g, '')) ? 'hit' : 'miss',
    }, word))));
    if (passed) {
      feedbackHost.replaceChildren(feedback(true, `听写准确率 ${Math.round(accuracy * 100)}%`, step.payload.explanation));
      input.disabled = true;
      submit.disabled = true;
      hintBtn.classList.add('hidden');
    } else {
      feedbackHost.replaceChildren(feedback(false, `准确率 ${Math.round(accuracy * 100)}%，还差一点`, '对照红词再听一遍，注意弱读与连读。', [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { input.value = ''; input.focus(); feedbackHost.replaceChildren(); } }, '再写一次'),
        attempts >= 3 ? h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => {
          input.value = step.payload.answer;
          input.disabled = false;
          submit.disabled = false;
          input.focus();
        } }, '填入答案') : null,
      ]));
    }
    ctx.onChange({ checks: { accuracy }, evidence: { transcript: value, accuracy, attempts } });
  }

  hintBtn.addEventListener('click', () => {
    hintBox.classList.toggle('hidden');
    hintBtn.textContent = hintBox.classList.contains('hidden') ? '看首字母提示' : '收起提示';
  });

  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      playButton(step.payload.audioText, { label: '播放整句' }),
      h('p', { class: 'sentence' }, step.payload.visible, h('span', { class: 'zh' }, '按顺序写出空格里的 5 个词')),
      h('div', { class: 'search-row' }, input, submit),
      h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, hintBtn, hintBox),
      diffHost,
      feedbackHost,
    ),
  };
}

function renderReadSynonym(step, ctx) {
  let solved = false;
  const feedbackHost = h('div', {});
  const passage = h('p', { class: 'sentence' }, markWord(step.payload.sentence, step.payload.target), h('span', { class: 'zh' }, step.payload.zh || ''));
  const { list, buttons } = optionsView(step, {
    onPick: (index) => {
      if (solved) return;
      const correct = index === step.payload.answerIndex;
      buttons.forEach((item, itemIndex) => {
        item.disabled = true;
        if (itemIndex === step.payload.answerIndex) item.classList.add('correct');
        else if (itemIndex === index) item.classList.add('wrong');
      });
      if (correct) {
        solved = true;
        feedbackHost.replaceChildren(feedback(true, '识别成功', step.payload.explanation));
      } else {
        feedbackHost.replaceChildren(feedback(false, '这个词在这里换不了', `注意 “${step.payload.target}” 的词性和搭配，再看一遍原句。`, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
            buttons.forEach((item) => { item.disabled = false; item.classList.remove('correct', 'wrong'); });
            feedbackHost.replaceChildren();
          } }, '再试一次'),
        ]));
      }
      ctx.onChange({ checks: { answer: correct }, evidence: { selected: index, target: step.payload.target } });
    },
  });
  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      passage,
      h('p', { class: 'instruction' }, h('strong', {}, step.payload.question)),
      list,
      feedbackHost,
    ),
  };
}

function renderReadInference(step, ctx) {
  let solved = false;
  const feedbackHost = h('div', {});
  const { list, buttons } = optionsView(step, {
    onPick: (index) => {
      if (solved) return;
      const correct = index === step.payload.answerIndex;
      buttons.forEach((item, itemIndex) => {
        item.disabled = true;
        if (itemIndex === step.payload.answerIndex) item.classList.add('correct');
        else if (itemIndex === index) item.classList.add('wrong');
      });
      if (correct) {
        solved = true;
        feedbackHost.replaceChildren(feedback(true, '判断正确', step.payload.explanation));
      } else {
        feedbackHost.replaceChildren(feedback(false, '再看证据', '先定位题干中的关键词在原文的哪一处，再判断是改写、反义还是未提及。', [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
            buttons.forEach((item) => { item.disabled = false; item.classList.remove('correct', 'wrong'); });
            feedbackHost.replaceChildren();
          } }, '再试一次'),
        ]));
      }
      ctx.onChange({ checks: { answer: correct }, evidence: { selected: index } });
    },
  });
  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      h('div', { class: 'sentence', style: 'font-size:17px;font-family:var(--sans)' }, step.payload.passage),
      h('div', { class: 'structure-card' },
        h('div', { class: 'sc-name' }, '题干 Statement'),
        h('div', { class: 'sc-example' }, step.payload.statement)),
      h('p', { class: 'instruction' }, h('strong', {}, step.payload.question)),
      list,
      feedbackHost,
    ),
  };
}

function renderShadow(step, ctx) {
  const target = step.payload.sentence;
  let listener = null;
  let startedAt = 0;
  let busy = false;
  const feedbackHost = h('div', {});
  const diffHost = h('div', {});
  const scoreHost = h('div', { class: 'accuracy-row' });
  const micLabel = h('span', {}, recognitionSupported ? '点击开始跟读' : '用文本自测');
  const micBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    onclick: toggleMic,
  }, h('span', { html: icon('mic', 17) }), micLabel);

  const manual = h('details', { class: 'model-box' },
    h('summary', {}, '没有麦克风或识别失败？用文本自测'),
    h('div', { class: 'search-row', style: 'margin-top:8px' },
      h('input', { class: 'input', type: 'text', placeholder: '把你刚才读的内容打出来，系统同样会比对…', 'aria-label': '跟读文本' }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (event) => {
        const input = event.currentTarget.previousElementSibling;
        evaluate(input.value, 0);
      } }, '比对'),
    ),
  );

  function toggleMic() {
    if (!recognitionSupported) {
      manual.open = true;
      return;
    }
    if (listener?.active) {
      listener.stop();
      return;
    }
    stopSpeaking();
    startedAt = performance.now();
    listener = new Listener({
      lang: 'en-GB',
      onInterim: (value) => { micLabel.textContent = `听到：${value.slice(0, 42)}…`; },
      onResult: (value) => {
        const seconds = Math.max(1, (performance.now() - startedAt) / 1000);
        evaluate(value, seconds);
      },
      onEnd: () => {
        micBtn.classList.remove('recording');
        micBtn.classList.add('btn-primary');
        micLabel.textContent = recognitionSupported ? '再读一遍' : '用文本自测';
      },
      onError: (message) => {
        toast(message, 'err');
        micBtn.classList.remove('recording');
        micLabel.textContent = '点击开始跟读';
      },
    });
    if (listener.start()) {
      micBtn.classList.add('recording');
      micLabel.textContent = '正在聆听…读完点击停止';
    }
  }

  async function evaluate(transcript, seconds) {
    if (busy || !transcript.trim()) return;
    busy = true;
    const result = compareSpeech(target, transcript, seconds);
    const accuracy = Math.round(result.accuracy * 100) / 100;
    scoreHost.replaceChildren(
      scoreRing(Math.round(accuracy * 100), { size: 82, label: `${Math.round(accuracy * 100)}%` }),
      h('div', { class: 'accuracy-text' },
        h('strong', {}, accuracy >= 0.75 ? '跟读达标' : '还差一点'),
        h('span', {}, `匹配 ${result.matched}/${result.total} 词${result.wordsPerMinute ? ` · 约 ${result.wordsPerMinute} 词/分` : ''}`),
      ),
    );
    const targetWords = target.split(/\s+/);
    const heard = new Set(transcript.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean));
    diffHost.replaceChildren(h('div', { class: 'diff-tokens' }, targetWords.map((word) => h('span', {
      class: heard.has(word.toLowerCase().replace(/[^a-z']/g, '')) ? 'hit' : 'miss',
    }, word))));

    if (accuracy >= 0.75) {
      feedbackHost.replaceChildren(feedback(true, '这句话读下来了', step.payload.tip));
      if (ctx.aiEnabled) {
        const note = h('p', { class: 'small faint' }, 'AI 教练正在听你的句子…');
        feedbackHost.append(note);
        try {
          const prompt = speakingFeedbackPrompt(step, transcript);
          const data = await chat({ messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], json: true, maxTokens: 300, temperature: 0.4 });
          const parsed = parseJson(data.content);
          if (parsed?.feedbackZh) {
            note.replaceWith(h('p', { class: 'small' }, `AI 教练：${parsed.feedbackZh}`));
            if (parsed.betterVersion) feedbackHost.append(h('p', { class: 'small muted' }, `更自然的版本：${parsed.betterVersion}`));
          } else {
            note.remove();
          }
        } catch {
          note.remove();
        }
      }
    } else {
      feedbackHost.replaceChildren(feedback(false, `准确率 ${Math.round(accuracy * 100)}%`, `漏掉或读错的词已标红。先慢速跟读 “${step.word.word}”，再整句连读。`, [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { micLabel.textContent = '再读一遍'; feedbackHost.replaceChildren(); } }, '再试一次'),
      ]));
    }
    ctx.onChange({ checks: { accuracy }, evidence: { transcript, accuracy, seconds, missing: result.missing, wordsPerMinute: result.wordsPerMinute } });
    busy = false;
  }

  const el = h('div', { class: 'task-body' },
    h('p', { class: 'instruction' }, step.payload.instruction),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      playButton(step.payload.audioText, { label: '听示范' }),
      playButton(step.payload.audioText, { label: '慢速 0.72x', rate: 0.72 }),
    ),
    h('p', { class: 'sentence' }, markWord(target, step.payload.focus), h('span', { class: 'zh' }, `${step.payload.focus} ${step.payload.ipa}`)),
    h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, micBtn, h('span', { class: 'small faint' }, '读完会自动比对，允许重试')),
    manual,
    scoreHost,
    diffHost,
    feedbackHost,
  );
  if (!recognitionSupported) manual.open = true;
  return { el, cleanup: () => listener?.abort() };
}

function renderDialog(step, ctx) {
  const messages = [{ role: 'tutor', text: step.payload.opening }];
  let turn = 0;
  let streaming = false;
  const thread = h('div', { class: 'chat', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: '用英语回答，至少 5 词…',
    'aria-label': '对话输入',
    onkeydown: (event) => { if (event.key === 'Enter') send(); },
  });
  const sendBtn = h('button', { class: 'icon-round', type: 'button', 'aria-label': '发送', onclick: () => send() }, h('span', { html: icon('send', 17) }));
  const micBtn = h('button', { class: 'icon-round', type: 'button', 'aria-label': '语音回答', onclick: toggleMic }, h('span', { html: icon('mic', 17) }));
  const status = h('div', { class: 'count-row' }, h('span', {}, '第 0 轮 · 0 词'), h('span', { class: 'spacer' }), h('span', { class: 'faint' }, '目标：2 轮 · 用上目标词 · ≥15 词'));
  let listener = null;

  function renderThread() {
    thread.innerHTML = '';
    for (const message of messages) {
      const bubble = h('div', { class: `bubble ${message.role}` },
        h('div', { class: 'bubble-meta' }, message.role === 'tutor' ? `${step.payload.role} · 陪练` : '你'),
        h('div', {}, message.text),
      );
      if (message.role === 'tutor') {
        bubble.append(h('div', { class: 'bubble-audio' }, h('button', {
          class: 'link-btn', type: 'button', onclick: () => {
            const settings = getSettings();
            speak(message.text, { rate: settings.voiceRate, lang: settings.voiceLang || 'en-GB' });
          },
        }, '▶ 播放')));
      }
      thread.append(bubble);
    }
    thread.scrollTop = thread.scrollHeight;
  }

  function syncChecks() {
    const userMessages = messages.filter((message) => message.role === 'user');
    const joined = userMessages.map((message) => message.text).join(' ');
    const checks = makeProgressCheck('speak_dialog', {
      turns: userMessages.length,
      wordUsed: containsWord(joined, step.word.word),
      wordCount: countWords(joined),
    });
    ctx.onChange({ checks, evidence: { history: messages.map(({ role, text }) => ({ role, text })), turns: userMessages.length } });
    status.replaceChildren(
      h('span', {}, `第 ${userMessages.length} 轮 · ${countWords(joined)} 词`),
      h('span', { class: 'spacer' }),
      h('span', { class: containsWord(joined, step.word.word) ? 'ok' : 'faint' }, containsWord(joined, step.word.word) ? `已用上 “${step.word.word}”` : `试着用上 “${step.word.word}”`),
    );
  }

  function localReply(userText) {
    const used = containsWord(userText, step.word.word);
    const correction = used ? '' : ` Try: “I noticed that ${step.word.word} matters because …”.`;
    if (turn >= 2) return `Good.${correction} That is enough for this round — I will keep the best sentence for your report.`;
    return `Thanks for sharing.${correction} ${step.payload.followUps[Math.min(turn, step.payload.followUps.length - 1)]}`;
  }

  async function send(forced) {
    if (streaming) return;
    const text = String(forced ?? input.value).trim();
    if (!text) return toast('先说一句英文，再发送。', 'err');
    messages.push({ role: 'user', text });
    turn += 1;
    input.value = '';
    renderThread();
    syncChecks();
    streaming = true;
    const typing = h('div', { class: 'bubble tutor' }, h('div', { class: 'bubble-meta' }, `${step.payload.role} · 正在回应`), h('div', {}, '…'));
    thread.append(typing);
    thread.scrollTop = thread.scrollHeight;
    try {
      if (ctx.aiEnabled) {
        const history = messages.slice(1, -1).map((message) => ({ role: message.role, text: message.text }));
        const full = await chatStream({
          messages: buildTutorMessages(ctx.session, step, history),
          maxTokens: 220,
          temperature: 0.8,
          onDelta: (value) => {
            typing.lastChild.textContent = value;
            thread.scrollTop = thread.scrollHeight;
          },
        });
        messages.push({ role: 'tutor', text: full.trim() || localReply(text) });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 420));
        messages.push({ role: 'tutor', text: localReply(text) });
      }
      typing.remove();
    } catch (error) {
      typing.remove();
      messages.push({ role: 'tutor', text: localReply(text) });
      toast('AI 陪练暂时不可用，已切换本地陪练。', 'info', 2600);
    } finally {
      streaming = false;
      renderThread();
    }
  }

  function toggleMic() {
    if (!recognitionSupported) return toast('请使用 Chrome 或 Edge 使用语音回答。', 'err');
    if (listener?.active) {
      listener.stop();
      return;
    }
    stopSpeaking();
    listener = new Listener({
      lang: 'en-GB',
      onResult: (value) => { input.value = value; micBtn.classList.remove('recording'); },
      onEnd: () => micBtn.classList.remove('recording'),
      onError: (message) => { toast(message, 'err'); micBtn.classList.remove('recording'); },
    });
    if (listener.start()) {
      micBtn.classList.add('recording');
      toast('录音中，说完后点一下麦克风结束。', 'info', 1800);
    }
  }

  renderThread();
  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      h('div', { class: 'structure-card' },
        h('div', { class: 'sc-name' }, `${step.payload.role} · ${step.payload.setting}`),
        h('div', { class: 'sc-tip' }, `关键词：${step.payload.keywords.join(' / ')}`)),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, playButton(step.payload.opening, { label: '听陪练开场' })),
      thread,
      status,
      h('div', { class: 'chat-input-row' }, input, micBtn, sendBtn),
    ),
    cleanup: () => listener?.abort(),
  };
}

function renderWriteFrame(step, ctx) {
  const textarea = h('textarea', { class: 'type-area', placeholder: 'Write two sentences here…', rows: '4', 'aria-label': '写作练习' });
  const counter = countRow(h('span', {}, '0 词'), { min: 20, max: 90 });
  const feedbackHost = h('div', {});
  let analysis = null;
  const structure = step.grammarPoints?.[0] || { name: '目标结构', pattern: '', regex: /$^/, tip: '', example: '' };

  textarea.addEventListener('input', () => counter.update(textarea.value));

  function submit() {
    const text = textarea.value.trim();
    if (countWords(text) < 8) return toast('再写长一点，至少两句完整表达。', 'err');
    analysis = scoreWriting(text, {
      word: step.word.word,
      learned: step.derived.slice(0, 3).map((item) => item.term),
      structure,
      minWords: 20,
      maxWords: 90,
    });
    const checks = makeProgressCheck('write_frame', { analysis });
    const passed = analysis.wordCount >= 20 && analysis.targetUsed && analysis.structureUsed && analysis.sentenceCount >= 2;
    feedbackHost.replaceChildren(
      feedback(passed, passed ? `已记录：${analysis.wordCount} 词 · ${analysis.sentenceCount} 句` : '还差一项就达标', passed ? '本步不追求完美，先确保目标词和句型都出现。' : (analysis.feedback[0] || '对照下面的检查项补一句。')),
      h('div', { class: 'panel' },
        h('h3', {}, '快速检查'),
        h('div', { class: 'check-list' }, [
          ['目标词使用', analysis.targetUsed],
          ['目标句型', analysis.structureUsed],
          ['词数 ≥ 20', analysis.wordCount >= 20],
          ['至少 2 句', analysis.sentenceCount >= 2],
        ].map(([label, ok]) => h('div', { class: `check-item ${ok ? 'met' : ''}` }, h('span', { class: 'check-box' }), h('span', {}, label)))),
        h('div', { class: 'small muted', style: 'margin-top:8px' }, analysis.feedback[0] || '')), 
    );
    ctx.onChange({ checks, evidence: { text, analysis } });
    toast('已保存这一版，可以继续修改后再次提交。', 'ok', 2200);
  }

  const chunkButtons = step.payload.chunks.map((chunk) => h('button', {
    class: 'chunk-btn', type: 'button', onclick: () => insertAtCursor(textarea, chunk),
  }, chunk));

  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      h('div', { class: 'structure-card' },
        h('div', { class: 'sc-name' }, `${structure.name} · ${structure.pattern}`),
        h('div', { class: 'sc-tip' }, structure.tip),
        h('div', { class: 'sc-example' }, structure.example)),
      h('div', { class: 'chunks' }, chunkButtons),
      textarea,
      counter.node,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: submit }, '提交这一版'),
        h('span', { class: 'small faint', style: 'align-self:center' }, '提交后所有项目达标，才会解锁下一步'),
      ),
      feedbackHost,
      h('details', { class: 'model-box' },
        h('summary', {}, '可背诵素材 · 点开对照'),
        h('div', { class: 'model-text' }, step.payload.model),
        h('button', { class: 'link-btn', type: 'button', onclick: () => speak(step.payload.model, { rate: 0.85 }) }, '▶ 听一遍'),
      ),
    ),
  };
}

function renderWriteParagraph(step, ctx) {
  const textarea = h('textarea', { class: 'type-area', placeholder: 'Write 50–110 words here…', rows: '7', 'aria-label': '段落写作' });
  const counter = countRow(h('span', {}, '0 词'), { min: 50, max: 110 });
  const feedbackHost = h('div', {});
  const correctionsHost = h('div', {});
  const submit = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: submitDraft }, '提交并评分');
  let analysis = null;

  textarea.addEventListener('input', () => counter.update(textarea.value));

  async function submitDraft() {
    const text = textarea.value.trim();
    if (countWords(text) < 20) return toast('至少写到 50 词，评分才有意义。', 'err');
    analysis = scoreWriting(text, {
      word: step.word.word,
      learned: step.payload.learned || [],
      structure: null,
      minWords: 50,
      maxWords: 110,
    });
    const checks = makeProgressCheck('write_paragraph', { analysis });
    renderLocal();
    ctx.onChange({ checks, evidence: { text, analysis, band: analysis.band } });

    if (!ctx.aiEnabled) return;
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span> AI 评分中';
    try {
      const prompt = writingFeedbackPrompt(step, text, analysis);
      const data = await chat({ messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], json: true, maxTokens: 900, temperature: 0.35 });
      const parsed = parseJson(data.content);
      if (parsed && Number.isFinite(Number(parsed.band))) {
        const band = Math.max(4.5, Math.min(8.5, Number(parsed.band)));
        analysis = { ...analysis, band, aiBand: band, criteria: { ...analysis.criteria, ...(parsed.criteria || {}) } };
        renderLocal({ ai: parsed });
        const nextChecks = makeProgressCheck('write_paragraph', { analysis });
        ctx.onChange({ checks: nextChecks, evidence: { text, analysis, band, ai: parsed } });
      }
    } catch (error) {
      toast('AI 评分没成功，已保留本地评分。', 'info', 2400);
    } finally {
      submit.disabled = false;
      submit.textContent = '提交并评分';
    }
  }

  function renderLocal({ ai = null } = {}) {
    const band = ai ? Number(ai.band) : analysis.band;
    const feedbackZh = ai?.feedbackZh || analysis.feedback.join(' ');
    feedbackHost.replaceChildren(
      h('div', { class: 'accuracy-row', style: 'padding:14px 16px;border-radius:14px;background:var(--paper-2);border:1px solid var(--line)' },
        scoreRing(Math.round(((band - 4.5) / 3.5) * 100), { size: 84, label: band.toFixed(1) }),
        h('div', { class: 'accuracy-text' },
          h('strong', {}, `写作 Band ${band.toFixed(1)}${ai ? ' · AI 评分' : ' · 本地评分'}`),
          h('span', {}, `${analysis.wordCount} 词 · ${analysis.sentenceCount} 句 · 平均 ${analysis.averageSentence} 词/句`),
          h('span', {}, `目标词 ${analysis.targetUsed ? '已出现' : '未出现'} · 连接词 ${analysis.linking.length} 个`),
        ),
      ),
      h('p', { class: 'small', style: 'margin-top:10px' }, feedbackZh),
    );
    if (ai?.corrections?.length) {
      correctionsHost.replaceChildren(h('div', { class: 'panel' },
        h('h3', {}, '可以改得更准'),
        h('div', { class: 'corrections' }, ai.corrections.slice(0, 3).map((item) => h('div', { class: 'correction' },
          h('span', { class: 'from' }, item.from || '…'),
          h('span', {}, '→'),
          h('span', { class: 'to' }, item.to || '…'),
          h('span', { class: 'why' }, item.whyZh || ''),
        ))),
        ai.betterSentence ? h('p', { class: 'small muted', style: 'margin-top:8px' }, `示范句：${ai.betterSentence}`) : null,
      ));
    } else {
      correctionsHost.replaceChildren();
    }
  }

  return {
    el: h('div', { class: 'task-body' },
      h('p', { class: 'instruction' }, step.payload.instruction),
      h('div', { class: 'structure-card' },
        h('div', { class: 'sc-name' }, '写作任务'),
        h('div', { class: 'sc-example' }, step.payload.prompt),
        h('div', { class: 'sc-tip' }, step.payload.requirements.join(' · '))),
      h('div', { class: 'chunks' }, step.payload.chunks.map((chunk) => h('button', {
        class: 'chunk-btn', type: 'button', onclick: () => insertAtCursor(textarea, chunk),
      }, chunk))),
      textarea,
      counter.node,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, submit, h('span', { class: 'small faint', style: 'align-self:center' }, '本地评分立即给出，配置 Key 后追加 AI 评语')),
      feedbackHost,
      correctionsHost,
      h('details', { class: 'model-box' },
        h('summary', {}, '可背诵小段 · 点开对照'),
        h('div', { class: 'model-text' }, step.payload.model),
        h('div', { class: 'model-zh' }, step.payload.zh || ''),
        h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
          h('button', { class: 'link-btn', type: 'button', onclick: () => speak(step.payload.model, { rate: 0.85 }) }, '▶ 听一遍'),
          h('button', { class: 'link-btn', type: 'button', onclick: () => {
            const box = document.querySelector('.model-box .model-text');
            box?.classList.toggle('blurred');
          } }, '遮住文字背一遍')),
      ),
    ),
  };
}

const RENDERERS = {
  listen_pick: renderListenPick,
  listen_dictation: renderDictation,
  read_synonym: renderReadSynonym,
  read_inference: renderReadInference,
  speak_shadow: renderShadow,
  speak_dialog: renderDialog,
  write_frame: renderWriteFrame,
  write_paragraph: renderWriteParagraph,
};

export function renderTask(step, ctx) {
  const renderer = RENDERERS[step.kind];
  if (!renderer) return { el: h('p', {}, '这个任务暂时无法展示。') };
  return renderer(step, ctx);
}
