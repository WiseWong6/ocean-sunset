// 真实海浪通过本地媒体元素播放；短音效共用画面的事件表，在音频时钟上提前安排。
// 不把 file:// 媒体接到 Web Audio，避免本地文件的跨域限制造成海浪静音。
function createEffectSamples(type, sampleRate, note = 0) {
  const duration = type === 'star' ? .7 : type === 'drop' ? .22 : type === 'lift' ? .42 : .8;
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = 871 + note, filtered = 0, phase = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 4294967296 * 2 - 1;
    let value;
    if (type === 'star') {
      const frequency = [1046.5, 1318.5, 1568][note % 3];
      value = (Math.sin(t * frequency * Math.PI * 2) + .13 * Math.sin(t * frequency * 4.01 * Math.PI))
        * (1 - Math.exp(-t / .014)) * Math.exp(-t / .15);
    } else if (type === 'drop') {
      phase += (620 + 1050 * Math.exp(-t / .035)) * Math.PI * 2 / sampleRate;
      value = (Math.sin(phase) + noise * .055) * (1 - Math.exp(-t / .003)) * Math.exp(-t / .037);
    } else {
      const cutoff = type === 'lift' ? 1200 : 2100 - 1400 * t / duration;
      const coefficient = 1 - Math.exp(-Math.PI * 2 * cutoff / sampleRate);
      filtered += coefficient * (noise - filtered);
      value = filtered * (1 - Math.exp(-t / .008)) * Math.exp(-t / (type === 'lift' ? .09 : .19));
    }
    value *= Math.min(1, (duration - t) / .018);
    data[i] = value;peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 0; i < data.length; i++) data[i] *= .85 / peak;
  return data;
}

