// 无浏览器的绘制与切换回归：检查时间、事件、画布输入和缓存，不代替美感验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8');

test('全屏和竖版引用的本地脚本齐全，回滚后不会留下缺失的依赖', () => {
  for (const entry of ['index.html', 'portrait.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', entry), 'utf8');
    for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
      assert.ok(!/^https?:/.test(src), '页面保持本地直开');
      const file = path.join(__dirname, '..', src);
      assert.ok(fs.existsSync(file), `${entry} 引用的 ${src} 必须存在`);
      assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), {filename: src}));
    }
  }
});

function scene({aspect = '', style = 'blue', blockedHistory = false} = {}) {
  const stats = {gradients: 0, canvases: 0, redraws: 0, loops: 0, eventResets: 0, invalidations: 0,
    graphicsCreated: 0, graphicsResizes: 0, graphicsDensitySets: 0};
  function context(recordPaints = false) {
    const stack = [];
    const state = {globalAlpha: 1, paints: []};
    return new Proxy(state, {
      get(object, key) {
        if (key in object) return object[key];
        return (...args) => {
          if (key === 'createImageData') return {data: new Uint8ClampedArray(args[0] * args[1] * 4)};
          if (key === 'getImageData') return {data: new Uint8ClampedArray(args[2] * args[3] * 4)};
          for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} 不能收到无效坐标`);
          if (key === 'save') stack.push(object.globalAlpha);
          if (key === 'restore') object.globalAlpha = stack.pop();
          if (recordPaints && key === 'fillRect') object.paints.push({rect: args, fill: object.fillStyle});
          if (String(key).startsWith('create') && String(key).endsWith('Gradient')) {
            stats.gradients++;
            return {stops: [], addColorStop(stop, color) {
              assert.ok(stop >= 0 && stop <= 1);
              assert.ok(!/NaN|undefined/.test(color));
              this.stops.push([stop, color]);
            }};
          }
        };
      },
      set(object, key, value) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} 必须有效`);
        if (typeof value === 'string') assert.ok(!/NaN|undefined/.test(value));
        object[key] = value;return true;
      }
    });
  }
  const nodes = new Map();
  const element = (id = '') => {
    const classes = new Set();
    return {disabled: true, hidden: id === 'play-style-menu', dataset: {}, attributes: {}, listeners: {}, style: {setProperty() {}},
      addEventListener(name, fn) {this.listeners[name] = fn;},
      setAttribute(name,value) {this.attributes[name] = value;},
      focus() {box.document.activeElement = this;},
      querySelectorAll() {return styleOptions;},
      contains(target) {return target === nodes.get('play-style') || target === nodes.get('play-style-menu') || styleOptions.includes(target);},
      classList: {add: value=>classes.add(value), remove: value=>classes.delete(value), contains: value=>classes.has(value)},
      getBoundingClientRect: () => ({left: 100, right: 860, top: 1000})};
  };
  const styleOptions = ['blue','warm'].map(style => Object.assign(element(), {dataset:{style}}));
  const windowListeners = {};
  const url = new URL(`file:///scenes/ocean-sunset/${aspect ? 'portrait' : 'index'}.html?style=${style}`);
  const links = ['index.html', 'portrait.html'].map(href => ({href}));
  class Sound {
    constructor() {this.enabled = false;this.anchor = {time: 0};}
    setEvents(events) {stats.eventResets++;this.events = events;}
    invalidate() {stats.invalidations++;}
    update() {} silence() {}
  }
  const box = vm.createContext({URL, URLSearchParams, SceneSound: Sound,
    width: 0, height: 0, windowWidth: aspect ? 624 : 1920, windowHeight: aspect ? 910 : 1080,
    document: {hidden: false, body: {dataset: {aspect}}, addEventListener() {},
      getElementById(id) {if (!nodes.has(id)) nodes.set(id, element(id));return nodes.get(id);},
      querySelectorAll() {return links;},
      createElement(name) {
        assert.equal(name, 'canvas');stats.canvases++;
        const ctx = context();return {getContext: () => ctx};
      }},
    window: {devicePixelRatio: 1, location: {search: url.search, href: url.href},
      history: {replaceState(_state, _title, href) {
        if (blockedHistory) throw new Error('本地文件不能替换地址');
        box.window.location.href = href;
      }}, addEventListener(name,fn) {(windowListeners[name] ||= []).push(fn);}, matchMedia: () => ({matches: false, addEventListener() {}})},
    millis: () => 1000, pixelDensity() {}, frameRate() {}, noLoop() {}, image() {},
    loop() {stats.loops++;}, redraw() {stats.redraws++;},
    createCanvas(width, height) {box.width = width;box.height = height;return {elt: element()};},
    resizeCanvas(width, height) {box.width = width;box.height = height;},
    createGraphics(width, height) {
      stats.graphicsCreated++;
      return {width, height, drawingContext: context(true),
        remove() {throw new Error('切换背景不得调用存在清理缺陷的 Graphics.remove()');},
        pixelDensity() {stats.graphicsDensitySets++;},
        resizeCanvas(nextWidth, nextHeight, noRedraw) {
          assert.equal(noRedraw, true, '背景重设尺寸不能触发额外重绘');
          stats.graphicsResizes++;this.width = nextWidth;this.height = nextHeight;
          this.drawingContext.paints.length = 0;
        }};
    },
    drawingContext: context()
  });
  vm.runInContext(source, box);
  const read = expression => vm.runInContext(expression, box);
  read('setup()');
  return {read, stats, nodes, links, styleOptions, windowListeners, box};
}

