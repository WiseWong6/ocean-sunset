const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sunScene(style, radius = 40, density = 1, displayScale = 1) {
  const calls = [], gradients = [];
  let canvases = 0;
  const ctx = new Proxy({globalAlpha: 1, canvas: {getBoundingClientRect: () => ({width: 1200 * displayScale})}}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        calls.push([key, ...args]);
        if (key === 'getImageData') throw new Error('圆盘直接合成像素，不能读取假画布');
        if (key === 'createImageData') return {width: args[0], height: args[1], data: new Uint8ClampedArray(args[0] * args[1] * 4)};
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          const gradient = {kind: key, args, stops: [], addColorStop(...stop) {this.stops.push(stop);}};
          gradients.push(gradient);return gradient;
        }
      };
    }
  });
  const box = vm.createContext({SceneSound: class {}, width: 1200, height: 900, ctx,
    window: {devicePixelRatio: density}, drawingContext: ctx, pixelDensity: () => Math.min(density, 2),
    document: {createElement() {canvases++;return {getContext: () => ctx};}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8'), box);
  const run = source => vm.runInContext(source, box);
  run(`sceneStyle = '${style}';palette = SCENE_STYLES[sceneStyle];sunR = ${radius};horizonY = 684;sunBrush = makeSunBrush()`);
  const raster = calls.find(([key]) => key === 'putImageData')[1];
  return {run, calls, gradients, raster, get canvases() {return canvases;}};
}

test('太阳使用缓存圆盘，重复绘制保持地平线裁剪和原来的眼睛位置', () => {
  for (const style of ['blue', 'warm']) {
    const scene = sunScene(style);
    const gradients = scene.gradients.length, canvases = scene.canvases;
    scene.calls.length = 0;
    for (let i = 0; i < 20; i++) scene.run('drawSun(ctx, 600, 654, 1, true, 1)');
    assert.equal(scene.gradients.length, gradients, '动画帧不能创建新的太阳渐变');
    assert.equal(scene.canvases, canvases, '动画帧不能创建新的太阳画布');
    assert.equal(scene.run('ctx.imageSmoothingQuality'), 'high');
    assert.equal(scene.calls.filter(([method]) => method === 'getImageData').length, 0);
    assert.equal(scene.calls.filter(([method]) => method === 'clip').length, 20);
    const eyes = scene.calls.filter(([method]) => method === 'ellipse');
    assert.equal(eyes.length, 40);
    assert.deepEqual(eyes[0].slice(1, 5), [580.8, 644.4, 3.4000000000000004, 3.4000000000000004]);
    assert.deepEqual(eyes[1].slice(1, 3), [607.2, 644.4]);
    const disc = scene.calls.find(([method]) => method === 'drawImage');
    const reach = scene.run('sunR * sunBrush.extent');
    assert.deepEqual(disc.slice(2), [600 - reach, 654 - reach, reach * 2, reach * 2]);
  }
});

test('暖色太阳直接合成原有渐变，内部不提亮也不增加晕边', () => {
  const scene = sunScene('warm'), {width: size, data} = scene.raster;
  const extent = scene.run('sunBrush.extent'), radius = scene.run('sunBrush.radius');
  const palette = [[0, [248, 211, 121]], [.14, [245, 196, 84]], [.34, [239, 172, 50]],
    [.58, [235, 139, 43]], [.8, [221, 96, 44]], [1, [200, 70, 53]]];
  for (const ny of [-.8, -.45, 0, .45, .8]) {
    const y = Math.floor((ny / extent + 1) * size / 2), x = Math.floor(size / 2);
    const normalizedY = ((y + .5) / size * 2 - 1) * extent;
    const at = Math.min(1, (normalizedY + 1) / 1.76);
    const end = palette.findIndex(([stop]) => stop >= at);
    const [a, left] = palette[end - 1], [b, right] = palette[end];
    for (let c = 0; c < 3; c++) {
      const expected = left[c] + (right[c] - left[c]) * (at - a) / (b - a);
      assert.ok(Math.abs(data[(y * size + x) * 4 + c] - expected) <= .5,
        '圆边处理不能改变原渐变的内部颜色');
    }
    assert.equal(data[(y * size + x) * 4 + 3], 255);
  }
  const edge = scene.run('sunBrush.edge');
  const x = Math.ceil(((1 + edge / 2) / extent + 1) * size / 2);
  assert.equal(data[(Math.floor(size / 2) * size + x) * 4 + 3], 0,
    '暖色圆边之外完全透明，不新增光晕');
  assert.equal(scene.gradients.length, 0, '颜色和轮廓直接在同一像素层合成');
  assert.equal(scene.run('sunBrush.canvas.width / (sunBrush.extent * 2 * sunBrush.radius)'), 4);
  assert.equal(radius, 40);
});

test('真实圆盘像素在不同尺寸与屏幕精度下保留连续圆边和面积', () => {
  for (const style of ['warm', 'blue']) for (const [radius, density, displayScale] of
    [[16, 1, 1], [40, 2, 1], [80, 2, .65], [40, 3, .7]]) {
    const scene = sunScene(style, radius, density, displayScale);
    const {width: size, data} = scene.raster;
    const brush = scene.run('sunBrush'), sampling = Math.min(density, 2) * 4;
    assert.equal(size % 2, 0);
    assert.equal(brush.sampling, sampling);
    assert.ok(Math.abs(brush.edge * radius * displayScale * density - 1.2) < 1e-10);
    const row = size / 2, screenStep = displayScale * density / sampling;
    const crossing = level => {
      for (let x = row; x < size - 1; x++) {
        const a = data[(row * size + x) * 4 + 3] / 255;
        const b = data[(row * size + x + 1) * 4 + 3] / 255;
        if (a >= level && b < level) return (x + (a - level) / (a - b)) * screenStep;
      }
      assert.fail('圆边缺少半透明过渡');
    };
    const transition = crossing(.1) - crossing(.9);
    assert.ok(transition > .65 && transition < 1.05,
      `${style} 半径 ${radius} / 屏幕 ${density} / 缩放 ${displayScale} 的边缘过渡应接近一个物理像素，实际 ${transition}`);
    let area = 0, partial = 0;
    for (let i = 3; i < data.length; i += 4) {
      area += data[i] / 255;
      if (data[i] > 0 && data[i] < 255) partial++;
    }
    assert.ok(partial > size / 2, '真实圆周应有足够的半透明像素');
    assert.ok(Math.abs(area / (Math.PI * (radius * sampling) ** 2) - 1) < .009,
      '平滑不能明显放大圆盘或新增大光晕');
    for (let i = 0; i < size; i++) {
      assert.equal(data[i * 4 + 3], 0);
      assert.equal(data[((size - 1) * size + i) * 4 + 3], 0);
    }
    // 画布精度、显示缩放任一变化都必须让旧圆盘失效。
    const key = brush.key;
    scene.run('window.devicePixelRatio += .5');
    assert.notEqual(scene.run('sunRasterMetrics().key'), key);
  }
});

test('太阳移动、拉长和压扁只缩放一次缓存圆盘，圆边连续且瞳孔保持圆形', () => {
  const radius = 40;
  const poses = [
    {name: '静止', x: 600, y: 654, body: {x: 1, y: 1}},
    {name: '移动', x: 817.35, y: 408.7, body: {x: 1, y: 1}},
    {name: '拉长', x: 638.6, y: 490.25, body: {x: 1 / 1.06, y: 1.06}},
    {name: '压扁', x: 640.1, y: 495.8, body: {x: 1 / .91, y: .91}}
  ];
  for (const style of ['blue', 'warm']) for (const density of [1, 2]) {
    const scene = sunScene(style, radius, density);
    const brush = scene.run('sunBrush'), {width: size, data} = scene.raster;
    const pixelsBefore = Buffer.from(data), canvases = scene.canvases;
    const gradients = scene.gradients.length, center = size / 2;
    const crossing = (axis, level) => {
      for (let p = center; p < size - 1; p++) {
        const first = axis === 'x' ? center * size + p : p * size + center;
        const second = first + (axis === 'x' ? 1 : size);
        const a = data[first * 4 + 3] / 255, b = data[second * 4 + 3] / 255;
        if (a >= level && b < level) return p + (a - level) / (a - b);
      }
      assert.fail('真实圆盘像素必须有连续的透明过渡');
    };
    for (const pose of poses) {
      scene.calls.length = 0;
      scene.run(`drawSun(ctx, ${pose.x}, ${pose.y}, 1, false, 1, ${JSON.stringify(pose.body)})`);
      const images = scene.calls.filter(([method]) => method === 'drawImage');
      assert.equal(images.length, 1, `${pose.name}只能绘制一次缓存圆盘`);
      assert.strictEqual(images[0][1], brush.canvas);
      const reach = radius * brush.extent;
      assert.deepEqual(images[0].slice(2), [pose.x - reach * pose.body.x,
        pose.y - reach * pose.body.y, reach * 2 * pose.body.x, reach * 2 * pose.body.y]);
      assert.ok(Math.abs(pose.body.x * pose.body.y - 1) < 1e-12,
        '拉长与压扁保持同样的太阳面积');
      for (const axis of ['x', 'y']) {
        // 从实际缓冲的透明度交点，按真实 drawImage 尺寸换算到屏幕物理像素。
        const destinationSpan = images[0][axis === 'x' ? 4 : 5];
        const transition = (crossing(axis, .1) - crossing(axis, .9))
          * destinationSpan / size * density;
        assert.ok(transition > .58 && transition < 1.15,
          `${style}/${pose.name}/${axis} 的圆边须保持约一个物理像素的渐变，实际 ${transition}`);
      }
      const eyes = scene.calls.filter(([method]) => method === 'ellipse');
      assert.equal(eyes.length, 2);
      for (const [i, eye] of eyes.entries()) {
        assert.equal(eye[3], eye[4], '身体变形不能把圆点眼睛压成椭圆');
        assert.equal(eye[3], radius * .085);
        assert.equal(eye[1], pose.x + [-.48, .18][i] * radius * pose.body.x);
        assert.equal(eye[2], pose.y - radius * .24 * pose.body.y);
      }
      for (const operation of ['scale', 'clip', 'createImageData', 'putImageData', 'getImageData']) {
        assert.equal(scene.calls.filter(([method]) => method === operation).length, 0,
          `${pose.name}不能重复缩放、裁切或重建圆盘`);
      }
      assert.strictEqual(scene.run('sunBrush'), brush);
      assert.equal(scene.canvases, canvases);
      assert.equal(scene.gradients.length, gradients);
      assert.equal(Buffer.compare(Buffer.from(data), pixelsBefore), 0,
        '运动和变形不能改写圆盘像素或新增晕边');
    }
  }
});
