import { SCENES, getScene } from './scenes.js';
import { GRAMMAR_BANK, detectGrammar, getGrammar, pickGrammar, targetStructure } from './grammar.js';
import {
  bandFromScore,
  compareSpeech,
  containsPhrase,
  containsWord,
  countSentences,
  countWords,
  escapeRegExp,
  hashString,
  normaliseText,
  scoreWriting,
  shuffle,
  similarity,
  tokenize,
  uniqueRatio,
} from './scoring.js';

export const MODULES = [
  {
    id: 'listening',
    name: '听力',
    en: 'Listening',
    color: '#2563eb',
    soft: '#dbeafe',
    icon: 'headphones',
    difficulty: 1,
    brief: '先听懂，再抓词',
    why: '听力是最容易进入状态的模块：先建立声音与意义的连接。',
  },
  {
    id: 'reading',
    name: '阅读',
    en: 'Reading',
    color: '#0d9488',
    soft: '#ccfbf1',
    icon: 'book',
    difficulty: 2,
    brief: '同义替换是核心',
    why: '读懂一句话的关键，是识别它被改写成了什么。',
  },
  {
    id: 'speaking',
    name: '口语',
    en: 'Speaking',
    color: '#db2777',
    soft: '#fce7f3',
    icon: 'mic',
    difficulty: 3,
    brief: '跟读 + 场景对话',
    why: '从模仿语音开始，再把词放进真实对话。',
  },
  {
    id: 'writing',
    name: '写作',
    en: 'Writing',
    color: '#d97706',
    soft: '#fef3c7',
    icon: 'pen',
    difficulty: 4,
    brief: '仿写可背诵的小段',
    why: '最后把输入变成可复用的句子与段落。',
  },
];

export const MODULE_MAP = Object.fromEntries(MODULES.map((module) => [module.id, module]));

export const STEP_SPECS = [
  { key: 'listening-1', module: 'listening', kind: 'listen_pick', title: '听音选词', focus: '在句子里抓住刚听到的关键词', minutes: 5, difficulty: 1 },
  { key: 'listening-2', module: 'listening', kind: 'listen_dictation', title: '听写补全', focus: '把声音还原成准确的词块', minutes: 5, difficulty: 2 },
  { key: 'reading-1', module: 'reading', kind: 'read_synonym', title: '同义替换', focus: '识别雅思阅读最常见的一种改写', minutes: 5, difficulty: 2 },
  { key: 'reading-2', module: 'reading', kind: 'read_inference', title: '判断题', focus: 'TRUE / FALSE / NOT GIVEN 的证据意识', minutes: 5, difficulty: 3 },
  { key: 'speaking-1', module: 'speaking', kind: 'speak_shadow', title: '跟读评分', focus: '让发音和重音先过关', minutes: 5, difficulty: 3 },
  { key: 'speaking-2', module: 'speaking', kind: 'speak_dialog', title: '场景对话', focus: '在真实场景里把词说出来', minutes: 5, difficulty: 4 },
  { key: 'writing-1', module: 'writing', kind: 'write_frame', title: '句型仿写', focus: '用一个结构写出两句完整表达', minutes: 5, difficulty: 4 },
  { key: 'writing-2', module: 'writing', kind: 'write_paragraph', title: '小段成文', focus: '写出可背诵、可迁移的 50–110 词', minutes: 5, difficulty: 5 },
];

export const STEP_MAP = Object.fromEntries(STEP_SPECS.map((spec) => [spec.key, spec]));

export const RUBRICS = {
  listen_pick: [{ id: 'answer', label: '选出正确单词', type: 'bool', weight: 1 }],
  listen_dictation: [{ id: 'accuracy', label: '听写准确率 ≥ 80%', type: 'ratio', target: 0.8, weight: 1 }],
  read_synonym: [{ id: 'answer', label: '选出正确替换词', type: 'bool', weight: 1 }],
  read_inference: [{ id: 'answer', label: '判断与原文一致', type: 'bool', weight: 1 }],
  speak_shadow: [{ id: 'accuracy', label: '跟读准确率 ≥ 75%', type: 'ratio', target: 0.75, weight: 1 }],
  speak_dialog: [
    { id: 'turns', label: '完成 2 轮对话', type: 'count', target: 2, weight: 1 },
    { id: 'wordUsed', label: '用上目标词', type: 'bool', weight: 1 },
    { id: 'wordCount', label: '累计说出 ≥ 15 词', type: 'count', target: 15, weight: 1 },
  ],
  write_frame: [
    { id: 'wordCount', label: '≥ 20 词', type: 'count', target: 20, weight: 1 },
    { id: 'wordUsed', label: '用上目标词', type: 'bool', weight: 1 },
    { id: 'structure', label: '用上目标句型', type: 'bool', weight: 1 },
    { id: 'sentences', label: '至少 2 句', type: 'count', target: 2, weight: 1 },
  ],
  write_paragraph: [
    { id: 'wordCount', label: '50–110 词', type: 'range', min: 50, max: 110, weight: 1 },
    { id: 'wordUsed', label: '用上目标词', type: 'bool', weight: 1 },
    { id: 'linking', label: '2 个逻辑连接词', type: 'count', target: 2, weight: 1 },
    { id: 'band', label: '写作评分 ≥ 6.0', type: 'band', target: 6.0, weight: 1 },
  ],
};

