import type {Env,SessionUser} from './security.ts';
import {digest,error,json,session} from './security.ts';

export interface CommerceEnv extends Env {
 RESEND_API_KEY?:string;
 EMAIL_FROM?:string;
 STRIPE_SECRET_KEY?:string;
 STRIPE_CONNECT_WEBHOOK_SECRET?:string;
 SALES_ENABLED?:string;
 STRIPE_TAX_ENABLED?:string;
 PUBLISHING_ENABLED?:string;
 ALLOWED_PUBLISHER_DOMAINS?:string;
 ENCRYPTION_MASTER_KEY?:string;
}
export function isTrue(x:unknown):boolean{return x==='true';}
export function safeEmail(x:unknown):string {
 const s=String(x??'').trim().toLowerCase();
 return s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:'';
}
export function requireHttps(x:unknown):string{
 if(typeof x!=='string'||!x)return '';
 try{const u=new URL(x); if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)return '';return u.href.slice(0,1000);}catch{return ''}
}
export function textField(x:unknown,length=200):string{return typeof x==='string'?x.trim().slice(0,length):''}
export function cleanId(x:unknown):string{return typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)?x:''}
export function amount(value:unknown):number|null{
 const n=Number(value);return Number.isSafeInteger(n)&&n>=0&&n<=100000000? n:null;
}
export function strongToken():string{
 return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
}
export function form(data:Record<string,string|number|boolean|null|undefined>):string{
 const p=new URLSearchParams();
 for(const [k,v] of Object.entries(data))if(v!==null&&v!==undefined)p.set(k,String(v));
 return p.toString();
}
export async function stripe(env:CommerceEnv,path:string,options:{method?:string;body?:string;account?:string;idempotency?:string}={}):Promise<any>{
 if(!env.STRIPE_SECRET_KEY)throw Error('Stripe credentials are not configured');
 const headers:Record<string,string>={Authorization:'Bearer '+env.STRIPE_SECRET_KEY};
 if(options.body)headers['content-type']='application/x-www-form-urlencoded';
 if(options.account)headers['Stripe-Account']=options.account;
 if(options.idempotency)headers['Idempotency-Key']=options.idempotency;
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:options.method||'GET',headers,body:options.body});
 const data=await response.json() as any;
 if(!response.ok)throw Error(data?.error?.message||'Stripe request was rejected');
 return data;
}
export async function stripeSignatureValid(payload:string,header:string|null,secret:string,nowSeconds=Math.floor(Date.now()/1000)):Promise<boolean>{
 if(!header||!secret)return false;
 const fields=Object.fromEntries(header.split(',').map(part=>{const index=part.indexOf('=');return index<0?['','']:[part.slice(0,index),part.slice(index+1)]}));
 const t=Number(fields.t);
 if(!Number.isSafeInteger(t)||Math.abs(nowSeconds-t)>300)return false;
 const signatures=header.split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
 if(!signatures.length)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(String(t)+'.'+payload));
 const expected=Array.from(new Uint8Array(signed),v=>v.toString(16).padStart(2,'0')).join('');
 return signatures.some(sig=>{
  if(sig.length!==expected.length||!/^[a-f0-9]{64}$/i.test(sig))return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=sig.charCodeAt(i)^expected.charCodeAt(i);
  return diff===0;
 });
}
export async function authenticate(req:Request,env:CommerceEnv):Promise<SessionUser|null>{return session(req,env)}
export async function member(env:CommerceEnv,user:SessionUser,store:string,write=false):Promise<boolean>{
 const role=await env.DB.prepare('SELECT role FROM store_members WHERE store_id=? AND user_id=?').bind(store,user.id).first<{role:string}>();
 return !!role&&(!write||role.role==='owner'||role.role==='manager');
}
export async function owner(env:CommerceEnv,user:SessionUser,store:string):Promise<boolean>{
 const r=await env.DB.prepare("SELECT role FROM store_members WHERE store_id=? AND user_id=? AND role='owner'").bind(store,user.id).first();
 return !!r;
}
export async function sendEmail(env:CommerceEnv,to:string,subject:string,html:string):Promise<void>{
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw Error('Transactional email service unavailable');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
 if(!res.ok)throw Error('Transactional email provider rejected the request');
}
export function htmlSafe(s:unknown):string {
 return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export async function encrypt(env:CommerceEnv,plain:string):Promise<string>{
 if(!env.ENCRYPTION_MASTER_KEY)throw Error('Encryption key is not configured');
 const raw=Uint8Array.from(atob(env.ENCRYPTION_MASTER_KEY),c=>c.charCodeAt(0));
 if(raw.length!==32)throw Error('Encryption key must be a base64-encoded 32-byte key');
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(plain));
 return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export async function decrypt(env:CommerceEnv,cipher:string):Promise<string>{
 if(!env.ENCRYPTION_MASTER_KEY)throw Error('Encryption key is not configured');
 const raw=Uint8Array.from(atob(env.ENCRYPTION_MASTER_KEY),c=>c.charCodeAt(0));
 if(raw.length!==32)throw Error('Invalid encryption key');
 const [ivB64,payload]=cipher.split('.');
 if(!ivB64||!payload)throw Error('Invalid encrypted credentials');
 const iv=Uint8Array.from(atob(ivB64),c=>c.charCodeAt(0));
 const bytes=Uint8Array.from(atob(payload),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,bytes));
}
export function validShopDomain(raw:unknown,channel:'woocommerce'|'shopify'):string{
 const url=requireHttps(raw);
 if(!url)return '';
 const u=new URL(url);
 const host=u.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^(\d{1,3}\.){3}\d{1,3}$/.test(host)||host.includes(':'))return '';
 if(channel==='shopify'&&!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host))return '';
 if(channel==='woocommerce'&&(!host.includes('.')||u.pathname!=='/'))return '';
 return u.origin;
}
export async function needLogin(req:Request,env:CommerceEnv):Promise<SessionUser|Response>{
 return (await authenticate(req,env))||error('Sign in required',401);
}
export function isResponse(x:SessionUser|Response):x is Response{return x instanceof Response;}
