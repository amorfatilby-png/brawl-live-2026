import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOfficialArchive } from './official-archive.mjs';
import { PICK_INTERVAL_MS, readBrawlerPicks } from './pick-stats.mjs';
import { OFFICIAL_MATCH_IDS, readSupercellFeed } from './supercell-feed.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(ROOT, 'public', 'index.html');
const PORT = Number(process.env.PORT || 3000);
const FEED_URL = process.env.FEED_URL || '';
const FEED_TOKEN = process.env.FEED_TOKEN || '';
const FEED_PROVIDER = process.env.FEED_PROVIDER || (FEED_URL ? 'json' : 'snapshot');
const defaultStateFile = FEED_PROVIDER === 'supercell' ? 'supercell-checkpoint.json' : 'state.json';
const FILE = process.env.STATE_FILE ? path.resolve(process.env.STATE_FILE) : path.join(ROOT, 'data', defaultStateFile);
if (!['snapshot','json','supercell'].includes(FEED_PROVIDER)) throw new Error('FEED_PROVIDER 必须是 snapshot / json / supercell');
if (FEED_PROVIDER === 'supercell' && FEED_URL) throw new Error('官方模式请移除 FEED_URL，避免数据源混淆');
if (FEED_PROVIDER === 'json' && !FEED_URL) throw new Error('JSON 模式需要 FEED_URL');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const requestedInterval = Number(process.env.FEED_INTERVAL_MS || (FEED_PROVIDER === 'supercell' ? 120000 : 45000));
if (!Number.isFinite(requestedInterval) || requestedInterval > 2147483647) throw new Error('FEED_INTERVAL_MS 必须是有效的毫秒数');
const INTERVAL_MS = Math.max(FEED_PROVIDER === 'supercell' ? 120000 : 15000, requestedInterval);
const MATCH_IDS = new Set(OFFICIAL_MATCH_IDS);
const STATES = new Set(['scheduled','live','final']);
const feedConfigured = FEED_PROVIDER !== 'snapshot';
if (FEED_URL && !/^https:\/\//i.test(FEED_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(FEED_URL)) {
  throw new Error('FEED_URL 必须是 HTTPS（localhost 调试例外）');
}

let state = JSON.parse(await fs.readFile(FILE, 'utf8'));
let manualUpdated = state.note === '管理员手动更新';
let feedLastOk = null;
let feedError = null;
let feedInFlight = null;
let feedChangedAt = null;
let feedRetryAt = 0;
let officialResponseDates = null;
let officialAccepted = false;
let officialArchive = null;
let pickStats = JSON.parse(await fs.readFile(path.join(ROOT,'data','brawler-picks.json'),'utf8'));
let pickStatsStatus = 'snapshot';
let pickRetryAt = 0;
const feedStale = () => feedConfigured && (!feedLastOk || Date.now() - Date.parse(feedLastOk) > Math.max(300000, INTERVAL_MS * 3));

function validatePayload(body, {partial = false} = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON 应为对象');
  const matches = body.matches;
  if (!matches || typeof matches !== 'object' || Array.isArray(matches)) throw new Error('缺少 matches 对象');
  const result = {};
  for (const [id, raw] of Object.entries(matches)) {
    if (!MATCH_IDS.has(id)) throw new Error(`未知比赛 ID: ${id}`);
    if (!raw || !STATES.has(raw.status)) throw new Error(`${id}: 无效的 status`);
    if (raw.status === 'scheduled') {
      result[id] = { status: 'scheduled', score1: null, score2: null };
      continue;
    }
    const a = raw.score1, b = raw.score2;
    const max = id === 'GF' ? 4 : 3;
    if (![a,b].every(n => Number.isInteger(n) && n >= 0 && n <= max)) throw new Error(`${id}: 比分必须是 0～${max} 的整数`);
    if (raw.status === 'final' && Math.max(a,b) !== max) throw new Error(`${id}: 完赛必须有一方先达到 ${max} 分`);
    if (raw.status === 'final' && a === b) throw new Error(`${id}: 完赛不能平局`);
    result[id] = { status: raw.status, score1:a, score2:b };
  }
  const updatedAt = body.updatedAt ? new Date(body.updatedAt) : new Date();
  if (!Number.isFinite(updatedAt.getTime())) throw new Error('updatedAt 必须是有效 ISO 时间');
  return {matches: result, updatedAt: updatedAt.toISOString(), note: typeof body.note === 'string' ? body.note.slice(0,180) : ''};
}

