export const PICK_SOURCE = 'https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026';
const API = 'https://liquipedia.net/brawlstars/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&titles=Brawl_Stars_World_Finals%2F2026&format=json&formatversion=2&smaxage=60&maxage=60';
const USER_AGENT = 'BrawlLive2026/1.0 (https://github.com/amorfatilby-png/brawl-live-2026/issues)';
export const PICK_INTERVAL_MS = 60000;
const MODES = new Map([
  ['Gem Grab','宝石争霸'],['Brawl Ball','乱斗足球'],['Heist','金库攻防'],
  ['Bounty','赏金猎人'],['Hot Zone','热区争夺'],['Knockout','极限淘汰'],
]);
const GROUP_MATCHES = {R1M1:'1',R1M2:'2',R2M1:'W',R1M3:'E',R2M2:'D'};
const PLAYOFF_MATCHES = {
  R1M1:'UQ1',R1M2:'UQ2',R1M3:'UQ3',R1M4:'UQ4',R1M5:'L1A',R1M6:'L1B',
  R2M1:'US1',R2M2:'US2',R2M3:'LQ1',R2M4:'LQ2',R3M1:'LS',R4M1:'UF',R4M2:'LF',R5M1:'GF',
};
const COUNTER_TEAMS = new Map([
  ['futesports','FUT Esports'],['navi','NAVI'],['natusvincere','NAVI'],['bountyhunters','Bounty Hunters'],
  ['bountyhuntersallu','Bounty Hunters'],['hmble','HMBLE'],['zetadivision','ZETA DIVISION'],
  ['totem','Totem Esports'],['replytotem','Totem Esports'],['totemesports','Totem Esports'],
  ['tribe','Tribe'],['tribegaming','Tribe'],['teamelektros','Team Elektros'],
  ['heretics','Team Heretics'],['teamheretics','Team Heretics'],['redcanids','RED Canids'],
  ['redcanidskalunga','RED Canids'],['crazyraccoon','Crazy Raccoon'],['novo','NOVO Esports'],['novoesports','NOVO Esports'],
]);

function counterTeam(name) {
  return COUNTER_TEAMS.get(name.toLowerCase().replace(/[^a-z0-9]/g,''));
}

function scoredSet(fields) {
  return fields.winner !== 'skip' && ['0','1','2'].includes(fields.score1) &&
    ['0','1','2'].includes(fields.score2) && fields.score1 !== fields.score2 &&
    (fields.score1 === '2' || fields.score2 === '2');
}

function brawlerId(name) {
  const id = name.replace(/[^a-z0-9]/g,'');
  return id === 'll' ? 'larrylawrie' : id;
}

function newBucket() {
  return {sets:0,recordedSets:0,recordedSeries:0,counts:new Map()};
}

function addLineup(bucket, ids, teams, winningSide) {
  bucket.sets++;
  for (const id of new Set(ids)) {
    let hero = bucket.counts.get(id);
    if (!hero) {
      hero = {id,picks:0,teamPicks:0,wins:0};
      bucket.counts.set(id,hero);
    }
    hero.picks++;
    hero.teamPicks += Number(teams[0].has(id)) + Number(teams[1].has(id));
    if (teams[winningSide].has(id)) hero.wins++;
  }
}

function summarizeBucket({counts,...coverage}) {
  const heroes=Array.from(counts.values()).sort((a,b)=>b.picks-a.picks||a.id.localeCompare(b.id));
  return {...coverage,heroes};
}

