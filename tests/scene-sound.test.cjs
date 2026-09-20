const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SceneSound, createEffectSamples, continuousSoundAt, SCENE_AUDIO_LEVELS} = require('../sound.js');

function scene(width, height, aspect = '') {
  const box = vm.createContext({width, height, SceneSound,
    document: {body: {dataset: {aspect}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8'), box);
  vm.runInContext(`
    motionPreference = {matches: false};
    horizonY = Math.round(height*.76);sunX = width * .5;
    sunR = Math.min(width*.0456,height*.054);sunY = horizonY - sunR * .76;
    pickupTime = findPickupTime();waterContacts = findWaterContacts();waterDrops = makeWaterDrops();sunExitTime = findSunExitTime();
    skyStars = makeSkyStars();soundEvents = makeSoundEvents();
  `, box);
  return {read: expression => vm.runInContext(expression, box), box};
}

for (const [width, height, aspect] of [[1920,1080,''], [800,600,''], [600,800,'3:4'], [375,500,'3:4']]) {
  test(`半秒后从画外进入，抵达和后续剧情时间保持：${width}×${height} ${aspect}`, () => {
    const {read}=scene(width,height,aspect);
    const state=time=>read(`flightAt(storyTime(${time}))`);
    // 机头二次曲线最右端约在机身单位的 1.40554 倍处。
    const nose=s=>s.x+s.unit*(1.4+.06*.06/.65);
    for(const time of [0,.25,.499]) assert.equal(state(time).visible,false);
    const entry=state(.5),entered=state(.52);
    assert.equal(entry.visible,true);assert.ok(nose(entry)<=0,'出现时机头还在左侧画框外');
    assert.ok(nose(entered)>0,'不能缓启动后又在画外等待数秒');
    let previous=entry.x;
    for(let t=.52;t<=2;t+=.02) {const s=state(t);assert.ok(s.x>previous);previous=s.x;}
    const arrival=aspect?6.5:14.5;
    assert.ok(Math.abs(state(arrival).x-width*.5)<1e-8);
    assert.ok(Math.abs(read(`storyTime(${arrival})`)-14.5)<1e-8);
    assert.equal(read(`storyTime(${aspect?16:24})`),24,'托举和负重时机保持');
    for(const t of [.49,.5,.51,arrival-.001,arrival,arrival+.001,65]) {
      assert.ok(Math.abs(read(`sceneTimeForAction(storyTime(${t}))`)-t)<1e-8);
    }
    const sound=continuousSoundAt({actionTime:read('storyTime(1)'),width,contacts:[],story:state(1)});
    assert.ok(sound.engine>0,'飞机进场时也要有引擎声');
    assert.equal(read('contrailSegments(storyTime(.49)).length'),0);
  });

  test(`绳端落在绘制座板的两侧中点，收绳标记不越界：${width}×${height} ${aspect}`, () => {
    const {read} = scene(width, height, aspect);
    // 只记录座板与吊索的实际绘制路径，角色形状不影响连接位置。
    read('drawSun = () => {};drawSunArms = () => {};drawAirplane = () => {}');
    for (const time of [14.001, 15.5, 17.9, 19, 21, 23, 25.6, 29, 36, 48]) {
      const story = read(`flightAt(${time})`);
      const paths = [];
      let points = [], matrix = [1,0,0,1,0,0];
      const stack = [];
      const point = (x,y) => [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]];
      const ctx = new Proxy({
        globalAlpha: 1,
        save() {stack.push([...matrix]);}, restore() {matrix = stack.pop();},
        translate(x,y) {[matrix[4],matrix[5]] = point(x,y);},
        rotate(angle) {
          const [a,b,c,d] = matrix, co = Math.cos(angle), si = Math.sin(angle);
          matrix.splice(0,4,a*co+c*si,b*co+d*si,c*co-a*si,d*co-b*si);
        },
        beginPath() {points = [];},
        moveTo(x,y) {points.push(point(x,y));}, lineTo(x,y) {points.push(point(x,y));},
        quadraticCurveTo(cx,cy,x,y) {points.push(point(x,y));},
        stroke() {paths.push({kind:'stroke', points:[...points]});},
        fill() {paths.push({kind:'fill', points:[...points]});}
      }, {get: (object,key) => key in object ? object[key] : () => {}});
      read('drawFlight')(ctx, story);
      const boardIndex = paths.findIndex(path => path.kind === 'fill');
      const board = paths[boardIndex].points;
      assert.equal(board.length, 4);
      const ropes = paths.slice(0, boardIndex).filter(path => path.points.length === 3);
      assert.equal(ropes.length, 2);
      for (let side = 0; side < 2; side++) {
        const front = board[side], back = board[3-side];
        const end = ropes[side].points.at(-1);
        assert.ok(Math.hypot(end[0]-(front[0]+back[0])/2, end[1]-(front[1]+back[1])/2) < 1e-7,
          `动作 ${time} 秒的${side ? '右' : '左'}绳端应在座板侧边中点`);
        const rope = read(`ropeAt(flightAt(${time}), ${side ? 1 : -1}, ${story.length})`);
        assert.ok([rope.topX,rope.topY,rope.bottomX,rope.bottomY,rope.guide.x,rope.guide.y].every(Number.isFinite));
        if (story.aboard) {
          const hand = read(`sunHandAt(flightAt(${time}), ${side ? 1 : -1})`);
          assert.ok(Math.abs(rope.guide.x-hand.x) < 1e-8);
          assert.ok(Math.abs(rope.guide.y-(story.length-read('sunR')*story.body.y+hand.y)) < 1e-8);
        }
        const marks = [];
        const markCtx = new Proxy({moveTo: (x,y) => marks.push([x,y]), lineTo: (x,y) => marks.push([x,y])},
          {get: (object,key) => key in object ? object[key] : () => {}});
        read('drawReelingRope')(markCtx, story, side ? 1 : -1);
        for (const [x,y] of marks) {
          assert.ok(Number.isFinite(x) && y >= rope.topY && y <= rope.bottomY);
        }
      }
    }
  });

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

for (const [width,height,aspect] of [[1920,1080,''],[600,800,'3:4']]) {
  test(`太阳离框后保留八秒余晖，星光声延后：${aspect || '全屏'}`, () => {
    const {read} = scene(width,height,aspect);
    const exit=read('sceneTimeForAction(sunExitTime)');
    const darkness = time => read(`flightAt(storyTime(${time})).darkness`);
    assert.ok(darkness(exit)<.4,'圆盘刚离框时仍有暖光');
    assert.ok(darkness(exit+2)<.55,'离框两秒后不能全暗');
    assert.ok(darkness(exit+4)>.6 && darkness(exit+4)<.75);
    assert.ok(darkness(exit+8)>.999);
    let previous=darkness(exit-.2);
    for(let time=exit-.18;time<exit+8.1;time+=.02) {
      const d=darkness(time);
      assert.ok(d>=previous-1e-7,'渐暗不能反向跳亮');
      assert.ok(Math.abs(d-previous)<.005,'不能跨帧跳黑');previous=d;
    }
    const bells=read('makeSoundEvents().filter(e=>e.type === "star")');
    assert.ok(bells.length>=1);
    assert.ok(bells[0].time>=exit+7);
    // 乱序拖动同样得到相同亮度，不能依赖前一帧。
    const before=darkness(exit+2);darkness(exit+7);assert.equal(darkness(exit+2),before);
  });
}

test('收绳声只在收绳阶段出现，负重轰鸣跟随飞机下拽并恢复', () => {
  const {read}=scene(1920,1080);
  const mixAt=time=>continuousSoundAt({actionTime:time,width:1920,contacts:[],story:read(`flightAt(${time})`)});
  for(const time of [0,14,18.3,24,25.6,30,65]) {
    const mix=mixAt(time);assert.equal(mix.winch,0);assert.equal(mix.rope,0);
  }
  const reeling=mixAt(21);assert.ok(reeling.winch>.02);assert.ok(reeling.rope>.1);
  const rest=mixAt(24), load=mixAt(25.6), recovered=mixAt(30);
  assert.ok(load.engine>rest.engine*2.5);assert.ok(load.wind>rest.wind*5);
  assert.ok(load.engineFrequency<rest.engineFrequency-20);
  assert.ok(Math.abs(rest.engine-recovered.engine)<.001);
  assert.ok(Math.abs(rest.engineFrequency-recovered.engineFrequency)<.001);
});

test('滴水以短水声为主，避免持续带音高的电子滴答', () => {
  const data=createEffectSamples('drop',44100);
  assert.equal(data.length,Math.ceil(.14*44100));
  let crossings=0,early=0,tail=0;
  for(let i=1;i<data.length;i++) {
    if(i<.04*44100 && data[i]*data[i-1]<0) crossings++;
    if(i<.04*44100) early+=data[i]*data[i];else tail+=data[i]*data[i];
  }
  assert.ok(crossings>100,'应以不规则的水声为主');
  assert.ok(early>tail*20,'水滴不应拖着一段铃音尾巴');
  assert.ok(SCENE_AUDIO_LEVELS.drop<.1);
});