const DEFAULT_GRAMMAR = ['relative', 'concession', 'nominalisation', 'hedging', 'cohesion', 'passive'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lowerFirst(value = '') {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function pickDistractors(entries, target, count, seed, { samePos = true } = {}) {
  const pool = entries
    .filter((entry) => entry.word.toLowerCase() !== target.word.toLowerCase())
    .filter((entry) => !samePos || entry.pos === target.pos)
    .map((entry) => entry.word);
  const fallback = entries
    .filter((entry) => entry.word.toLowerCase() !== target.word.toLowerCase())
    .map((entry) => entry.word);
  const source = pool.length >= count ? pool : [...new Set([...pool, ...fallback])];
  return shuffle(source, seed).slice(0, count);
}

function optionsFor(correct, distractors, seed) {
  const unique = [correct, ...distractors.filter((item) => item && item.toLowerCase() !== correct.toLowerCase())];
  const final = shuffle([...new Set(unique)].slice(0, 4), seed + 11);
  return { options: final, answerIndex: final.findIndex((item) => item === correct) };
}

/** Replace the first standalone occurrence of the target word with a marker. */
function blankWord(sentence, word, marker = '____') {
  const regex = new RegExp(`\\b${escapeRegExp(word)}(?:s|es|ed|d|ing)?\\b`, 'i');
  return sentence.replace(regex, marker);
}

function replaceWord(sentence, word, replacement) {
  const regex = new RegExp(`\\b${escapeRegExp(word)}(?:s|es|ed|d|ing)?\\b`, 'i');
  return sentence.replace(regex, replacement);
}

export function matchCoreWords(text, bank, sceneId, band) {
  const hits = [];
  for (const entry of bank) {
    const regex = new RegExp(`\\b${escapeRegExp(entry.word)}(?:s|es|ed|d|ing)?\\b`, 'i');
    const match = regex.exec(text);
    if (!match) continue;
    const sceneHit = entry.scenes.includes(sceneId) ? 2 : 0;
    const bandFit = 1 - Math.min(1, Math.abs(entry.band - band) / 2);
    const early = match.index < Math.min(240, text.length * 0.4) ? 0.6 : 0;
    hits.push({ entry, score: sceneHit + bandFit * 1.2 + early });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.entry.word.localeCompare(b.entry.word))
    .map((hit) => hit.entry);
}

function fillTargetWords(matched, bank, sceneId, band) {
  const result = [...matched];
  const seen = new Set(result.map((entry) => entry.id));
  const candidates = bank
    .filter((entry) => !seen.has(entry.id))
    .map((entry) => ({
      entry,
      score: (entry.scenes.includes(sceneId) ? 2 : 0) + (1 - Math.min(1, Math.abs(entry.band - band) / 2)),
    }))
    .sort((a, b) => b.score - a.score || a.entry.word.localeCompare(b.entry.word));
  for (const candidate of candidates) {
    if (result.length >= 8) break;
    if (!seen.has(candidate.entry.id)) {
      result.push(candidate.entry);
      seen.add(candidate.entry.id);
    }
  }
  return result.slice(0, 8);
}

export function analyzeInput(rawText, { bank, sceneId, band }) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 12) throw new Error('至少输入一句完整的英文（12 个字符以上）。');
  if (text.length > 8000) throw new Error('输入过长，请控制在 8000 字符以内。');

  const scene = getScene(sceneId);
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const words = tokenize(text);
  const matched = matchCoreWords(text, bank, scene.id, band);
  const targetWords = fillTargetWords(matched, bank, scene.id, band);
  const detected = detectGrammar(text);
  const grammarIds = [...new Set([...detected, ...DEFAULT_GRAMMAR])].slice(0, 6);

  const longestSentence = sentences.reduce((longest, sentence) => (countWords(sentence) > countWords(longest) ? sentence : longest), sentences[0] || text);
  const averageSentence = sentences.length ? words.length / sentences.length : words.length;
  const diversity = uniqueRatio(text);
  const estimatedBand = round(clamp(5 + (averageSentence > 18 ? 0.8 : 0.3) + (diversity > 0.62 ? 0.8 : 0.2), 5, 7.5), 1);

  const synonymEvidence = targetWords.slice(0, 2).map((entry) => ({
    word: entry.word,
    synonym: entry.synonyms[0],
    note: `${entry.word} ⇄ ${entry.synonyms[0]}`,
  }));

  const points = [
    {
      type: 'synonym',
      label: '同义替换',
      detail: synonymEvidence.map((item) => `${item.word} ⇄ ${item.synonym}`).join('；') || '本段没有命中核心词，将从同场景词中补足。',
    },
    {
      type: 'academic',
      label: '学术词汇',
      detail: `命中 ${matched.length} 个核心词，目标学习 ${targetWords.length} 个；词形覆盖率 ${round((new Set(words).size / Math.max(words.length, 1)) * 100, 0)}%。`,
    },
    {
      type: 'sentence',
      label: '长难句',
      detail: `最长一句 ${countWords(longestSentence)} 词：${longestSentence.length > 90 ? `${longestSentence.slice(0, 90)}…` : longestSentence}`,
    },
    {
      type: 'grammar',
      label: '语法点',
      detail: grammarIds.map((id) => getGrammar(id)?.name).filter(Boolean).slice(0, 4).join('、') || '将按 Band 逐步补充复杂结构。',
    },
    {
      type: 'scene',
      label: '场景迁移',
      detail: `所有任务会放进「${scene.name}」场景：${scene.setting}。`,
    },
  ];

  return {
    text,
    sceneId: scene.id,
    band,
    stats: {
      chars: text.length,
      words: words.length,
      sentences: sentences.length,
      averageSentence: round(averageSentence, 1),
      diversity: round(diversity, 2),
      estimatedBand,
    },
    targetWords,
    matchedCount: matched.length,
    grammar: grammarIds,
    points,
    longestSentence,
  };
}

