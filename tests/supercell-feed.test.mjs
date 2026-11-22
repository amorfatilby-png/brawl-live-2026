import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeSupercell,readSupercellFeed,supplementSupercellMatches} from '../supercell-feed.mjs';

const bracket = JSON.parse(await fs.readFile(new URL('./fixtures/supercell-bracket.json',import.meta.url),'utf8'));
const state = JSON.parse(await fs.readFile(new URL('./fixtures/supercell-state.json',import.meta.url),'utf8'));
const copy = () => structuredClone(bracket);
const match = (data,id) => data[0].ranges.flatMap(r=>r.matches).find(m=>m.id===id);

test('supplements the stalled official score without changing official results or guessing teams',async()=>{
 const snapshot=JSON.parse(await fs.readFile(new URL('../data/supercell-checkpoint.json',import.meta.url),'utf8'));
 const official={...snapshot.matches,LQ1:{status:'live',score1:0,score2:0}};
 const backup={teams:['FUT Esports','Reply Totem'],played:[2,0],declared:null};
 assert.deepEqual(supplementSupercellMatches(official,{LQ1:backup}).LQ1,
   {status:'live',score1:0,score2:2,source:'liquipedia'});
 assert.equal(official.LQ1.score2,0);
 assert.deepEqual(supplementSupercellMatches(official,{LQ1:{...backup,teams:['FUT Esports','NAVI']}}).LQ1,official.LQ1);
 assert.deepEqual(supplementSupercellMatches(official,{LQ1:{...backup,declared:[3,0]}}).LQ1,official.LQ1);
 const finished={...official,LQ1:{status:'final',score1:1,score2:3}};
 assert.deepEqual(supplementSupercellMatches(finished,{LQ1:{...backup,played:[0,3]}}).LQ1,finished.LQ1);
 assert.deepEqual(supplementSupercellMatches(official,{LQ1:{...backup,played:[3,0],declared:[3,0]}}).LQ1,
   {status:'final',score1:0,score2:3,source:'liquipedia'});
});

test('captured official response maps all fourteen matches and preserves scheduled unknowns',()=>{
 const result=normalizeSupercell(copy(),state);
 assert.equal(Object.keys(result).length,14);
 assert.deepEqual(result.UQ1,{status:'final',score1:2,score2:3});
 assert.deepEqual(result.UQ3,{status:'final',score1:2,score2:3});
 assert.deepEqual(result.UQ4,{status:'final',score1:0,score2:3});
 assert.deepEqual(result.L1A,{status:'live',score1:0,score2:0});
 assert.deepEqual(result.L1B,{status:'scheduled',score1:null,score2:null});
 assert.equal(result.GF.status,'scheduled');
});

test('future finals resolve every side correctly, including grand final',()=>{
 const data=copy();
 // Explicit official-side results through the whole bracket, not website-side scores.
 const results={15:[[47,1],[15,3]],16:[[10,0],[8,3]],17:[[4,2],[5,3]],18:[[16,3],[2,1]],19:[[15,1],[2,3]],20:[[8,0],[4,3]],21:[[16,1],[5,3]],22:[[4,2],[2,3]],23:[[2,1],[16,3]],24:[[16,2],[5,4]]};
 for(const [id,sides] of Object.entries(results)){
  const m=match(data,Number(id));m.contestant=sides.map(([id,score])=>({id,score}));m.completed=true;m.winner=sides[0][1]>sides[1][1]?0:1;
 }
 const result=normalizeSupercell(data,{...state,eventState:3});
 const expected={L1A:[3,1],L1B:[3,0],US1:[3,2],US2:[1,3],LQ1:[3,1],LQ2:[3,0],UF:[3,1],LS:[3,2],LF:[3,1],GF:[4,2]};
 for(const [id,scores] of Object.entries(expected))assert.deepEqual(result[id],{status:'final',score1:scores[0],score2:scores[1]},id);
 const old={...result,GF:{status:'live',score1:0,score2:0}};
 const grandFinal={teams:['Natus Vincere','Team Elektros'],played:[1,2],declared:null};
 assert.deepEqual(supplementSupercellMatches(old,{GF:grandFinal}).GF,{status:'live',score1:2,score2:2,source:'liquipedia'});
 assert.deepEqual(supplementSupercellMatches(old,{GF:{...grandFinal,played:[3,2],declared:[4,2]}}).GF,
   {status:'final',score1:4,score2:2,source:'liquipedia'});
});