for (const aspect of ['', '3:4']) {
  test(`配色菜单清楚标记选项，展开时可操作，收起后恢复鼠标隐藏：${aspect || '全屏'}`, () => {
    const {read,nodes,styleOptions,windowListeners,box}=scene({aspect});
    const trigger=nodes.get('play-style'),menu=nodes.get('play-style-menu'),controls=nodes.get('play-controls');
    const move=(x,y)=>windowListeners.pointermove.forEach(fn=>fn({pointerType:'mouse',clientX:x,clientY:y}));
    const key=(target,key)=>target.listeners.keydown({key,preventDefault(){}});
    assert.equal(menu.hidden,true);
    trigger.listeners.click();
    assert.equal(menu.hidden,false);assert.equal(trigger.attributes['aria-expanded'],'true');
    assert.strictEqual(box.document.activeElement,styleOptions[0]);
    move(0,0);assert.equal(controls.classList.contains('is-hidden'),false,'菜单展开不能被鼠标隐藏');
    key(menu,'ArrowDown');assert.strictEqual(box.document.activeElement,styleOptions[1]);
    styleOptions[1].listeners.click();
    assert.equal(read('sceneStyle'),'warm');assert.equal(trigger.textContent,'暖色');
    assert.equal(styleOptions[1].attributes['aria-checked'],'true');
    assert.equal(styleOptions[0].attributes['aria-checked'],'false');
    assert.equal(menu.hidden,true);assert.strictEqual(box.document.activeElement,trigger);
    move(0,0);assert.equal(controls.classList.contains('is-hidden'),true,'菜单收起后仍按鼠标位置隐藏');
    assert.equal(windowListeners.keydown,undefined,'普通键盘输入不介入播放条显隐');
    move(200,1020);assert.equal(controls.classList.contains('is-hidden'),false);
    key(trigger,'ArrowUp');assert.equal(menu.hidden,false);
    key(menu,'Escape');assert.equal(menu.hidden,true);assert.equal(trigger.attributes['aria-expanded'],'false');
    trigger.listeners.click();
    windowListeners.pointerdown.forEach(fn=>fn({target:{}}));
    assert.equal(menu.hidden,true,'点击菜单外部关闭');
    trigger.listeners.click();key(menu,'Tab');assert.equal(menu.hidden,true,'切走焦点不会留下悬空菜单');
  });

  for (const style of ['blue', 'warm']) {
    test(`配色切换保持动作、进度与音效：${aspect || '全屏'} / ${style}`, () => {
      const {read, stats, nodes, links, styleOptions} = scene({aspect, style});
      assert.equal(read('sceneStyle'), style);
      assert.equal(nodes.get('play-style').disabled, false);
      const geometry = read('[waterContacts, waterDrops, waterRows, skyStars]');
      const events = read('sceneSound.events'), anchor = read('sceneSound.anchor');
      const times = [0, read('waterContacts[0].time'), 25.6, read('sunExitTime') + 1, 65];
      const poses = times.map(t => read(`JSON.stringify(flightAt(${t}))`));
      for (const running of [false, true]) {
        read(`Object.assign(playback, {time: 25.6, stamp: 1000, playing: ${running}, running: ${running}, rate: 2});sceneSound.enabled = true`);
        const clock = read('JSON.stringify(playback)'), resetCount = stats.eventResets;
        const redraws = stats.redraws, loops = stats.loops;
        const next = read('sceneStyle') === 'blue' ? 'warm' : 'blue';
        styleOptions.find(option => option.dataset.style === next).listeners.click();
        assert.equal(read('JSON.stringify(playback)'), clock);
        assert.equal(stats.eventResets, resetCount);
        assert.equal(stats.invalidations, 0);
        assert.equal(read('sceneSound.enabled'), true);
        assert.strictEqual(read('sceneSound.events'), events);
        assert.strictEqual(read('sceneSound.anchor'), anchor);
        assert.equal(stats.redraws - redraws, running ? 0 : 1);
        assert.equal(stats.loops, loops);
        ['waterContacts', 'waterDrops', 'waterRows', 'skyStars'].forEach((name, i) => assert.strictEqual(read(name), geometry[i]));
        times.forEach((time, i) => assert.equal(read(`JSON.stringify(flightAt(${time}))`), poses[i]));
        for (const link of links) assert.equal(new URL(link.href).searchParams.get('style'), next);
      }
      assert.equal(read('styleCaches.size'), 2);
      const canvasCount = stats.canvases;
      read('setSceneStyle("warm");setSceneStyle("blue");setSceneStyle("warm")');
      assert.equal(stats.canvases, canvasCount, '往返切换应复用小贴片');
      assert.equal(read('waterReflectionField.style'), read('sceneStyle'));
      assert.equal(read('waterReflectionField.canvas.width'), 384);
    });

    test(`关键画面绘制输入与渐变预算：${aspect || '全屏'} / ${style}`, () => {
      const {read, stats} = scene({aspect, style});
      const times = [0, read('sceneTimeForAction(waterContacts[0].time)'),
        read('sceneTimeForAction(25.6)'), read('sceneTimeForAction(sunExitTime) + 4'), 64, 65];
      const canvases = stats.canvases;
      for (const time of times) {
        const gradients = stats.gradients;
        read(`playback.running = false;playback.time = ${time};draw()`);
        assert.ok(stats.gradients - gradients <= 3, '海面和星光应复用贴片，不能逐片创建渐变');
      }
      assert.equal(stats.canvases, canvases, '播放时不逐帧创建贴片');
      assert.equal(read('waterRows.length'), 72);
    });
  }

  test(`星光固定分布、短闪错落、音画同峰且不超过三处：${aspect || '全屏'}`, () => {
    const {read} = scene({aspect});
    assert.equal(read('JSON.stringify(makeSkyStars())'), read('JSON.stringify(skyStars)'));
    const flashes = read('skyStars.flatMap(star => star.flashes || [])');
    assert.ok(flashes.length > 5);
    const timeline = flashes.flatMap(flash => [[flash.start, 1], [flash.end, -1]]).sort((a,b) => a[0] - b[0]);
    let active = 0;
    for (const [, delta] of timeline) {active += delta;assert.ok(active <= 3);}
    assert.ok(flashes.every(flash => flash.end - flash.start < .54));
    const bells = read('soundEvents.filter(event => event.type === "star")');
    for (const event of bells) {
      assert.equal(read(`skyStars.find(star => star.x * width === ${event.x}).flashes.some(flash => flash.peak === ${event.time})`), true);
    }
    assert.equal(read('skyStars.some(star => skyStarAt(star, 0, 0).alpha > 0)'), false);
    assert.equal(read('skyStars.some(star => skyStarAt(star, 65, 1).twinkle > 0)'), false);
    read('motionPreference.matches = true');
    assert.equal(read(`skyStars.some(star => skyStarAt(star, ${bells[0].time}, 1).twinkle > 0)`), false);
  });
}

