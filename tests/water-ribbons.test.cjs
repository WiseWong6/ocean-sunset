// 加载真实绘制代码检查受光场；这些检查约束连续性、缓存和播放，不代替画面验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8');

function renderer(style = 'blue', aspect = '') {
  const dimensions = aspect ? [675, 900] : [1440, 900];
  const stats = {canvases: 0, buffers: 0, uploads: 0};
  let now = 0;
  const box = vm.createContext({SceneSound: class {}, width: dimensions[0], height: dimensions[1],
    millis: () => now,
    document: {body: {dataset: {aspect}}, createElement(name) {
      assert.equal(name, 'canvas');stats.canvases++;
      return {width: 0, height: 0, getContext() {return {
        createImageData(width, height) {
          stats.buffers++;
          return {data: new Uint8ClampedArray(width * height * 4)};
        },
        putImageData(image, x, y) {
          assert.equal(x, 0);assert.equal(y, 0);assert.ok(image.data.length > 0);stats.uploads++;
        }
      };}};
    }}
  });
  vm.runInContext(source, box, {filename: 'sketch.js'});
  const read = expression => vm.runInContext(expression, box);
  read(`sceneStyle = '${style}';palette = SCENE_STYLES[sceneStyle];
    horizonY = Math.round(height * .76);sunX = width * .5;
    sunR = Math.min(width * .038, height * .045);sunY = horizonY - sunR * .76;
    pickupTime = findPickupTime();waterContacts = findWaterContacts();sunExitTime = findSunExitTime();
    {const next = seededRandom(860214);waterRows = Array.from({length:72},(_,i)=>({
      depth:Math.pow((i+.15+next()*.7)/72,1.7),phase:next()*Math.PI*2,weight:.65+next()*.7}));}`);
  const images = [], stack = [];
  const ctx = {globalAlpha: .8, imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    save() {stack.push([this.globalAlpha, this.imageSmoothingEnabled, this.imageSmoothingQuality]);},
    restore() {[this.globalAlpha, this.imageSmoothingEnabled, this.imageSmoothingQuality] = stack.pop();},
    drawImage(...args) {
      assert.ok(args.slice(1).every(Number.isFinite), '反光层绘制位置必须有限');images.push(args);
    }};
  const story = {sunX: read('sunX'), sunY: read('sunY'), reflection: 1, light: {elevation: 0}};
  const render = (time = 0, override = {}) => {
    box.drawWaterReflection(ctx, {...story, ...override}, time);
    return read('waterReflectionField');
  };
  const clockFrame = (time, rate, running = true) => {
    now = running ? time * 1000 / rate : 0;
    read(`Object.assign(playback,{time:${running ? 0 : time},stamp:0,rate:${rate},running:${running}})`);
    const current = box.sceneTime();
    box.drawWaterReflection(ctx, box.flightAt(box.storyTime(current)), current);
    return new Uint8ClampedArray(read('waterReflectionField.image.data'));
  };
  return {box, read, render, clockFrame, ctx, images, stats, story};
}

function alphaAt(field, x, y) {
  return field.image.data[(y * field.canvas.width + x) * 4 + 3] / 255;
}

function centerLine(field) {
  const x = Math.floor(field.canvas.width / 2);
  return Array.from({length: field.canvas.height}, (_, y) => alphaAt(field, x, y));
}

function copyPixels(field) {return new Uint8ClampedArray(field.image.data);}

test('水面视角决定反射比例，正视反射弱、贴近水面时增强', () => {
  const {box} = renderer();
  assert.ok(Math.abs(box.waterFresnel(1) - .02037) < .0001, '正视反射约为水的2%');
  assert.ok(box.waterFresnel(.1) > box.waterFresnel(.5));
  assert.equal(box.waterFresnel(0), 1);
});

