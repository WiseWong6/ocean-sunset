// p5.js 海面日落：暗色波谷、连续波峰与随波面朝向变化的碎金反射。
// 天空保留连续渐变，海面的反光与波纹使用同一组形状。
// 这是基于反射规律的视觉近似，不是完整的光线追踪或流体模拟。
let backdrop;
let waterBrushes;
let controlsStamp = -Infinity;
let horizonY, sunX, sunY, sunR;
let pickupTime = 19;
let waterContacts = [];
let waterDrops = [];
let soundEvents = [];
let waterRows = [];
let skyStars = [];
let motionPreference;
const SCENE_DURATION = 65;
const playback = {time: 0, stamp: 0, playing: false, running: false, rate: 1};
let playButton, progressInput, timeOutput, speedButton, soundButton;
const sceneSound = new SceneSound();
let draggingProgress = false, resumeAfterDrag = false;

function setup() {
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  const size = sceneSize();
  const surface = createCanvas(size.width, size.height);
  surface.elt.setAttribute('role', 'img');
  surface.elt.setAttribute('aria-label', '夕阳海面上，飞机放下秋千，太阳长出手脚握住绳子，坐着秋千向右飞去，夜色渐深，星星逐渐显现');
  frameRate(60);
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', () => {
    playback.playing = !motionPreference.matches;
    soundEvents = makeSoundEvents();
    sceneSound.setEvents(soundEvents);
    updatePlayback();
  });
  sceneSound.getFrame = soundFrame;
  sceneSound.onError = error => {
    soundButton.textContent = '音效重试';
    soundButton.title = error.message;
    soundButton.setAttribute('aria-pressed', 'false');
    soundButton.setAttribute('aria-label', '重试开启音效');
    soundButton.disabled = false;
  };
  setupPlaybackControls();
  playback.playing = !motionPreference.matches;
  document.addEventListener('visibilitychange', updatePlayback);
  buildScene();
  updatePlayback();
}

function sceneTime() {
  if (!playback.running) return playback.time;
  return Math.min(SCENE_DURATION, playback.time + Math.max(0, millis() - playback.stamp) / 1000 * playback.rate);
}

function updatePlayback() {
  playback.time = sceneTime();
  playback.stamp = millis();
  playback.running = playback.playing && !document.hidden;
  if (playback.running) loop();
  else {
    noLoop();
    if (!document.hidden) redraw();
  }
  updatePlaybackControls();
  updateSound();
}

function setupPlaybackControls() {
  playButton = document.getElementById('play-toggle');
  progressInput = document.getElementById('play-progress');
  timeOutput = document.getElementById('play-time');
  soundButton = document.getElementById('play-sound');
  soundButton.disabled = false;
  soundButton.addEventListener('click', async () => {
    soundButton.disabled = true;
    try {
      await sceneSound.setEnabled(!sceneSound.enabled);
      soundButton.textContent = sceneSound.enabled ? '声音开' : '声音关';
      soundButton.setAttribute('aria-pressed', String(sceneSound.enabled));
      soundButton.setAttribute('aria-label', sceneSound.enabled ? '关闭音效' : '开启音效');
      soundButton.disabled = false;
      soundButton.title = '开启海浪、飞机、落水、滴水与星光音效';
      updateSound();
    } catch (error) {
      soundButton.textContent = '音效重试';
      soundButton.setAttribute('aria-pressed', 'false');
      soundButton.setAttribute('aria-label', '重试开启音效');
      soundButton.title = error.message;
      soundButton.disabled = false;
    }
  });
  window.addEventListener('pagehide', () => {
    sceneSound.silence();
  });
  speedButton = document.getElementById('play-speed');
  speedButton.disabled = false;
  speedButton.addEventListener('click', () => {
    playback.time = sceneTime();
    playback.stamp = millis();
    const rates = [.5, 1, 1.5, 2, 3];
    playback.rate = rates[(rates.indexOf(playback.rate) + 1) % rates.length];
    sceneSound.invalidate();
    updatePlaybackControls();
    updateSound();
  });
  playButton.disabled = false; progressInput.disabled = false;
  progressInput.max = SCENE_DURATION;
  playButton.addEventListener('click', () => {
    if (!playback.playing && playback.time >= SCENE_DURATION) playback.time = 0;
    playback.playing = !playback.playing;
    updatePlayback();
  });
  progressInput.addEventListener('pointerdown', () => {
    draggingProgress = true;
    resumeAfterDrag = playback.playing;
    playback.playing = false;
    updatePlayback();
  });
  progressInput.addEventListener('input', () => {
    playback.time = Math.max(0, Math.min(SCENE_DURATION, Number(progressInput.value)));
    playback.stamp = millis();
    sceneSound.invalidate();
    updatePlaybackControls();
    updateSound();
    if (!playback.running) redraw();
  });
  const finishDrag = () => {
    if (!draggingProgress) return;
    draggingProgress = false;
    playback.playing = resumeAfterDrag;
    updatePlayback();
  };
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', finishDrag);
}

function updatePlaybackControls(force = true) {
  if (!playButton) return;
  const now = millis();
  if (!force && now - controlsStamp < 100) return;
  controlsStamp = now;
  const t = sceneTime();
  speedButton.textContent = `${playback.rate}×`;
  speedButton.setAttribute('aria-label', `播放速度 ${playback.rate} 倍，点击切换`);
  const clockText = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  playButton.textContent = playback.playing ? '暂停' : t >= SCENE_DURATION ? '重播' : '播放';
  playButton.setAttribute('aria-label', playback.playing ? '暂停动画' : t >= SCENE_DURATION ? '重播动画' : '播放动画');
  if (!draggingProgress) progressInput.value = t;
  progressInput.style.setProperty('--progress', `${t / SCENE_DURATION * 100}%`);
  progressInput.setAttribute('aria-valuetext', `${clockText(t)}，共 ${clockText(SCENE_DURATION)}`);
  timeOutput.textContent = `${clockText(t)} / ${clockText(SCENE_DURATION)}`;
}