test('风格参数默认蓝橙，本地地址更新失败也保留比例链接', () => {
  const {read, links} = scene({style: 'unknown', blockedHistory: true});
  for (const query of ['', '?style=unknown', '?style=blue']) assert.equal(read(`styleFromSearch(${JSON.stringify(query)})`), 'blue');
  assert.equal(read('sceneStyle'), 'blue');
  read('setSceneStyle("warm")');
  assert.equal(read('sceneStyle'), 'warm');
  for (const link of links) assert.equal(new URL(link.href).searchParams.get('style'), 'warm');
});

test('天空与海面整幅重绘各自渐变，不只更新太阳', () => {
  const {read, stats} = scene();
  const background = read('backdrop');
  const blue = read('backdrop.drawingContext.paints.slice(-2)');
  read('setSceneStyle("warm")');
  const warm = read('backdrop.drawingContext.paints.slice(-2)');
  assert.strictEqual(read('backdrop'), background);
  assert.equal(stats.graphicsCreated, 1);
  assert.equal(stats.graphicsResizes, 0);
  assert.equal(stats.graphicsDensitySets, 1);
  for (const paints of [blue, warm]) {
    assert.equal(paints.length, 2);
    assert.deepEqual(Array.from(paints[0].rect), [0, 0, read('width'), read('horizonY')]);
    assert.deepEqual(Array.from(paints[1].rect), [0, read('horizonY'), read('width'), read('height - horizonY')]);
  }
  assert.equal(blue[0].fill.stops[0][1], '#1265f3');
  assert.equal(warm[0].fill.stops[0][1], '#f69b18');
  assert.notDeepEqual(blue[1].fill.stops, warm[1].fill.stops);
});

