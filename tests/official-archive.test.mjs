import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialArchive, validateOfficialArchive } from '../official-archive.mjs';
import { WORLD_FINALS_EVENT_ID } from '../supercell-feed.mjs';

test('archives only finals, saves new results and corrections, and refuses a rollback',()=>{
  const first = {status:'final',score1:2,score2:3};
  const next = {status:'final',score1:3,score2:1};
  const matches = {UQ1:first, UQ2:next, UQ3:{status:'live',score1:1,score2:0}};
  const seed = {matches:{UQ1:first}};
  const archive = buildOfficialArchive(seed,matches);
  assert.equal(archive.eventId,WORLD_FINALS_EVENT_ID);
  assert.deepEqual(archive.matches,{UQ1:first,UQ2:next});
  assert.equal(buildOfficialArchive(archive,matches),null);
  assert.deepEqual(buildOfficialArchive(archive,{...matches,UQ1:{...first,score1:1}}).matches.UQ1,{...first,score1:1});
  assert.throws(()=>buildOfficialArchive(archive,{UQ1:first}),/缺少已归档/);
  assert.throws(()=>validateOfficialArchive({...archive,matches:{UQ3:matches.UQ3}}),/无效比分/);
});