// 竖版缩短两段横向飞行，入水、托举和负重动作仍保持原来的时长。
function storyTime(time) {
  if (document.body.dataset.aspect !== '3:4') return time;
  if (time <= .6) return time * 2 / .6;
  if (time <= 6.5) return 2 + (time - .6) * 12.5 / 5.9;
  if (time <= 24) return time + 8;
  if (time <= 37) return 32 + (time - 24) * 2;
  return time + 21;
}

// 动作事件先换算成当前版本的播放时刻，音效与画面共用同一时钟。
function sceneTimeForAction(time) {
  if (document.body.dataset.aspect !== '3:4') return time;
  if (time <= 2) return time * .6 / 2;
  if (time <= 14.5) return .6 + (time - 2) * 5.9 / 12.5;
  if (time <= 32) return time - 8;
  if (time <= 58) return 24 + (time - 32) / 2;
  return time - 21;
}

function sceneSize() {
  if (document.body.dataset.aspect !== '3:4') return {width: windowWidth, height: windowHeight};
  // 竖版完整适配窗口，底部留出独立控制区，不裁切画面。
  const availableWidth = Math.max(3, windowWidth - 24);
  const availableHeight = Math.max(4, windowHeight - (windowWidth <= 580 ? 150 : 110));
  const width = Math.min(availableWidth, availableHeight * .75);
  return {width, height: width * 4 / 3};
}

function windowResized() {
  const size = sceneSize();
  resizeCanvas(size.width, size.height);
  buildScene();
  if (!playback.running) redraw();
}

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function smoothstep(a, b, value) {
  const u = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

function rgba(r, g, b, alpha) {
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function buildScene() {
  if (backdrop) backdrop.remove();
  backdrop = createGraphics(width, height);
  backdrop.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  horizonY = Math.round(height * 0.76);
  sunX = width * 0.5;
  sunR = Math.min(width * 0.038, height * 0.045);
  sunY = horizonY - sunR * 0.76;
  pickupTime = findPickupTime();
  waterContacts = findWaterContacts();
  waterDrops = makeWaterDrops();
  const ctx = backdrop.drawingContext;

  // 参考落日照片：橙金高空向低空的灰紫色过渡，保留海平线的暗层。
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, '#f69b18');
  sky.addColorStop(0.32, '#eb922b');
  sky.addColorStop(0.64, '#bd6c46');
  sky.addColorStop(0.86, '#795669');
  sky.addColorStop(1, '#545269');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizonY);
  const sea = ctx.createLinearGradient(0, horizonY, 0, height);
  sea.addColorStop(0, '#72616c');
  sea.addColorStop(0.12, '#605966');
  sea.addColorStop(0.38, '#454e60');
  sea.addColorStop(0.72, '#344456');
  sea.addColorStop(1, '#25394b');
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  if (!waterBrushes) waterBrushes = makeWaterBrushes();
  skyStars = makeSkyStars();
  soundEvents = makeSoundEvents();
  sceneSound.setEvents(soundEvents);
  const next = seededRandom(860214);
  // 同一条波峰同时决定暗面、暖色天光和金色反射的位置。
  waterRows = Array.from({length: 72}, (_, i) => ({
    depth: Math.pow((i + .15 + next() * .7) / 72, 1.7),
    phase: next() * Math.PI * 2,
    weight: 0.65 + next() * 0.7
  }));
}

function waveAt(x, row, time, scale) {
  const d = row.depth;
  // 两组不同方向的波相互叠加；相邻水面共享波相，避免每行各自振动。
  const u = x / (25 + d * 110);
  const a = u * .85 + d * 43 - time * .46;
  const b = u * 1.53 - d * 67 + time * .32;
  const c = u * 3.7 + d * 115 - time * .61;
  const swell = Math.sin(a) * .6 + Math.sin(b) * .28 + Math.sin(c) * .12;
  const facing = Math.cos(a) * .5 + Math.cos(b) * .32 + Math.cos(c) * .18;
  const patch = smoothstep(-.65, .65, Math.sin(u * .57 - d * 29 + time * .17)
    * .65 + Math.sin(u * 2.17 + d * 81 - time * .29) * .35);
  return {
    y: horizonY + d * (height - horizonY) + swell * (.2 + d * 4) * scale,
    facing, patch
  };
}

function waterFacet(ctx, x1, y1, x2, y2, thickness, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, y2 + thickness);
  ctx.lineTo(x1, y1 + thickness);
  ctx.closePath();
  ctx.fill();
}

// 将柔和边缘预先画成小贴片，避免每帧为每个亮斑创建渐变。
function makeWaterBrushes() {
  return Array.from({length: 17}, (_, i) => {
    const canvas = document.createElement('canvas');canvas.width = 8;canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const color = i === 16 ? [255, 235, 195] : [246, 180 + i * 32 / 15, 105 + i * 48 / 15];
    const gradient = ctx.createLinearGradient(0, 0, 0, 32);
    for (const [stop, alpha] of [[0,0],[.35,.75],[.55,1],[1,0]]) {
      gradient.addColorStop(stop, rgba(...color, alpha));
    }
    ctx.fillStyle = gradient;ctx.fillRect(0, 0, 8, 32);
    return canvas;
  });
}

function softWaterFacet(ctx, x1, y1, x2, y2, thickness, brush, alpha) {
  if (alpha < .001) return;
  const feather = Math.max(.65, thickness * .7);
  ctx.save();ctx.globalAlpha *= alpha;
  ctx.transform(1, (y2 - y1) / (x2 - x1), 0, 1, x1, y1);
  ctx.drawImage(waterBrushes[brush], 0, -feather, x2 - x1 + .2, thickness + feather * 2);
  ctx.restore();
}

