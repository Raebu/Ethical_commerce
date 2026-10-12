import type {Env} from './security.ts';
import {digest,json} from './security.ts';

/** Best-effort request throttling on top of Cloudflare edge protections. */
export async function throttle(req:Request,env:Env,kind:string,identity:string,limit:number,windowSeconds:number):Promise<Response|null>{
 const timestamp=Date.now();
 const windowMs=windowSeconds*1000;
 const bucketTime=Math.floor(timestamp/windowMs);
 // The trusted Cloudflare header is set by Cloudflare at the edge. No user-supplied X-Forwarded-For values.
 const client=req.headers.get('CF-Connecting-IP')||'unattributed';
 const bucket=await digest([kind,client,identity.trim().toLowerCase(),bucketTime].join(':'));
 const expiresAt=(bucketTime+1)*windowMs;
 const row=await env.DB.prepare(
  'INSERT INTO abuse_counters(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=abuse_counters.hits+1 RETURNING hits'
 ).bind(bucket,expiresAt).first<{hits:number}>();
 // Opportunistic expiry cleanup; no raw IP/email is stored.
 if(Math.random()<0.02)await env.DB.prepare('DELETE FROM abuse_counters WHERE expires_at<?').bind(timestamp).run();
 if((row?.hits||0)<=limit)return null;
 const retry=Math.max(1,Math.ceil((expiresAt-timestamp)/1000));
 return json({error:'Too many requests. Please try again later.',retryAfterSeconds:retry},429,{'retry-after':String(retry)});
}
