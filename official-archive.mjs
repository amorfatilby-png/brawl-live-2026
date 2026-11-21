import { OFFICIAL_MATCH_IDS, WORLD_FINALS_EVENT_ID } from './supercell-feed.mjs';

const ARCHIVE_URL = 'https://raw.githubusercontent.com/amorfatilby-png/brawl-live-2026/official-results/data/official-results.json';

export function validateOfficialArchive(archive) {
  if (archive?.eventId !== WORLD_FINALS_EVENT_ID || typeof archive.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(archive.updatedAt)) || !archive.matches || Array.isArray(archive.matches) ||
      typeof archive.matches !== 'object') throw new Error('完赛归档格式异常');
  const entries = Object.entries(archive.matches);
  if (!entries.length || !entries.every(([id, match]) => {
    const target = id === 'GF' ? 4 : 3;
    const scores = [match?.score1, match?.score2];
    return OFFICIAL_MATCH_IDS.includes(id) && match?.status === 'final' &&
      scores.every(score => Number.isInteger(score) && score >= 0) &&
      Math.max(...scores) === target && scores[0] !== scores[1];
  })) throw new Error('完赛归档包含无效比分');
  return archive;
}

export async function readOfficialArchive() {
  const response = await fetch(ARCHIVE_URL, {signal:AbortSignal.timeout(4000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`完赛归档返回 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 10000) throw new Error('完赛归档数据过大');
  const body = await response.text();
  if (body.length > 10000) throw new Error('完赛归档数据过大');
  return validateOfficialArchive(JSON.parse(body));
}

export function buildOfficialArchive(previous, incoming) {
  const finals = Object.fromEntries(Object.entries(incoming).filter(([, match]) => match.status === 'final'));
  if (Object.keys(previous.matches).some(id => !finals[id])) throw new Error('官方对阵缺少已归档的完赛结果');
  const changed = Object.entries(finals).some(([id, match]) => {
    const saved = previous.matches[id];
    return match.score1 !== saved?.score1 || match.score2 !== saved?.score2;
  });
  if (!changed && previous.eventId === WORLD_FINALS_EVENT_ID) return null;
  return validateOfficialArchive({eventId:WORLD_FINALS_EVENT_ID, updatedAt:new Date().toISOString(), matches:finals});
}
