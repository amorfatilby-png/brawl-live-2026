export const WORLD_FINALS_EVENT_ID = '6Yk1HZc0AIJdknCBGQZEI4';
const BASE = 'https://event.supercell.com/brawlstars/v1';
const IDS = ['UQ1','UQ2','UQ3','UQ4','L1A','L1B','US1','US2','LQ1','LQ2','UF','LS','LF','GF'];
// Slots follow public/index.html; the official bracket reverses sides after match 14.
const SLOTS = [
  [15,5], [47,4], [8,2], [10,16],
  [[11,'loser'],[12,'loser']], [[13,'loser'],[14,'loser']],
  [[11,'winner'],[12,'winner']], [[13,'winner'],[14,'winner']],
  [[18,'loser'],[15,'winner']], [[17,'loser'],[16,'winner']],
  [[17,'winner'],[18,'winner']], [[19,'winner'],[20,'winner']],
  [[21,'loser'],[22,'winner']], [[21,'winner'],[23,'winner']]
];

export function normalizeSupercell(brackets, globalState) {
  if (!Array.isArray(brackets)) throw new Error('官方对阵格式异常');
  const events = brackets.filter(e => e.eventId === WORLD_FINALS_EVENT_ID);
  if (events.length !== 1 || events[0].bracketType !== 'double_elimination') throw new Error('官方对阵未包含本届总决赛');
  if (globalState?.maintenance || globalState?.resetting || globalState?.currentEventId !== WORLD_FINALS_EVENT_ID || globalState?.currentApplication !== 'brawlstars') throw new Error('官方赛事切换或维护中');
  if (![0,1,2,3].includes(globalState.eventState) || !Array.isArray(events[0].ranges)) throw new Error('官方赛事状态异常');
  const source = new Map();
  for (const range of events[0].ranges) {
    if (!Array.isArray(range.matches)) throw new Error('官方场次缺失');
    for (const m of range.matches) {
      if (source.has(m.id)) throw new Error('官方场次重复');
      source.set(m.id, m);
    }
  }
  const matches = {}, resolved = new Map();
  for (let i = 0; i < IDS.length; i++) {
    const n = i + 11, id = IDS[i], m = source.get(n), max = id === 'GF' ? 4 : 3;
    if (!m || typeof m.completed !== 'boolean' || !Array.isArray(m.contestant) || m.contestant.length !== 2 || m.isSkipped || m.isForfeit) throw new Error(`${id}: 官方场次不完整或赛制异常`);
    const sides = n > 14 ? [...m.contestant].reverse() : m.contestant;
    const dependencies = n > 14 ? [...(m.populateFromMatches || [])].reverse() : m.populateFromMatches;
    const expectedTeams = SLOTS[i].map((slot, side) => {
      if (Number.isInteger(slot)) return slot;
      const [ref, result] = slot, dependency = dependencies?.[side];
      if (dependency?.matchId !== ref || dependency?.result !== result) throw new Error(`${id}: 官方晋级关系发生变化`);
      const previous = resolved.get(ref);
      if (!previous?.completed) return 0;
      return previous.teams[result === 'winner' ? previous.winner : 1 - previous.winner];
    });
    const scores = sides.map(s => s?.score);
    if (!scores.every(s => Number.isInteger(s) && s >= 0 && s <= max)) throw new Error(`${id}: 官方比分无效`);
    const winner = scores[0] > scores[1] ? 0 : 1;
    if (m.completed && (Math.max(...scores) !== max || scores[0] === scores[1] || m.winner !== (n > 14 ? 1 - winner : winner) || expectedTeams.includes(0))) throw new Error(`${id}: 官方完赛结果矛盾`);
    const current = globalState.eventState === 1 && globalState.matchId === n && Number.isInteger(globalState.liveState) && globalState.liveState >= 1 && globalState.liveState <= 8;
    if (current && expectedTeams.includes(0)) throw new Error(`${id}: 当前比赛队伍尚未确认`);
    // A scheduled grand final can carry a one-set advantage before play starts.
    const started = current || (id !== 'GF' && !expectedTeams.includes(0) && scores.some(s => s > 0));
    // The official bracket can leave future slots empty after a feeder match finishes.
    const awaitingTeams = !m.completed && !started;
    if (sides.some((s,j) => s?.id !== expectedTeams[j] && !(awaitingTeams && s?.id === 0))) throw new Error(`${id}: 官方双方队伍与网站对阵不符`);
    matches[id] = {status:m.completed ? 'final' : started ? 'live' : 'scheduled', score1:m.completed || started ? scores[0] : null, score2:m.completed || started ? scores[1] : null};
    resolved.set(n, {teams:expectedTeams, completed:m.completed, winner});
  }
  return matches;
}

async function requestJSON(name, fetchImpl, now) {
  const response = await fetchImpl(`${BASE}/${name}`, {headers:{Accept:'application/json','User-Agent':'BrawlWorldsScoreboard/1.0'}, signal:AbortSignal.timeout(12000)});
  if (!response.ok) {
    const error = new Error(`官方数据源返回 HTTP ${response.status}`);
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get('retry-after');
      const wait = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - now;
      error.retryAfterMs = Math.max(120000, Number.isFinite(wait) ? wait : 300000);
    }
    throw error;
  }
  const date = Date.parse(response.headers.get('date'));
  const age = Number(response.headers.get('age') || 0);
  // HTTP metadata describes the response cache, not when a score changed.
  if (!Number.isFinite(date) || !Number.isFinite(age) || age < 0 || age > 300 || now - date > 300000 || date - now > 60000) throw new Error('官方响应缓存过旧或缺少有效时间');
  const raw = await response.text();
  if (raw.length > 1000000) throw new Error('官方响应数据过大');
  return {body:JSON.parse(raw), date};
}

export async function readSupercellFeed({fetchImpl = fetch, now = Date.now()} = {}) {
  // Sequential reads stop immediately on rate limiting.
  const bracket = await requestJSON('bracket', fetchImpl, now);
  const state = await requestJSON('state', fetchImpl, now);
  return {matches:normalizeSupercell(bracket.body,state.body), responseDates:{bracket:bracket.date,state:state.date}};
}