async function refreshPickStats() {
  if (Date.now() < pickRetryAt) return;
  try {
    pickStats = await readBrawlerPicks(pickStats);
    pickStatsStatus = 'synced';
    pickRetryAt = 0;
  } catch (error) {
    pickStatsStatus = 'cached';
    pickRetryAt = Date.now() + (error.retryAfterMs ?? PICK_INTERVAL_MS);
    console.error('[picks]',error.message);
  }
}

async function refreshOfficialArchive() {
  try {
    const archive = await readOfficialArchive();
    if (!archive || (officialArchive && Date.parse(archive.updatedAt) <= Date.parse(officialArchive.updatedAt))) return;
    if (officialArchive && Object.keys(officialArchive.matches).some(id => !archive.matches[id])) throw new Error('完赛归档缺少已保存的结果');
    officialArchive = archive;
    const replaceCheckpoint = !officialAccepted && Date.parse(archive.updatedAt) >= Date.parse(state.updatedAt);
    for (const [id, match] of Object.entries(archive.matches)) {
      if (replaceCheckpoint || state.matches[id]?.status !== 'final') state.matches[id] = match;
    }
    if (replaceCheckpoint) {
      state.updatedAt = archive.updatedAt;
      state.note = 'Supercell 官方完赛归档';
    }
  } catch (error) {
    console.error('[archive]', error.message);
  }
}

async function refreshFeed() {
  if (!feedConfigured) return;
  if (feedInFlight) return feedInFlight;
  feedInFlight = (async () => {
    if (FEED_PROVIDER === 'supercell') await refreshOfficialArchive();
    if (Date.now() < feedRetryAt) return;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      if (FEED_PROVIDER === 'supercell') {
        const incoming = await readSupercellFeed();
        if (officialResponseDates && Object.keys(incoming.responseDates).some(k => incoming.responseDates[k] < officialResponseDates[k])) throw new Error('官方响应早于已接受的缓存，暂不覆盖');
        if (Object.entries(state.matches).some(([id,m]) => m.status === 'final' && incoming.matches[id]?.status !== 'final')) throw new Error('官方响应回退了已完赛场次，暂不覆盖');
        if (officialAccepted && JSON.stringify(incoming.matches) !== JSON.stringify(state.matches)) feedChangedAt = new Date().toISOString();
        state = {...state, updatedAt:null, matches:incoming.matches, note:'来源：Supercell 官方赛事网页；比分更新时间未提供'};
        officialResponseDates = incoming.responseDates;
        officialAccepted = true;
        manualUpdated = false;
        feedLastOk = new Date().toISOString();
        feedError = null;
        feedRetryAt = 0;
        return;
      }
      const headers = { 'Accept': 'application/json', 'User-Agent': 'BrawlWorldsScoreboard/1.0' };
      if (FEED_TOKEN) headers.Authorization = `Bearer ${FEED_TOKEN}`;
      const res = await fetch(FEED_URL, { headers, signal: abort.signal, cache:'no-store' });
      if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);
      const length = Number(res.headers.get('content-length') || 0);
      if (length > 100_000) throw new Error('上游数据过大');
      const body = await res.json();
      if (!body.updatedAt) throw new Error('上游缺少 updatedAt，无法判断数据新旧');
      const valid = validatePayload(body);
      if (!Object.keys(valid.matches).length) throw new Error('上游结果为空');
      if (Date.parse(valid.updatedAt) < Date.parse(state.updatedAt)) throw new Error('上游快照早于目前数据，暂不覆盖');
      // 保留已知比赛：上游可只推送变化的对局。
      state = {...state, ...valid, matches: {...state.matches, ...valid.matches}};
      feedLastOk = new Date().toISOString();
      feedError = null;
      manualUpdated = false;
    } catch (e) {
      feedError = String(e.message || e).slice(0,180);
      if (e.retryAfterMs) feedRetryAt = Date.now() + e.retryAfterMs;
      console.error('[feed]', feedError);
    } finally { clearTimeout(timeout); }
  })();
  try { await feedInFlight; } finally { feedInFlight = null; }
}