function draw() {
  if (!backdrop) return;
  const t = sceneTime();
  if (t >= SCENE_DURATION && playback.running) {
    playback.time = SCENE_DURATION;
    playback.running = false;playback.playing = false;
    noLoop();
  }
  updatePlaybackControls(false);
  const ctx = drawingContext;
  const actionTime = storyTime(t);
  const story = flightAt(actionTime);
  const scale = Math.max(0.55, Math.min(1.5, height / 900));
  image(backdrop, 0, 0);
  drawSunlight(ctx, story);
  drawSun(ctx, sunX, sunY, story.restOpacity, true, story.eyeOpen);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizonY, width, height - horizonY);
  ctx.clip();

  // 远处细密、近处舒展的波纹覆盖整个海面；倒影服从同一波峰的朝向。
  for (const row of waterRows) {
    const d = row.depth;
    const fineCell = Math.max(3, width / 180) * (.6 + d * 1.5);
    const coarseCell = Math.max(6, width / 65) * (.6 + d * 1.5);
    const thickness = (.45 + Math.pow(d, 1.2) * 3.4) * scale * row.weight;
    const spread = sunR * (.7 + Math.pow(d, .8) * 1.2) * (1 + story.light.elevation * .5) * (.88 + .12 * Math.sin(d * 39 - t * .23));
    const center = story.sunX + (Math.sin(d * 12 - t * .35) * .09 + Math.sin(d * 27 + t * .21) * .035) * spread * d;
    let left = waveAt(0, row, t, scale);
    for (let x = 0; x < width;) {
      const nearReflection = story.reflection > .005 && Math.abs(x - center) < spread * 3.2;
      const end = Math.min(width, x + (nearReflection ? fineCell : coarseCell));
      const right = waveAt(end, row, t, scale);
      const facing = (left.facing + right.facing) * .5;
      const patch = (left.patch + right.patch) * .5;
      // 降低长条波谷的对比，避免整片海面呈现等距横线。
      waterFacet(ctx, x, left.y + thickness * 0.45, end, right.y + thickness * 0.45,
        thickness, rgba(17, 30, 43, (.025 + d * .055) * (.75 - facing * .25) * (.2 + .8 * patch)));
      waterFacet(ctx, x, left.y, end, right.y, thickness * 0.36,
        rgba(186, 135, 110, (.015 + Math.max(0, facing) * .05) * patch));

      const across = ((x + end) * 0.5 - center) / spread;
      const depthLight = 1 - story.light.elevation * .5 * (1 - d);
      const coverage = (Math.exp(-across * across * 2) * .8 + Math.exp(-across * across * .48) * .2) * story.reflection * depthLight;
      // 光带外缘柔和扩散，细碎亮点随波峰连续变化，不用硬阈值突然开关。
      const crest = smoothstep(-.4, .85, facing);
      const reflection = coverage * (.018 + crest * crest * .7) * (.12 + .88 * patch) * (1 - d * .3);
      softWaterFacet(ctx, x, left.y, end, right.y, thickness * (.32 + crest * .42),
        Math.round(crest * 15), reflection);
      const glint = Math.pow(smoothstep(.25, .88, facing), 3) * coverage * patch;
      softWaterFacet(ctx, x, left.y, end, right.y, Math.max(.35, thickness * .12),
        16, glint * .42);
      left = right;
      x = end;
    }
  }
  ctx.restore();
  drawWaterContact(ctx, actionTime);
  drawDusk(ctx, story);
  drawStars(ctx, t, story.darkness, story);
  drawContrail(ctx, actionTime);
  drawFlight(ctx, story);
  updateSound(t, story);
}


function soundFrame(time = sceneTime(), story = flightAt(storyTime(time))) {
  return {time, actionTime: storyTime(time), story, contacts: waterContacts,
    width, duration: SCENE_DURATION, rate: playback.rate,
    reducedMotion: motionPreference.matches, running: playback.running && !document.hidden};
}

function updateSound(time = sceneTime(), story = flightAt(storyTime(time))) {
  sceneSound.update(soundFrame(time, story));
}