export function deriveVocabulary(entry, scene, index, bank = []) {
  const items = [];
  const seen = new Set([entry.word.toLowerCase()]);
  const push = (term, type, note) => {
    const clean = String(term || '').trim();
    if (!clean || items.length >= 10) return;
    if (seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    items.push({ term: clean, type, note });
  };

  entry.synonyms.forEach((term) => push(term, 'synonym', `≈ ${entry.word}`));
  entry.family.forEach((term) => push(term, 'family', `${entry.word} 的词族`));
  entry.collocations.forEach((term) => push(term, 'chunk', '高频搭配'));
  const offset = index % Math.max(scene.topicWords.length, 1);
  const rotated = [...scene.topicWords.slice(offset), ...scene.topicWords.slice(0, offset)];
  rotated.forEach((term) => push(term, 'scene', `${scene.name}场景词`));

  if (items.length < 10) {
    for (const candidate of bank) {
      if (items.length >= 10) break;
      if (candidate.pos !== entry.pos) continue;
      push(candidate.synonyms[0], 'synonym', `${candidate.word} 的同义词`);
    }
  }
  return items.slice(0, 10);
}

function modelParagraph(entry, scene) {
  return `${entry.example} However, noticing it takes practice. In ${scene.setting}, ${scene.agent} turns that small observation into a daily habit.`;
}

function buildSceneLine(entry, scene) {
  return `${scene.sceneLine} You are thinking about “${entry.word}”.`;
}

const BUILDERS = {
  listen_pick(entry, scene, session, index, bank) {
    const seed = hashString(`${session.id}-${index}-pick`);
    const distractors = pickDistractors([...session.words, ...bank], entry, 3, seed);
    const { options, answerIndex } = optionsFor(entry.word, distractors, seed);
    return {
      instruction: '听句子，选出空格处应填的词。可以重播。',
      audioText: entry.example,
      sentence: blankWord(entry.example, entry.word),
      question: '空格处是哪个词？',
      options,
      answerIndex,
      hint: `词性与搭配：${entry.pos} · ${entry.collocations[0]}`,
      explanation: `${entry.word} ${entry.ipa} ${entry.pos} ${entry.zh}。高频搭配：${entry.collocations.join('；')}。`,
      sceneLine: buildSceneLine(entry, scene),
      zh: entry.exampleZh,
    };
  },

  listen_dictation(entry, scene, session, index) {
    const tokens = entry.example.split(/\s+/);
    const targetIndex = tokens.findIndex((token) => normaliseText(token) === entry.word.toLowerCase());
    const start = clamp(targetIndex - 1, 0, Math.max(0, tokens.length - 5));
    const chunkTokens = tokens.slice(start, start + 5);
    const chunk = chunkTokens.join(' ');
    const visible = `${tokens.slice(0, start).join(' ')} ____ ${tokens.slice(start + 5).join(' ')}`.replace(/\s+/g, ' ').trim();
    return {
      instruction: '听整句，把缺失的 5 个词按顺序写下来。',
      audioText: entry.example,
      visible,
      answer: chunk.replace(/[.,!?;:]$/, ''),
      answerFull: chunk,
      hint: `首字母：${chunkTokens.map((token) => token.replace(/[^A-Za-z]/g, '').charAt(0) || '·').join(' ')}`,
      explanation: `${entry.word} ${entry.ipa} ${entry.zh}。原句：${entry.example}`,
      sceneLine: buildSceneLine(entry, scene),
      zh: entry.exampleZh,
    };
  },

  read_synonym(entry, scene, session, index, bank) {
    const seed = hashString(`${session.id}-${index}-syn`);
    const pool = bank
      .filter((item) => item.word !== entry.word)
      .map((item) => item.synonyms[0])
      .filter((term) => term && !entry.synonyms.includes(term));
    const { options, answerIndex } = optionsFor(entry.synonyms[0], shuffle(pool, seed).slice(0, 3), seed);
    return {
      instruction: '阅读句子，选出最能替换划线词、且句意不变的选项。',
      sentence: entry.example,
      target: entry.word,
      question: `哪个词可以替换 “${entry.word}”？`,
      options,
      answerIndex,
      hint: `先判断词性：${entry.pos}；再看它与上下文的搭配。`,
      explanation: `“${entry.word}” 在此处意为 ${entry.zh}，与 “${entry.synonyms[0]}” 构成同义替换；另一近义表达 “${entry.synonyms[1]}” 也可，但搭配略有差别。`,
      sceneLine: buildSceneLine(entry, scene),
      zh: entry.exampleZh,
    };
  },

  read_inference(entry, scene, session, index) {
    const seed = hashString(`${session.id}-${index}-tf`);
    const truthy = seed % 2 === 0;
    const paraphrase = replaceWord(entry.example, entry.word, entry.synonyms[0]);
    const statement = truthy ? paraphrase : `It is not true that ${lowerFirst(paraphrase)}`;
    const options = ['TRUE', 'FALSE', 'NOT GIVEN'];
    return {
      instruction: '阅读原文，判断题干与原文是否一致。',
      passage: entry.example,
      statement,
      question: '题干与原文的关系是？',
      options,
      answerIndex: truthy ? 0 : 1,
      hint: '先找题干里的词在原文对应哪一处，再判断是改写、反义还是原文未提。',
      explanation: truthy
        ? `原文的 “${entry.word}” 被改写为 “${entry.synonyms[0]}”，句意一致，所以是 TRUE。`
        : `题干用 “It is not true that ...” 否定了原文，方向相反，所以是 FALSE。`,
      sceneLine: buildSceneLine(entry, scene),
      zh: entry.exampleZh,
    };
  },

  speak_shadow(entry, scene) {
    return {
      instruction: '点击麦克风跟读整句；系统会逐词比对并给出准确率。',
      sentence: entry.example,
      audioText: entry.example,
      focus: entry.word,
      ipa: entry.ipa,
      tip: `先把 “${entry.word}” 读准（${entry.ipa}），再整句连读；句末陈述句用降调。`,
      chunks: entry.collocations,
      zh: entry.exampleZh,
      sceneLine: buildSceneLine(entry, scene),
    };
  },

  speak_dialog(entry, scene) {
    return {
      instruction: '用英语完成 2 轮对话。可以打字，也可以按住麦克风说。',
      role: scene.role,
      setting: scene.setting,
      opening: `${scene.dialogOpen} Let us connect it to the word “${entry.word}”.`,
      followUps: [
        `What does “${entry.word}” mean in your own words?`,
        `Can you describe a situation in ${scene.place} where “${entry.word}” mattered?`,
      ],
      keywords: [entry.word, entry.synonyms[0], entry.collocations[0]],
      hint: `至少用一次 “${entry.word}”；回答里加入 because / for example 会更自然。`,
      zh: entry.exampleZh,
      sceneLine: buildSceneLine(entry, scene),
    };
  },

  write_frame(entry, scene, session, index, bank) {
    const structure = pickGrammar(index, session.analysis.grammar, 2)[0] || GRAMMAR_BANK[0];
    return {
      instruction: `用句型 ${structure.pattern} 写 2 句，把 “${entry.word}” 用进去。`,
      prompt: `场景：${scene.setting}。写两句话，描述这里发生的事，至少一句使用 ${structure.name}。`,
      structure: {
        id: structure.id,
        name: structure.name,
        pattern: structure.pattern,
        tip: structure.tip,
        example: structure.example,
        frame: structure.frame,
      },
      chunks: [entry.collocations[0], entry.synonyms[0], entry.family[0]],
      minWords: 20,
      maxWords: 90,
      model: modelParagraph(entry, scene),
      hint: `可以直接从 “${entry.collocations[0]}” 入手，再用 ${structure.pattern} 补充一个细节。`,
      zh: entry.exampleZh,
      sceneLine: buildSceneLine(entry, scene),
    };
  },

  write_paragraph(entry, scene, session, index) {
    const learned = session.steps
      .slice(0, index)
      .filter(Boolean)
      .map((step) => step.word.word);
    return {
      instruction: '写一段 50–110 词的短文。提交后会按雅思写作四项给出本地评分与修改建议。',
      prompt: `${scene.writingPrompt}`,
      requirements: [
        `用上目标词 “${entry.word}”`,
        learned.length ? `复用已学词：${learned.slice(0, 3).join(' / ')}` : '至少用 2 个本课学过的搭配',
        '至少 2 个逻辑连接词（because / however / for example）',
        '50–110 词，2 句以上',
      ],
      chunks: [entry.collocations[0], entry.collocations[1], entry.synonyms[0], entry.family[0], scene.topicWords[index % scene.topicWords.length]],
      minWords: 50,
      maxWords: 110,
      model: modelParagraph(entry, scene),
      hint: '先写主题句，再给一个具体例子，最后用 however 或 therefore 收束。',
      zh: entry.exampleZh,
      sceneLine: buildSceneLine(entry, scene),
      learned,
    };
  },
};

export function createSession({ text, sceneId = 'music', band = 6.5, bank, mode = 'auto', sourceLabel = '自定义文本' }) {
  const analysis = analyzeInput(text, { bank, sceneId, band });
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const session = {
    id,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode,
    sourceLabel,
    sceneId: analysis.sceneId,
    band,
    input: {
      text: analysis.text,
      words: analysis.stats.words,
      sentences: analysis.stats.sentences,
      sourceLabel,
    },
    analysis,
    words: analysis.targetWords,
    steps: new Array(STEP_SPECS.length).fill(null),
    results: {},
    status: 'active',
    targets: {
      steps: STEP_SPECS.length,
      minutes: STEP_SPECS.reduce((sum, spec) => sum + spec.minutes, 0),
      vocabExposures: analysis.targetWords.length * 10,
      grammarExposures: STEP_SPECS.length * 2,
      listeningAccuracy: 0.8,
      readingAccuracy: 0.8,
      speakingAccuracy: 0.75,
      writingBand: 6.0,
    },
  };
  return session;
}

export function buildLocalStep(session, index, bank = []) {
  const spec = STEP_SPECS[index];
  if (!spec) throw new Error(`Unknown step index: ${index}`);
  const entry = session.words[index % session.words.length];
  const scene = getScene(session.sceneId);
  const grammarPoints = pickGrammar(index, session.analysis.grammar, 2);
  const derived = deriveVocabulary(entry, scene, index, bank);
  const payload = BUILDERS[spec.kind](entry, scene, session, index, bank);
  const previous = index > 0 ? session.steps[index - 1] : null;

  const step = {
    key: spec.key,
    index,
    module: spec.module,
    kind: spec.kind,
    title: spec.title,
    focus: spec.focus,
    minutes: spec.minutes,
    difficulty: spec.difficulty,
    word: entry,
    grammar: grammarPoints.map((point) => point.id),
    grammarPoints,
    derived,
    payload,
    rubric: RUBRICS[spec.kind].map((item) => ({ ...item })),
    source: 'local',
    contextLine: previous
      ? `承接第 ${index} 步：你已经和 “${previous.word.word}” 交过手，这一步换一个角度。`
      : `起步：先把 “${entry.word}” 听清、读懂，再开口、落笔。`,
  };
  return step;
}

export function stepGoal(step) {
  return step.focus || step.title || '微任务';
}

export function evaluateRubricItem(item, actual) {
  if (item.type === 'bool') {
    const met = Boolean(actual);
    return { actual: met ? 1 : 0, target: 1, met, ratio: met ? 1 : 0, display: met ? '已完成' : '未完成' };
  }
  if (item.type === 'ratio') {
    const value = clamp(Number(actual) || 0, 0, 1);
    const met = value >= item.target;
    return {
      actual: value,
      target: item.target,
      met,
      ratio: clamp(value / item.target, 0, 1),
      display: `${Math.round(value * 100)}% / ${Math.round(item.target * 100)}%`,
    };
  }
  if (item.type === 'count') {
    const value = Number(actual) || 0;
    const met = value >= item.target;
    return {
      actual: value,
      target: item.target,
      met,
      ratio: clamp(value / item.target, 0, 1),
      display: `${value} / ${item.target}`,
    };
  }
  if (item.type === 'range') {
    const value = Number(actual) || 0;
    const met = value >= item.min && value <= item.max;
    const ratio = met ? 1 : value < item.min ? clamp(value / item.min, 0, 1) : clamp(item.max / Math.max(value, 1), 0, 1);
    return { actual: value, target: `${item.min}–${item.max}`, met, ratio, display: `${value} 词` };
  }
  if (item.type === 'band') {
    const value = Number(actual) || 0;
    const met = value >= item.target;
    return {
      actual: value,
      target: item.target,
      met,
      ratio: clamp((value - 4.5) / 3.5, 0, 1),
      display: `Band ${value.toFixed(1)}`,
    };
  }
  return { actual, met: false, ratio: 0, display: '—' };
}

export function evaluateStep(step, progress = {}) {
  const checks = progress.checks || {};
  const items = step.rubric.map((item) => ({ ...item, ...evaluateRubricItem(item, checks[item.id]) }));
  const weight = items.reduce((sum, item) => sum + (item.weight || 1), 0) || 1;
  const score = Math.round((items.reduce((sum, item) => sum + (item.weight || 1) * item.ratio, 0) / weight) * 100);
  const completed = items.every((item) => item.met);
  return {
    completed,
    score: clamp(score, 0, 100),
    items,
    metrics: {
      vocab: 1 + (step.derived?.length || 0),
      grammar: step.grammar?.length || 0,
      derived: step.derived?.length || 0,
    },
    remaining: items.filter((item) => !item.met).map((item) => item.label),
  };
}

export function makeProgressCheck(kind, evidence = {}) {
  const checks = {};
  if (kind === 'listen_pick' || kind === 'read_synonym' || kind === 'read_inference') {
    checks.answer = Boolean(evidence.correct);
  }
  if (kind === 'listen_dictation') {
    checks.accuracy = evidence.accuracy || 0;
  }
  if (kind === 'speak_shadow') {
    checks.accuracy = evidence.accuracy || 0;
  }
  if (kind === 'speak_dialog') {
    checks.turns = evidence.turns || 0;
    checks.wordUsed = Boolean(evidence.wordUsed);
    checks.wordCount = evidence.wordCount || 0;
  }
  if (kind === 'write_frame') {
    const analysis = evidence.analysis || {};
    checks.wordCount = analysis.wordCount || 0;
    checks.wordUsed = Boolean(analysis.targetUsed);
    checks.structure = Boolean(analysis.structureUsed);
    checks.sentences = analysis.sentenceCount || 0;
  }
  if (kind === 'write_paragraph') {
    const analysis = evidence.analysis || {};
    checks.wordCount = analysis.wordCount || 0;
    checks.wordUsed = Boolean(analysis.targetUsed);
    checks.linking = (analysis.linking || []).length;
    checks.band = analysis.band || 0;
  }
  return checks;
}

export function summarizeSession(session) {
  const steps = session.steps.filter(Boolean);
  const results = session.results || {};
  const completedSteps = steps.filter((step) => results[step.index]?.completed);
  const attempted = steps.filter((step) => results[step.index]);

  const totalSeconds = Object.values(results).reduce((sum, result) => sum + (Number(result.timeSpent) || 0), 0);
  const moduleStats = {};
  for (const module of MODULES) {
    const items = attempted.filter((step) => step.module === module.id);
    const scores = items.map((step) => results[step.index]?.score ?? 0);
    moduleStats[module.id] = {
      score: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
      steps: items.length,
      completed: completedSteps.filter((step) => step.module === module.id).length,
    };
  }

  const coreWords = [];
  const derivedTerms = new Map();
  let vocabExposures = 0;
  const grammarIds = new Set();
  let grammarExposures = 0;

  for (const step of completedSteps) {
    if (!coreWords.some((item) => item.id === step.word.id)) coreWords.push(step.word);
    for (const item of step.derived || []) {
      derivedTerms.set(item.term.toLowerCase(), item);
      vocabExposures += 1;
    }
    for (const id of step.grammar || []) {
      grammarIds.add(id);
      grammarExposures += 1;
    }
  }

  const listeningItems = attempted.filter((step) => step.module === 'listening');
  const readingItems = attempted.filter((step) => step.module === 'reading');
  const speakingItems = attempted.filter((step) => step.module === 'speaking');
  const writingItems = attempted.filter((step) => step.module === 'writing');

  const listeningAccuracy = listeningItems.length
    ? listeningItems.reduce((sum, step) => {
      const result = results[step.index];
      const check = result?.checks || {};
      return sum + (typeof check.accuracy === 'number' ? check.accuracy : check.answer ? 1 : 0);
    }, 0) / listeningItems.length
    : 0;
  const readingAccuracy = readingItems.length
    ? readingItems.reduce((sum, step) => sum + (results[step.index]?.checks?.answer ? 1 : 0), 0) / readingItems.length
    : 0;
  const speakingAccuracy = speakingItems.length
    ? speakingItems.reduce((sum, step) => {
      const check = results[step.index]?.checks || {};
      if (typeof check.accuracy === 'number') return sum + check.accuracy;
      return sum + (check.wordUsed ? 0.8 : 0.5);
    }, 0) / speakingItems.length
    : 0;
  const writingBands = writingItems
    .map((step) => results[step.index]?.checks?.band)
    .filter((band) => typeof band === 'number');
  const writingBand = writingBands.length ? writingBands.reduce((sum, band) => sum + band, 0) / writingBands.length : null;

  const scores = attempted.map((step) => results[step.index]?.score || 0);
  const overall = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;

  const achievements = [
    { id: 'vocab', label: '词汇接触量（核心词 × 10）', actual: vocabExposures, target: session.targets.vocabExposures, unit: '次', met: vocabExposures >= session.targets.vocabExposures },
    { id: 'grammar', label: '语法点接触次数', actual: grammarExposures, target: session.targets.grammarExposures, unit: '次', met: grammarExposures >= session.targets.grammarExposures },
    { id: 'listening', label: '听力正确率', actual: round(listeningAccuracy * 100, 0), target: 80, unit: '%', met: listeningAccuracy >= 0.8 },
    { id: 'reading', label: '阅读判断正确率', actual: round(readingAccuracy * 100, 0), target: 80, unit: '%', met: readingAccuracy >= 0.8 },
    { id: 'speaking', label: '口语跟读/表达', actual: round(speakingAccuracy * 100, 0), target: 75, unit: '%', met: speakingAccuracy >= 0.75 },
    { id: 'writing', label: '写作评分', actual: writingBand ? Number(writingBand.toFixed(1)) : 0, target: 6.0, unit: 'Band', met: (writingBand || 0) >= 6.0 },
  ];

  const moduleEntries = MODULES.map((module) => ({
    ...module,
    ...moduleStats[module.id],
    accuracy: module.id === 'listening' ? listeningAccuracy
      : module.id === 'reading' ? readingAccuracy
        : module.id === 'speaking' ? speakingAccuracy
          : writingBand,
  }));

  const weakest = moduleEntries.filter((module) => module.score !== null).sort((a, b) => a.score - b.score)[0];
  const strongest = moduleEntries.filter((module) => module.score !== null).sort((a, b) => b.score - a.score)[0];
  const strengths = [];
  const next = [];

  if (strongest) strengths.push(`${strongest.name}是本轮最稳的一项（${strongest.score} 分），保持这种节奏。`);
  if (coreWords.length) strengths.push(`已经能主动使用 ${coreWords.length} 个核心词，并把它们放进了「${getScene(session.sceneId).name}」场景。`);
  if (grammarIds.size) strengths.push(`覆盖了 ${grammarIds.size} 个语法点，其中 ${getGrammar([...grammarIds][0])?.name || '复杂句'} 已进入输出。`);

  if (weakest) next.push(`下一轮优先补${weakest.name}：用同一段输入再做一次，只关注一个卡点。`);
  if (listeningAccuracy < 0.8) next.push('听力：每天做 1 次 5 词听写，先听整句再逐词还原。');
  if (speakingAccuracy < 0.75) next.push('口语：先慢速跟读 3 遍，再录音对比重音位置，不必追求速度。');
  if (!writingBand || writingBand < 6) next.push('写作：背下本轮的 model paragraph，再用自己的场景替换其中两句。');
  if (derivedTerms.size < session.targets.vocabExposures / 2) next.push('词汇：把派生词做成 3 张复习卡，第二天只听写搭配。');

  return {
    sessionId: session.id,
    finishedAt: new Date().toISOString(),
    totalSeconds,
    completedSteps: completedSteps.length,
    totalSteps: STEP_SPECS.length,
    overall,
    band: bandFromScore(overall || 50),
    moduleStats: moduleEntries,
    modules: moduleStats,
    vocab: {
      core: coreWords,
      derived: [...derivedTerms.values()],
      exposures: vocabExposures,
      unique: coreWords.length + derivedTerms.size,
      target: session.targets.vocabExposures,
    },
    grammar: {
      points: [...grammarIds].map((id) => getGrammar(id)).filter(Boolean),
      exposures: grammarExposures,
      unique: grammarIds.size,
      target: session.targets.grammarExposures,
    },
    metrics: {
      listeningAccuracy,
      readingAccuracy,
      speakingAccuracy,
      writingBand,
      totalSeconds,
      averageSecondsPerStep: completedSteps.length ? Math.round(totalSeconds / completedSteps.length) : 0,
    },
    achievements,
    strengths,
    next,
    timeline: steps.map((step) => ({
      index: step.index,
      key: step.key,
      module: step.module,
      title: step.title,
      word: step.word.word,
      completed: Boolean(results[step.index]?.completed),
      score: results[step.index]?.score ?? 0,
      timeSpent: results[step.index]?.timeSpent ?? 0,
    })),
    scene: getScene(session.sceneId),
    input: session.input,
    analysis: session.analysis,
  };
}

/** ---------- AI prompts for a single step (optional enhancement) ---------- */

const REQUIRED_FIELDS = {
  listen_pick: ['audioText', 'sentence', 'question', 'options', 'answerIndex', 'explanation'],
  listen_dictation: ['audioText', 'visible', 'answer', 'hint', 'explanation'],
  read_synonym: ['sentence', 'target', 'question', 'options', 'answerIndex', 'explanation'],
  read_inference: ['passage', 'statement', 'question', 'options', 'answerIndex', 'explanation'],
  speak_shadow: ['sentence', 'audioText', 'tip', 'zh'],
  speak_dialog: ['opening', 'followUps', 'keywords'],
  write_frame: ['prompt', 'structure', 'chunks', 'model'],
  write_paragraph: ['prompt', 'requirements', 'chunks', 'model'],
};

export function buildStepPrompt(session, step) {
  const scene = getScene(session.sceneId);
  const system = [
    'You are an IELTS coach who writes one 5-minute micro-task at a time.',
    'Return ONLY a valid JSON object. No markdown, no commentary.',
    'Keep exactly the same keys and value types as the TEMPLATE object.',
    'English sentences must be natural, 8–24 words, around IELTS Band 6–7.5, and must contain the TARGET word exactly once.',
    'All Chinese explanations must be concise and learner-friendly.',
    'Options must contain exactly 4 plausible, distinct items and answerIndex must point at the correct one.',
  ].join(' ');

  const payload = {
    scene: { id: scene.id, name: scene.name, setting: scene.setting, agent: scene.agent, role: scene.role, sceneLine: scene.sceneLine },
    band: session.band,
    module: step.module,
    kind: step.kind,
    title: step.title,
    target: {
      word: step.word.word,
      ipa: step.word.ipa,
      pos: step.word.pos,
      zh: step.word.zh,
      example: step.word.example,
      synonyms: step.word.synonyms,
      collocations: step.word.collocations,
      family: step.word.family,
    },
    learnedWords: session.words.slice(0, step.index).map((entry) => entry.word),
    inputExcerpt: session.input.text.slice(0, 600),
    template: step.payload,
  };

  const user = `Create the next task for this learner. It must stay in the specified scene, build on the target word and reuse at least one learned word when possible.\n${JSON.stringify(payload, null, 2)}`;
  return { system, user };
}

function sanitiseOptions(options, answerIndex) {
  if (!Array.isArray(options)) return null;
  const cleaned = options.map((option) => String(option).trim()).filter(Boolean);
  if (cleaned.length !== 4) return null;
  if (new Set(cleaned.map((option) => option.toLowerCase())).size !== 4) return null;
  const index = Number(answerIndex);
  if (!Number.isInteger(index) || index < 0 || index > 3) return null;
  return { options: cleaned, answerIndex: index };
}

export function applyAIStep(step, candidate) {
  if (!candidate || typeof candidate !== 'object') return step;
  const fields = REQUIRED_FIELDS[step.kind] || [];
  if (!fields.every((field) => candidate[field] !== undefined)) return step;

  const payload = { ...step.payload };
  for (const field of Object.keys(step.payload)) {
    if (candidate[field] === undefined) continue;
    const current = step.payload[field];
    const next = candidate[field];
    if (typeof current === 'string' && typeof next === 'string' && next.trim()) payload[field] = next.trim();
    else if (typeof current === 'number' && typeof next === 'number') payload[field] = next;
    else if (Array.isArray(current) && Array.isArray(next)) {
      if (field === 'options') {
        const safe = sanitiseOptions(next, candidate.answerIndex);
        if (safe) {
          payload.options = safe.options;
          payload.answerIndex = safe.answerIndex;
        }
      } else if (next.length) payload[field] = next.map((item) => String(item));
    }
  }

  if (payload.options && payload.answerIndex === undefined) payload.answerIndex = step.payload.answerIndex;
  if (payload.options && (!Number.isInteger(payload.answerIndex) || payload.answerIndex < 0 || payload.answerIndex > 3)) return step;

  const sentence = payload.audioText || payload.sentence || payload.passage || '';
  if (sentence && step.kind !== 'speak_dialog' && !containsWord(sentence, step.word.word)) return step;

  return { ...step, payload, source: 'ai' };
}

/** ---------- Dialogue & feedback prompts ---------- */

export function buildTutorMessages(session, step, history = []) {
  const scene = getScene(session.sceneId);
  const system = [
    `You are a patient IELTS speaking tutor role-playing ${scene.role} in ${scene.setting}.`,
    `The learner is practising the word "${step.word.word}" (${step.word.pos} ${step.word.zh}).`,
    'Reply in English, 25–55 words, with one natural follow-up question.',
    'If the learner makes a clear error, correct it briefly in brackets and give the better phrase.',
    'Do not lecture; keep the role-play alive and push the learner to speak more.',
  ].join(' ');
  const messages = [
    { role: 'system', content: system },
    { role: 'assistant', content: step.payload.opening },
    ...history.map((turn) => ({ role: turn.role === 'tutor' ? 'assistant' : 'user', content: turn.text })),
  ];
  return messages;
}

export function writingFeedbackPrompt(step, text, local) {
  const system = [
    'You are an IELTS writing examiner. Return ONLY JSON.',
    'Schema: {"band": number between 4.5 and 8.5, "criteria": {"task": 0-9, "coherence": 0-9, "lexis": 0-9, "grammar": 0-9}, "feedbackZh": string, "corrections": [{"from": string, "to": string, "whyZh": string}], "betterSentence": string}.',
    'Be precise and kind. At most 3 corrections. Feedback in Simplified Chinese, under 90 characters.',
  ].join(' ');
  const user = JSON.stringify({
    task: step.payload.prompt,
    targetWord: step.word.word,
    band: step.band || 6.5,
    wordCount: local.wordCount,
    draft: text,
  });
  return { system, user };
}

export function speakingFeedbackPrompt(step, transcript) {
  const system = [
    'You are an IELTS pronunciation and fluency coach. Return ONLY JSON.',
    'Schema: {"feedbackZh": string, "tips": [string], "betterVersion": string}.',
    'Feedback in Simplified Chinese under 80 characters. Tips are short English/Chinese mix, max 3.',
  ].join(' ');
  const user = JSON.stringify({
    targetSentence: step.payload.sentence,
    focusWord: step.word.word,
    ipa: step.word.ipa,
    learnerSaid: transcript,
  });
  return { system, user };
}

export function reportPrompt(session, summary) {
  const system = [
    'You are an IELTS learning coach. Return ONLY JSON.',
    'Schema: {"headline": string, "summaryZh": string, "strengths": [string], "nextSteps": [string]}.',
    'headline <= 24 Chinese characters. summaryZh 80-120 Chinese characters. strengths and nextSteps: 3 items each, each <= 40 Chinese characters.',
    'Base every claim on the numbers provided; do not invent scores.',
  ].join(' ');
  const user = JSON.stringify({
    scene: summary.scene.name,
    band: summary.band,
    overall: summary.overall,
    completedSteps: summary.completedSteps,
    minutes: Math.round(summary.totalSeconds / 60),
    modules: summary.moduleStats.map((module) => ({ name: module.name, score: module.score })),
    vocab: summary.vocab,
    grammar: summary.grammar.points.map((point) => point.name),
    metrics: summary.metrics,
  });
  return { system, user };
}

export { SCENES, GRAMMAR_BANK, detectGrammar, getGrammar, targetStructure, scoreWriting, compareSpeech, countWords, countSentences, containsPhrase, containsWord, similarity };
