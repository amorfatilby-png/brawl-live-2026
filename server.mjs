import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.STATE_FILE ? path.resolve(process.env.STATE_FILE) : path.join(ROOT, 'data', 'state.json');
const INDEX = path.join(ROOT, 'public', 'index.html');
const PORT = Number(process.env.PORT || 3000);
const FEED_URL = process.env.FEED_URL || '';
const FEED_TOKEN = process.env.FEED_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const INTERVAL_MS = Math.max(15000, Number(process.env.FEED_INTERVAL_MS || 45000));
const MATCH_IDS = new Set(['UQ1','UQ2','UQ3','UQ4','US1','US2','UF','GF','L1A','L1B','LQ1','LQ2','LS','LF']);
const STATES = new Set(['scheduled','live','final']);
const feedConfigured = Boolean(FEED_URL);
if (FEED_URL && !/^https:\/\//i.test(FEED_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(FEED_URL)) {
  throw new Error('FEED_URL 必须是 HTTPS（localhost 调试例外）');
}

let state = JSON.parse(await fs.readFile(FILE, 'utf8'));
let manualUpdated = state.note === '管理员手动更新';
let feedLastOk = null;
let feedError = null;
let feedInFlight = null;

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

async function refreshFeed() {
  if (!feedConfigured) return;
  if (feedInFlight) return feedInFlight;
  feedInFlight = (async () => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
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
      return json(res,200,{ok:true,feedConfigured,feedLastOk,feedError});
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res,200,{
        ...state,
        mode: feedConfigured ? 'feed' : manualUpdated ? 'manual' : 'snapshot',
        feedConfigured,
        feedLastOk,
        feedError,
        serverTime: new Date().toISOString(),
        refreshIntervalSeconds: Math.round(INTERVAL_MS / 1000)
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/update') {
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