// 找到回升的座板刚好托住太阳底部的时刻，而不是另做一个爬上去的动作。
function findPickupTime() {
  const deepY = horizonY + sunR * .55;
  const raisedY = horizonY - Math.max(sunR * 1.6, height * .065);
  const contactY = sunY + sunR;
  let low = 18.35, high = 24;
  for (let i = 0; i < 36; i++) {
    const mid = (low + high) / 2;
    const seatY = deepY + (raisedY - deepY) * smoothstep(18.35, 24, mid);
    if (seatY > contactY) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// 全长 65 秒：秋千浅潜到太阳下方 → 收绳托起 → 负重爬升 → 夜色。
// 用随时间衰减的摆动近似绳索受风和负重后的反应，保持任意时刻可重绘。
function flightAt(time) {
  const t = Math.max(0, Math.min(time, SCENE_DURATION));
  const unit = Math.max(5, Math.min(16, sunR * 0.34));
  const approach = smoothstep(2, 14.5, t);
  const depart = smoothstep(32, 58, t);
  const aboard = t >= pickupTime && t < 62;
  const board = aboard ? 1 : 0;
  const deploy = smoothstep(14, 18, t);
  const x = -unit * 3 + (sunX + unit * 3) * approach
    + (width + sunR * 2.5 - sunX) * depart;

  // 降低巡航高度，登板后先被重量拽下，再恢复并抬头爬升。
  const cruiseY = height * .22;
  const loadTime = 24.5; // 收绳已把太阳带离水面一段，再承受完整重量。
  const impactTime = waterContacts[0]?.time ?? 18;
  const awake = t < 62 ? smoothstep(impactTime, impactTime + .65, t) : 0;
  const eyeOpen = awake * (.65 + .35 * smoothstep(impactTime + .7, impactTime + 1.7, t));
  const tug = smoothstep(loadTime, loadTime + 1.1, t) * (1 - smoothstep(loadTime + 1.1, loadTime + 5.5, t));
  const recovery = Math.sin(Math.max(0, t - (loadTime + 1.1)) * 2.1)
    * Math.exp(-Math.max(0, t - (loadTime + 1.1)) * .85) * smoothstep(loadTime + 1.1, loadTime + 1.7, t);
  const y = cruiseY + height * (.038 * tug + .005 * recovery) - height * .15 * depart;
  const pitch = .065 * tug - .12 * smoothstep(loadTime + 2, loadTime + 6, t) * (1 - smoothstep(52, 58, t));
  const pivotY = y + unit * .65;
  const seatY = horizonY - Math.max(sunR * 1.6, height * .065);
  const fullLength = seatY - (cruiseY + unit * .65);
  const releaseAge = Math.max(0, t - 14);
  const lowering = smoothstep(14, 15, t) * (1 - smoothstep(17, 18, t));
  const payout = Math.sin(releaseAge * 3.2) * sunR * .08 * lowering;
  const stretch = sunR * .08 * tug;
  // 只下探到太阳底部稍下方，座板被海水遮住；停顿 0.35 秒便收绳。
  const deepLength = horizonY + sunR * .55 - (cruiseY + unit * .65);
  const retrieve = smoothstep(18.35, 24, t);
  const length = Math.max(unit * .25,
    deepLength * deploy + (fullLength - deepLength) * retrieve + payout + stretch);
  const releaseSwing = Math.sin(releaseAge * 2.2) * .13 * Math.exp(-releaseAge * .18) * lowering;
  const loadAge = Math.max(0, t - loadTime);
  const loadSwing = Math.sin(loadAge * 1.75) * .055 * Math.exp(-loadAge * .3) * smoothstep(loadTime, loadTime + .5, t);
  const cruisingSwing = Math.sin((t - 32) * .85) * .035 * smoothstep(32, 36, t);
  const angle = releaseSwing + loadSwing + cruisingSwing;
  const riderX = x - Math.sin(angle) * (length - sunR);
  const riderY = pivotY + Math.cos(angle) * (length - sunR);
  const lightX = t >= pickupTime ? riderX : sunX;
  const lightY = t >= pickupTime ? riderY : sunY;
  const light = sunlightAt(lightX, lightY);
  const darkness = light.darkness;
  return {t, unit, x, y, pitch, pivotY, length, angle, board, deploy, darkness,
    eyeOpen, armOpacity: awake,
    aboard, visible: t >= 2 && t < 62,
    restOpacity: t < pickupTime ? 1 : 0,
    sunX: lightX, sunY: lightY, light,
    reflection: light.reflection
  };
}

// 座板绘制、入水中心和滴水起点共用尺寸与旋转，避免视觉和碰撞各算各的。
function swingSeatGeometry(radius, deploy) {
  return {left: -radius * 1.48 * deploy, right: radius * 1.48 * deploy,
    depth: radius * .25 * deploy, offset: radius * .16 * deploy,
    thickness: radius * .07 * deploy};
}

function seatWorldPoint(story, x, y) {
  return {x: story.x + x * Math.cos(story.angle) - y * Math.sin(story.angle),
    y: story.pivotY + x * Math.sin(story.angle) + y * Math.cos(story.angle)};
}

function seatContactPoint(story) {
  const seat = swingSeatGeometry(sunR, story.deploy);
  return seatWorldPoint(story, seat.offset / 2, story.length - seat.depth / 2 + seat.thickness);
}

function findWaterContacts() {
  return [{start: 14, end: 18, entering: true}, {start: 18.35, end: 24, entering: false}].map(event => {
    let low = event.start, high = event.end;
    for (let i = 0; i < 36; i++) {
      const mid = (low + high) / 2;
      const point = seatContactPoint(flightAt(mid));
      if (event.entering ? point.y < horizonY : point.y > horizonY) low = mid;
      else high = mid;
    }
    const time = (low + high) / 2;
    return {time, entering: event.entering, ...seatContactPoint(flightAt(time))};
  });
}

function makeWaterDrops() {
  const exit = waterContacts.find(contact => !contact.entering);
  if (!exit) return [];
  return Array.from({length: 10}, (_, i) => {
    const emitted = exit.time + .12 + i * .16;
    const story = flightAt(emitted);
    const seat = swingSeatGeometry(sunR, story.deploy);
    const edge = (i % 2 ? seat.left : seat.right) * (.78 + (i % 3) * .055);
    const start = seatWorldPoint(story, edge, story.length + seat.thickness);
    // 用同一条重力轨迹求落水时刻，声音不在水滴离板时触发。
    const gravity = height * .34;
    const fall = Math.sqrt(Math.max(0, 2 * (horizonY - start.y) / gravity));
    return {id: `drop-${i}`, emitted, time: emitted + fall, x: start.x, y: horizonY,
      startY: start.y, gravity, strength: .75 + (i % 3) * .1};
  }).filter(drop => drop.startY < horizonY);
}

function drawRipple(ctx, event, age, small = false) {
  const lifetime = small ? .85 : 3.1;
  const rings = small ? 1 : 3;
  ctx.save();ctx.beginPath();ctx.rect(0, horizonY, width, height - horizonY);ctx.clip();
  for (let i = 0; i < rings; i++) {
    const u = (age - i * .2) / lifetime;
    if (u <= 0 || u >= 1) continue;
    const spread = .5 + sunR * (small ? .38 : 3.8) * (1 - Math.pow(1 - u, 1.5));
    const opacity = smoothstep(0, .06, u) * Math.pow(1 - u, 2) * (small ? .32 : .42);
    ctx.strokeStyle = rgba(238, 224, 204, opacity);
    ctx.lineWidth = Math.max(.55, sunR * .018) * (1 - u * .35);
    ctx.beginPath();ctx.ellipse(event.x, event.y, spread, Math.max(.3, spread * .065), 0, 0, Math.PI * 2);ctx.stroke();
  }
  ctx.restore();
}

function drawWaterContact(ctx, time) {
  const r = sunR;
  ctx.save();ctx.lineCap = 'round';
  for (const event of waterContacts) {
    const age = time - event.time;
    if (age < 0 || age > 3.6) continue;
    drawRipple(ctx, event, age);
    if (!event.entering) continue;
    for (let i = 0; i < 10; i++) {
      const life = .55 + (i % 3) * .13;
      const u = age / life;
      if (u <= 0 || u >= 1) continue;
      const side = i % 2 ? -1 : 1;
      const x = event.x + side * r * u * (.8 + i * .055);
      const y = event.y - Math.sin(Math.PI * u) * r * (.16 + (i % 4) * .075);
      ctx.fillStyle = rgba(255, 231, 187, Math.sin(Math.PI * u) * .6);
      ctx.beginPath();ctx.ellipse(x, y, Math.max(.7, r * .018), Math.max(1, r * .04), side * .25, 0, Math.PI * 2);ctx.fill();
    }
  }
  for (const drop of waterDrops) {
    const elapsed = time - drop.emitted;
    if (elapsed < 0) continue;
    if (time >= drop.time) {
      drawRipple(ctx, drop, time - drop.time, true);
      continue;
    }
    const y = drop.startY + .5 * drop.gravity * elapsed * elapsed;
    ctx.fillStyle = rgba(255, 233, 210, .58);
    ctx.beginPath();ctx.ellipse(drop.x, y, Math.max(.65, r * .016), Math.max(1.2, r * .045), 0, 0, Math.PI * 2);ctx.fill();
  }
  ctx.restore();
}

function makeSoundEvents() {
  const events = waterContacts.map((contact, i) => ({...contact, id: `contact-${i}`,
    type: contact.entering ? 'splash' : 'lift', time: sceneTimeForAction(contact.time), strength: 1}));
  for (const drop of waterDrops) {
    const time = sceneTimeForAction(drop.time);
    const previous = events[events.length - 1];
    // 邻近滴答共用一个声音，所有小水环仍按各自落点绘制。
    if (previous.type === 'drop' && time - previous.time < .23) {
      previous.strength = Math.min(1.15, previous.strength + .15);
    } else events.push({...drop, time, type: 'drop'});
  }
  const bells = [];
  skyStars.filter(star => star.bright).forEach((star, index) => {
    for (let cycle = -10; cycle < 5; cycle++) {
      const time = 48 + (cycle + .12 - star.twinklePhase) * 6.4;
      if (time < 0 || time > SCENE_DURATION - .75) continue;
      const story = flightAt(storyTime(time));
      const light = skyStarAt(star, time, localDarkness(story, star.x * width, star.y * horizonY));
      if (light.twinkle < .85 || light.visibility < .8) continue;
      bells.push({id: `star-${index}-${cycle}`, time, x: star.x * width, y: star.y * horizonY,
        type: 'star', note: index % 3, strength: .85});
    }
  });
  let lastBell = -Infinity;
  for (const bell of bells.sort((a, b) => a.time - b.time)) {
    if (bell.time - lastBell < 2.2) continue;
    events.push(bell);lastBell = bell.time;
  }
  return events.sort((a, b) => a.time - b.time);
}

// 太阳完整留在画面内时仅轻微变暗；圆盘越过右边缘后才完成入夜。
function sunlightAt(x, y) {
  const elevation = Math.max(0, (sunY - y) / height);
  const travel = Math.hypot((x - sunX) / (width * .56),
    Math.max(0, elevation - .16) / .65);
  const drift = smoothstep(.12, .98, travel);
  const leavingFrame = smoothstep(width - sunR, width + sunR * 1.5, x);
  const darkness = .2 * drift * (1 - leavingFrame) + leavingFrame;
  return {darkness, elevation,
    reflection: (1 - darkness) * (1 - .35 * smoothstep(.12, .4, elevation))};
}

function localDarkness(story, x, y, sea = false) {
  const d = story.darkness;
  const dy = sea ? (y - horizonY) / (height - horizonY) : (y - story.sunY) / height;
  const distance = Math.hypot((x - story.sunX) / (width * .55), dy * .4);
  const far = smoothstep(.1, 1.25, distance);
  return Math.max(0, Math.min(1, d + d * (1 - d) * (far - .45) * 1.1));
}

function drawSunlight(ctx, story) {
  const intensity = 1 - story.darkness;
  if (intensity <= 0) return;
  const glow = (x, y, rx, ry, sea, alpha) => {
    ctx.save();ctx.beginPath();ctx.rect(0, sea ? horizonY : 0, width, sea ? height - horizonY : horizonY);ctx.clip();
    ctx.translate(x, y);ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, rgba(255, 175, 100, alpha * intensity));
    gradient.addColorStop(.45, rgba(255, 175, 100, alpha * intensity * .45));
    gradient.addColorStop(1, 'rgba(255,175,100,0)');
    ctx.fillStyle = gradient;ctx.fillRect(-1, -1, 2, 2);ctx.restore();
  };
  glow(story.sunX, story.sunY, width * .7, height * .52, false, .12);
  glow(story.sunX, horizonY + (height - horizonY) * Math.min(.65, story.light.elevation),
    width * .72, (height - horizonY) * .85, true, .16);
}

function drawDusk(ctx, story) {
  if (story.darkness <= 0) return;
  // 横向连续渐变：背离太阳的一边先暗，附近仍留暖光；海面同步跟随。
  ctx.save();
  for (const sea of [false, true]) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const y = sea ? horizonY : story.sunY;
    for (let i = 0; i <= 24; i++) {
      const d = localDarkness(story, width * i / 24, y, sea);
      gradient.addColorStop(i / 24, sea ? rgba(9, 19, 32, d * .95) : rgba(9, 17, 35, d * .98));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, sea ? horizonY : 0, width, sea ? height - horizonY : horizonY);
  }
  ctx.restore();
}

