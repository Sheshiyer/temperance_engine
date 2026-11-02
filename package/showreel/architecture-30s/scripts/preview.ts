import {join} from 'node:path';
const root=join(import.meta.dir,'..');
Bun.serve({hostname:'127.0.0.1',port:47333,async fetch(req){
 const u=new URL(req.url),rel=decodeURIComponent(u.pathname);
 if(rel.includes('..'))return new Response('bad path',{status:400});
 const f=Bun.file(join(root,rel==='/'?'reel.html':rel));
 return await f.exists()?new Response(f):new Response('not found',{status:404});
}});
console.log('Review preview http://127.0.0.1:47333/reel.html');
