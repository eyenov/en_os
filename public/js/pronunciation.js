export class PronunciationPlayer {
  constructor({
    synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance,
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    this.synthesis = synthesis;
    this.Utterance = Utterance;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.current = null;
  }

  get supported() {
    return Boolean(this.Utterance && typeof this.synthesis?.speak === 'function');
  }

  play(text) {
    this.cancel();
    if (!this.supported) return Promise.reject(new Error('Speech synthesis is unavailable'));
    const voices = this.synthesis.getVoices?.() || [];
    const english = voices.filter((voice) => /^en(?:-|$)/i.test(voice.lang));
    if (voices.length && !english.length) return Promise.reject(new Error('An English voice is unavailable'));
    return new Promise((resolve, reject) => {
      const utterance = new this.Utterance(String(text).trim().slice(0, 120));
      const voice = english.find((item) => /^en-US$/i.test(item.lang)) || english[0];
      utterance.lang = voice?.lang || 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = 0.85;
      utterance.pitch = 1;
      utterance.volume = 1;
      const finish = (error) => {
        if (this.current?.utterance !== utterance) return;
        this.clearTimer(this.current.timer);
        this.current = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (error) reject(error);
        else resolve(true);
      };
      const timer = this.setTimer(() => {
        finish(new Error('Speech synthesis timed out'));
        this.synthesis.cancel();
      }, 10_000);
      this.current = { utterance, timer, resolve };
      utterance.onend = () => finish();
      utterance.onerror = () => finish(new Error('Speech synthesis failed'));
      try { this.synthesis.speak(utterance); } catch (error) { finish(error); }
    });
  }

  cancel() {
    const current = this.current;
    if (!current) return;
    this.current = null;
    this.clearTimer(current.timer);
    current.utterance.onend = null;
    current.utterance.onerror = null;
    try { this.synthesis.cancel(); } catch {}
    current.resolve(false);
  }
}