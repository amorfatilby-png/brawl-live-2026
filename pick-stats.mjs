export const PICK_SOURCE = 'https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026';
const API = 'https://liquipedia.net/brawlstars/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&titles=Brawl_Stars_World_Finals%2F2026&format=json&formatversion=2&smaxage=120&maxage=120';
const USER_AGENT = 'BrawlLive2026/1.0 (https://github.com/amorfatilby-png/brawl-live-2026/issues)';
export const PICK_INTERVAL_MS = 120000;
const MODES = new Map([
  ['Gem Grab','宝石争霸'],['Brawl Ball','乱斗足球'],['Heist','金库攻防'],
  ['Bounty','赏金猎人'],['Hot Zone','热区争夺'],['Knockout','极限淘汰'],
]);

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
  const matches = tournament.matchAll(/^[ \t]*\|R\d+M\d+\s*=\s*\{\{Match\b([\s\S]*?)^\}\}[ \t]*$/gm);
  const overall = newBucket();
  const byMode = new Map();
  for (const [,match] of matches) {
    const countedSeries = new Set();
    for (const [,map] of match.matchAll(/\|\s*map[1-7]\s*=\s*\{\{Map\b([^{}]*)\}\}/g)) {
      const fields = Object.fromEntries([...map.matchAll(/\|\s*(\w+)\s*=\s*([^|\n]*)/g)].map(([,key,value])=>[key,value.trim()]));
      if (!scoredSet(fields)) continue;
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
      const winningSide = fields.score1 === '2' ? 0 : 1;
      addLineup(overall,ids,teams,winningSide);
      countedSeries.add(overall);
      if (bucket) {
        addLineup(bucket,ids,teams,winningSide);
        countedSeries.add(bucket);
      }
    }
    for (const bucket of countedSeries) bucket.recordedSeries++;
  }
  if (!overall.sets) throw new Error('暂无完整的已完赛英雄阵容');
  const modeNames = new Set([...MODES.keys(),...byMode.keys()]);
  const modes = [...modeNames].map(mode=>({mode,label:MODES.get(mode)??mode,...summarizeBucket(byMode.get(mode)??newBucket())}));
  return {...summarizeBucket(overall),modes};
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
  if (hasWinStats && previous.modes?.length && revision.revid === previous.revision) return {...previous,checkedAt};
  const stats = countBrawlerPicks(revision.slots.main.content);
  if (hasWinStats && stats.sets < previous.sets) throw new Error('出场资料的完整阵容数量回退');
  return {...stats,revision:revision.revid,checkedAt,source:PICK_SOURCE,license:'https://creativecommons.org/licenses/by-sa/3.0/'};
}
