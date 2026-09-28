const fs=require('fs'),vm=require('vm'),path=require('path'),{spawn,spawnSync}=require('child_process');
const {createCanvas}=require('/Users/wisewong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const root=path.resolve(__dirname,'../..'); const {continuousSoundAt,createEffectSamples,SCENE_AUDIO_LEVELS:L}=require(root+'/sound.js');
const W=960,H=1280,S=3,FPS=30,D=28,R=1.5,SR=48000;
const canvas=createCanvas(W*S,H*S),ctx=canvas.getContext('2d');ctx.scale(S,S);
const c=vm.createContext({width:W,height:H,drawingContext:ctx,window:{devicePixelRatio:S},document:{body:{dataset:{aspect:'3:4'}},createElement:()=>createCanvas(1,1)},SceneSound:class{setEvents(){}update(){}},pixelDensity:()=>S,millis:()=>0,noLoop(){},image:(g,x,y)=>ctx.drawImage(g.canvas,x,y,W,H),createGraphics:(w,h)=>{const a=createCanvas(w*S,h*S),b=a.getContext('2d');b.scale(S,S);return{width:w,height:h,canvas:a,drawingContext:b,pixelDensity(){}}}});
vm.runInContext(fs.readFileSync(root+'/sketch.js','utf8'),c);vm.runInContext("sceneStyle='warm';palette=SCENE_STYLES.warm;motionPreference={matches:false};playback.rate=1.5;buildScene()",c);
function run(s){return vm.runInContext(s,c)}
const events=run('soundEvents');
function audio(){
 const r=spawnSync('ffmpeg',['-v','error','-i',root+'/audio/ocean-waves.mp3','-af','atempo=1.5','-t','28','-ar','48000','-ac','2','-f','f32le','pipe:1'],{maxBuffer:32e6});if(r.status)throw Error(r.stderr.toString());
 const data=new Float32Array(D*SR*2),sea=new Float32Array(r.stdout.buffer,r.stdout.byteOffset,r.stdout.length/4);for(let i=0;i<data.length;i++)data[i]=(sea[i]||0)*L.sea;
 let phase=0,wp=0,seed=75391,low=0,wind=0,rope=0,engine=0;let mix,story;
 const p={engine:0,harmonic:0,wind:0,rope:0,winch:0,engineFrequency:78,winchFrequency:170,engineCutoff:320,pan:0};
 for(let i=0;i<D*SR;i++){
  if(i%480===0){c.ts=i/SR*R;const frame=run('soundFrame(ts)');story=frame.story;mix=continuousSoundAt(frame)}
  for(const k of Object.keys(p)){const target=k==='pan'?Math.max(-1,Math.min(1,story.x/W*2-1)):mix[k];const tau=/Frequency|Cutoff/.test(k)?.12:.06;p[k]+=(target-p[k])*(1-Math.exp(-1/(SR*tau)))}
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/4294967296*2-1;low=low*.97+white*.03;const noise=low*2.8+white*.12;
  wind+=(noise-wind)*(1-Math.exp(-2*Math.PI*380/SR));rope+=(noise-rope)*(1-Math.exp(-2*Math.PI*1300/SR));
  phase+=p.engineFrequency/SR;wp+=p.winchFrequency/SR;
  const tri=x=>2/Math.PI*Math.asin(Math.sin(2*Math.PI*x));
  const eng=tri(phase)*p.engine+Math.sin(4*Math.PI*phase)*p.harmonic;
  engine+=(eng-engine)*(1-Math.exp(-2*Math.PI*p.engineCutoff/SR));
  const a=engine+wind*p.wind,b=rope*p.rope+tri(wp)*p.winch;
  for(let ch=0;ch<2;ch++){const pan=(v)=>ch?Math.sin((v+1)*Math.PI/4):Math.cos((v+1)*Math.PI/4);data[i*2+ch]+=L.master*(a*pan(p.pan)+b*pan(p.pan*.8))}
 }
 for(const e of events){const start=Math.round(e.time/R*SR);if(start>=D*SR)continue;const buf=createEffectSamples(e.type,SR,e.note||0),pan=Math.max(-.8,Math.min(.8,e.x/W*2-1));for(let j=0;j<buf.length&&start+j<D*SR;j++)for(let ch=0;ch<2;ch++)data[(start+j)*2+ch]+=buf[j]*L[e.type]*e.strength*L.master*(ch?Math.sin((pan+1)*Math.PI/4):Math.cos((pan+1)*Math.PI/4))}
 let peak=0;for(let i=0;i<D*SR;i++){const t=i/SR;const u=Math.min(1,t*R/.5),fade=u*u*(3-2*u)*Math.min(1,(D-t)/.03);for(let ch=0;ch<2;ch++){data[i*2+ch]*=fade;peak=Math.max(peak,Math.abs(data[i*2+ch]))}}
 fs.writeFileSync(__dirname+'/audio.f32',Buffer.from(data.buffer));console.log('audio peak dB',20*Math.log10(peak));
}
async function main(){audio();const ff=spawn('ffmpeg',['-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','2880x3840','-r','30','-i','pipe:0','-f','f32le','-ar','48000','-ac','2','-i',__dirname+'/audio.f32','-t','28','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart',__dirname+'/夕阳-暖色-3比4-4K-1.5倍-28秒.mp4'],{stdio:['pipe','inherit','inherit']});const done=new Promise((resolve,reject)=>ff.on('exit',code=>code?reject(Error('ffmpeg '+code)):resolve()));for(let i=0;i<D*FPS;i++){run(`playback.time=${i/FPS*R};draw()`);if([0,300,600].includes(i))fs.writeFileSync(__dirname+`/frame-${i}.png`,canvas.toBuffer('image/png'));if(!ff.stdin.write(canvas.data()))await new Promise(r=>ff.stdin.once('drain',r));if(i%60===0)console.log('frames',i,'/',D*FPS)}ff.stdin.end();await done;fs.unlinkSync(__dirname+'/audio.f32');console.log('DONE')}
main().catch(e=>{console.error(e);process.exit(1)});
