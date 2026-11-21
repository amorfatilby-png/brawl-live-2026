export const PICK_SOURCE = 'https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026';
const API = 'https://liquipedia.net/brawlstars/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&titles=Brawl_Stars_World_Finals%2F2026&format=json&formatversion=2&smaxage=120&maxage=120';
const USER_AGENT = 'BrawlLive2026/1.0 (https://github.com/amorfatilby-png/brawl-live-2026/issues)';
export const PICK_INTERVAL_MS = 120000;

function scoredSet(fields) {
  return fields.winner !== 'skip' && ['0','1','2'].includes(fields.score1) &&
    ['0','1','2'].includes(fields.score2) && fields.score1 !== fields.score2 &&
    (fields.score1 === '2' || fields.score2 === '2');
}

function brawlerId(name) {
  const id = name.replace(/[^a-z0-9]/g,'');
  return id === 'll' ? 'larrylawrie' : id;
}

export function countBrawlerPicks(wikitext) {
  const text = wikitext.replaceAll('\r\n','\n').replace(/<!--[\s\S]*?-->/g,'');
  const start = text.indexOf('{{Stage|Group Stage}}');
  const playoffs = text.indexOf('{{Stage|Playoffs}}',start);
  if (start < 0 || playoffs < start) throw new Error('无法识别小组赛与淘汰赛');
  const end = text.indexOf('\n==References==',playoffs);
  const tournament = text.slice(start,end < 0 ? undefined : end);
  const matches = tournament.matchAll(/^[ \t]*\|R\d+M\d+\s*=\s*\{\{Match\b([\s\S]*?)^\}\}[ \t]*$/gm);
  const counts = new Map();
  let sets = 0, recordedSets = 0, recordedSeries = 0;
  for (const [,match] of matches) {
    let countedSeries = false;
    for (const [,map] of match.matchAll(/\|\s*map[1-7]\s*=\s*\{\{Map\b([^{}]*)\}\}/g)) {
      const fields = Object.fromEntries([...map.matchAll(/\|\s*(\w+)\s*=\s*([^|\n]*)/g)].map(([,key,value])=>[key,value.trim()]));
      if (!scoredSet(fields)) continue;
      recordedSets++;
      const picks = ['t1c1','t1c2','t1c3','t2c1','t2c2','t2c3'].map(key=>fields[key]?.toLowerCase());
      if (!picks.every(pick=>pick && /^[a-z0-9][a-z0-9& .'-]{0,31}$/.test(pick))) continue;
      sets++;
      countedSeries = true;
      for (const pick of new Set(picks.map(brawlerId))) counts.set(pick,(counts.get(pick)??0)+1);
    }
    if (countedSeries) recordedSeries++;
  }
  if (!sets) throw new Error('暂无完整的已完赛英雄阵容');
  const heroes = Array.from(counts,([id,picks])=>({id,picks})).sort((a,b)=>b.picks-a.picks||a.id.localeCompare(b.id));
  return {sets,recordedSets,recordedSeries,heroes};
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
  if (previous && revision.revid === previous.revision) return {...previous,checkedAt};
  const stats = countBrawlerPicks(revision.slots.main.content);
  if (previous && stats.sets < previous.sets) throw new Error('出场资料的完整阵容数量回退');
  return {...stats,revision:revision.revid,checkedAt,source:PICK_SOURCE,license:'https://creativecommons.org/licenses/by-sa/3.0/'};
}
