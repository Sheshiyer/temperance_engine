// Preserve the original authored score, then make the 30-second slower edit.
import {renameSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dir,'..');
const run=(args:string[])=>{const r=Bun.spawnSync(args,{cwd:root,stdout:'inherit',stderr:'inherit'});if(r.exitCode!==0)throw new Error('Audio preparation failed');};
run(['bun','scripts/soundtrack.ts']);
renameSync(join(root,'public/soundtrack.wav'),join(root,'public/soundtrack-reference-15s.wav'));
run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i','public/soundtrack-reference-15s.wav','-af','atempo=0.5,apad=whole_dur=30,atrim=duration=30,afade=t=out:st=29.5:d=0.5','-ar','48000','-ac','2','-c:a','pcm_s16le','public/soundtrack.wav']);
