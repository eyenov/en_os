/**
 * Listening lab: dialogue generation, validation and result text.
 * Pure functions only, so the same code runs in the browser and in node:test.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/** Roles used by the syntax view. English aliases are accepted from models. */
const ROLE_ALIASES = {
  subject: '主语',
  predicate: '谓语',
  verb: '谓语',
  object: '宾语',
  predicative: '表语',
  complement: '补语',
  attribute: '定语',
  attributive: '定语',
  adverbial: '状语',
  clause: '从句',
  connector: '连接词',
  conjunction: '连接词',
  phrase: '意群',
  chunk: '意群',
  sentence: '句子',
};

const ROLE_ORDER = ['从句', '表语', '主语', '谓语', '宾语', '定语', '状语', '补语', '连接词'];

export function normaliseRole(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '意群';
  const alias = ROLE_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  for (const role of ROLE_ORDER) {
    if (raw.includes(role)) return role;
  }
  if (/主句/.test(raw)) return '主句';
  if (/问句|疑问/.test(raw)) return '疑问句';
  if (/问候|回应|评价|独立/.test(raw)) return '意群';
  return raw.slice(0, 10);
}

export function countWords(text = '') {
  return (String(text).match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
}

function cleanEnglish(value) {
  let text = String(value ?? '')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (CJK_RE.test(text)) return '';
  if (!/[A-Za-z]{3,}/.test(text)) return '';
  if (text.length > 240) text = text.slice(0, 240).trim();
  return text;
}

function parseJSONLoose(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normaliseWords(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item) => {
    if (typeof item === 'string') {
      const term = item.trim();
      return term ? { term, pos: '', zh: '', gloss: '', usage: '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const term = String(item.term || item.word || item.phrase || '').trim();
    if (!term) return null;
    return {
      term,
      pos: String(item.pos || item.type || '').trim().slice(0, 12),
      zh: String(item.zh || item.meaning || item.meaningZh || '').trim().slice(0, 60),
      gloss: String(item.gloss || item.definition || item.meaningEn || item.english || '').trim().slice(0, 160),
      usage: String(item.usage || item.scene || item.usageNote || item.noteEn || '').trim().slice(0, 180),
    };
  }).filter(Boolean);
}

function normaliseChunks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    if (typeof item === 'string') return { text: item.trim(), role: '意群' };
    if (!item || typeof item !== 'object') return null;
    const text = String(item.text || item.span || item.phrase || '').trim();
    if (!text) return null;
    return { text, role: normaliseRole(item.role || item.type || item.label) };
  }).filter(Boolean);
}

/**
 * Align model/author chunks to the real sentence. Chunks must be exact
 * substrings in order; the gaps between them belong to the previous chunk, so
 * punctuation never disappears. Anything unusable falls back to clause chunks.
 */
export function resolveChunks(sentence, chunks) {
  const text = String(sentence || '').trim();
  if (!text) return [];
  const list = normaliseChunks(chunks);
  if (!list.length) return fallbackChunks(text);

  const spans = [];
  let cursor = 0;
  for (const chunk of list) {
    const index = text.toLowerCase().indexOf(chunk.text.toLowerCase(), cursor);
    if (index < 0) return fallbackChunks(text);
    spans.push({ start: index, end: index + chunk.text.length, role: chunk.role });
    cursor = index + chunk.text.length;
  }

  // Give everything before the first chunk and between chunks to the previous span.
  spans.forEach((span, index) => {
    span.start = index === 0 ? 0 : spans[index - 1].end;
  });
  spans[spans.length - 1].end = text.length;

  const resolved = spans
    .map((span) => ({ text: text.slice(span.start, span.end).trim(), role: span.role }))
    .filter((chunk) => chunk.text);

  if (!resolved.length) return fallbackChunks(text);
  return resolved;
}

/** Last-resort structure: split at commas/semicolons, otherwise one block. */
export function fallbackChunks(sentence) {
  const text = String(sentence || '').trim();
  if (!text) return [];
  const parts = (text.match(/[^,;:]+[,;:]*/g) || [text])
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [{ text, role: '句子' }];
  return parts.map((part, index) => ({
    text: part,
    role: index === 0 ? '主句' : '从句',
  }));
}

