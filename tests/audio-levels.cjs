// 使用实际海浪解码和运行时相同的音效样本检查混音峰值，不代替浏览器试听。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {SceneSound, createEffectSamples} = require('../sound.js');
const sampleRate = 44100;
const decoded = spawnSync('ffmpeg', ['-v','error','-i',path.join(__dirname,'../audio/ocean-waves.mp3'),
  '-t','65','-ar',String(sampleRate),'-ac','2','-f','f32le','pipe:1'], {maxBuffer:32*1024*1024});
if (decoded.error) throw decoded.error;
assert.equal(decoded.status, 0, decoded.stderr.toString());
const sea = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.length / 4);
assert.ok(sea.length >= 65 * sampleRate * 2);
const db = value => 20 * Math.log10(Math.max(1e-12, value));
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
// 所有飞机分量的 RMS 上界相加，甚至不计低通滤波和远近衰减。
const planeUpperRms = .7 * (.007 / Math.sqrt(3) + .002 / Math.sqrt(2) + .01 * .37);
const seaRms = rms(sea) * .72;
assert.ok(db(seaRms / planeUpperRms) > 10, '海浪应明显高于飞机持续声');
const reports = [];
for (const [width,height,aspect] of [[1920,1080,''],[600,800,'3:4']]) {
  const box = vm.createContext({width,height,SceneSound,document:{body:{dataset:{aspect}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sketch.js'),'utf8'),box);
  vm.runInContext(`motionPreference={matches:false};horizonY=Math.round(height*.76);sunX=width*.5;
    sunR=Math.min(width*.038,height*.045);sunY=horizonY-sunR*.76;pickupTime=findPickupTime();
    waterContacts=findWaterContacts();waterDrops=makeWaterDrops();skyStars=makeSkyStars();`,box);
  const events=vm.runInContext('makeSoundEvents()',box);
  const mix = new Float32Array(sea.length);
  for(let i=0;i<sea.length;i++) mix[i]=sea[i]*.72;
  const levels={splash:.42,lift:.25,drop:.17,star:.085};
  for(const event of events) {
    const samples=createEffectSamples(event.type,sampleRate,event.note||0);
    const start=Math.round(event.time*sampleRate);
    const pan=Math.max(-.8,Math.min(.8,event.x/width*2-1));
    const gains=[Math.cos((pan+1)*Math.PI/4),Math.sin((pan+1)*Math.PI/4)];
    for(let i=0;i<samples.length && (start+i)*2+1<mix.length;i++) {
      const v=samples[i]*levels[event.type]*event.strength*.7;
      mix[(start+i)*2]+=v*gains[0];mix[(start+i)*2+1]+=v*gains[1];
    }
  }
  const peak=mix.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
  // 另预留飞机和收绳的最大振幅；这里没有把压缩器的削峰作用计入。
  const conservativePeak=peak+.7*(.007+.002+.01+.035);
  assert.ok(conservativePeak<.9, '混合音频应保留余量，不发生削波');
  reports.push({version:aspect||'全屏',seaRmsDb:db(seaRms).toFixed(1),
    seaAbovePlaneDb:db(seaRms/planeUpperRms).toFixed(1),mixPeakDb:db(peak).toFixed(1),
    conservativePeakDb:db(conservativePeak).toFixed(1),
    contacts:events.filter(e=>e.type==='splash'||e.type==='lift').map(e=>({type:e.type,time:+e.time.toFixed(2)})),
    drops:events.filter(e=>e.type==='drop').length,stars:events.filter(e=>e.type==='star').length,
    firstStar:events.find(e=>e.type==='star')?.time.toFixed(2)});
}
console.log(JSON.stringify(reports,null,2));
