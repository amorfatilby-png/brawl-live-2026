import test from 'node:test';
import assert from 'node:assert/strict';
import { countBrawlerPicks, readBrawlerPicks } from '../pick-stats.mjs';

const article = [
  '==={{Stage|Group Stage}}===',
  '|R1M1={{Match',
  ' |map1={{Map|maptype=Brawl Ball|score1=2|score2=1|t1c1=8-bit|t1c2=ll|t1c3=lou|t2c1=chester|t2c2=ruffs|t2c3=surge|t1b1=colt}}',
  ' |map2={{Map|maptype=Brawl Ball|score1=2|score2=0|t1c1=gus}}',
  ' |map3={{Map|score1=1|score2=0|t1c1=gus|t1c2=8bit|t1c3=surge|t2c1=chuck|t2c2=hank|t2c3=piper}}',
  ' |map4={{Map|score1=2|score2=0|t1c1=gus|t1c2=gus|t1c3=ruffs|t2c1=otis|t2c2=chester|t2c3=surge}}',
  '}}',
  '==={{Stage|Playoffs}}===',
  '|R1M1={{Match',
  ' |map1={{Map|maptype=Heist|score1=0|score2=2|t1c1=8bit|t1c2=larry & lawrie|t1c3=otis|t2c1=chester|t2c2=hank|t2c3=8-bit}}',
  ' |map2={{Map|winner=skip|score1=2|score2=0|t1c1=gus|t1c2=8bit|t1c3=surge|t2c1=chuck|t2c2=hank|t2c3=piper}}',
  '}}',
].join('\n');

test('counts heroes once per complete played set across both tournament stages',()=>{
  const result = countBrawlerPicks(article);
  assert.equal(result.sets,2);
  assert.equal(result.recordedSets,4);
  assert.equal(result.recordedSeries,2);
  assert.deepEqual(result.heroes.slice(0,3),[
    {id:'8bit',picks:2,teamPicks:3,wins:2},
    {id:'chester',picks:2,teamPicks:2,wins:1},
    {id:'larrylawrie',picks:2,teamPicks:2,wins:1},
  ]);
  assert.equal(result.heroes.some(hero=>['gus','colt','piper'].includes(hero.id)),false);
  const soccer=result.modes.find(mode=>mode.mode==='Brawl Ball');
  assert.equal(soccer.label,'乱斗足球');
  assert.equal(soccer.sets,1);
  assert.equal(soccer.recordedSets,2);
  assert.equal(soccer.recordedSeries,1);
  assert.deepEqual(soccer.heroes.find(hero=>hero.id==='8bit'),{id:'8bit',picks:1,teamPicks:1,wins:1});
  const heist=result.modes.find(mode=>mode.mode==='Heist');
  assert.deepEqual(heist.heroes.find(hero=>hero.id==='8bit'),{id:'8bit',picks:1,teamPicks:2,wins:1});
});

test('checks API identity, handles revisions and respects Retry-After',async()=>{
  const revisionResponse = (revid,content=article)=>async (_url,options)=>{
    assert.match(options.headers['User-Agent'],/BrawlLive2026/);
    assert.equal(options.headers['Accept-Encoding'],'gzip');
    return Response.json({query:{pages:[{title:'Brawl Stars World Finals/2026',revisions:[{revid,slots:{main:{content}}}]}]}});
  };
  const prior = await readBrawlerPicks(null,revisionResponse(20));
  const same = await readBrawlerPicks(prior,revisionResponse(20,'same revision'));
  assert.equal(same.sets,2);
  const oldFormat = {...prior,heroes:prior.heroes.map(({id,picks})=>({id,picks}))};
  const upgraded = await readBrawlerPicks(oldFormat,revisionResponse(20));
  assert.deepEqual(upgraded.heroes,prior.heroes);
  const ungrouped = {...prior,modes:undefined};
  assert.deepEqual((await readBrawlerPicks(ungrouped,revisionResponse(20))).modes,prior.modes);
  await assert.rejects(readBrawlerPicks(prior,revisionResponse(19)),/较早/);
  const partial = article.replace('t2c3=surge','t2c3=');
  await assert.rejects(readBrawlerPicks(prior,revisionResponse(21,partial)),/数量回退/);
  await assert.rejects(readBrawlerPicks(prior,async()=>new Response('',{status:429,headers:{'retry-after':'600'}})),
    error=>error.retryAfterMs===600000);
});
