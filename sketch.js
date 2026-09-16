// p5.js 海面日落：暗色波谷、连续波峰与随波面朝向变化的碎金反射。
// 天空保留连续渐变，海面的反光与波纹使用同一组形状。
// 这是基于反射规律的视觉近似，不是完整的光线追踪或流体模拟。
let backdrop;
let horizonY, sunX, sunY, sunR;
let pickupTime = 19;
let waterContacts = [];
let waterRows = [];
let skyStars = [];
let motionPreference;
const SCENE_DURATION = 70;
const playback = {time: 0, stamp: 0, playing: false, running: false};
let playButton, progressInput, timeOutput;
let draggingProgress = false, resumeAfterDrag = false;

function setup() {
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  const surface = createCanvas(windowWidth, windowHeight);
  surface.elt.setAttribute('role', 'img');
  surface.elt.setAttribute('aria-label', '夕阳海面上，飞机放下秋千，太阳长出手脚握住绳子，坐着秋千向右飞去，夜色渐深，星星逐渐显现');
  frameRate(30);
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', () => {
    playback.playing = !motionPreference.matches;
    updatePlayback();
  });
  setupPlaybackControls();
  playback.playing = !motionPreference.matches;
  document.addEventListener('visibilitychange', updatePlayback);
  buildScene();
  updatePlayback();
}

function sceneTime() {
  if (!playback.running) return playback.time;
  return (playback.time + Math.max(0, millis() - playback.stamp) / 1000) % SCENE_DURATION;
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
}

