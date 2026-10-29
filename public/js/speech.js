/* Browser speech synthesis + recognition. Graceful when unsupported. */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const ttsSupported = Boolean(synth);
export const recognitionSupported = Boolean(SR);

let voices = [];
let voicesReady = false;
let speakToken = 0;

function refreshVoices() {
  if (!synth) return;
  const list = synth.getVoices().filter((voice) => /^en(-|_)/i.test(voice.lang));
  if (list.length) {
    voices = list;
    voicesReady = true;
  }
}

if (synth) {
  refreshVoices();
  synth.addEventListener?.('voiceschanged', refreshVoices);
  setTimeout(refreshVoices, 400);
}

export function listVoices() {
  return voices.slice();
}

function pickVoice(lang = 'en-GB') {
  if (!voicesReady) refreshVoices();
  const preferred = [
    'Google UK English Female', 'Microsoft Sonia', 'Microsoft Libby', 'Microsoft Ryan',
    'Google US English', 'Samantha', 'Daniel', 'Serena', 'Microsoft Aria',
  ];
  for (const name of preferred) {
    const match = voices.find((voice) => voice.name.includes(name));
    if (match) return match;
  }
  return voices.find((voice) => voice.lang.replace('_', '-') === lang)
    || voices.find((voice) => voice.lang.startsWith(lang.slice(0, 2)))
    || voices[0]
    || null;
}

function splitSentences(text, max = 190) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      chunks.push(sentence);
    } else {
      let rest = sentence;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max * 0.5) cut = max;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks;
}

export function stopSpeaking() {
  speakToken += 1;
  if (synth) synth.cancel();
}

export function speak(text, { rate = 0.92, lang = 'en-GB', onStart, onEnd, onError } = {}) {
  if (!synth) {
    onEnd?.();
    return () => {};
  }
  stopSpeaking();
  const token = speakToken;
  const chunks = splitSentences(text);
  if (!chunks.length) { onEnd?.(); return () => {}; }
  const voice = pickVoice(lang);
  let index = 0;
  let finished = false;

  const finish = () => {
    if (finished || token !== speakToken) return;
    finished = true;
    onEnd?.();
  };

  const playNext = () => {
    if (token !== speakToken || finished) return;
    if (index >= chunks.length) { finish(); return; }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    index += 1;
    utterance.rate = rate;
    utterance.lang = voice?.lang || lang;
    utterance.pitch = 1;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { if (index === 1) onStart?.(); };
    utterance.onend = () => playNext();
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      onError?.(event);
      finish();
    };
    synth.speak(utterance);
  };

  onStart?.();
  playNext();
  return () => {
    speakToken += 1;
    synth.cancel();
  };
}

const ERROR_TEXT = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许麦克风。',
  'service-not-allowed': '当前浏览器不允许语音识别。',
  'no-speech': '没有听到声音，再试一次。',
  'audio-capture': '找不到麦克风设备。',
  network: '语音识别服务暂时不可用（需要网络）。',
  aborted: '',
};

export class Listener {
  constructor({ lang = 'en-GB', continuous = false, interimResults = true, onResult, onInterim, onEnd, onError } = {}) {
    this.lang = lang;
    this.continuous = continuous;
    this.interimResults = interimResults;
    this.onResult = onResult;
    this.onInterim = onInterim;
    this.onEnd = onEnd;
    this.onError = onError;
    this.recognition = null;
    this.active = false;
    this.finalText = '';
  }

  get supported() {
    return Boolean(SR);
  }

  start() {
    if (!SR) {
      this.onError?.('当前浏览器不支持语音识别。推荐使用 Chrome 或 Edge。');
      return false;
    }
    if (this.active) return true;
    this.finalText = '';
    const recognition = new SR();
    recognition.lang = this.lang;
    recognition.continuous = this.continuous;
    recognition.interimResults = this.interimResults;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { this.active = true; };
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          this.finalText += `${result[0].transcript} `;
        } else {
          interim += result[0].transcript;
        }
      }
      if (this.finalText.trim()) this.onResult?.(this.finalText.trim());
      if (interim) this.onInterim?.(interim);
    };
    recognition.onerror = (event) => {
      this.active = false;
      const message = ERROR_TEXT[event.error] ?? `语音识别出错：${event.error}`;
      if (message) this.onError?.(message);
    };
    recognition.onend = () => {
      this.active = false;
      this.onEnd?.(this.finalText.trim());
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.active = true;
      return true;
    } catch (error) {
      this.active = false;
      this.onError?.(`无法启动麦克风：${error.message}`);
      return false;
    }
  }

  stop() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* ignore */ }
    }
    this.active = false;
  }

  abort() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
    }
    this.active = false;
  }
}

/**
 * Map a short utterance to an intent. Bilingual on purpose: recognition often
 * returns either the English command or a Chinese one.
 */
export function parseCommand(raw = '') {
  const text = String(raw).toLowerCase().replace(/[.,!?。，！？]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  if (/\b(next|continue|go on|move on|done)\b/.test(text) || /(下一步|继续|下一个|完成)/.test(text)) return { intent: 'next' };
  if (/\b(repeat|again|say it again)\b/.test(text) || /(重播|再说一遍|再来一遍)/.test(text)) return { intent: 'repeat' };
  if (/\b(play|listen|hear it)\b/.test(text) || /(播放|听一遍|听一下|开始听)/.test(text)) return { intent: 'play' };
  if (/\b(hint|help|clue)\b/.test(text) || /(提示|帮助|不会|给点线索)/.test(text)) return { intent: 'hint' };
  if (/\b(stop|pause|cancel|quiet)\b/.test(text) || /(停止|暂停|别说了|安静)/.test(text)) return { intent: 'stop' };
  if (/\b(report|summary)\b/.test(text) || /(报告|总结|看结果)/.test(text)) return { intent: 'report' };

  const searchMatch = text.match(/(?:search|find|look up|read about)\s+(?:for\s+|about\s+)?(.{2,80})/) || text.match(/(?:搜索|搜一下|查一下|查找|找一篇)(?:关于)?(.{2,60})/);
  if (searchMatch) return { intent: 'search', query: searchMatch[1].trim() };

  const optionMatch = text.match(/(?:choose|option|answer|pick|选|选择)?\s*([abcd])\s*$/) || text.match(/(?:choose|option|answer|选)\s*(?:option\s*)?([abcd])/);
  if (optionMatch) return { intent: 'option', index: 'abcd'.indexOf(optionMatch[1]) };

  const chineseNumber = text.match(/(?:第|选)?\s*([一二三四])\s*(?:个|项)?$/);
  if (chineseNumber) return { intent: 'option', index: '一二三四'.indexOf(chineseNumber[1]) };
  const englishNumber = text.match(/(?:number|option)?\s*\b(one|two|three|four)\b\s*$/);
  if (englishNumber && ['one', 'two', 'three', 'four'].includes(englishNumber[1])) {
    return { intent: 'option', index: ['one', 'two', 'three', 'four'].indexOf(englishNumber[1]) };
  }

  if (/(next step|move forward)/.test(text)) return { intent: 'next' };
  return null;
}