// 大量微弱远星铺底，宽星带内有局部聚集和暗隙；固定种子保证拖动可复现。
function makeSkyStars() {
  const random = seededRandom(731029);
  const stars = [];
  const count = Math.round(Math.max(700, Math.min(3600, width * horizonY / 460)));
  const clusters = Array.from({length: 7}, (_, i) => ({
    x: .06 + i * .145, y: .73 - i * .079 + (random() - .5) * .14,
    sx: .035 + random() * .045, sy: .035 + random() * .05
  }));
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.00001, random()))) * Math.cos(random() * Math.PI * 2);
  for (let i = 0; i < count; i++) {
    let x, y;
    const layer = random();
    for (let attempt = 0; attempt < 20; attempt++) {
      if (layer < .43) {
        x = random();y = random() * .97;
      } else if (layer < .77) {
        x = random();
        y = .78 - x * .52 + Math.sin(x * 8) * .055 + gaussian() * .10;
      } else {
        const group = clusters[Math.floor(random() * clusters.length)];
        x = group.x + gaussian() * group.sx;y = group.y + gaussian() * group.sy;
      }
      if (x > .006 && x < .994 && y > .012 && y < .97) break;
    }
    if (!(x > 0 && x < 1 && y > 0 && y < 1)) continue;
    const seed = random();
    const rank = random();
    const medium = rank > .92;
    stars.push({x, y, seed, bright: false, medium,
      dust: layer >= .43 && !medium, twinkling: false});
  }
  // 少量主星横跨全幅，纵向自由错落，不形成网格，也不集中在一侧。
  const brightCount = Math.round(Math.max(9, Math.min(18, width / 100)));
  for (let i = 0; i < brightCount; i++) {
    stars.push({x: (i + .2 + random() * .6) / brightCount,
      y: .07 + random() * .76, seed: random(), bright: true,
      medium: false, dust: false, twinkling: true, twinklePhase: (i + random() * .35) / brightCount});
  }
  return stars;
}