export function countBrawlerPicks(wikitext) {
  const text = wikitext.replaceAll('\r\n','\n').replace(/<!--[\s\S]*?-->/g,'');
  const start = text.indexOf('{{Stage|Group Stage}}');
  const playoffs = text.indexOf('{{Stage|Playoffs}}',start);
  if (start < 0 || playoffs < start) throw new Error('无法识别小组赛与淘汰赛');
  const end = text.indexOf('\n==References==',playoffs);
  const tournament = text.slice(start,end < 0 ? undefined : end);
  const groupB = tournament.indexOf('====Group B====');
  const matches = tournament.matchAll(/^[ \t]*\|(R\d+M\d+)\s*=\s*\{\{Match\b([\s\S]*?)^\}\}[ \t]*$/gm);
  const overall = newBucket();
  const byMode = new Map();
  const mvps = new Map();
  const setsByMatch = {};
  const seriesByMatch = {};
  const counterByMatch = {};
  for (const entry of matches) {
    const [,slot,match] = entry;
    const groupSlot = GROUP_MATCHES[slot];
    const matchId = entry.index>=playoffs-start ? PLAYOFF_MATCHES[slot] :
      groupB>=0 && groupSlot ? (entry.index<groupB?'A':'B')+groupSlot : null;
    const playedSets = [];
    const draftSets = new Map();
    const countedSeries = new Set();
    const setWins = [0,0];
    const opponents = [...match.matchAll(/^[ \t]*\|opponent[12]\s*=\s*\{\{TeamOpponent\|([^|{}\n]+)(?:\|[^{}\n]*)?\}\}/gm)].map(([,team])=>team.trim());
    const draftTeams = opponents.map(counterTeam);
    const validDraftTeams = draftTeams.length===2 && draftTeams.every(Boolean) && draftTeams[0]!==draftTeams[1];
    let openingAdvantageSlot = 0;
    let openingAdvantageSide = -1;
    for (const [,number,map] of match.matchAll(/\|\s*map([1-7])\s*=\s*\{\{Map\b([^{}]*)\}\}/g)) {
      const fields = Object.fromEntries([...map.matchAll(/\|\s*(\w+)\s*=\s*([^|\n]*)/g)].map(([,key,value])=>[key,value.trim()]));
      const complete = scoredSet(fields);
      if (matchId==='GF' && number==='1' && (fields.winner==='skip'||!fields.map)) {
        openingAdvantageSlot=1;
        const winner=counterTeam(fields.winner??'');
        if (winner) openingAdvantageSide=draftTeams.indexOf(winner);
      }
      const playedNumber = Number(number)-openingAdvantageSlot;
      const counter = fields.firstpick==='1' ? draftTeams[1] : fields.firstpick==='2' ? draftTeams[0] : null;
      if (validDraftTeams && fields.map && fields.winner!=='skip' && (counter||complete) &&
          playedNumber>=1 && playedNumber<=(matchId==='GF'?6:5)) {
        const winner = complete ? draftTeams[fields.score1==='2'?0:1] : null;
        draftSets.set(playedNumber,{number:playedNumber,map:fields.map,counter,winner});
      }
      if (!complete||playedNumber<1) continue;
      playedSets.push({number:playedNumber,map:fields.map||'',mode:fields.maptype||'',games:Number(fields.score1)+Number(fields.score2)});
      const winningSide = fields.score1 === '2' ? 0 : 1;
      setWins[winningSide]++;
      const mode = fields.maptype;
      if (mode && !byMode.has(mode)) byMode.set(mode,newBucket());
      const bucket = byMode.get(mode);
      overall.recordedSets++;
      if (bucket) bucket.recordedSets++;
      const picks = ['t1c1','t1c2','t1c3','t2c1','t2c2','t2c3'].map(key=>fields[key]?.toLowerCase());
      if (!picks.every(pick=>pick && /^[a-z0-9][a-z0-9& .'-]{0,31}$/.test(pick))) continue;
      const ids = picks.map(brawlerId);
      const teams = [new Set(ids.slice(0,3)),new Set(ids.slice(3))];
      if (teams.some(team=>team.size!==3)) continue;
      addLineup(overall,ids,teams,winningSide);
      countedSeries.add(overall);
      if (bucket) {
        addLineup(bucket,ids,teams,winningSide);
        countedSeries.add(bucket);
      }
    }
    if (matchId && playedSets.length) setsByMatch[matchId]=playedSets;
    if (matchId && draftSets.size) counterByMatch[matchId]={teams:draftTeams,sets:[...draftSets.values()]};
    const mvp = match.match(/\|\s*mvp\s*=\s*([a-z0-9][a-z0-9?_. -]{0,31})(?=[|\r\n])/i)?.[1].trim().toLowerCase();
    const bestOf = Number(match.match(/(?:^|\n)[ \t]*\|bestof=(\d+)\b/)?.[1] ?? 5);
    const clincher = Math.floor(bestOf/2)+1;
    const seriesScores = [...match.matchAll(/\|\s*opponent[12]\s*=\s*\{\{TeamOpponent\|[^{}\n]+?\|score=(\d+)\b/gi)].map(([,score])=>Number(score));
    const scores = seriesScores.length===2 ? seriesScores : setWins.map((wins,side)=>wins+Number(side===openingAdvantageSide));
    if (matchId && opponents.length===2 && playedSets.length &&
        playedSets.every((set,index)=>set.number===index+1)) {
      seriesByMatch[matchId]={teams:opponents,played:setWins,declared:seriesScores.length===2?seriesScores:null};
    }
    if (mvp && Math.max(...scores) === clincher && Math.min(...scores) < clincher) {
      mvps.set(mvp,(mvps.get(mvp)??0)+1);
    }
    for (const bucket of countedSeries) bucket.recordedSeries++;
  }
  if (!overall.sets) throw new Error('暂无完整的已完赛英雄阵容');
  const modeNames = new Set([...MODES.keys(),...byMode.keys()]);
  const modes = [...modeNames].map(mode=>({mode,label:MODES.get(mode)??mode,...summarizeBucket(byMode.get(mode)??newBucket())}));
  return {...summarizeBucket(overall),modes,mvps:Object.fromEntries(mvps),setsByMatch,seriesByMatch,counterByMatch};
}

function mergeCounterPicks(previous, current) {
  const result = {...previous};
  for (const [id,{teams,sets}] of Object.entries(current)) {
    const saved = previous?.[id];
    const sameTeams = saved?.teams.every(team=>teams.includes(team));
    const rows = new Map(sameTeams ? saved.sets.map(set=>[set.number,set]) : []);
    for (const set of sets) {
      const prior = rows.get(set.number);
      // Keep a draft verified from the broadcast when an upstream edit disagrees on the map or pick order.
      if (prior?.replay && (!set.winner||set.winner===prior.winner)) continue;
      const sameMap = prior?.map===set.map;
      rows.set(set.number,{
        ...set,counter:set.counter??(sameMap?prior.counter:null),winner:set.winner??(sameMap?prior.winner:null),
      });
    }
    const reported = new Set(sets.map(set=>set.number));
    result[id]={teams,sets:[...rows.values()].filter(set=>set.winner||reported.has(set.number)).sort((a,b)=>a.number-b.number)};
  }
  return result;
}

export async function readBrawlerPicks(previous, fetchImpl = fetch) {
  const response = await fetchImpl(API,{headers:{
    Accept:'application/json','Accept-Encoding':'gzip','User-Agent':USER_AGENT
  },signal:AbortSignal.timeout(10000)});
  if (!response.ok) {
    const error = new Error('Liquipedia 返回 HTTP '+response.status);
    const retry = response.headers.get('retry-after');
    const retryMs = /^\d+$/.test(retry ?? '') ? Number(retry)*1000 : Date.parse(retry)-Date.now();
    error.retryAfterMs = Math.max(response.status===403 ? 1800000 : 300000,Number.isFinite(retryMs) ? retryMs : 0);
    throw error;
  }
  const raw = await response.text();
  if (raw.length > 300000) throw new Error('出场资料响应过大');
  const page = JSON.parse(raw).query?.pages?.[0];
  const revision = page?.revisions?.[0];
  if (page?.title !== 'Brawl Stars World Finals/2026' || !Number.isInteger(revision?.revid) ||
      typeof revision.slots?.main?.content !== 'string') throw new Error('出场资料版本异常');
  if (previous && revision.revid < previous.revision) throw new Error('出场资料返回较早的版本');
  const checkedAt = new Date().toISOString();
  const hasWinStats = previous?.heroes.every(hero=>Number.isInteger(hero.teamPicks)&&Number.isInteger(hero.wins));
  if (hasWinStats && previous.modes?.length && previous.mvps && previous.setsByMatch && previous.seriesByMatch &&
      previous.counterByMatch && revision.revid === previous.revision) return {...previous,checkedAt};
  const stats = countBrawlerPicks(revision.slots.main.content);
  if (hasWinStats && stats.sets < previous.sets) throw new Error('出场资料的完整阵容数量回退');
  const counterByMatch = mergeCounterPicks(previous?.counterByMatch,stats.counterByMatch);
  return {...stats,counterByMatch,revision:revision.revid,checkedAt,source:PICK_SOURCE,license:'https://creativecommons.org/licenses/by-sa/3.0/'};
}