class SceneSound {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.events = [];
    this.voices = new Set();
    this.cursor = 0;
    this.anchor = null;
    this.lastMix = -Infinity;
    this.seaNeedsSync = true;
  }

  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('当前浏览器不支持场景音效');
    const c = this.context = new AudioContext();
    this.master = c.createGain();this.master.gain.value = 0;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6;limiter.knee.value = 4;
    limiter.ratio.value = 12;limiter.attack.value = .002;limiter.release.value = .1;
    this.master.connect(limiter);limiter.connect(c.destination);

    this.sea = new Audio('audio/ocean-waves.mp3');
    this.sea.preload = 'auto';this.sea.volume = 0;
    this.sea.preservesPitch = true;
    this.sea.addEventListener('error', () => this.fail(new Error('海浪录音加载失败，请确认 audio/ocean-waves.mp3 存在后重试')));
    this.sea.addEventListener('loadedmetadata', () => {this.seaNeedsSync = true;});

    const noise = c.createBuffer(1, c.sampleRate * 6, c.sampleRate);
    let seed = 75391, low = 0;
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 4294967296 * 2 - 1;
      low = low * .97 + white * .03;data[i] = low * 2.8 + white * .12;
    }
    const source = c.createBufferSource();source.buffer = noise;source.loop = true;
    const makeNoise = (frequency, destination) => {
      const filter = c.createBiquadFilter();filter.type = 'lowpass';filter.frequency.value = frequency;
      const gain = c.createGain();gain.gain.value = 0;
      source.connect(filter);filter.connect(gain);gain.connect(destination);
      return {filter, gain};
    };
    const makeTone = (frequency, type, destination) => {
      const oscillator = c.createOscillator();oscillator.type = type;oscillator.frequency.value = frequency;
      const gain = c.createGain();gain.gain.value = 0;
      oscillator.connect(gain);gain.connect(destination);oscillator.start();
      return {oscillator, gain};
    };
    this.planePan = c.createStereoPanner();this.planePan.connect(this.master);
    const engineFilter = c.createBiquadFilter();engineFilter.type = 'lowpass';engineFilter.frequency.value = 240;
    engineFilter.connect(this.planePan);
    this.engine = makeTone(78, 'triangle', engineFilter);
    this.harmonic = makeTone(156, 'sine', engineFilter);
    this.wind = makeNoise(380, this.planePan);
    this.rope = makeNoise(1000, this.master);
    source.start();
    this.buffers = {};
    for (const type of ['splash', 'lift', 'drop', 'star']) {
      for (let note = 0; note < (type === 'star' ? 3 : 1); note++) {
        const samples = createEffectSamples(type, c.sampleRate, note);
        const buffer = c.createBuffer(1, samples.length, c.sampleRate);
        buffer.copyToChannel(samples, 0);this.buffers[`${type}-${note}`] = buffer;
      }
    }
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {this.silence();return;}
    try {
      if (!this.context) this.create();
      clearTimeout(this.suspendTimer);this.suspendTimer = null;
      this.invalidate();
      const frame = this.getFrame?.() || this.frame;
      if (this.sea.error) this.sea.load();
      if (frame && this.sea.readyState >= 1) this.sea.currentTime = Math.min(frame.time, 65);
      // 两种播放都在按钮点击中解锁，包括动画正暂停的情况。
      this.starting = true;
      await Promise.all([this.context.resume(), this.sea.play()]);
      this.starting = false;
      if (!this.enabled) {this.silence();return;}
      const current = this.getFrame?.() || frame;
      if (current) this.update(current);
      else this.sea.pause();
    } catch (error) {
      this.starting = false;this.enabled = false;this.silence();throw error;
    }
  }

  fail(error) {
    if (!this.enabled) return;
    this.enabled = false;this.silence();this.onError?.(error);
  }

  set(parameter, value, smoothing = .06) {
    const now = this.context.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, smoothing);
  }

  setEvents(events) {
    this.events = events;
    this.invalidate();
  }

  invalidate() {
    if (this.context) {
      const now = this.context.currentTime;
      for (const voice of this.voices) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, .004);
        try {voice.source.stop(now + .02);} catch (_) { /* 已经结束 */ }
      }
    }
    this.anchor = null;this.lastMix = -Infinity;this.seaNeedsSync = true;
  }

  silence() {
    clearInterval(this.timer);this.timer = null;
    this.invalidate();
    if (this.sea) {this.sea.pause();this.sea.volume = 0;}
    if (!this.context) return;
    this.set(this.master.gain, 0, .01);
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;this.context.suspend().catch(() => {});
    }, 60);
  }

  schedule(event, when, width) {
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = this.buffers[`${event.type}-${event.note || 0}`];
    const gain = c.createGain();
    const levels = {splash: .42, lift: .25, drop: .17, star: .085};
    gain.gain.value = levels[event.type] * event.strength;
    const pan = c.createStereoPanner();pan.pan.value = Math.max(-.8, Math.min(.8, event.x / width * 2 - 1));
    source.connect(gain);gain.connect(pan);pan.connect(this.master);
    const voice = {source, gain, pan};this.voices.add(voice);
    source.onended = () => {
      source.disconnect();gain.disconnect();pan.disconnect();this.voices.delete(voice);
    };
    source.start(when);
  }

  update(frame) {
    this.frame = frame;
    if (!this.enabled || !this.context || this.starting) return;
    if (!frame.running || frame.time >= frame.duration) {
      if (this.timer || !this.sea.paused || this.anchor) this.silence();
      else if (this.context.state === 'running' && !this.suspendTimer) this.silence();
      return;
    }
    clearTimeout(this.suspendTimer);this.suspendTimer = null;
    if (this.context.state === 'suspended') {
      if (!this.resuming) {
        this.resuming = true;
        this.context.resume().then(() => {
          this.resuming = false;
          if (this.enabled && this.getFrame) this.update(this.getFrame());
        }).catch(error => {this.resuming = false;this.fail(error);});
      }
      return;
    }
    if (!this.timer && this.getFrame) this.timer = setInterval(() => this.update(this.getFrame()), 25);
    const c = this.context, now = c.currentTime;
    const {time, actionTime: t, story, contacts, width, duration, rate} = frame;
    if (this.anchor && (this.anchor.rate !== rate
      || Math.abs(time - (this.anchor.time + (now - this.anchor.clock) * rate)) > .12 * rate)) this.invalidate();
    if (!this.anchor) {
      this.anchor = {time, clock: now, rate};
      this.cursor = this.events.findIndex(event => event.time >= time);
      if (this.cursor < 0) this.cursor = this.events.length;
      this.lastBellAt = -Infinity;this.lastDropAt = -Infinity;
    }
    // 120 毫秒的提前量覆盖普通掉帧；跳过错过的事件，拖动时绝不补播旧声。
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time + .12 * rate) {
      const event = this.events[this.cursor++];
      if (event.time < time - .06 * rate) continue;
      const when = now + Math.max(0, (event.time - time) / rate);
      if (event.type === 'star') {
        if (frame.reducedMotion || when - this.lastBellAt < 2) continue;
        this.lastBellAt = when;
      }
      if (event.type === 'drop') {
        if (when - this.lastDropAt < .12) continue;
        this.lastDropAt = when;
      }
      this.schedule(event, when, width);
    }
    if (now - this.lastMix < .045) return;
    this.lastMix = now;
    const smooth = (a, b, x) => {const u = Math.max(0, Math.min(1, (x - a) / (b - a)));return u * u * (3 - 2 * u);};
    const fade = smooth(0, .5, time) * (1 - smooth(duration - .8, duration, time));
    this.set(this.master.gain, .7 * fade, .025);
    if (this.sea.readyState >= 1 && (this.seaNeedsSync || Math.abs(this.sea.currentTime - time) > .4 * rate)) {
      this.sea.currentTime = time;this.seaNeedsSync = false;
    }
    this.sea.playbackRate = rate;this.sea.preservesPitch = true;
    this.sea.volume = .72 * fade;
    if (this.sea.paused && !this.seaStarting) {
      this.seaStarting = true;
      this.sea.play().then(() => {
        this.seaStarting = false;
        if (!this.enabled || !this.frame.running) this.sea.pause();
      }).catch(error => {
        this.seaStarting = false;
        if (error.name === 'AbortError' && (!this.enabled || !this.frame.running)) return;
        this.fail(error);
      });
    }
    const reeling = smooth(18.35, 18.7, t) * (1 - smooth(23.5, 24, t));
    const contactFocus = contacts.reduce((amount, contact) => Math.max(amount,
      smooth(contact.time - .15, contact.time, t) * (1 - smooth(contact.time + 1, contact.time + 2.8, t))), 0);
    const engineRoom = 1 - Math.max(contactFocus * .72, reeling * .55);
    const plane = story.visible ? Math.exp(-Math.pow((story.x / width - .5) * 1.7, 2))
      * smooth(2, 3.5, t) * (1 - smooth(56, 62, t)) : 0;
    const load = smooth(24.5, 25.5, t) * (1 - smooth(26, 30, t));
    this.set(this.planePan.pan, Math.max(-1, Math.min(1, story.x / width * 2 - 1)));
    this.set(this.engine.oscillator.frequency, 78 - load * 9, .2);
    this.set(this.harmonic.oscillator.frequency, 156 - load * 18, .2);
    this.set(this.engine.gain.gain, plane * .007 * engineRoom);
    this.set(this.harmonic.gain.gain, plane * .002 * engineRoom);
    this.set(this.wind.gain.gain, plane * .01 * engineRoom);
    this.set(this.rope.gain.gain, reeling * .035);
  }
}

if (typeof module !== 'undefined') module.exports = {SceneSound, createEffectSamples};
