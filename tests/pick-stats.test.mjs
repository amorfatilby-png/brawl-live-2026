import test from 'node:test';
import assert from 'node:assert/strict';
import { countBrawlerPicks, readBrawlerPicks } from '../pick-stats.mjs';

const article = [
  '==={{Stage|Group Stage}}===',
  '====Group A====',
  '|R1M1={{Match',
  ' |map1={{Map|maptype=Brawl Ball|score1=2|score2=1|t1c1=8-bit|t1c2=ll|t1c3=lou|t2c1=chester|t2c2=ruffs|t2c3=surge|t1b1=colt}}',
  ' |map2={{Map|maptype=Brawl Ball|score1=2|score2=0|t1c1=gus}}',
  ' |map3={{Map|score1=1|score2=0|t1c1=gus|t1c2=8bit|t1c3=surge|t2c1=chuck|t2c2=hank|t2c3=piper}}',
  ' |map4={{Map|score1=2|score2=0|t1c1=gus|t1c2=gus|t1c3=ruffs|t2c1=otis|t2c2=chester|t2c3=surge}}',
  '}}',
  '====Group B====',
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
  assert.deepEqual(result.setsByMatch.A1.map(set=>[set.number,set.mode,set.games]),[[1,'Brawl Ball',3],[2,'Brawl Ball',2],[4,'',2]]);
  assert.deepEqual(result.setsByMatch.UQ1.map(set=>[set.number,set.mode,set.games]),[[1,'Heist',2]]);
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
  const withoutMaps = {...prior,setsByMatch:undefined};
  assert.deepEqual((await readBrawlerPicks(withoutMaps,revisionResponse(20))).setsByMatch,prior.setsByMatch);
  await assert.rejects(readBrawlerPicks(prior,revisionResponse(19)),/较早/);
  const partial = article.replace('t2c3=surge','t2c3=');
  await assert.rejects(readBrawlerPicks(prior,revisionResponse(21,partial)),/数量回退/);
  await assert.rejects(readBrawlerPicks(prior,async()=>new Response('',{status:429,headers:{'retry-after':'600'}})),
    error=>error.retryAfterMs===600000);
});

test('counts recorded series MVPs only after a verified final score',()=>{
  const withAwards=article
    .replace('|R1M1={{Match','|R1M1={{Match\n |caster1=Kenny|mvp=Guesti')
    .replace(' |map1={{Map|maptype=Heist',' |mvp=Nowy297\n |map1={{Map|maptype=Heist');
  assert.deepEqual(countBrawlerPicks(withAwards).mvps,{guesti:1});
  const grandFinal=[
    '|R5M1={{Match',' |bestof=7',
    ' |opponent1={{TeamOpponent|NAVI|score=4}}',' |opponent2={{TeamOpponent|HMBLE|score=2}}',
    ' |mvp=GeRo','}}',
  ].join('\n');
  assert.deepEqual(countBrawlerPicks(withAwards+'\n'+grandFinal).mvps,{guesti:1,gero:1});
});