function skyStarAt(star, time, darkness) {
  const visibility = smoothstep(star.bright ? .8 + star.seed * .04 : .36 + star.seed * .22,
    star.bright ? .98 : .86 + star.seed * .12, darkness);
  const sparkleVisibility = smoothstep(.82, .98, darkness);
  const period = 6.4;
  const phase = (((time - 48) / period + (star.twinklePhase ?? star.seed)) % 1 + 1) % 1;
  const twinkle = star.twinkling && !motionPreference.matches
    ? sparkleVisibility * smoothstep(0, .12, phase) * (1 - smoothstep(.12, .37, phase))
      * (1 - smoothstep(SCENE_DURATION - .8, SCENE_DURATION, time)) : 0;
  const restingAlpha = star.bright ? .65 : star.medium ? .42 + star.seed * .22
    : star.dust ? .13 + star.seed * .19 : .22 + star.seed * .23;
  const restingRadius = star.bright ? 1.05 + star.seed * .25 : star.medium ? .65 + star.seed * .2
    : .24 + star.seed * .3;
  return {
    visibility, twinkle,
    alpha: visibility * (restingAlpha + (1 - restingAlpha) * twinkle) * (1 - star.y * .22),
    radius: restingRadius + .48 * twinkle
  };
}

function drawStars(ctx, time, darkness, story) {
  if (darkness <= .36) return;
  const scale = Math.max(.8, Math.min(1.25, Math.min(width / 1100, height / 850)));
  ctx.save();ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();
  for (const star of skyStars) {
    const light = skyStarAt(star, time, story ? localDarkness(story, star.x * width, star.y * horizonY) : darkness);
    if (light.alpha < .002) continue;
    const x = star.x * width, y = star.y * horizonY;
    // 远星保持细小，依靠数量与密度形成星带，不给每颗远星加光晕。
    if (!star.bright) {
      ctx.globalAlpha = light.alpha;ctx.fillStyle = '#ffffff';
      ctx.beginPath();ctx.arc(x, y, light.radius * scale, 0, Math.PI * 2);ctx.fill();
      continue;
    }
    ctx.save();ctx.translate(x, y);ctx.scale(scale, scale);
    const radius = 4 + light.twinkle * 5;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    halo.addColorStop(0, 'rgba(255,255,255,.55)');
    halo.addColorStop(.22, 'rgba(255,255,255,.16)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = light.alpha;
    ctx.fillStyle = halo;ctx.beginPath();ctx.arc(0, 0, radius, 0, Math.PI * 2);ctx.fill();
    if (light.twinkle > .015) {
      ctx.globalAlpha = light.visibility * light.twinkle * .8;
      const reach = 5 + light.twinkle * 12;
      for (const angle of [0, Math.PI / 2]) {
        ctx.save();ctx.rotate(angle);
        const ray = ctx.createLinearGradient(-reach, 0, reach, 0);
        ray.addColorStop(0, 'rgba(255,255,255,0)');
        ray.addColorStop(.5, '#ffffff');ray.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = ray;ctx.lineWidth = .65;
        ctx.beginPath();ctx.moveTo(-reach, 0);ctx.lineTo(reach, 0);ctx.stroke();ctx.restore();
      }
    }
    ctx.globalAlpha = light.alpha;ctx.fillStyle = '#ffffff';
    ctx.beginPath();ctx.arc(0, 0, light.radius, 0, Math.PI * 2);ctx.fill();ctx.restore();
  }
  ctx.restore();
}

function drawSun(ctx, x, y, opacity, behindHorizon = false, eyeOpen = 0) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  if (behindHorizon) {
    ctx.beginPath(); ctx.rect(0, 0, width, horizonY); ctx.clip();
  }
  const sun = ctx.createLinearGradient(0, y - sunR, 0, y + sunR * 0.76);
  for (const [stop, color] of [[0, '#f8d379'], [.14, '#f5c454'], [.34, '#efac32'],
    [.58, '#eb8b2b'], [.8, '#dd602c'], [1, '#c84635']]) sun.addColorStop(stop, color);
  ctx.fillStyle = sun;
  ctx.beginPath(); ctx.arc(x, y, sunR, 0, Math.PI * 2); ctx.fill();
  // 入水时逐渐睁眼，此后保持平静的圆眼睛。
  if (eyeOpen > 0) {
    ctx.fillStyle = '#151515';
    const radius = Math.max(1.25, sunR * .085);
    for (const eyeX of [-.48, .18]) {
      ctx.beginPath();
      ctx.ellipse(x + eyeX * sunR, y - sunR * .24,
        radius, radius * eyeOpen, 0, 0, Math.PI * 2);
      ctx.fill();
    }

  }
  ctx.restore();
}