/** Validate model output. Returns null when the dialogue is not usable. */
export function parseDialogue(raw, { topic = '', band = 6, source = 'ai' } = {}) {
  const data = typeof raw === 'string' ? parseJSONLoose(raw) : raw;
  if (!data || typeof data !== 'object' || !Array.isArray(data.lines)) return null;

  const lines = [];
  data.lines.slice(0, 14).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const text = cleanEnglish(entry.text ?? entry.en ?? entry.sentence);
    const zh = String(entry.zh ?? entry.translation ?? entry.chinese ?? '').trim().slice(0, 240);
    if (!text || countWords(text) < 3) return;
    if (!CJK_RE.test(zh)) return;
    const rawSpeaker = String(entry.speaker ?? entry.role ?? '').trim();
    const speaker = /^b/i.test(rawSpeaker) ? 'B' : /^a/i.test(rawSpeaker) ? 'A' : (index % 2 ? 'B' : 'A');
    lines.push({
      speaker,
      text,
      zh,
      structure: String(entry.structure ?? entry.syntax ?? '').trim().slice(0, 240),
      chunks: normaliseChunks(entry.chunks ?? entry.segments ?? entry.structureChunks),
      words: normaliseWords(entry.words ?? entry.vocabulary ?? entry.keywords),
      grammar: String(entry.grammar ?? entry.grammarNote ?? '').trim().slice(0, 240),
    });
  });

  if (lines.length < 8) return null;
  return {
    id: `lst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(data.title || topic || 'Listening practice').trim().slice(0, 120),
    topic: String(topic || '').trim(),
    band: Number(band) || 6,
    source,
    createdAt: new Date().toISOString(),
    lines,
  };
}

/** Prompt for one JSON call: short turns with translation, syntax chunks and vocabulary. */
export function buildDialoguePrompt(topic, { band = 6, scene = null } = {}) {
  const system = [
    'You are an IELTS listening coach for lower-intermediate learners (Band 5.0-6.0).',
    'Write ONE natural two-person dialogue in English about the user topic, 10-12 turns, 200-280 words in total.',
    'Each turn must be exactly ONE sentence of 10-20 words, with common vocabulary and clear punctuation.',
    'Alternate speakers A and B, starting with A.',
    'For every turn provide:',
    '- zh: a faithful Simplified Chinese translation;',
    '- structure: one short Chinese sentence explaining the grammar of the whole turn;',
    '- chunks: 2-4 consecutive pieces that together cover the whole sentence exactly (copy the substrings, including punctuation), each with text and role. role must be one of: 主语, 谓语, 宾语, 表语, 定语, 状语, 补语, 从句, 连接词, 意群;',
    '- words: 2-3 key words OR short collocations from the sentence, each with term, pos, zh (Chinese meaning), gloss (English definition, at most 14 words) and usage (English note on meaning in this sentence or when to use it, at most 16 words);',
    '- grammar: one short Chinese grammar note.',
    'Use Simplified Chinese only in zh, structure and grammar fields. English only in text, gloss and usage.',
    'Return ONLY valid JSON in this shape:',
    '{"title":"English title","lines":[{"speaker":"A","text":"...","zh":"...","structure":"...","chunks":[{"text":"...","role":"主语"}],"words":[{"term":"...","pos":"n.","zh":"...","gloss":"...","usage":"..."}],"grammar":"..."}]}',
    'No markdown, no code fence, no explanation outside the JSON.',
  ].join(' ');
  const sceneLine = scene ? `Scene flavour: ${scene.en}, ${scene.setting}.` : '';
  const user = [
    `Topic: ${topic}`,
    `Target band: ${Number(band).toFixed(1)}`,
    sceneLine,
    'Return the JSON now.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

const LOCAL_LINES = [
  {
    speaker: 'A',
    text: 'Hi, are you ready for our meeting?',
    zh: '你好，你准备好我们的会议了吗？',
    structure: '一般疑问句：Be 动词提到主语前，for our meeting 说明准备好的事情。',
    chunks: [
      { text: 'Hi,', role: '意群' },
      { text: 'are you ready', role: '谓语' },
      { text: 'for our meeting?', role: '状语' },
    ],
    words: [
      {
        term: 'ready', pos: 'adj.', zh: '准备好的',
        gloss: 'prepared for what is going to happen',
        usage: 'be ready for + noun, e.g. ready for a meeting or an exam',
      },
      {
        term: 'meeting', pos: 'n.', zh: '会议',
        gloss: 'a planned discussion with other people',
        usage: 'at / in a meeting; hold a meeting',
      },
    ],
    grammar: 'be ready for 表示“为……做好准备”。',
  },
  {
    speaker: 'B',
    text: 'Not yet. I need five more minutes.',
    zh: '还没有。我还需要五分钟。',
    structure: '否定简答 + 主谓宾：I 是主语，need 是谓语，five more minutes 是宾语。',
    chunks: [
      { text: 'Not yet.', role: '意群' },
      { text: 'I', role: '主语' },
      { text: 'need', role: '谓语' },
      { text: 'five more minutes.', role: '宾语' },
    ],
    words: [
      {
        term: 'yet', pos: 'adv.', zh: '还（用于否定）',
        gloss: 'up to now, used in negatives and questions',
        usage: 'not yet = still not; often a short answer',
      },
      {
        term: 'minute', pos: 'n.', zh: '分钟',
        gloss: 'a unit of time equal to sixty seconds',
        usage: 'five more minutes = five additional minutes',
      },
    ],
    grammar: 'Not yet. 是口语里常用的“还没有”。',
  },
  {
    speaker: 'A',
    text: 'No problem. We can start with the easy part.',
    zh: '没问题。我们可以从简单的部分开始。',
    structure: '主谓宾：We 是主语，can start 是谓语，with the easy part 是状语。',
    chunks: [
      { text: 'No problem.', role: '意群' },
      { text: 'We', role: '主语' },
      { text: 'can start', role: '谓语' },
      { text: 'with the easy part.', role: '状语' },
    ],
    words: [
      {
        term: 'problem', pos: 'n.', zh: '问题',
        gloss: 'a difficulty that needs a solution',
        usage: 'no problem = it is fine / you are welcome',
      },
      {
        term: 'part', pos: 'n.', zh: '部分',
        gloss: 'one piece of a whole thing',
        usage: 'the easy part = the simple section of a task',
      },
    ],
    grammar: 'start with 表示“从……开始”。',
  },
  {
    speaker: 'B',
    text: 'Good idea. The numbers are in this chart.',
    zh: '好主意。数字都在这张图表里。',
    structure: '主系表：The numbers 是主语，are 是系动词，in this chart 是表语。',
    chunks: [
      { text: 'Good idea.', role: '意群' },
      { text: 'The numbers', role: '主语' },
      { text: 'are', role: '谓语' },
      { text: 'in this chart.', role: '表语' },
    ],
    words: [
      {
        term: 'chart', pos: 'n.', zh: '图表',
        gloss: 'a picture that shows numbers or information',
        usage: 'in / on a chart; a bar chart or a line chart',
      },
      {
        term: 'number', pos: 'n.', zh: '数字',
        gloss: 'a word or symbol that shows an amount',
        usage: 'sales numbers = the amount sold',
      },
    ],
    grammar: 'in this chart 用 in 表示“在图表中”。',
  },
  {
    speaker: 'A',
    text: 'Can you explain the first line to me?',
    zh: '你能给我解释一下第一行吗？',
    structure: '一般疑问句：Can you 是主语和情态动词，explain 是谓语，the first line 是宾语，to me 是状语。',
    chunks: [
      { text: 'Can you', role: '主语' },
      { text: 'explain', role: '谓语' },
      { text: 'the first line', role: '宾语' },
      { text: 'to me?', role: '状语' },
    ],
    words: [
      {
        term: 'explain', pos: 'v.', zh: '解释',
        gloss: 'to make something clear by giving details',
        usage: 'explain something to somebody (not “explain me”)',
      },
      {
        term: 'line', pos: 'n.', zh: '行；文字',
        gloss: 'a row of words on a page or screen',
        usage: 'the first line of a report or a chart',
      },
    ],
    grammar: 'explain something to somebody 是固定搭配。',
  },
  {
    speaker: 'B',
    text: 'Sure. Sales went up last month.',
    zh: '当然。上个月销售额上升了。',
    structure: '主谓状：Sales 是主语，went up 是谓语，last month 是时间状语。',
    chunks: [
      { text: 'Sure.', role: '意群' },
      { text: 'Sales', role: '主语' },
      { text: 'went up', role: '谓语' },
      { text: 'last month.', role: '状语' },
    ],
    words: [
      {
        term: 'sales', pos: 'n.', zh: '销售额',
        gloss: 'the money a company receives from selling goods',
        usage: 'sales went up / down = the amount sold increased / decreased',
      },
      {
        term: 'month', pos: 'n.', zh: '月份',
        gloss: 'one of the twelve periods in a year',
        usage: 'last month, this month, next month',
      },
    ],
    grammar: 'go up 表示“上升”，过去式是 went up。',
  },
  {
    speaker: 'A',
    text: 'That is good news. Why did they go up?',
    zh: '那是好消息。为什么上升了？',
    structure: '两个句子：第一句是主系表，第二句是 Why 引导的特殊疑问句。',
    chunks: [
      { text: 'That is good news.', role: '主句' },
      { text: 'Why did they go up?', role: '疑问句' },
    ],
    words: [
      {
        term: 'news', pos: 'n.', zh: '消息',
        gloss: 'information about something that has happened',
        usage: 'uncountable: a piece of good news',
      },
      {
        term: 'why', pos: 'adv.', zh: '为什么',
        gloss: 'used to ask about the reason for something',
        usage: 'Why did ...? answer with because ...',
      },
    ],
    grammar: '特殊疑问句用 did 提问，后面的动词回到原形。',
  },
  {
    speaker: 'B',
    text: 'Because we posted more videos.',
    zh: '因为我们发布了更多视频。',
    structure: 'Because 引导原因状语从句：we 是主语，posted 是谓语，more videos 是宾语。',
    chunks: [
      { text: 'Because', role: '连接词' },
      { text: 'we', role: '主语' },
      { text: 'posted', role: '谓语' },
      { text: 'more videos.', role: '宾语' },
    ],
    words: [
      {
        term: 'because', pos: 'conj.', zh: '因为',
        gloss: 'used to give the reason for something',
        usage: 'because + a full clause; not “because of” before a clause',
      },
      {
        term: 'post', pos: 'v.', zh: '发布',
        gloss: 'to put text, photos or video online',
        usage: 'post a video or a comment on social media',
      },
    ],
    grammar: 'because 后面接一个完整的句子。',
  },
  {
    speaker: 'A',
    text: "Nice. Let's keep that plan for next month.",
    zh: '很好。下个月我们继续用这个计划。',
    structure: "主谓宾状：Let's 提出建议，keep 是谓语，that plan 是宾语，for next month 是状语。",
    chunks: [
      { text: 'Nice.', role: '意群' },
      { text: "Let's", role: '主语' },
      { text: 'keep', role: '谓语' },
      { text: 'that plan', role: '宾语' },
      { text: 'for next month.', role: '状语' },
    ],
    words: [
      {
        term: 'plan', pos: 'n.', zh: '计划',
        gloss: 'a set of steps for doing something',
        usage: 'keep a plan = continue to follow it',
      },
      {
        term: 'keep', pos: 'v.', zh: '保持',
        gloss: 'to continue to have or do something',
        usage: 'keep + noun, or keep doing something',
      },
    ],
    grammar: "Let's 是 Let us 的缩写，后面接动词原形。",
  },
  {
    speaker: 'B',
    text: 'I agree. I will prepare the slides tonight.',
    zh: '我同意。我今晚会准备幻灯片。',
    structure: '两个主谓宾结构：第二句用 will + 动词原形表示将来。',
    chunks: [
      { text: 'I', role: '主语' },
      { text: 'agree.', role: '谓语' },
      { text: 'I', role: '主语' },
      { text: 'will prepare', role: '谓语' },
      { text: 'the slides', role: '宾语' },
      { text: 'tonight.', role: '状语' },
    ],
    words: [
      {
        term: 'agree', pos: 'v.', zh: '同意',
        gloss: 'to have the same opinion as someone',
        usage: 'agree with a person; agree to a plan',
      },
      {
        term: 'prepare', pos: 'v.', zh: '准备',
        gloss: 'to get something ready before it is needed',
        usage: 'prepare slides; prepare for a meeting',
      },
    ],
    grammar: 'will 表示临时决定的将来动作。',
  },
  {
    speaker: 'A',
    text: 'Great. Send them to me before nine.',
    zh: '太好了。九点前发给我。',
    structure: '祈使句：Send 是谓语，them 是宾语，to me 和 before nine 都是状语。',
    chunks: [
      { text: 'Great.', role: '意群' },
      { text: 'Send', role: '谓语' },
      { text: 'them', role: '宾语' },
      { text: 'to me', role: '状语' },
      { text: 'before nine.', role: '状语' },
    ],
    words: [
      {
        term: 'send', pos: 'v.', zh: '发送',
        gloss: 'to make something go to another person',
        usage: 'send somebody something, or send something to somebody',
      },
      {
        term: 'before', pos: 'prep.', zh: '在……之前',
        gloss: 'earlier than a time or event',
        usage: 'before nine = earlier than nine o’clock',
      },
    ],
    grammar: '祈使句省略主语 you。',
  },
  {
    speaker: 'B',
    text: 'No problem. Talk to you later.',
    zh: '没问题。回头聊。',
    structure: '省略句 + 祈使句：Talk 是谓语，to you 是状语，later 是时间状语。',
    chunks: [
      { text: 'No problem.', role: '意群' },
      { text: 'Talk', role: '谓语' },
      { text: 'to you', role: '状语' },
      { text: 'later.', role: '状语' },
    ],
    words: [
      {
        term: 'later', pos: 'adv.', zh: '稍后',
        gloss: 'at a time after now',
        usage: 'see you later / talk to you later = goodbye phrases',
      },
      {
        term: 'talk', pos: 'v.', zh: '交谈',
        gloss: 'to speak with someone',
        usage: 'talk to / with somebody about something',
      },
    ],
    grammar: 'Talk to you later. 是口语里常用的告别表达。',
  },
];

/** Offline fallback with the same annotation shape as AI output. */
export function localDialogue(topic = '', { band = 5.5 } = {}) {
  const cleanTopic = String(topic || '').trim();
  return {
    id: `lst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: /[A-Za-z]{3,}/.test(cleanTopic) ? `${cleanTopic} · Listening practice` : 'A short meeting · Listening practice',
    topic: cleanTopic,
    band: Number(band) || 5.5,
    source: 'local',
    createdAt: new Date().toISOString(),
    lines: LOCAL_LINES.map((line) => ({
      ...line,
      chunks: line.chunks.map((chunk) => ({ ...chunk })),
      words: line.words.map((word) => ({ ...word })),
    })),
  };
}

/** Plain-text transcript + translation for the result card and clipboard. */
export function buildListeningResult(dialogue) {
  const lines = dialogue?.lines || [];
  const numbered = lines.map((line, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { number, speaker: line.speaker, text: line.text, zh: line.zh };
  });
  return {
    lines: numbered,
    transcript: numbered.map((line) => `${line.number}. ${line.speaker}: ${line.text}`).join('\n'),
    translation: numbered.map((line) => `${line.number}. ${line.zh}`).join('\n'),
    bilingual: numbered.map((line) => `${line.number}. ${line.speaker}: ${line.text}\n    ${line.zh}`).join('\n'),
  };
}
