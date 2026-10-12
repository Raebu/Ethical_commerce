export interface Env {DB:D1Database; ASSETS:Fetcher}
export interface SessionUser {id:string;email:string;is_platform_admin:number}
const utf8=new TextEncoder();
const toHex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',utf8.encode(value));
 return toHex(new Uint8Array(bytes));
}
export function json(value:unknown,status=200,headers:Record<string,string>={}):Response {
 return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
}
export function error(message:string,status=400){return json({error:message},status)}
export async function readBody(req:Request):Promise<Record<string,unknown>>{
 if(!req.headers.get('content-type')?.includes('application/json'))throw Error('JSON content required');
 const text=await req.text();
 if(text.length>64000)throw Error('Request too large');
 const data:unknown=JSON.parse(text);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('JSON object required');
 return data as Record<string,unknown>;
}
export async function passwordHash(value:string):Promise<string>{
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const secret=await crypto.subtle.importKey('raw',utf8.encode(value),'PBKDF2',false,['deriveBits']);
 const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},secret,256);
 return ['pbkdf2','210000',toHex(salt),toHex(new Uint8Array(derived))].join('$');
}
export async function verifyPassword(value:string,encoded:string):Promise<boolean>{
 const [alg,iterations,salt,expected]=encoded.split('$');
 if(alg!=='pbkdf2'||iterations!=='210000'||!salt||!expected)return false;
 const key=await crypto.subtle.importKey('raw',utf8.encode(value),'PBKDF2',false,['deriveBits']);
 const saltBytes=Uint8Array.from(salt.match(/../g)??[],s=>parseInt(s,16));
 const result=toHex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:saltBytes,iterations:210000},key,256)));
 if(result.length!==expected.length)return false;
 let diff=0;for(let i=0;i<result.length;i++)diff|=result.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
export async function createSession(req:Request,env:Env,userId:string):Promise<string>{
 const bytes=crypto.getRandomValues(new Uint8Array(32));const value=toHex(bytes);
 await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(value),userId,Date.now()+604800000).run();
 return 'ec_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'+(new URL(req.url).protocol==='https:'?'; Secure':'');
}
export async function session(req:Request,env:Env):Promise<SessionUser|null>{
 const token=req.headers.get('cookie')?.match(/(?:^|;\\s*)ec_session=([0-9a-f]{64})/)?.[1];
 if(!token)return null;
 return env.DB.prepare('SELECT u.id,u.email,u.is_platform_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first<SessionUser>();
}
export function sameOrigin(req:Request):boolean{
 const origin=req.headers.get('origin');
 if(!origin)return !req.headers.get('cookie');
 return origin===new URL(req.url).origin;
}
export async function audit(db:D1Database,store:string,actor:string,action:string,kind:string,id:string):Promise<void>{
 const last=await db.prepare('SELECT event_hash FROM audit_events WHERE store_id=? ORDER BY rowid DESC LIMIT 1').bind(store).first<{event_hash:string}>();
 const prev=last?.event_hash??'';const aid=crypto.randomUUID();
 const hash=await digest(JSON.stringify({aid,prev,store,actor,action,kind,id}));
 await db.prepare('INSERT INTO audit_events(id,store_id,actor_user_id,action,resource_type,resource_id,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?)').bind(aid,store,actor,action,kind,id,prev,hash).run();
}