function setupPlaybackControls() {
  playButton = document.getElementById('play-toggle');
  progressInput = document.getElementById('play-progress');
  timeOutput = document.getElementById('play-time');
  playButton.disabled = false; progressInput.disabled = false;
  progressInput.max = SCENE_DURATION;
  playButton.addEventListener('click', () => {
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
    updatePlaybackControls();
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

function updatePlaybackControls() {
  if (!playButton) return;
  const t = sceneTime();
  const clockText = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  playButton.textContent = playback.playing ? '暂停' : '播放';
  playButton.setAttribute('aria-label', playback.playing ? '暂停动画' : '播放动画');
  if (!draggingProgress) progressInput.value = t;
  progressInput.style.setProperty('--progress', `${t / SCENE_DURATION * 100}%`);
  progressInput.setAttribute('aria-valuetext', `${clockText(t)}，共 ${clockText(SCENE_DURATION)}`);
  timeOutput.textContent = `${clockText(t)} / ${clockText(SCENE_DURATION)}`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
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

  // 天光在海面形成宽阔的暖色过渡，范围超出中央直接反光。
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizonY, width, height - horizonY);
  ctx.clip();
  ctx.translate(sunX, horizonY);
  const lightRadius = Math.max(width * 0.72, sunR * 3);
  ctx.scale(1, (height - horizonY) * 0.7 / lightRadius);
  const reflectedSky = ctx.createRadialGradient(0, 0, 0, 0, 0, lightRadius);
  reflectedSky.addColorStop(0, 'rgba(244,161,95,0.12)');
  reflectedSky.addColorStop(0.48, 'rgba(244,161,95,0.05)');
  reflectedSky.addColorStop(1, 'rgba(255,192,153,0)');
  ctx.fillStyle = reflectedSky;
  ctx.fillRect(-lightRadius, 0, lightRadius * 2, lightRadius);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, horizonY);
  ctx.clip();
  // 微弱暖光横向铺开，避免覆盖低空的灰紫暗层。
  const glowRadius = Math.max(width * 0.7, horizonY * 1.25);
  ctx.save();
  ctx.translate(sunX, horizonY);
  ctx.scale(1, horizonY * 0.62 / glowRadius);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
  glow.addColorStop(0, 'rgba(255,174,83,0.08)');
  glow.addColorStop(0.45, 'rgba(255,179,99,0.04)');
  glow.addColorStop(1, 'rgba(255,198,156,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius);
  ctx.restore();
  ctx.restore();

  // 参考 august-night-osmanthus 枫叶版：固定星位，只有少数星星错开闪烁。
  const starRandom = seededRandom(731029);
  skyStars = Array.from({length: 84}, (_, i) => ({
    x: (i % 12 + .12 + starRandom() * .76) / 12,
    y: (Math.floor(i / 12) + .15 + starRandom() * .7) / 7,
    seed: starRandom(), bright: i % 11 === 0,
    // 每一行错开闪烁列，避免与星位的十二列排列重合在最左侧。
    twinkling: i % 12 === (Math.floor(i / 12) * 5 + 2) % 12,
    warm: i % 3 === 0
  }));
  const next = seededRandom(860214);
  // 同一条波峰同时决定暗面、暖色天光和金色反射的位置。
  waterRows = Array.from({length: 100}, (_, i) => ({
    depth: Math.pow((i + 0.35) / 100, 1.7),
    phase: next() * Math.PI * 2,
    weight: 0.65 + next() * 0.7
  }));
}

function waveAt(x, row, time, scale) {
  const d = row.depth;
  const phase = x / (32 + d * 105) + row.phase;
  const swell = Math.sin(phase + time * 0.65) * 0.6
    + Math.sin(phase * 2.3 - time * 0.43 + d * 42) * 0.28
    + Math.sin(phase * 5.7 + time * 0.8) * 0.12;
  return {
    y: horizonY + d * (height - horizonY) + swell * (0.3 + d * 5) * scale,
    facing: Math.sin(phase * 1.4 + time * 0.7 + d * 65) * 0.55
      + Math.sin(phase * 4.1 - time * 0.55) * 0.3
      + Math.sin(phase * 9.3 + time * 0.9) * 0.15
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

function draw() {
  if (!backdrop) return;
  const t = Math.min(sceneTime(), SCENE_DURATION - .001);
  updatePlaybackControls();
  const ctx = drawingContext;
  const story = flightAt(t);
  const scale = Math.max(0.55, Math.min(1.5, height / 900));
  image(backdrop, 0, 0);
  drawSun(ctx, sunX, sunY, story.restOpacity, true, story.eyeOpen);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizonY, width, height - horizonY);
  ctx.clip();

  // 远处细密、近处舒展的波纹覆盖整个海面；倒影服从同一波峰的朝向。
  for (const row of waterRows) {
    const d = row.depth;
    const cell = Math.max(3, width / 180) * (0.6 + d * 1.8);
    const thickness = (0.65 + Math.pow(d, 1.2) * 5.5) * scale * row.weight;
    const spread = sunR * (0.58 + d * 0.95);
    const center = story.sunX + Math.sin(d * 17 - t * 0.45) * spread * d * 0.09;
    let left = waveAt(0, row, t, scale);
    for (let x = 0; x < width; x += cell) {
      const end = Math.min(width, x + cell);
      const right = waveAt(end, row, t, scale);
      const facing = (left.facing + right.facing) * 0.5;
      // 波谷在亮面下方，近处明暗分界更厚、更清楚。
      waterFacet(ctx, x, left.y + thickness * 0.45, end, right.y + thickness * 0.45,
        thickness, rgba(17, 30, 43, (0.12 + d * 0.22) * (0.75 - facing * 0.25)));
      waterFacet(ctx, x, left.y, end, right.y, thickness * 0.36,
        rgba(186, 135, 110, 0.07 + Math.max(0, facing) * 0.16));

      const across = ((x + end) * 0.5 - center) / spread;
      const coverage = Math.exp(-across * across * 2.1) * story.reflection;
      // 反光保留暗间隙，局部朝向合适的波峰才露出亮金色。
      const crest = smoothstep(-0.25, 0.8, facing);
      const reflection = coverage * (0.08 + crest * 0.83) * (1 - d * 0.2);
      if (reflection > 0.015) {
        waterFacet(ctx, x, left.y, end, right.y, thickness * (0.3 + crest * 0.38),
          rgba(246, Math.round(168 + crest * 44), Math.round(70 + crest * 53), reflection));
        const glint = smoothstep(0.55, 0.9, facing) * coverage;
        if (glint > 0.1) {
          waterFacet(ctx, x, left.y, end, right.y, Math.max(0.4, thickness * 0.16),
            rgba(255, 228, 160, glint * 0.78));
        }
      }
      left = right;
    }
  }
  ctx.restore();
  drawWaterContact(ctx, t);
  drawDusk(ctx, story.darkness);
  drawStars(ctx, t, story.darkness);
  drawContrail(ctx, t);
  drawFlight(ctx, story);
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

// 一轮 70 秒：秋千浅潜到太阳下方 → 收绳托起 → 负重爬升 → 夜色。
// 用随时间衰减的摆动近似绳索受风和负重后的反应，保持任意时刻可重绘。
function flightAt(time) {
  const t = time % SCENE_DURATION;
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
  const reset = smoothstep(65, 69, t);
  const darkness = (.18 * smoothstep(24, 32, t) + .82 * depart) * (1 - reset);
  return {t, unit, x, y, pitch, pivotY, length, angle, board, deploy, darkness,
    eyeOpen, armOpacity: awake,
    aboard, visible: t >= 2 && t < 62,
    restOpacity: t < pickupTime ? 1 : (t >= 62 ? reset : 0),
    sunX: aboard ? riderX : sunX,
    sunY: aboard ? riderY : sunY,
    reflection: t < pickupTime ? 1 : (t < 62 ? (1 - depart) * (1 - smoothstep(pickupTime, 26, t) * .45) : reset)
  };
}

// 以座板实际穿过水面的时刻触发水花，拖动进度也能重现同一组涟漪。
function findWaterContacts() {
  return [{start: 14, end: 18, entering: true}, {start: 18.35, end: 24, entering: false}].map(event => {
    let low = event.start, high = event.end;
    for (let i = 0; i < 36; i++) {
      const mid = (low + high) / 2;
      const s = flightAt(mid);
      const seatY = s.pivotY + Math.cos(s.angle) * s.length;
      if (event.entering ? seatY < horizonY : seatY > horizonY) low = mid;
      else high = mid;
    }
    const time = (low + high) / 2;
    const s = flightAt(time);
    return {time, entering: event.entering, x: s.x - Math.sin(s.angle) * s.length};
  });
}

function drawWaterContact(ctx, time) {
  const t = time % SCENE_DURATION;
  const r = sunR;
  ctx.save();ctx.lineCap = 'round';
  for (const event of waterContacts) {
    const age = t - event.time;
    if (age < 0 || age > 4.5) continue;
    // 扁平水环由接触点向两侧铺开，留在海面上。
    ctx.save();ctx.beginPath();ctx.rect(0, horizonY, width, height - horizonY);ctx.clip();
    for (let i = 0; i < 3; i++) {
      const u = (age - i * .24) / 3.5;
      if (u <= 0 || u >= 1) continue;
      const spread = r * (.95 + u * 3.5);
      ctx.strokeStyle = rgba(255, 216, 155, Math.sin(Math.PI * u) * (1 - u) * (event.entering ? .55 : .38));
      ctx.lineWidth = Math.max(.75, r * .027) * (1 - u * .4);
      ctx.beginPath();ctx.ellipse(event.x, horizonY + r * .035, spread,
        r * (.03 + u * .24), 0, 0, Math.PI * 2);ctx.stroke();
    }
    ctx.restore();
    if (event.entering) {
      // 入水的一瞬溅起短小水珠，随后落回水面。
      for (let i = 0; i < 10; i++) {
        const life = .55 + (i % 3) * .13;
        const u = age / life;
        if (u <= 0 || u >= 1) continue;
        const side = i % 2 ? -1 : 1;
        const x = event.x + side * r * (.5 + i * .075 + u * .32);
        const y = horizonY - Math.sin(Math.PI * u) * r * (.16 + (i % 4) * .075);
        ctx.fillStyle = rgba(255, 231, 187, Math.sin(Math.PI * u) * .7);
        ctx.beginPath();ctx.ellipse(x, y, Math.max(.7, r * .018), Math.max(1, r * .04), side * .25, 0, Math.PI * 2);ctx.fill();
      }
    } else {
      // 板边带出的水沿重力方向滴落，座板继续随吊绳上升。
      for (let i = 0; i < 10; i++) {
        const emitted = event.time + .12 + i * .14;
        const elapsed = t - emitted;
        if (elapsed <= 0 || elapsed > 1.1) continue;
        const s = flightAt(emitted);
        const edge = (i % 2 ? -1 : 1) * r * 1.23;
        const x = s.x + edge * Math.cos(s.angle) - s.length * Math.sin(s.angle);
        const y = s.pivotY + edge * Math.sin(s.angle) + s.length * Math.cos(s.angle) + height * .17 * elapsed * elapsed;
        if (y >= horizonY) continue;
        ctx.fillStyle = rgba(255, 233, 194, .6 * (1 - elapsed / 1.1));
        ctx.beginPath();ctx.ellipse(x, y, Math.max(.65, r * .016), Math.max(1.2, r * .045), 0, 0, Math.PI * 2);ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawDusk(ctx, darkness) {
  if (darkness <= 0) return;
  ctx.save();
  // 夜色覆盖天空和水纹，太阳本身与秋千在这层之后绘制。
  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, rgba(12, 20, 42, darkness * .9));
  shade.addColorStop(.76, rgba(29, 26, 43, darkness * .86));
  shade.addColorStop(.765, rgba(15, 24, 39, darkness * .86));
  shade.addColorStop(1, rgba(7, 16, 29, darkness * .93));
  ctx.fillStyle = shade;ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function skyStarAt(star, time, darkness) {
  // 暮色先显露微弱星点，亮星和光芒留到夜色更深时渐入。
  const visibility = smoothstep(star.bright ? .78 + star.seed * .06 : .34 + star.seed * .14,
    star.bright ? .98 : .82 + star.seed * .15, darkness);
  const sparkleVisibility = smoothstep(.84, 1, darkness);
  const period = 3.6 + star.seed * 2.4;
  const phase = ((time + star.seed * period) % period + period) % period;
  const twinkle = star.twinkling && !motionPreference.matches
    ? sparkleVisibility * smoothstep(0, .45, phase) * (1 - smoothstep(.45, 1.3, phase)) : 0;
  const restingAlpha = (star.bright ? .92 : .3 + star.seed * .25) * (star.twinkling ? .6 : 1);
  const restingRadius = star.bright ? 1.35 + star.seed * .45 : .55 + star.seed * .5;
  return {
    visibility, twinkle,
    alpha: visibility * (restingAlpha + (.98 - restingAlpha) * twinkle),
    radius: restingRadius + (2.2 + star.seed * .4 - restingRadius) * twinkle
  };
}

function drawStars(ctx, time, darkness) {
  if (darkness <= .34) return;
  const scale = Math.max(.65, Math.min(1.35, Math.min(width / 1100, height / 850)));
  ctx.save();ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();
  for (const star of skyStars) {
    const light = skyStarAt(star, time, darkness);
    if (light.alpha < .002) continue;
    const x = star.x * width;
    const y = (.04 + star.y * .86) * horizonY;
    ctx.save();ctx.translate(x, y);ctx.scale(scale, scale);
    // 从枫叶版的 drawGlint 沿用小光核与逐渐收细的横竖光芒。
    if (light.twinkle > .001) {
      ctx.save();ctx.globalAlpha = light.visibility * light.twinkle;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 4.5);
      halo.addColorStop(0, 'rgba(255,250,223,.8)');
      halo.addColorStop(.25, 'rgba(255,230,161,.22)');
      halo.addColorStop(1, 'rgba(255,219,133,0)');
      ctx.fillStyle = halo;ctx.beginPath();ctx.arc(0, 0, 4.5, 0, Math.PI * 2);ctx.fill();
      const reach = 22 * (.5 + .5 * light.twinkle);
      for (const angle of [0, Math.PI / 2]) {
        ctx.save();ctx.rotate(angle);
        const ray = ctx.createLinearGradient(-reach, 0, reach, 0);
        for (const [stop, color] of [[0,'rgba(255,220,110,0)'],[.4,'rgba(255,241,185,.65)'],
          [.5,'#fffdf0'],[.6,'rgba(255,241,185,.65)'],[1,'rgba(255,220,110,0)']]) ray.addColorStop(stop, color);
        ctx.strokeStyle = ray;ctx.lineWidth = .65;
        ctx.beginPath();ctx.moveTo(-reach, 0);ctx.lineTo(reach, 0);ctx.stroke();ctx.restore();
      }
      ctx.restore();
    }
    ctx.globalAlpha = light.alpha;
    ctx.fillStyle = star.warm ? '#fff0d1' : '#eef3ff';
    ctx.beginPath();ctx.arc(0, 0, light.radius, 0, Math.PI * 2);ctx.fill();
    ctx.restore();
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
  const t = time % SCENE_DURATION;
  const fade = 1 - smoothstep(65, 70, t);
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

function drawSwingSeat(ctx, halfWidth, y, radius, deploy) {
  const left = -halfWidth - radius * .06 * deploy;
  const right = halfWidth + radius * .06 * deploy;
  const depth = radius * .25 * deploy;
  const offset = radius * .16 * deploy;
  const thickness = radius * .07 * deploy;
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
  const halfSeat = r * 1.42 * story.deploy;
  if (story.deploy > 0) {
    for (const side of [-1, 1]) {
      const rope = ropeAt(story, side, story.length);
      ctx.beginPath();ctx.moveTo(rope.topX, rope.topY);
      ctx.lineTo(rope.guide.x, rope.guide.y);ctx.lineTo(rope.bottomX, story.length);ctx.stroke();
      drawReelingRope(ctx, story, side);
    }
    drawSwingSeat(ctx, halfSeat, story.length, r, story.deploy);
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
