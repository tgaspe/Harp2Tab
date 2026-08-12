import { analyzeSpectral, spectralAlgorithm } from '../src/audio/algorithms/spectral';
import { MAX_CANDIDATES } from '../src/audio/segmenters/candidatesToNotes';
import { defaultParams } from '../src/audio/algorithms';
const SR = 44100;
const midiToHz = (m:number)=>440*Math.pow(2,(m-69)/12);
function synth(events:{midi:number,startMs:number,durationMs:number}[]) {
  const endMs = events.reduce((m,e)=>Math.max(m,e.startMs+e.durationMs),0)+100;
  const total = Math.ceil(endMs/1000*SR); const s = new Float32Array(total);
  for (const e of events) { const st=Math.floor(e.startMs/1000*SR), n=Math.floor(e.durationMs/1000*SR);
    const base=midiToHz(e.midi); const fade=Math.max(1,Math.min(Math.round(SR*0.008),Math.floor(n/4)));
    for (let k=1;k<=8;k++){ const p=k*Math.sqrt(1+8e-6*k*k); if(base*p>SR*0.45)break;
      const a=1/k; let ph=Math.random()*6.28;
      for(let i=0;i<n;i++){ const idx=st+i; if(idx>=total)break;
        const cents=4*Math.sin(2*Math.PI*5*i/SR); ph+=2*Math.PI*base*p*Math.pow(2,cents/1200)/SR;
        let g=a; if(i<fade)g*=i/fade; else if(i>n-fade)g*=(n-i)/fade; s[idx]+=g*Math.sin(ph);} } }
  let pk=0; for(let i=0;i<total;i++)pk=Math.max(pk,Math.abs(s[i]));
  for(let i=0;i<total;i++)s[i]=s[i]/pk*0.7;
  return { samples:s, sampleRate:SR, durationMs:endMs };
}
async function main(){
const cases: {name:string, ev:{midi:number,startMs:number,durationMs:number}[]}[] = [
  { name:'ladder 60/67/72/79/84', ev:[60,67,72,79,84].map((midi,i)=>({midi,startMs:i*550,durationMs:400})) },
  { name:'fifth 64+67',  ev:[{midi:64,startMs:100,durationMs:500},{midi:67,startMs:100,durationMs:500}] },
  { name:'triad 60/64/67', ev:[{midi:60,startMs:100,durationMs:500},{midi:64,startMs:100,durationMs:500},{midi:67,startMs:100,durationMs:500}] },
  { name:'octave 60+72', ev:[{midi:60,startMs:100,durationMs:500},{midi:72,startMs:100,durationMs:500}] },
];
for (const c of cases) {
  const audio = synth(c.ev);
  const prep = await spectralAlgorithm.prepare(audio);
  const seg = await spectralAlgorithm.resegment(prep, defaultParams(spectralAlgorithm));
  const notes = (seg.output as any).notes;
  console.log(`${c.name}\n  want ${c.ev.map(e=>`${e.midi}@${e.startMs}`).join(' ')}`);
  console.log(`  got  ${notes.map((n:any)=>`${n.midi}@${n.timeMs}+${n.durationMs}`).join(' ')}`);
  prep.dispose();
}
}
main();