test('蓝橙远水亮核集中在太阳下方，外侧不铺红雾，仍留细水缝', () => {
  const f=renderer('blue');
  for(const time of [0,5,8,15]) {
    const field=f.render(time),w=field.canvas.width,h=field.canvas.height;
    const xAt=local=>Math.round((local/8.2+1)*.5*(w-1));
    assert.ok(alphaAt(field,xAt(0),0)>.65,'日盘下方保留清楚亮核');
    for(const depth of [0,.02,.04]) for(const side of [-1,1]) {
      assert.ok(alphaAt(field,xAt(side*2),Math.round(depth*(h-1)))<.025,
        '太阳两侧不能残留宽红雾晕边');
    }
    const rows=centerLine(field).slice(2,Math.round(h*.08));
    assert.ok(Math.max(...rows)-Math.min(...rows)>.35,'集中倒影不能连成实心梯形');
  }
});

test('太阳下方细波的间距和左右位置错开，抬起后仍连续变化', () => {
  const f=renderer('blue');
  for(const time of [0,5,8,15]) {
    const field=f.render(time),w=field.canvas.width,line=centerLine(field);
    const peaks=[],centers=[];
    for(let y=2;y<21;y++) if(line[y]>line[y-1] && line[y]>=line[y+1]) peaks.push(y);
    const gaps=peaks.slice(1).map((peak,index)=>peak-peaks[index]);
    assert.ok(gaps.length>=2 && Math.max(...gaps)-Math.min(...gaps)>=2,'不能排成固定间隔的横线');
    for(let y=2;y<12;y++) {
      let energy=0,weighted=0;
      for(let x=0;x<w;x++) {const a=alphaAt(field,x,y);energy+=a;weighted+=a*x;}
      centers.push((weighted/energy/(w-1)*2-1)*8.2);
    }
    assert.ok(Math.max(...centers)-Math.min(...centers)>.23,'近地平线的亮纹也要左右错落');
  }
  const lifted={light:{elevation:.15}};
  const before=copyPixels(f.render(23,lifted)),after=copyPixels(f.render(23+1/60,lifted));
  let maxDifference=0;
  for(let i=3;i<before.length;i+=4) maxDifference=Math.max(maxDifference,Math.abs(before[i]-after[i]));
  assert.ok(maxDifference<=8,'抬起时不能用逐帧随机位置制造闪跳');
  f.render(5);assert.deepEqual(copyPixels(f.render(23,lifted)),before,'拖回相同时刻仍保持同一片波纹');
});

test('受光场保留72行，播放、换色和调整尺寸都复用一次分配的缓冲', () => {
  const f = renderer();
  const original = f.render();
  const references = [original.canvas, original.image, original.alpha, original.depth, original.rowAt, original.rowMix, original.color];
  assert.equal(original.depth.length, 72);
  assert.ok(original.alpha.length <= 72 * 256);
  assert.ok(original.canvas.width <= 512 && original.canvas.height <= 192);
  for (const time of [.016, .032, 5]) f.render(time);
  for (const style of ['warm', 'blue', 'warm']) {
    f.read(`sceneStyle = '${style}';palette = SCENE_STYLES[sceneStyle]`);
    const field = f.render(5);
    assert.equal(field.style, style);
  }
  f.read('width = 675;height = 900;horizonY = Math.round(height*.76);sunR = Math.min(width*.038,height*.045)');
  const resized = f.render(5);
  assert.equal(resized.width, 675);assert.equal(resized.radius, f.read('sunR'));
  [resized.canvas, resized.image, resized.alpha, resized.depth, resized.rowAt, resized.rowMix, resized.color]
    .forEach((value, i) => assert.strictEqual(value, references[i]));
  assert.equal(f.stats.canvases, 1);assert.equal(f.stats.buffers, 1);
  assert.equal(f.ctx.globalAlpha, .8);
  assert.equal(f.ctx.imageSmoothingEnabled, false);assert.equal(f.ctx.imageSmoothingQuality, 'low');
});