function drawAirplane(ctx, unit) {
  ctx.save(); ctx.scale(unit, unit);
  // 深灰蓝机身与轻微的机翼明暗，在暖色天空中保持清晰。
  ctx.fillStyle = '#505969';
  ctx.beginPath();
  ctx.moveTo(-1.5, -.04);ctx.lineTo(-1.68, -.64);
  ctx.lineTo(-1.48, -.61);ctx.lineTo(-1.13, -.15);
  ctx.lineTo(-.34, -.08);ctx.lineTo(-.65, -.44);
  ctx.lineTo(-.39, -.42);ctx.lineTo(.18, -.12);
  ctx.quadraticCurveTo(1.04, -.16, 1.4, .08);
  ctx.quadraticCurveTo(1.46, .25, .87, .26);
  ctx.lineTo(-.1, .22);ctx.lineTo(-.67, .52);
  ctx.lineTo(-.89, .5);ctx.lineTo(-.57, .19);
  ctx.lineTo(-1.5, .08);ctx.closePath();ctx.fill();
  ctx.fillStyle = '#687181';
  ctx.beginPath();ctx.moveTo(-.34, -.08);ctx.lineTo(-.65, -.44);
  ctx.lineTo(-.39, -.42);ctx.lineTo(.18, -.12);ctx.closePath();ctx.fill();
  ctx.fillStyle = '#3e4859';
  ctx.beginPath();ctx.moveTo(.22, .13);ctx.lineTo(-.67, .52);
  ctx.lineTo(-.89, .5);ctx.lineTo(-.57, .19);ctx.closePath();ctx.fill();
  ctx.fillStyle = '#303b4c';
  ctx.beginPath();ctx.moveTo(.63, -.1);ctx.lineTo(.89, -.035);
  ctx.lineTo(1.06, .055);ctx.lineTo(.77, .015);ctx.closePath();ctx.fill();
  ctx.restore();
}

// 从飞机经过的历史位置绘制尾流，旧段逐渐变宽、漂移和消散。
// 不累积帧缓存，循环、缩放与减少动态效果设置都能得到一致的画面。
function contrailSegments(time) {
  const t = Math.max(0, Math.min(time, SCENE_DURATION));
  const fade = 1 - smoothstep(59, 64, t);
  const segments = [];
  const start = Math.max(2, t - 12);
  const end = Math.min(t, 61);
  const step = 0.15;
  const scale = Math.max(.6, Math.min(1.5, height / 900));
  for (let emitted = start; emitted < end; emitted += step) {
    const next = Math.min(end, emitted + step);
    const a = flightAt(emitted), b = flightAt(next);
    // 飞机接太阳时暂停，避免在停留处堆出一团烟。
    if (Math.hypot(b.x - a.x, b.y - a.y) < .05) continue;
    const age = t - (emitted + next) * .5;
    const alpha = Math.pow(Math.max(0, 1 - age / 12), 1.6) * .34 * fade;
    if (alpha < .002) continue;
    const point = (state, sampleTime, side) => {
      const elapsed = t - sampleTime;
      const tailX = -state.unit * 1.35;
      const tailY = state.unit * (.08 + side * .14);
      return {
        x: state.x + tailX * Math.cos(state.pitch) - tailY * Math.sin(state.pitch) - elapsed * scale * .9,
        y: state.y + tailX * Math.sin(state.pitch) + tailY * Math.cos(state.pitch)
          + elapsed * scale * .35
          + Math.sin(sampleTime * .7 + side) * elapsed * scale * .1
      };
    };
    for (const side of [-1, 1]) {
      segments.push({a: point(a, emitted, side), b: point(b, next, side),
        alpha, width: (.75 + age * .23) * scale});
    }
  }
  return segments;
}

function drawContrail(ctx, time) {
  ctx.save();ctx.lineCap = 'round';
  for (const segment of contrailSegments(time)) {
    for (const [spread, opacity] of [[3, .15], [1, 1]]) {
      ctx.strokeStyle = rgba(255, 244, 225, segment.alpha * opacity);
      ctx.lineWidth = segment.width * spread;
      ctx.beginPath();ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);ctx.stroke();
    }
  }
  ctx.restore();
}

// 起初左右镜像；下拽时双手向下扣绳，恢复平稳后左手抬回、右手保持。
function sunHandAt(story, side) {
  const brace = smoothstep(24.5, 24.95, story.t);
  const recover = side < 0 ? 1 - smoothstep(26.2, 29.5, story.t) : 1;
  const change = brace * recover;
  return {
    x: side * sunR * 1.3,
    y: sunR * (-.055 + .26 * change),
    wristLift: sunR * (-.015 + .135 * change),
    rotation: side * (.35 - .7 * change)
  };
}

// 两条绳子直接连接机身与座板；握点使用相同的绳线位置。
function ropeAt(story, side, localY) {
  const mountX = side * story.unit * .75;
  const mountY = story.unit * .15;
  const anchorX = mountX * Math.cos(story.pitch) - mountY * Math.sin(story.pitch);
  const anchorY = mountX * Math.sin(story.pitch) + mountY * Math.cos(story.pitch) - story.unit * .65;
  const topX = anchorX * Math.cos(story.angle) + anchorY * Math.sin(story.angle);
  const topY = -anchorX * Math.sin(story.angle) + anchorY * Math.cos(story.angle);
  const bottomX = side * sunR * 1.42 * story.deploy;
  // 已醒来的太阳保持固定手势，松弛的绳索经过手掌，不再牵着手臂伸缩。
  const hand = sunHandAt(story, side);
  const handX = hand.x;
  const handY = hand.y;
  const c = Math.cos(story.angle), sn = Math.sin(story.angle);
  const dx = story.sunX + handX - story.x;
  const dy = story.sunY + handY - story.pivotY;
  const guideY = story.aboard ? story.length - sunR + handY : -dx * sn + dy * c;
  const straightX = topX + (bottomX - topX) * Math.max(0, Math.min(1, (guideY - topY) / (story.length - topY)));
  const targetX = story.aboard ? handX : dx * c + dy * sn;
  const guideX = straightX + (targetX - straightX) * (story.armOpacity || 0);
  const guide = {x: guideX, y: Math.max(topY + .001, Math.min(story.length - .001, guideY))};
  const a = localY < guide.y ? {x: topX, y: topY} : guide;
  const b = localY < guide.y ? guide : {x: bottomX, y: story.length};
  const fraction = Math.max(0, Math.min(1, (localY - a.y) / (b.y - a.y)));
  return {topX, topY, bottomX, guide, x: a.x + (b.x - a.x) * fraction};
}