test('背景在窗口改尺寸后继续复用，下一次配色切换完整重涂', () => {
  const {read, stats} = scene();
  const background = read('backdrop');
  const sun = read('sunBrush'), water = read('waterReflectionField');
  read('windowWidth = 1080;windowHeight = 720;windowResized()');
  assert.notStrictEqual(read('sunBrush'), sun, '窗口改变尺寸时更新太阳的屏幕边缘精度');
  assert.equal(read('sunBrush.radius'), read('sunR'));
  assert.equal(read('sunBrush.key'), read('sunRasterMetrics().key'));
  assert.strictEqual(read('waterReflectionField'), water, '不重建与尺寸无关的水纹缓存');
  const resizedSun = read('sunBrush');
  assert.strictEqual(read('backdrop'), background);
  assert.equal(read('backdrop.width'), 1080);
  assert.equal(read('backdrop.height'), 720);
  assert.equal(stats.graphicsCreated, 1);
  assert.equal(stats.graphicsResizes, 1);
  assert.equal(stats.graphicsDensitySets, 1);
  read('setSceneStyle("warm")');
  const paints = read('backdrop.drawingContext.paints.slice(-2)');
  assert.deepEqual(Array.from(paints[0].rect), [0, 0, 1080, read('horizonY')]);
  assert.deepEqual(Array.from(paints[1].rect), [0, read('horizonY'), 1080, 720 - read('horizonY')]);
  assert.equal(paints[0].fill.stops[0][1], '#f69b18');
  assert.equal(stats.graphicsResizes, 1);
  read('setSceneStyle("blue")');
  assert.strictEqual(read('sunBrush'), resizedSun, '切回配色后复用正确尺寸的太阳');
});

test('本地 p5 原始清理函数复现背景切换中断，测试不能把 remove 当空操作', () => {
  const library = fs.readFileSync(path.join(__dirname, '../p5.min.js'), 'utf8');
  // 只执行库中的两个清理函数，不启动 p5、浏览器或绘制环境。
  const graphicsSource = library.match(/key:"remove",value:(function\(\)\{this\._renderer&&.*?\})\},\{key:"createFramebuffer"/);
  const elementSource = library.match(/Element\.prototype\.remove=(function\(\)\{.*?\}),f\.default\.Element\.prototype\.drop=/);
  assert.ok(graphicsSource && elementSource, 'p5 更新后需重新核对清理路径');
  const removeGraphics = vm.runInNewContext(`(${graphicsSource[1]})`);
  const removeElement = vm.runInNewContext(`(${elementSource[1]})`, {f: {default: {MediaElement: class {}}}});
  const main = {_elements: []};
  const graphics = {_pInst: main, _events: {}, elt: {parentNode: null}};
  graphics._renderer = {_pInst: graphics, _events: {}, elt: graphics.elt, remove: removeElement};
  main._elements.push(graphics);
  assert.throws(() => removeGraphics.call(graphics), /reading 'indexOf'/);
  assert.ok(main._elements.includes(graphics), '异常发生时旧背景仍留在原处');
});
