// Child-process preload: no external network requests during integration tests.
import fs from 'node:fs/promises';
const bracket=await fs.readFile(new URL('./fixtures/supercell-bracket.json',import.meta.url),'utf8');
const state=await fs.readFile(new URL('./fixtures/supercell-state.json',import.meta.url),'utf8');
const nativeFetch=globalThis.fetch,nativeInterval=globalThis.setInterval;
let bracketCalls=0;
globalThis.setInterval=(fn,ms,...args)=>nativeInterval(fn,ms===120000?60:ms,...args);
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://event.supercell.com/brawlstars/v1/'))return nativeFetch(url,options);
 const isBracket=String(url).endsWith('/bracket');
 if(isBracket)bracketCalls++;
 const scenario=process.env.TEST_OFFICIAL_SCENARIO;
 if(scenario==='failure'||(scenario==='rate-limit-after-success'&&bracketCalls>1))return new Response('',{status:429,headers:{'retry-after':'600'}});
 let body=isBracket?bracket:state;
 if(scenario==='rollback'&&isBracket&&bracketCalls>1){const d=JSON.parse(bracket),matches=d[0].ranges[1].matches;matches.find(m=>m.id===14).completed=false;for(const id of [16,18])matches.find(m=>m.id===id).contestant[0].id=0;body=JSON.stringify(d);}
 return new Response(body,{headers:{date:new Date().toUTCString(),age:'0'}});
};
