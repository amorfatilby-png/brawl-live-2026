import { readFile, writeFile } from 'node:fs/promises';
import { buildOfficialArchive, validateOfficialArchive } from '../official-archive.mjs';
import { readSupercellFeed } from '../supercell-feed.mjs';

const archiveFile = process.argv[2];
if (!archiveFile) throw new Error('Expected the path to official-results.json');
let previous;
try {
  previous = validateOfficialArchive(JSON.parse(await readFile(archiveFile,'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  previous = JSON.parse(await readFile(new URL('../data/supercell-checkpoint.json',import.meta.url),'utf8'));
}

const {matches} = await readSupercellFeed();
const archive = buildOfficialArchive(previous,matches);
if (archive) await writeFile(archiveFile,JSON.stringify(archive,null,2)+'\n','utf8');
console.log(`Verified ${Object.keys((archive ?? previous).matches).length} completed matches. ${archive ? 'Archive updated.' : 'Archive unchanged.'}`);
