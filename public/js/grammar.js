/**
 * A compact grammar bank. Each point carries a detector so that the analyser
 * can claim the structures actually present in the learner's input, and a
 * writing frame used by the writing tasks.
 */
export const GRAMMAR_BANK = [
  {
    id: 'relative',
    name: '定语从句',
    en: 'Relative clause',
    pattern: 'which / that / who / whose',
    tip: '用从句补充名词信息，把两个短句合成一个长句。',
    example: 'The idea that changed my mind came from a stranger.',
    frame: 'The ____ that ____ is ____.',
    regex: /\b(which|that|who|whose|whom)\b/i,
  },
  {
    id: 'passive',
    name: '被动语态',
    en: 'Passive voice',
    pattern: 'be + past participle',
    tip: '当动作的执行者不重要或未知时，用被动语态让句子更客观。',
    example: 'The results were published before the conference.',
    frame: '____ was / were ____ by ____.',
    regex: /\b(is|are|was|were|been|being)\s+\w+(ed|en)\b/i,
  },
  {
    id: 'conditional',
    name: '条件句',
    en: 'Conditional',
    pattern: 'if / unless / provided that',
    tip: '第二条件句（if + past, would + verb）常用来讨论假设。',
    example: 'If the city invested more in buses, fewer people would drive.',
    frame: 'If ____, ____ would ____.',
    regex: /\b(if|unless|provided that|as long as)\b/i,
  },
  {
    id: 'concession',
    name: '让步状语从句',
    en: 'Concession',
    pattern: 'although / even though / while / despite',
    tip: '先承认对立面，再给出主观点，是雅思写作的高分结构。',
    example: 'Although the plan is expensive, it may save money in the long run.',
    frame: 'Although ____, ____.',
    regex: /\b(although|though|even though|while|whereas|despite|in spite of)\b/i,
  },
  {
    id: 'comparison',
    name: '比较结构',
    en: 'Comparison',
    pattern: 'more ... than / as ... as / the most',
    tip: '比较时保持对象一致，避免 than 后面成分残缺。',
    example: 'Online courses are often cheaper than traditional ones.',
    frame: '____ is / are more ____ than ____.',
    regex: /\b(more|less|fewer|as)\s+\w+\s+(than|as)\b|\bthe\s+(most|least)\b/i,
  },
  {
    id: 'participle',
    name: '分词短语',
    en: 'Participle phrase',
    pattern: '-ing / -ed clause',
    tip: '分词短语可以压缩从句，让书面语更紧凑。',
    example: 'Faced with rising costs, the company changed its strategy.',
    frame: '____-ing / ____-ed, ____.',
    regex: /^\s*\w+(ing|ed)\s*,|\b\w+(ing|ed)\s+\w+\s*,/i,
  },
  {
    id: 'nominalisation',
    name: '名词化',
    en: 'Nominalisation',
    pattern: '-tion / -ment / -ity / -ness',
    tip: '把动词或形容词变成名词，是学术写作提升正式度的常用手段。',
    example: 'The rapid growth of cities has increased the demand for housing.',
    frame: 'The ____ of ____ has ____.',
    regex: /\b\w+(tion|ment|ity|ness|ance|ence)\b/i,
  },
  {
    id: 'hedging',
    name: '模糊限制语',
    en: 'Hedging',
    pattern: 'tend to / may / appear to / it seems',
    tip: '对结论保持谨慎，避免绝对化表达，是学术论证的礼貌策略。',
    example: 'Younger viewers tend to prefer short videos.',
    frame: 'It seems that ____ tends to ____.',
    regex: /\b(tend to|may|might|appear to|seem to|it seems|likely|probably)\b/i,
  },
  {
    id: 'cleft',
    name: '强调句',
    en: 'Cleft sentence',
    pattern: 'It is ... that ...',
    tip: '把信息焦点放在 It is 后面，适合段落主题句。',
    example: 'It is the daily habit, not the talent, that matters most.',
    frame: 'It is ____ that ____.',
    regex: /\bit\s+(is|was)\s+.+\s+that\b/i,
  },
  {
    id: 'inversion',
    name: '倒装与强调搭配',
    en: 'Inversion / Not only',
    pattern: 'Not only ... but also / Never have ...',
    tip: '倒装能制造节奏，但一篇作文用一次即可。',
    example: 'Not only does exercise improve mood, but it also sharpens memory.',
    frame: 'Not only ____, but ____ also ____.',
    regex: /\b(not only|never have|rarely does|little did)\b/i,
  },
  {
    id: 'cohesion',
    name: '衔接手段',
    en: 'Cohesion',
    pattern: 'however / therefore / for example / in contrast',
    tip: '连接词要表达真实的逻辑关系，不要为了用而用。',
    example: 'The scheme is popular; however, its cost remains unclear.',
    frame: '____; however, ____.',
    regex: /\b(however|therefore|moreover|furthermore|for example|in contrast|consequently)\b/i,
  },
  {
    id: 'modality',
    name: '情态动词',
    en: 'Modals',
    pattern: 'should / must / could / need to',
    tip: '区分建议、义务与可能性，写作中避免 must 过度使用。',
    example: 'Governments should invest in public transport rather than roads.',
    frame: '____ should ____ because ____.',
    regex: /\b(should|must|ought to|could|need to|have to)\b/i,
  },
];

export const GRAMMAR_MAP = Object.fromEntries(GRAMMAR_BANK.map((point) => [point.id, point]));

export function getGrammar(id) {
  return GRAMMAR_MAP[id] || null;
}

export function detectGrammar(text) {
  return GRAMMAR_BANK.filter((point) => point.regex.test(text)).map((point) => point.id);
}

/**
 * Two points per step: one anchored in the input (when possible), one new.
 * Rotation guarantees the whole session covers at least eight distinct points.
 */
export function pickGrammar(index, detected = [], count = 2) {
  const picked = [];
  const push = (point) => {
    if (point && !picked.some((item) => item.id === point.id)) picked.push(point);
  };
  const detectedPoints = detected.map(getGrammar).filter(Boolean);
  push(detectedPoints[index % Math.max(detectedPoints.length, 1)]);
  for (let offset = 0; picked.length < count && offset < GRAMMAR_BANK.length * 2; offset += 1) {
    push(GRAMMAR_BANK[(index * 2 + offset) % GRAMMAR_BANK.length]);
  }
  return picked;
}

export function targetStructure(index, detected = []) {
  const detectedPoints = detected.map(getGrammar).filter(Boolean);
  return detectedPoints[index % Math.max(detectedPoints.length, 1)] || GRAMMAR_BANK[index % GRAMMAR_BANK.length];
}
