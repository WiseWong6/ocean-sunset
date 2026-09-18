const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function scene(width = 1920, height = 1080, aspect = '') {
  const box = vm.createContext({width, height, SceneSound: class {},
    document: {body: {dataset: {aspect}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sketch.js'), 'utf8'), box);
  const read = code => vm.runInContext(code, box);
  read(`horizonY=Math.round(height*.76);sunR=Math.min(width*.038,height*.045);
    sunX=width*.5;sunY=horizonY-sunR*.76;pickupTime=findPickupTime();waterContacts=findWaterContacts()`);
  return {box, read};
}

for (const [width, height, aspect] of [[1920,1080,''], [375,500,'3:4']]) {
  test(`双手共同承重，握点和板边中心一致：${width}×${height}`, () => {
    const {read} = scene(width,height,aspect);
    const radius = read('sunR');
    const inward = time => [-1,1].map(side => read(`(() => {
      const s=flightAt(${time}), r=ropeAt(s,${side},s.length);
      const x=r.topX+(r.bottomX-r.topX)*(r.guide.y-r.topY)/(r.bottomY-r.topY);
      return ${side}*(x-r.guide.x)/sunR;
    })()`));
    const rest = inward(24), loaded = inward(25.6);
    assert.ok(rest.every(value=>value>.035), '平稳时两侧绳子都被手掌向内拉住');
    assert.ok(Math.abs(rest[0]-rest[1])<.003, '初始抓力不能只显示在一侧');
    assert.ok(loaded.every((value,i)=>value>rest[i]+.055), '负重时两只手都增加内收');
    assert.ok(Math.abs(loaded[0]-loaded[1])<.015, '负重时两侧受力相近');
    for (const time of [24,25.6,31]) {
      const [left,right] = [-1,1].map(side=>read(`sunHandAt(flightAt(${time}),${side})`));
      assert.ok(Math.abs(left.x+right.x)<1e-8);
      if (time<26) assert.ok(Math.abs(left.y-right.y)<1e-8);
      else assert.ok(left.y<right.y-radius*.2, '恢复左上右下');
    }
    const seat = read('swingSeatGeometry(sunR,1)');
    assert.ok(Math.abs(seat.left+seat.right+seat.offset)<1e-8, '板面中心不能偏右');
  });

  test(`下坠形变贴板、面积稳定、拖动无历史状态：${width}×${height}`, () => {
    const {read} = scene(width,height,aspect), r=read('sunR');
    const poses=[];
    for(let time=24;time<=30;time+=.025) {
      const story=read(`flightAt(${time})`), body=story.body;
      assert.ok(body.y>=.91-1e-8 && body.y<=1.06+1e-8);
      assert.ok(Math.abs(body.x*body.y-1)<1e-10);
      const bottom={x:story.sunX-Math.sin(story.angle)*r*body.y,
        y:story.sunY+Math.cos(story.angle)*r*body.y};
      const seat=read(`seatWorldPoint(flightAt(${time}),0,${story.length})`);
      assert.ok(Math.hypot(bottom.x-seat.x,bottom.y-seat.y)<1e-7,'圆盘底部始终被座板托住');
      for(const side of [-1,1]) {
        const hand=read(`sunHandAt(flightAt(${time}),${side})`);
        const rope=read(`ropeAt(flightAt(${time}),${side},${story.length})`);
        const world={x:story.sunX+hand.x*Math.cos(story.angle)-hand.y*Math.sin(story.angle),
          y:story.sunY+hand.x*Math.sin(story.angle)+hand.y*Math.cos(story.angle)};
        const grip={x:story.x+rope.guide.x*Math.cos(story.angle)-rope.guide.y*Math.sin(story.angle),
          y:story.pivotY+rope.guide.x*Math.sin(story.angle)+rope.guide.y*Math.cos(story.angle)};
        assert.ok(Math.hypot(world.x-grip.x,world.y-grip.y)<1e-7,'变形不能让手掌离绳');
      }
      poses.push([time,JSON.stringify(story)]);
    }
    assert.ok(read('sunDeformationAt(24.95).y')>1.055);
    assert.ok(read('sunDeformationAt(25.6).y')<.915);
    assert.ok(read('sunDeformationAt(26.65).y')>1.015);
    assert.equal(read('sunDeformationAt(28).y'),1);
    for(const [time,expected] of poses.reverse()) assert.equal(read(`JSON.stringify(flightAt(${time}))`),expected);
  });

  test(`手掌从入水淡入起就贴住绳索：${width}×${height}`, () => {
    const {read} = scene(width,height,aspect);
    const contact=read('waterContacts[0].time'),pickup=read('pickupTime');
    for(let t=contact+.005;t<pickup;t+=.02) for(const side of [-1,1]) {
      const s=read(`flightAt(${t})`),h=read(`sunHandAt(flightAt(${t}),${side})`);
      const rope=read(`ropeAt(flightAt(${t}),${side},${s.length})`);
      const x=s.x+rope.guide.x*Math.cos(s.angle)-rope.guide.y*Math.sin(s.angle);
      const y=s.pivotY+rope.guide.x*Math.sin(s.angle)+rope.guide.y*Math.cos(s.angle);
      assert.ok(Math.hypot(x-s.sunX-h.x,y-s.sunY-h.y)<1e-7, '手已可见时不能还与绳子分离');
    }
  });

  test(`入水前整根绳线连续，触水后随可见手掌逐渐收紧：${width}×${height}`, () => {
    const {read} = scene(width,height,aspect), radius=read('sunR');
    const contact=read('waterContacts[0].time');
    for(let time=14.1;time<=contact;time+=.015) for(const side of [-1,1]) {
      const s=read(`flightAt(${time})`), r=read(`ropeAt(flightAt(${time}),${side},0)`);
      assert.equal(s.ropeGrip,0,'手出现前不能提前把绳子拉出折角');
      const span=r.bottomY-r.topY;
      for(const u of [.1,.5,.85,.95,.99]) {
        const y=r.topY+span*u;
        const actual=read(`ropeAt(flightAt(${time}),${side},${y}).x`);
        const expected=r.topX+(r.bottomX-r.topX)*u+4*u*(1-u)*side*s.ropeSlack*span;
        assert.ok(Math.abs(actual-expected)<1e-8,'分段绘制仍须落在同一条连续柔弯上');
      }
      const step=Math.min(.0001,(r.guide.y-r.topY)/4,(r.bottomY-r.guide.y)/4);
      const left=read(`ropeAt(flightAt(${time}),${side},${r.guide.y-step}).x`);
      const right=read(`ropeAt(flightAt(${time}),${side},${r.guide.y+step}).x`);
      assert.ok(Math.abs((r.guide.x-left)/step-(right-r.guide.x)/step)<1e-5,
        '空绳不能在未来手掌高度留下转折');
    }
    for(const side of [-1,1]) {
      let previous;
      for(let time=contact-.02;time<=contact+.7;time+=1/120) {
        const s=read(`flightAt(${time})`),r=read(`ropeAt(flightAt(${time}),${side},0)`);
        assert.equal(s.ropeGrip,s.armOpacity,'握绳受力与手掌淡入同步');
        const world={x:s.x+r.guide.x*Math.cos(s.angle)-r.guide.y*Math.sin(s.angle),
          y:s.pivotY+r.guide.x*Math.sin(s.angle)+r.guide.y*Math.cos(s.angle)};
        if(previous) assert.ok(Math.hypot(world.x-previous.x,world.y-previous.y)<radius*.04,
          '触水到握稳之间不能突然跳到目标握点');
        previous=world;
      }
      const actual=read(`sunHandAt(flightAt(${contact+.7}),${side})`);
      const target=read(`sunHandPoseAt(flightAt(${contact+.7}),${side})`);
      assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<1e-7,'握稳后保留既定手势');
    }
  });

  test(`空秋千柔绳与板面滞后独立于载人动作：${width}×${height}`, () => {
    const {read} = scene(width,height,aspect);
    let maxTilt=0,maxSlack=0;
    for(let time=14;time<=24;time+=.1) {
      const s=read(`flightAt(${time})`);
      maxTilt=Math.max(maxTilt,Math.abs(s.seatTilt));maxSlack=Math.max(maxSlack,s.ropeSlack);
      assert.ok(Math.abs(s.seatTilt)<=Math.PI/36+1e-8);
      assert.ok(s.ropeSlack>=0 && s.ropeSlack<=.015+1e-8);
      if(time>18.35) {assert.equal(s.ropeSlack,0);assert.equal(Math.abs(s.seatTilt),0);}
      assert.equal(s.body.y,1,'空秋千下降不能让太阳提前负重变形');
    }
    assert.ok(maxTilt>Math.PI/90 && maxSlack>.012,'放绳时有可辨的柔弯和座板滞后');
    for(const side of [-1,1]) {
      const s=read('flightAt(15.5)'),r=read(`ropeAt(flightAt(15.5),${side},0)`);
      const points=[];
      read('traceRope')({beginPath(){},moveTo(x,y){points.push([x,y]);},
        quadraticCurveTo(cx,cy,x,y){points.push([cx,cy,x,y]);}},r);
      const midY=(r.topY+r.guide.y)/2, sample=read(`ropeAt(flightAt(15.5),${side},${midY})`);
      const [cx,cy,x,y]=points[1];
      assert.ok(Math.abs(sample.x-(r.topX+2*cx+x)/4)<1e-8,'绘制曲线与绳上位置采样一致');
      assert.ok(Math.abs(midY-(r.topY+2*cy+y)/4)<1e-8);
    }
  });
}
