const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SceneSound, createEffectSamples} = require('../sound.js');

function scene(width, height, aspect = '') {
  const box = vm.createContext({width, height, SceneSound,
    document: {body: {dataset: {aspect}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8'), box);
  vm.runInContext(`
    motionPreference = {matches: false};
    horizonY = Math.round(height * .76);sunX = width * .5;
    sunR = Math.min(width * .038, height * .045);sunY = horizonY - sunR * .76;
    pickupTime = findPickupTime();waterContacts = findWaterContacts();waterDrops = makeWaterDrops();
    skyStars = makeSkyStars();soundEvents = makeSoundEvents();
  `, box);
  return {read: expression => vm.runInContext(expression, box), box};
}

for (const [width, height, aspect] of [[1920,1080,''], [800,600,''], [600,800,'3:4'], [375,500,'3:4']]) {
  test(`座板和水滴接触几何：${width}×${height} ${aspect}`, () => {
    const {read} = scene(width, height, aspect);
    const contacts = read('waterContacts');
    assert.equal(contacts.length, 2);
    for (const event of contacts) {
      assert.ok(Math.abs(event.y - read('horizonY')) < 1e-6);
      const point = read(`seatContactPoint(flightAt(${event.time}))`);
      assert.ok(Math.abs(point.x - event.x) < 1e-6);
      const before = read(`seatContactPoint(flightAt(${event.time - .001})).y`);
      const after = read(`seatContactPoint(flightAt(${event.time + .001})).y`);
      assert.ok(event.entering ? before < event.y && after > event.y : before > event.y && after < event.y);
    }
    const drops = read('waterDrops');
    assert.ok(drops.length >= 8);
    for (const drop of drops) {
      assert.ok(drop.time > drop.emitted);
      const impactY = drop.startY + .5 * drop.gravity * (drop.time - drop.emitted) ** 2;
      assert.ok(Math.abs(impactY - drop.y) < 1e-6);
    }
    for (const event of read('soundEvents.filter(e => e.type === "drop")')) {
      const drop = drops.find(drop => drop.id === event.id);
      assert.ok(Math.abs(read(`storyTime(${event.time})`) - drop.time) < 1e-8);
      assert.equal(event.x, drop.x);
    }
    const ellipses = [];
    const ctx = new Proxy({ellipse: (...args) => ellipses.push(args)}, {get: (o,k) => k in o ? o[k] : () => {}});
    read('drawRipple')(ctx, contacts[0], .01);
    assert.equal(ellipses[0][0], contacts[0].x);
    assert.equal(ellipses[0][1], contacts[0].y);
    assert.ok(ellipses[0][2] < read('sunR') * .1, '初始水环应接近接触点，不应一开始就很宽');
  });

  test(`星光音效只对齐可见亮星：${width}×${height} ${aspect}`, () => {
    const {read} = scene(width, height, aspect);
    const stars = read('soundEvents.filter(e => e.type === "star")');
    assert.ok(stars.length >= 2);
    stars.forEach((event, i) => {
      if (i) assert.ok(event.time - stars[i-1].time >= 2.2);
      assert.ok(event.time <= 64.25);
      const twinkle = read(`(() => {
        const star = skyStars.find(s => s.bright && s.x * width === ${event.x});
        const story = flightAt(storyTime(${event.time}));
        return skyStarAt(star, ${event.time}, localDarkness(story, ${event.x}, ${event.y})).twinkle;
      })()`);
      assert.ok(twinkle >= .85);
    });
    read('motionPreference.matches = true');
    assert.equal(read('makeSoundEvents().filter(e => e.type === "star").length'), 0);
    for (let t = 0; t <= 65; t += .125) assert.ok(Math.abs(read(`sceneTimeForAction(storyTime(${t}))`) - t) < 1e-8);
  });
}

function soundHarness() {
  const timers = new Map();let nextTimer = 1;
  class Parameter {
    constructor() {this.value = 0;}
    setTargetAtTime(value) {this.value = value;}
    cancelScheduledValues() {}
  }
  class Node {
    constructor() {
      for (const name of ['gain','pan','frequency','Q','threshold','knee','ratio','attack','release']) this[name] = new Parameter();
    }
    connect() {} disconnect() {}
    start(when) {this.startedAt = when;}
    stop(when) {this.stoppedAt = when;}
  }
  class Context {
    constructor() {this.currentTime = 0;this.sampleRate = 8000;this.state = 'running';}
    createGain() {return new Node();} createDynamicsCompressor() {return new Node();}
    createStereoPanner() {return new Node();} createBiquadFilter() {return new Node();}
    createBufferSource() {return new Node();} createOscillator() {return new Node();}
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return {duration: length / sampleRate, getChannelData: () => data, copyToChannel: samples => data.set(samples)};
    }
    resume() {this.state = 'running';return Promise.resolve();}
    suspend() {this.state = 'suspended';return Promise.resolve();}
  }
  class Media {
    constructor() {this.paused = true;this.readyState = 4;this.currentTime = 0;}
    addEventListener() {} load() {}
    play() {this.paused = false;return Promise.resolve();}
    pause() {this.paused = true;}
  }
  const box = vm.createContext({window: {AudioContext: Context}, Audio: Media,
    setInterval: fn => {const id=nextTimer++;timers.set(id,fn);return id;}, clearInterval: id => timers.delete(id),
    setTimeout: fn => {const id=nextTimer++;timers.set(id,fn);return id;}, clearTimeout: id => timers.delete(id)});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sound.js'), 'utf8'), box);
  const sound = vm.runInContext('new SceneSound()', box);
  sound.create();sound.enabled = true;
  const frame = {time: 0, actionTime: 0, running: true, rate: 1, width: 1000, duration: 65,
    contacts: [], story: {visible: true, x: 500}, reducedMotion: false};
  sound.getFrame = () => frame;
  const scheduled = [];
  const schedule = sound.schedule.bind(sound);
  sound.schedule = (event, when, width) => {scheduled.push({event, when});schedule(event, when, width);};
  return {sound, frame, scheduled, timers};
}

test('音效提前安排且不重复；暂停、拖动和重播清除旧事件', () => {
  const {sound, frame, scheduled} = soundHarness();
  sound.setEvents([{id:'a', time:1, type:'drop', x:500, strength:1}, {id:'b', time:2, type:'star', x:100, strength:1}]);
  frame.time=.9;frame.actionTime=.9;sound.update(frame);
  assert.equal(scheduled.length,1);assert.ok(Math.abs(scheduled[0].when-.1)<1e-8);
  sound.update(frame);assert.equal(scheduled.length,1);
  const voice=[...sound.voices][0];
  frame.running=false;sound.update(frame);
  assert.ok(voice.source.stoppedAt !== undefined);assert.ok(sound.sea.paused);assert.equal(sound.timer,null);
  frame.time=3;frame.running=true;sound.invalidate();sound.update(frame);
  assert.equal(scheduled.length,1, '拖动到事件后面不能补播');
  frame.time=.9;sound.invalidate();sound.update(frame);
  assert.equal(scheduled.length,2,'重播可以再次触发');
  assert.equal(sound.sea.currentTime,.9);
});

test('倍速保持海浪音高，短音效时间随播放速度换算，星音至少相隔两秒', () => {
  const {sound, frame, scheduled} = soundHarness();
  sound.setEvents([1,3.2,5.4,7.6].map((time,i)=>({id:String(i),time,type:'star',x:500,strength:1})));
  frame.rate=3;frame.time=.7;sound.update(frame);
  assert.equal(sound.sea.playbackRate,3);assert.equal(sound.sea.preservesPitch,true);
  assert.ok(Math.abs(scheduled[0].when-.1)<1e-8);
  for (let clock=.025;clock<2.5;clock+=.025) {
    sound.context.currentTime=clock;frame.time=.7+clock*3;sound.update(frame);
  }
  for(let i=1;i<scheduled.length;i++) assert.ok(scheduled[i].when-scheduled[i-1].when>=2);
});

test('结束与声音关闭都停止海浪和事件调度；重新打开只播当前位置之后', async () => {
  const {sound, frame, scheduled, timers} = soundHarness();
  sound.setEvents([{id:'old',time:2,type:'drop',x:500,strength:1}]);
  sound.update(frame);
  await sound.setEnabled(false);
  assert.ok(sound.sea.paused);assert.equal(sound.timer,null);
  frame.time=10;await sound.setEnabled(true);
  assert.equal(scheduled.length,0);assert.equal(sound.sea.currentTime,10);
  frame.time=65;frame.running=false;sound.update(frame);
  assert.ok(sound.sea.paused);assert.equal(sound.sea.volume,0);assert.equal(sound.timer,null);
  for(const callback of timers.values()) callback();
  assert.equal(sound.context.state,'suspended');
});

test('低帧率时音效仍由独立时钟触发；迟到事件不成串补播', () => {
  const {sound, frame, scheduled, timers} = soundHarness();
  sound.setEvents([1,1.3,1.6].map((time,i)=>({id:String(i),time,type:'drop',x:500,strength:1})));
  sound.update(frame);
  const tick=timers.get(sound.timer);
  for(let t=.025;t<1.15;t+=.025) {
    sound.context.currentTime=t;frame.time=t;tick();
  }
  assert.equal(scheduled.length,1);
  sound.context.currentTime=2;frame.time=2;tick();
  assert.equal(scheduled.length,1);
});

test('音效样本无削波、起止平滑，能量有效且可重复', () => {
  for(const type of ['splash','lift','drop','star']) {
    const data=createEffectSamples(type,44100);
    const peak=data.reduce((a,b)=>Math.max(a,Math.abs(b)),0);
    assert.ok(peak>.8 && peak<.86);
    assert.equal(data[0],0);assert.ok(Math.abs(data.at(-1))<.002);
    assert.deepEqual(data,createEffectSamples(type,44100));
    assert.ok(data.every(Number.isFinite));
  }
});

test('各档倍速切换会取消旧排程并重新对时', () => {
  const {sound, frame, scheduled} = soundHarness();
  sound.setEvents([{id:'a',time:1,type:'splash',x:500,strength:1}]);
  for(const rate of [.5,1,1.5,2,3]) {
    const old=[...sound.voices];
    frame.rate=rate;frame.time=.97;sound.invalidate();sound.update(frame);
    assert.equal(sound.sea.playbackRate,rate);
    assert.ok(Math.abs(scheduled.at(-1).when-.03/rate)<1e-8);
    for(const voice of old) assert.ok(voice.source.stoppedAt !== undefined);
  }
});

test('海浪播放失败会提示，暂停引起的播放中断不误报', async () => {
  const {sound, frame} = soundHarness();
  let errors=0;sound.onError=()=>errors++;
  sound.sea.play=()=>Promise.reject(new Error('missing media'));
  sound.update(frame);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors,1);assert.equal(sound.enabled,false);assert.ok(sound.sea.paused);
  sound.enabled=true;sound.seaStarting=false;sound.context.state='running';
  const abort=new Error('paused');abort.name='AbortError';
  sound.sea.play=()=>Promise.reject(abort);
  frame.running=true;sound.update(frame);frame.running=false;sound.update(frame);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors,1);assert.equal(sound.enabled,true);
});
