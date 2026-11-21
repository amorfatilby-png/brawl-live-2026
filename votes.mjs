import { randomUUID } from 'node:crypto';

const teams = [
  'FUT Esports','NAVI','Bounty Hunters','HMBLE','ZETA DIVISION','Totem Esports','Tribe',
  'Team Elektros','Crazy Raccoon','NOVO Esports','RED Canids','Team Heretics',
];
const eligible = new Set(teams);

export function createVoteStore(sql) {
  let ready;
  const initialize = () => ready ??= sql`
    CREATE TABLE IF NOT EXISTS world_finals_team_votes (
      voter_id uuid PRIMARY KEY,
      team text NOT NULL
    )
  `.catch(error=>{ready=undefined;throw error;});

  return {
    async results(voter) {
      await initialize();
      const rows=await sql`
        SELECT team, COUNT(*)::int AS votes, BOOL_OR(voter_id = ${voter}::uuid) AS chosen
        FROM world_finals_team_votes GROUP BY team
      `;
      const counts=Object.fromEntries(teams.map(team=>[team,0]));
      let choice=null;
      for(const {team,votes,chosen} of rows){
        counts[team]=votes;
        if(chosen)choice=team;
      }
      return {counts,choice,total:rows.reduce((sum,row)=>sum+row.votes,0)};
    },
    async support(voter,team) {
      await initialize();
      await sql`
        INSERT INTO world_finals_team_votes (voter_id,team) VALUES (${voter},${team})
        ON CONFLICT (voter_id) DO UPDATE SET team=EXCLUDED.team
      `;
    },
    async remove(voter) {
      await initialize();
      await sql`DELETE FROM world_finals_team_votes WHERE voter_id=${voter}`;
    },
  };
}

export function teamVoteRoute({databaseUrl,siteUrl,json,readBody}) {
  const trustedOrigin=siteUrl?new URL(siteUrl).origin:null;
  let storePromise;
  return async (req,res) => {
    const method=req.method;
    if(!['GET','POST','DELETE'].includes(method)){
      res.setHeader('Allow','GET, POST, DELETE');
      return json(res,405,{error:'不支持的投票操作'});
    }
    if(!databaseUrl)return json(res,503,{error:'投票尚未开放'});
    const origin=trustedOrigin??'http://'+req.headers.host;
    const cookie=req.headers.cookie?.match(/(?:^|;\s*)brawl_support=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:;|$)/i)?.[1];
    let team;
    if(method!=='GET'){
      if(req.headers.origin!==origin)return json(res,403,{error:'请在本站投票'});
      if(!cookie)return json(res,409,{error:'请刷新投票区域后重试'});
      if(method==='POST'){
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))return json(res,415,{error:'投票应为 JSON'});
        try{team=(await readBody(req))?.team;}
        catch{return json(res,400,{error:'投票格式无效'});}
        if(!eligible.has(team))return json(res,400,{error:'请选择本届参赛战队'});
      }
    }
    const voter=cookie??randomUUID();
    try{
      storePromise ??= import('postgres').then(({default:postgres})=>
        createVoteStore(postgres(databaseUrl,{max:4,connect_timeout:5,idle_timeout:25,onnotice:()=>{}})));
      const store=await storePromise;
      if(method==='POST')await store.support(voter,team);
      if(method==='DELETE')await store.remove(voter);
      const board=await store.results(voter);
      if(!cookie){
        const secure=origin.startsWith('https:')?'; Secure':'';
        res.setHeader('Set-Cookie','brawl_support='+voter+'; Path=/api/votes; Max-Age=2592000; HttpOnly; SameSite=Strict'+secure);
      }
      return json(res,200,board);
    }catch(error){
      console.error('[votes]',error.code??error.name);
      return json(res,503,{error:'暂时无法读取投票，请稍后重试'});
    }
  };
}
