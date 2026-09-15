// p5.js 海面日落：暗色波谷、连续波峰与随波面朝向变化的碎金反射。
// 天空保留连续渐变，海面的反光与波纹使用同一组形状。
// 这是基于反射规律的视觉近似，不是完整的光线追踪或流体模拟。
let backdrop;
let horizonY, sunX, sunY, sunR;
let waterRows = [];
let motionPreference;

function setup() {
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  const surface = createCanvas(windowWidth, windowHeight);
  surface.elt.setAttribute('role', 'img');
  surface.elt.setAttribute('aria-label', '夕阳海面上，飞机放下秋千，太阳长出手脚握住绳子，坐着秋千向右飞去');
  frameRate(30);
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);
  buildScene();
  updatePlayback();
}

function updatePlayback() {
  if (document.hidden || motionPreference.matches) {
    noLoop();
    if (!document.hidden) redraw();
  } else {
    loop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildScene();
  if (motionPreference.matches) redraw();
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
  const t = motionPreference.matches ? 0 : millis() / 1000;
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
  drawContrail(ctx, t);
  drawFlight(ctx, story);
}


// 一轮 66 秒：缓慢靠近 → 放绳 → 接住太阳 → 摆动飞走 → 尾流消散、日落重新出现。
// 所有位置由时间直接计算，缩放窗口和暂停后不依赖之前的帧。
function flightAt(time) {
  const t = time % 66;
  const unit = Math.max(5, Math.min(16, sunR * 0.34));
  const approach = smoothstep(2, 14.5, t);
  const depart = smoothstep(28, 54, t);
  const board = smoothstep(20, 24, t);
  const grow = smoothstep(19.7, 22, t);
  const deploy = smoothstep(14, 20, t);
  const x = -unit * 3 + (sunX + unit * 3) * approach
    + (width + sunR * 2.5 - sunX) * depart;
  const y = height * 0.12 - height * 0.065 * depart;
  const pivotY = y + unit * 0.65;
  const seatY = horizonY - sunR * 0.1;
  const length = Math.max(unit * 0.25, (seatY - (height * 0.12 + unit * 0.65)) * deploy);
  const angle = Math.sin((t - 24) * 0.85) * 0.045 * smoothstep(24, 28, t);
  const riderX = x - Math.sin(angle) * (length - sunR);
  const riderY = pivotY + Math.cos(angle) * (length - sunR);
  const reset = smoothstep(61, 65, t);
  const aboard = t >= 20 && t < 58;
  return {t, unit, x, y, pivotY, length, angle, board, grow, deploy,
    eyeOpen: aboard ? smoothstep(20, 21.2, t) : 0,
    aboard, visible: t >= 2 && t < 58,
    restOpacity: t < 20 ? 1 : (t >= 58 ? reset : 0),
    sunX: aboard ? sunX + (riderX - sunX) * board : sunX,
    sunY: sunY + (riderY - sunY) * board,
    reflection: t < 20 ? 1 : (t < 58 ? 1 - depart : reset)
  };
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
  // 秋千降到位后才出现眼睛，由细缝舒展成圆点；新一轮恢复无眼睛的太阳。
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
  const t = time % 66;
  const fade = 1 - smoothstep(61, 66, t);
  const segments = [];
  const start = Math.max(2, t - 12);
  const end = Math.min(t, 57);
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
      return {
        x: state.x - state.unit * 1.35 - elapsed * scale * .9,
        y: state.y + state.unit * (.08 + side * .14)
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

// 两条绳子直接连接机身与座板；握点使用相同的绳线位置。
function ropeAt(story, side, localY) {
  const anchorX = side * story.unit * .75;
  const anchorY = -story.unit * .5;
  const topX = anchorX * Math.cos(story.angle) + anchorY * Math.sin(story.angle);
  const topY = -anchorX * Math.sin(story.angle) + anchorY * Math.cos(story.angle);
  const bottomX = side * sunR * 1.42 * story.deploy;
  const fraction = Math.max(0, Math.min(1, (localY - topY) / (story.length - topY)));
  return {topX, topY, bottomX, x: topX + (bottomX - topX) * fraction};
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

function drawFlight(ctx, story) {
  if (!story.visible) return;
  const r = sunR;
  // 只保留两条吊绳与座板，上端随飞机、下端随秋千摆动。
  ctx.save();ctx.translate(story.x, story.pivotY);ctx.rotate(story.angle);
  ctx.strokeStyle = '#ffffff';ctx.lineWidth = Math.max(0.9, r * .024);ctx.lineCap = 'round';
  const halfSeat = r * 1.42 * story.deploy;
  if (story.deploy > 0) {
    for (const side of [-1, 1]) {
      const rope = ropeAt(story, side, story.length);
      ctx.beginPath();ctx.moveTo(rope.topX, rope.topY);
      ctx.lineTo(rope.bottomX, story.length);ctx.stroke();
    }
    drawSwingSeat(ctx, halfSeat, story.length, r, story.deploy);
  }
  ctx.restore();

  if (story.aboard) {
    ctx.save();
    // 登上秋千时仍由海平线遮住太阳下沿，离开海面后自然露出全身。
    if (story.board < 1) {ctx.beginPath();ctx.rect(0, 0, width, horizonY);ctx.clip();}
    ctx.translate(story.sunX, story.sunY);ctx.rotate(story.angle * story.board);
    drawSun(ctx, 0, 0, 1, false, story.eyeOpen);
    ctx.strokeStyle = '#151515';ctx.fillStyle = '#151515';
    ctx.lineWidth = Math.max(1.15, r * .065);ctx.lineCap = 'round';
    const grow = story.grow;
    // 参考图的双腿从太阳下缘伸出，膝盖向左弯，脚掌是短小的圆头。
    for (const side of [-1, 1]) {
      const sway = Math.sin(story.t * .75 + side * .2) * .012 * story.board;
      const hipX = r * (side < 0 ? -.32 : .36);
      const hipY = r * .68;
      const footX = hipX - r * (.2 + sway) * grow;
      const footY = hipY + r * (side < 0 ? .58 : .63) * grow;
      ctx.beginPath();ctx.moveTo(hipX, hipY);
      ctx.bezierCurveTo(hipX - r * .31 * grow, hipY,
        footX + r * .04 * grow, footY - r * .23 * grow, footX, footY);ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(footX - r * .025 * grow, footY, r * .09 * grow,
        r * .072 * grow, -.15, 0, Math.PI * 2);ctx.fill();
    }
    // 左手稍抬起，右手向下勾；端点仍取自两条吊绳。
    for (const side of [-1, 1]) {
      const shoulderX = side * r * .93;
      const shoulderY = r * .055;
      const handY = shoulderY + r * (side < 0 ? -.11 : .15) * grow;
      const grip = ropeAt(story, side, story.length - r + handY);
      const handX = shoulderX + (grip.x - shoulderX) * grow;
      ctx.beginPath();ctx.moveTo(shoulderX, shoulderY);
      ctx.bezierCurveTo(shoulderX + (handX - shoulderX) * .45, shoulderY,
        handX - side * r * .05 * grow, handY - r * (side < 0 ? -.015 : .12) * grow,
        handX, handY);ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(handX, handY, r * .077 * grow, r * .09 * grow,
        side * .35, 0, Math.PI * 2);ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();ctx.translate(story.x, story.y);drawAirplane(ctx, story.unit);ctx.restore();
}
