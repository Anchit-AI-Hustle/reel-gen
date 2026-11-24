/** Neon Postgres-only repository layer. The adapter accepts an injected tagged SQL function.
 * In production: import { neon } from '@neondatabase/serverless'; const sql=neon(process.env.DATABASE_URL);
 * No data storage or DB connectivity is claimed without a real connection string.
 */
import {randomUUID} from 'node:crypto';
export function assertNeonUrl(connectionString){
 if(!connectionString || typeof connectionString!=='string')throw Error('DATABASE_URL is required');
 let u;try{u=new URL(connectionString)}catch{throw Error('Invalid DATABASE_URL')}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech')||!u.username||!u.password)throw Error('Expected authenticated Neon PostgreSQL URL');
 if(u.searchParams.get('sslmode')!=='require'&&u.searchParams.get('sslmode')!=='verify-full')throw Error('Neon DATABASE_URL must enforce TLS');
 return true;
}
const uuid=v=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw Error('Invalid UUID');return v};
export class ReelRepository{
 constructor(query){if(typeof query!=='function')throw Error('SQL query function required');this.query=query}
 async createProject({workspaceId,userId,title='Untitled highlights',brief='',settings={}}){
  let id=randomUUID();await this.query('INSERT INTO projects(id,workspace_id,created_by,title,brief,settings) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id,uuid(workspaceId),uuid(userId),String(title).slice(0,160),String(brief).slice(0,5000),JSON.stringify(settings)]);return id;
 }
 async getProjects(workspaceId){return this.query('SELECT id,title,brief,status,settings,created_at FROM projects WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[uuid(workspaceId)])}
 async recordEvent({workspaceId,projectId=null,actorId=null,type,details={}}){return this.query('INSERT INTO activity_events(workspace_id,project_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5::jsonb)',[uuid(workspaceId),projectId?uuid(projectId):null,actorId?uuid(actorId):null,String(type).slice(0,100),JSON.stringify(details)])}
 async saveTimeline({projectId,workspaceId,edl}){let rows=await this.query('SELECT coalesce(max(version),0)+1 AS version FROM timelines t JOIN projects p ON p.id=t.project_id WHERE p.id=$1 AND p.workspace_id=$2',[uuid(projectId),uuid(workspaceId)]);let version=Number(rows[0]?.version||1);await this.query('INSERT INTO timelines(project_id,version,edl) SELECT id,$2,$3::jsonb FROM projects WHERE id=$1 AND workspace_id=$4',[projectId,version,JSON.stringify(edl),workspaceId]);return version}
 async getActivity(workspaceId){return this.query('SELECT event_type,details,created_at FROM activity_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200',[uuid(workspaceId)])}
}