test('tracks the counter side for completed and in-progress drafts, excluding the grand-final advantage',async()=>{
  const text=article
    .replace('|R1M1={{Match\n |map1={{Map|maptype=Brawl Ball',
      '|R1M1={{Match\n |opponent1={{TeamOpponent|HMBLE}}\n |opponent2={{TeamOpponent|Reply Totem}}\n |map1={{Map|map=Beach Ball|firstpick=2|maptype=Brawl Ball')
    .replace('|map2={{Map|maptype=Brawl Ball|score1=2',
      '|map2={{Map|map=Triple Dribble|firstpick=|maptype=Brawl Ball|score1=2')
    .replace('|map3={{Map|score1=1','|map3={{Map|map=Hideout|firstpick=1|score1=1');
  const final=[
    '|R5M1={{Match',' |bestof=7',
    ' |opponent1={{TeamOpponent|Natus Vincere|score=2}}',' |opponent2={{TeamOpponent|Team Elektros|score=0}}',
    ' |map1={{Map|winner=skip|score1=2|score2=0}}',
    ' |map2={{Map|map=Dry Season|firstpick=1|score1=2|score2=0}}',
    ' |map3={{Map|map=Safe Zone|firstpick=1|score1=|score2=}}',
    '}}',
  ].join('\n');
  const full=text+'\n'+final;
  const parsed=countBrawlerPicks(full);
  const preview=parsed.counterByMatch;
  assert.deepEqual(preview.A1,{teams:['HMBLE','Totem Esports'],sets:[
    {number:1,map:'Beach Ball',counter:'HMBLE',winner:'HMBLE'},
    {number:2,map:'Triple Dribble',counter:null,winner:'HMBLE'},
    {number:3,map:'Hideout',counter:'Totem Esports',winner:null},
  ]});
  assert.deepEqual(preview.GF.sets,[
    {number:1,map:'Dry Season',counter:'Team Elektros',winner:'NAVI'},
    {number:2,map:'Safe Zone',counter:'Team Elektros',winner:null},
  ]);
  assert.deepEqual(parsed.setsByMatch.GF,[{number:1,map:'Dry Season',mode:'',games:2}]);
  assert.deepEqual(parsed.seriesByMatch.GF,{
    teams:['Natus Vincere','Team Elektros'],played:[1,0],declared:[2,0],
  });
  const source=(revid,content)=>async()=>Response.json({query:{pages:[{
    title:'Brawl Stars World Finals/2026',revisions:[{revid,slots:{main:{content}}}],
  }]}});
  const prior=await readBrawlerPicks(null,source(20,full));
  const updated=await readBrawlerPicks(prior,source(21,full
    .replace('map=Beach Ball|firstpick=2','map=Beach Ball|firstpick=')
    .replace('map=Safe Zone|firstpick=1|score1=|score2=','map=Safe Zone|firstpick=|score1=1|score2=2')));
  assert.deepEqual(updated.counterByMatch.A1,prior.counterByMatch.A1);
  assert.deepEqual(updated.counterByMatch.GF.sets[1],{number:2,map:'Safe Zone',counter:'Team Elektros',winner:'Team Elektros'});
  const conflict=structuredClone(prior);
  const replaySet=conflict.counterByMatch.A1.sets[0];
  replaySet.replay='https://www.youtube.com/watch?v=example';
  const rechecked=await readBrawlerPicks(conflict,source(22,full.replace('map=Beach Ball|firstpick=2','map=Hideout|firstpick=1')));
  assert.deepEqual(rechecked.counterByMatch.A1.sets[0],replaySet);
});

test('accounts for the grand-final advantage in the MVP clincher without counting it as a played set',()=>{
  const final=[
    '|R5M1={{Match',' |bestof=7',' |mvp=Nowy297',
    ' |opponent1={{TeamOpponent|NAVI|score=}}',' |opponent2={{TeamOpponent|FUT Esports|score=}}',
    ' |map1={{Map|winner=navi}}',
    ' |map2={{Map|map=Dry Season|score1=2|score2=0}}',
    ' |map3={{Map|map=Safe Zone|score1=2|score2=0}}',
    ' |map4={{Map|map=Hard Rock Mine|score1=2|score2=1}}',
    '}}',
  ].join('\n');
  const result=countBrawlerPicks(article+'\n'+final);
  assert.deepEqual(result.setsByMatch.GF.map(set=>set.number),[1,2,3]);
  assert.deepEqual(result.seriesByMatch.GF,{teams:['NAVI','FUT Esports'],played:[3,0],declared:null});
  assert.deepEqual(result.mvps,{nowy297:1});
  assert.equal(countBrawlerPicks(article+'\n'+final.replace('score1=2|score2=1','score1=1|score2=1')).mvps.nowy297,undefined);
});