if (feedConfigured) {
  await refreshFeed();
  const timer = setInterval(refreshFeed, INTERVAL_MS);
  timer.unref();
}
if (FEED_PROVIDER === 'supercell') {
  void refreshPickStats();
  setInterval(refreshPickStats,PICK_INTERVAL_MS).unref();
}

function json(res, status, obj) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve,reject)=> {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20_000) { reject(new Error('请求内容过大')); req.destroy(); }
    });
    req.on('end', () => {try {resolve(JSON.parse(body));} catch {reject(new Error('请求必须是合法 JSON'));}});
    req.on('error', reject);
  });
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res,200,{ok:true,feedConfigured,feedProvider:FEED_PROVIDER,feedLastOk,feedError,feedStale:feedStale(),feedRetryAt:feedRetryAt ? new Date(feedRetryAt).toISOString() : null});
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res,200,{
        ...state,
        mode: feedConfigured ? 'feed' : manualUpdated ? 'manual' : 'snapshot',
        feedConfigured,
        feedLastOk,
        feedError,
        feedProvider:FEED_PROVIDER,
        feedStale:feedStale(),
        feedChangedAt,
        archiveSavedAt:officialArchive?.updatedAt ?? null,
        archivedFinals:officialArchive ? Object.keys(officialArchive.matches).length : 0,
        pickStats: {...pickStats,status:pickStatsStatus},
        sourceUpdatedAt:FEED_PROVIDER === 'supercell' ? null : state.updatedAt,
        sourceUrl:FEED_PROVIDER === 'supercell' ? 'https://event.supercell.com/brawlstars/en/live' : null,
        feedRetryAt:feedRetryAt ? new Date(feedRetryAt).toISOString() : null,
        serverTime: new Date().toISOString(),
        refreshIntervalSeconds: Math.round(INTERVAL_MS / 1000)
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/update') {
      if (FEED_PROVIDER === 'supercell') return json(res,409,{error:'官方同步模式不接受人工改分，请切换数据源后操作'});
      if (!ADMIN_KEY) return json(res,403,{error:'未启用人工更新：请设置 ADMIN_KEY'});
      if (req.headers.authorization !== `Bearer ${ADMIN_KEY}`) return json(res,401,{error:'管理员密钥不正确'});
      const incoming = validatePayload(await readBody(req),{partial:true});
      state = {...state, ...incoming, note:'管理员手动更新', matches:{...state.matches, ...incoming.matches}};
      manualUpdated = true;
      await fs.writeFile(FILE, JSON.stringify({updatedAt:state.updatedAt,matches:state.matches,note:'管理员手动更新'},null,2)+'\n','utf8');
      return json(res,200,{ok:true,updatedAt:state.updatedAt});
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});
      res.end(await fs.readFile(INDEX));
      return;
    }
    return json(res,404,{error:'Not found'});
  } catch (e) {
    const status = /无效|未知|比分|必须|缺少|平局|请求|updatedAt|完赛/.test(String(e.message)) ? 400 : 500;
    json(res,status,{error: e.message || '服务器错误'});
  }
});
server.listen(PORT, '0.0.0.0',()=>console.log(`BRAWL // LIVE 运行于 http://localhost:${PORT}`));