for (const aspect of ['', '3:4']) for (const style of ['blue', 'warm']) {
  const label = `${aspect || '全屏'} / ${style}`;
  test(`透明边缘平滑归零，倒影持续接住太阳底部：${label}`, () => {
    const f = renderer(style, aspect);
    for (const time of [0, 5, 10, 15, 30, 60]) {
      const field = f.render(time), w = field.canvas.width, h = field.canvas.height;
      assert.ok(Array.from(field.alpha).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      for (let y = 0; y < h; y++) {
        assert.equal(alphaAt(field, 0, y), 0, '不能露出矩形左边');
        assert.equal(alphaAt(field, w - 1, y), 0, '不能露出矩形右边');
        assert.ok(alphaAt(field, 4, y) <= 3 / 255 && alphaAt(field, w - 5, y) <= 3 / 255,
          '外缘内侧先淡出，不能最后一列才切成透明');
      }
      assert.ok(alphaAt(field, Math.floor(w / 2), 0) > (style === 'blue' ? .55 : .30),
        '远处细波应在不同相位均与太阳底部相接');
      const foreground = centerLine(field).slice(Math.ceil(h * .13));
      assert.ok(foreground.filter(value => value < .16).length > foreground.length * .24,
        '连接远处倒影不能补成贯穿到底的亮柱');
    }
  });

  test(`橙红到金黄层次、海水间隙及左右错落同时保留：${label}`, () => {
    const field = renderer(style, aspect).render(0);
    const w = field.canvas.width, h = field.canvas.height;
    const center = Math.floor(w / 2);
    const colorAt = depth => {
      const offset = (Math.round((h - 1) * depth) * w + center) * 4;
      return Array.from(field.image.data.slice(offset, offset + 3));
    };
    const top = colorAt(.02), middle = colorAt(.5), tail = colorAt(.90);
    assert.ok(top[0] > top[1] + 70, '远处保留橙红色');
    assert.ok(middle[1] > top[1] + 30 && tail[1] > middle[1] + 20, '中段到末端有金橙、浅金层次');
    assert.ok(tail[2] < tail[1] * .85, '主要末端仍是金色，不全部刷白');
    const line = centerLine(field).slice(Math.ceil(h * .13));
    assert.ok(line.filter(value => value > (style === 'blue' ? .55 : .35)).length > line.length * .08,
      '存在可见的主反光片，不能全部稀释成薄雾');
    const centers = [];
    for (let y = Math.round(h * .16); y < h * .94; y += 16) {
      let energy = 0, weightedX = 0;
      for (let x = 0; x < w; x++) {const a = alphaAt(field, x, y);energy += a;weightedX += a * x;}
      if (energy > .1) centers.push(weightedX / energy);
    }
    assert.ok(Math.max(...centers) - Math.min(...centers) > w * .03,
      '不同水深的亮片左右错落，不全部居中排成阶梯');
  });

  test(`跳转可复现、相邻帧平顺、半速正常和倍速同进度一致：${label}`, () => {
    const f = renderer(style, aspect);
    const first = copyPixels(f.render(5));
    const next = copyPixels(f.render(5.02));
    let total = 0, max = 0;
    for (let i = 3; i < first.length; i += 4) {
      const difference = Math.abs(first[i] - next[i]);total += difference;max = Math.max(max, difference);
    }
    assert.ok(total / (first.length / 4) < 1, '相邻帧平均亮度变化不能闪跳');
    assert.ok(max <= 8, '单点变化也不能突然跳亮');
    f.render(30);assert.deepEqual(copyPixels(f.render(5)), first);
    const frames = [.5, 1, 2].map(rate => f.clockFrame(12, rate));
    assert.deepEqual(frames[0], frames[1]);assert.deepEqual(frames[1], frames[2]);
    assert.deepEqual(f.clockFrame(12, 1, false), frames[1], '暂停后同一进度的水面不跳变');
  });

  test(`反光跟随太阳横移、抬高后缩短、无日光时停止绘制：${label}`, () => {
    const f = renderer(style, aspect);
    f.render(5);const base = f.images.at(-1);
    f.render(5, {sunX: f.story.sunX + 50});const moved = f.images.at(-1);
    assert.ok(Math.abs(moved[1] - base[1] - 50) < 1e-8);
    assert.equal(moved[2], base[2]);assert.equal(moved[3], base[3]);
    const lifted = f.render(5, {light: {elevation: .25}});
    assert.ok(centerLine(lifted).slice(Math.ceil(lifted.canvas.height * .55)).every(value => value < .005));
    const imageCount = f.images.length, uploads = f.stats.uploads;
    f.render(6, {reflection: 0});
    assert.equal(f.images.length, imageCount);assert.equal(f.stats.uploads, uploads);
  });
}