function drawReelingRope(ctx, story, side) {
  const reeling = smoothstep(18.35, 18.65, story.t) * (1 - smoothstep(23.5, 24, story.t));
  if (reeling <= 0) return;
  ctx.save();
  ctx.strokeStyle = rgba(255, 242, 195, reeling * .8);
  ctx.lineWidth = Math.max(1.6, sunR * .045);
  const spacing = Math.max(18, height * .045);
  // 标记固定在绳子上，距座板不变；收绳时沿吊索向机身移动。
  for (let distance = spacing; distance < story.length; distance += spacing) {
    const y1 = story.length - distance;
    const y2 = Math.min(story.length, y1 + Math.max(3, sunR * .12));
    const a = ropeAt(story, side, y1), b = ropeAt(story, side, y2);
    ctx.beginPath();ctx.moveTo(a.x, y1);ctx.lineTo(b.x, y2);ctx.stroke();
  }
  ctx.restore();
}

function drawSwingSeat(ctx, y, radius, deploy) {
  const {left, right, depth, offset, thickness} = swingSeatGeometry(radius, deploy);
  ctx.save();
  ctx.strokeStyle = '#ffffff';ctx.lineWidth = Math.max(.85, radius * .025);
  ctx.lineJoin = 'round';
  // 斜向后延伸的板面与向下的前沿，组成一块薄座板。
  ctx.fillStyle = 'rgba(255,246,220,0.38)';
  ctx.beginPath();ctx.moveTo(left, y);ctx.lineTo(right, y);
  ctx.lineTo(right + offset, y - depth);ctx.lineTo(left + offset, y - depth);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle = 'rgba(223,210,188,0.65)';
  ctx.beginPath();ctx.moveTo(left, y);ctx.lineTo(right, y);
  ctx.lineTo(right, y + thickness);ctx.lineTo(left, y + thickness);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle = 'rgba(196,185,169,0.55)';
  ctx.beginPath();ctx.moveTo(right, y);ctx.lineTo(right + offset, y - depth);
  ctx.lineTo(right + offset, y - depth + thickness);ctx.lineTo(right, y + thickness);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.restore();
}

// 手臂以完整的抓绳姿态淡入，仅随绳索位置移动，不再旋转或切换姿态。
function drawSunArms(ctx, story) {
  if (story.armOpacity <= 0) return;
  const r = sunR;
  ctx.save();ctx.globalAlpha *= story.armOpacity;
  ctx.strokeStyle = '#151515';ctx.fillStyle = '#151515';
  ctx.lineWidth = Math.max(1.15, r * .065);ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const shoulderX = side * r * .94;
    const shoulderY = r * .055;
    const hand = sunHandAt(story, side);
    const handX = hand.x;
    const handY = hand.y;
    ctx.beginPath();ctx.moveTo(shoulderX, shoulderY);
    ctx.bezierCurveTo(shoulderX + (handX - shoulderX) * .45, shoulderY,
      handX - side * r * .05, handY - hand.wristLift,
      handX, handY);ctx.stroke();
    ctx.beginPath();ctx.ellipse(handX, handY, r * .077, r * .09,
      hand.rotation, 0, Math.PI * 2);ctx.fill();
  }
  ctx.restore();
}

function drawFlight(ctx, story) {
  if (!story.visible) return;
  const r = sunR;
  // 海面遮住水下的绳索和座板，收绳时从同一位置自然露出。
  ctx.save();
  ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();
  ctx.translate(story.x, story.pivotY);ctx.rotate(story.angle);
  ctx.strokeStyle = '#ffffff';ctx.lineWidth = Math.max(0.9, r * .024);ctx.lineCap = 'round';
  if (story.deploy > 0) {
    for (const side of [-1, 1]) {
      const rope = ropeAt(story, side, story.length);
      ctx.beginPath();ctx.moveTo(rope.topX, rope.topY);
      ctx.lineTo(rope.guide.x, rope.guide.y);ctx.lineTo(rope.bottomX, story.length);ctx.stroke();
      drawReelingRope(ctx, story, side);
    }
    drawSwingSeat(ctx, story.length, r, story.deploy);
  }
  ctx.restore();

  if (story.restOpacity > 0 && story.armOpacity > 0) {
    ctx.save();ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();
    ctx.translate(sunX, sunY);ctx.globalAlpha = story.restOpacity;
    drawSunArms(ctx, story);ctx.restore();
  }

  if (story.aboard) {
    ctx.save();
    // 座板、太阳与手脚接受同一海面遮挡，随收绳一起露出水面。
    ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();
    ctx.translate(story.sunX, story.sunY);ctx.rotate(story.angle * story.board);
    ctx.strokeStyle = '#151515';ctx.fillStyle = '#151515';
    ctx.lineWidth = Math.max(1.15, r * .065);ctx.lineCap = 'round';
    // 双腿始终保持完整长度；身体与海面遮住上端和水下部分，提起时自然显露。
    for (const side of [-1, 1]) {
      const sway = Math.sin(story.t * .75 + side * .2) * .012 * story.board;
      const hipX = r * (side < 0 ? -.32 : .36);
      const hipY = r * .68;
      const footX = hipX - r * (.2 + sway);
      const footY = hipY + r * (side < 0 ? .58 : .63);
      ctx.beginPath();ctx.moveTo(hipX, hipY);
      ctx.bezierCurveTo(hipX - r * .31, hipY,
        footX + r * .04, footY - r * .23, footX, footY);ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(footX - r * .025, footY, r * .09,
        r * .072, -.15, 0, Math.PI * 2);ctx.fill();
    }
    drawSun(ctx, 0, 0, 1, false, story.eyeOpen);
    drawSunArms(ctx, story);
    ctx.restore();
  }
  ctx.save();ctx.translate(story.x, story.y);ctx.rotate(story.pitch);drawAirplane(ctx, story.unit);ctx.restore();
}