test('a preassigned grand-final advantage does not imply live play',()=>{
 const data=copy();match(data,24).contestant[1].score=1;
 assert.deepEqual(normalizeSupercell(data,state).GF,{status:'scheduled',score1:null,score2:null});
});

test('accepts a completed result while the official bracket still leaves future teams blank',()=>{
 const data=copy();
 const finished=match(data,15);
 finished.completed=true;
 finished.winner=1;
 finished.contestant[0].score=1;
 finished.contestant[1].score=3;
 const sourceState={...state,matchId:16,liveState:2};
 const result=normalizeSupercell(data,sourceState);
 assert.deepEqual(result.L1A,{status:'final',score1:3,score2:1});
 assert.deepEqual(result.LQ1,{status:'scheduled',score1:null,score2:null});
 match(data,19).contestant[0].id=47;
 assert.throws(()=>normalizeSupercell(data,sourceState),/LQ1: 官方双方队伍/);
});

test('rejects wrong event, maintenance, incomplete bracket, team mismatch and contradictory winner',()=>{
 assert.throws(()=>normalizeSupercell(bracket,{...state,currentEventId:'another-event'}));
 assert.throws(()=>normalizeSupercell(bracket,{...state,maintenance:true}));
 for(const mutate of [
  d=>d[0].ranges.pop(),
  d=>match(d,11).contestant[0].id=999,
  d=>match(d,11).winner=0,
  d=>match(d,15).populateFromMatches[0].matchId=13,
  d=>match(d,15).contestant[0].score=-1,
  d=>d[0].ranges[0].matches.push(match(d,11))
 ]){const data=copy();mutate(data);assert.throws(()=>normalizeSupercell(data,state));}
});

test('between broadcasts the identified finals bracket still supplies verified results',()=>{
 const data=copy();
 const results={15:[[47,1],[15,3]],16:[[10,1],[8,3]],17:[[4,1],[5,3]],18:[[2,1],[16,3]]};
 for(const [id,sides] of Object.entries(results)){
  const m=match(data,Number(id));m.contestant=sides.map(([id,score])=>({id,score}));m.completed=true;m.winner=1;
 }
 match(data,19).contestant=[{id:2,score:0},{id:15,score:0}];
 const standby={eventState:0,liveState:0};
 const result=normalizeSupercell(data,standby);
 assert.deepEqual(result.UQ4,{status:'final',score1:0,score2:3});
 assert.deepEqual(result.L1A,{status:'final',score1:3,score2:1});
 assert.deepEqual(result.US2,{status:'final',score1:1,score2:3});
 assert.deepEqual(result.LQ1,{status:'scheduled',score1:null,score2:null});
 assert.equal(Object.keys(result).length,14);
 assert.throws(()=>normalizeSupercell(bracket,{...standby,maintenance:true}));
 assert.throws(()=>normalizeSupercell([{...bracket[0],eventId:'other'}],standby),/未包含本届总决赛/);
});

test('HTTP reads keep source update time unknown and reject stale caches or bad JSON',async()=>{
 const now=Date.now();
 const fetchImpl=async url=>new Response(JSON.stringify(url.endsWith('/bracket')?bracket:state),{headers:{date:new Date(now).toUTCString(),age:'0'}});
 const result=await readSupercellFeed({fetchImpl,now});
 assert.equal(result.matches.L1A.status,'live');assert.equal(result.updatedAt,undefined);
 await assert.rejects(readSupercellFeed({now,fetchImpl:async()=>new Response('{}',{headers:{date:new Date(now-600000).toUTCString()}})}),/缓存/);
 await assert.rejects(readSupercellFeed({now,fetchImpl:async()=>new Response('{}',{headers:{date:new Date(now).toUTCString(),age:'900'}})}),/缓存/);
 await assert.rejects(readSupercellFeed({now,fetchImpl:async()=>new Response('<html>',{headers:{date:new Date(now).toUTCString()}})}));
});

test('429 honors Retry-After and stops before requesting the second resource',async()=>{
 let calls=0;const now=Date.now();
 await assert.rejects(readSupercellFeed({now,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'600'}})}}),e=>e.retryAfterMs===600000);
 assert.equal(calls,1);
 await assert.rejects(readSupercellFeed({now,fetchImpl:async()=>new Response('',{status:503,headers:{'retry-after':new Date(now+900000).toUTCString()}})}),e=>e.retryAfterMs>=899000);
});
