import {Env,SessionUser,json,error,readBody,passwordHash,verifyPassword,createSession,session,sameOrigin,audit,digest} from './security';
import {throttle} from './abuse';
import {CommerceEnv} from './commercial-utils';
import {commerceRoutes,scheduledCommerce} from './commercial-router';
import {safeSlug,cleanText,safeHttpsUrl,moneyMinor,isKnownFacet,isKnownStage,traceCoverage,exportCsv} from './ethics';

const id=()=>crypto.randomUUID();
const str=(v:unknown,max=240)=>cleanText(v,max);
const number=(v:unknown)=>moneyMinor(v);
const bad=(m='Invalid request')=>{throw new Error(m)};
const info=(e:unknown)=>e instanceof Error?e.message:'Invalid request';
const isValidEmail=(s:string)=>s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const roles=['owner','manager'];
const channels=['csv','ebay','amazon','etsy','shopify','woocommerce','tiktok'];
const reportTypes=['worker_welfare','product_safety','misleading_claim','animal_welfare','environment','other'];

async function access(env:Env,user:SessionUser,storeId:string,manage=false):Promise<boolean>{
 const m=await env.DB.prepare('SELECT role FROM store_members WHERE user_id=? AND store_id=?').bind(user.id,storeId).first<{role:string}>();
 return !!m&&(!manage||roles.includes(m.role));
}
async function storedProduct(env:Env,uid:SessionUser,productId:string,manage=false){
 const product=await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(productId).first<Record<string,unknown>>();
 if(!product||!await access(env,uid,String(product.store_id),manage))return null;
 return product;
}
async function evidenceBelongs(env:Env,storeId:string,productId:string,ref:string):Promise<boolean>{
 if(!ref)return true;
 const found=await env.DB.prepare('SELECT id FROM evidence WHERE id=? AND store_id=? AND (product_id=? OR product_id IS NULL)').bind(ref,storeId,productId).first();
 return !!found;
}
async function sendPassport(env:Env,productId:string,publicOnly=true):Promise<Response>{
 const p=await env.DB.prepare('SELECT p.*,s.name AS store_name,s.slug AS store_slug,v.name AS supplier_name,v.country AS supplier_country FROM products p JOIN stores s ON s.id=p.store_id LEFT JOIN suppliers v ON v.id=p.supplier_id WHERE p.id=?').bind(productId).first<Record<string,unknown>>();
 if(!p||(publicOnly&&p.status!=='published'))return error('Product not found',404);
 const [claims,events]=await Promise.all([
  env.DB.prepare(`SELECT c.id,c.facet,c.statement,c.created_at,e.title AS evidence_title,e.issuer,e.source_url,CASE WHEN e.status='independently_verified' THEN
 CASE WHEN EXISTS(
 SELECT 1 FROM independent_assessments ia
 JOIN approved_verifiers av ON ia.verifier_id=av.id
 WHERE ia.evidence_id=e.id AND av.status='approved' AND ia.verdict='verified'
 AND ia.valid_until>=date('now')
 AND ia.id=(SELECT recent.id FROM independent_assessments recent WHERE recent.evidence_id=e.id ORDER BY recent.reviewed_at DESC,recent.rowid DESC LIMIT 1)
 ) THEN 'independently_verified' ELSE 'evidence_checked' END
 ELSE e.status END AS evidence_status,e.checked_at FROM passport_claims c LEFT JOIN evidence e ON e.id=c.evidence_id WHERE c.product_id=? ORDER BY c.created_at DESC`).bind(productId).all(),
  env.DB.prepare(`SELECT t.id,t.stage,t.actor_name,t.place,t.happened_at,e.title AS evidence_title,e.source_url,CASE WHEN e.status='independently_verified' THEN
 CASE WHEN EXISTS(
 SELECT 1 FROM independent_assessments ia
 JOIN approved_verifiers av ON ia.verifier_id=av.id
 WHERE ia.evidence_id=e.id AND av.status='approved' AND ia.verdict='verified'
 AND ia.valid_until>=date('now')
 AND ia.id=(SELECT recent.id FROM independent_assessments recent WHERE recent.evidence_id=e.id ORDER BY recent.reviewed_at DESC,recent.rowid DESC LIMIT 1)
 ) THEN 'independently_verified' ELSE 'evidence_checked' END
 ELSE e.status END AS evidence_status FROM trace_events t LEFT JOIN evidence e ON e.id=t.evidence_id WHERE t.product_id=? ORDER BY t.happened_at ASC`).bind(productId).all()
 ]);
 const trace=events.results||[];
 return json({product:p,claims:claims.results||[],events:trace,coverage:traceCoverage(trace.map((e:any)=>String(e.stage)))});
}
async function api(req:Request,env:Env):Promise<Response>{
 const u=new URL(req.url),path=u.pathname,method=req.method;
 if(path==='/api/health')return json({ok:true,service:'ethical-commerce',payments:((env as CommerceEnv).SALES_ENABLED==='true'?'configuration-enabled':'disabled'),external_publishing:((env as CommerceEnv).PUBLISHING_ENABLED==='true'?'configuration-enabled':'disabled')});
 if(path==='/api/ready'&&method==='GET'){
  try{for(const table of ['users','stores','products','suppliers','passport_claims','trace_events','abuse_counters','merchant_compliance','orders','order_items','email_challenges','independent_assessments','channel_connections','supplier_order_settings','purchase_orders','purchase_order_items','notification_outbox']){
   const result=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
   if(!result)throw Error('Missing schema');
  }
  return json({ready:true,database:'configured',schema:'available'});}
  catch{return json({ready:false,database:'configured',schema:'missing',next:'Apply remote D1 migrations'},503)}
 }
 if(!['GET','HEAD','OPTIONS'].includes(method)&&!sameOrigin(req))return error('Origin validation failed',403);
 const extended=await commerceRoutes(req,env as CommerceEnv);if(extended)return extended;
 if(method==='GET'&&path==='/api/public/products'){
  const search=str(u.searchParams.get('search'),80);
  const rows=await env.DB.prepare("SELECT p.id,p.name,p.description,p.category,p.price_minor,p.currency,p.image_url,p.stock,p.updated_at,s.name AS store_name,s.slug AS store_slug FROM products p JOIN stores s ON s.id=p.store_id WHERE p.status='published' AND (?='' OR p.name LIKE ? OR p.category LIKE ?) ORDER BY p.updated_at DESC LIMIT 100")
  .bind(search,'%'+search+'%','%'+search+'%').all();
  return json({products:rows.results||[]});
 }
 const pubstore=path.match(/^\/api\/public\/stores\/([a-z0-9-]+)$/);
 if(method==='GET'&&pubstore){
  const store=await env.DB.prepare('SELECT id,slug,name,description,theme_color FROM stores WHERE slug=?').bind(pubstore[1]).first();
  if(!store)return error('Store not found',404);
  const products=await env.DB.prepare("SELECT id,name,description,category,price_minor,currency,stock,image_url FROM products WHERE store_id=? AND status='published' ORDER BY updated_at DESC LIMIT 100").bind((store as any).id).all();
  return json({store,products:products.results||[]});
 }
 const pubproduct=path.match(/^\/api\/public\/products\/([a-f0-9-]{36})$/);
 if(method==='GET'&&pubproduct)return sendPassport(env,pubproduct[1]);
 if(method==='POST'&&path==='/api/reports'){
  const b=await readBody(req),productId=str(b.productId,60),category=str(b.category,35),message=str(b.message,2000),contact=str(b.contactEmail,254);
  if(!reportTypes.includes(category)||message.length<20)return error('Choose a category and describe the concern (at least 20 characters)');
  // This form is read by seller staff. It must never accept sensitive worker disclosures.
  if(category==='worker_welfare')return error('Protected worker reports are not accepted through this seller-visible form. Use an independently protected channel.',503);
  const limited=await throttle(req,env,'public-report','report',4,3600);if(limited)return limited;
  if(contact&&!isValidEmail(contact))return error('Invalid contact email');
  const product=await env.DB.prepare("SELECT id,store_id FROM products WHERE id=? AND status='published'").bind(productId).first<{store_id:string}>();
  if(!product)return error('Product not found',404);
  await env.DB.prepare('INSERT INTO complaints(id,store_id,product_id,category,message,contact_email) VALUES(?,?,?,?,?,?)').bind(id(),product.store_id,productId,category,message,contact).run();
  return json({received:true,note:'Report submitted for seller review. Do not use this form for emergencies.'},201);
 }
 if(method==='POST'&&path==='/api/auth/register'){
  const b=await readBody(req),email=str(b.email,254).toLowerCase(),password=String(b.password??'');
  if(!isValidEmail(email)||password.length<12||password.length>128)return error('Valid email and 12-128 character password required');
  const limited=await throttle(req,env,'registration','signup',5,3600);if(limited)return limited;
  if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return error('Account already exists',409);
  const uid=id();
  await env.DB.prepare('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)').bind(uid,email,await passwordHash(password)).run();
  const cookie=await createSession(req,env,uid);
  return json({user:{id:uid,email},note:'Email verification must be enabled before public launch'},201,{'set-cookie':cookie});
 }
 if(method==='POST'&&path==='/api/auth/login'){
  const b=await readBody(req),email=str(b.email,254).toLowerCase(),password=String(b.password??'');
  const limitedIp=await throttle(req,env,'login-ip','login',20,900);if(limitedIp)return limitedIp;
  const limitedAccount=await throttle(req,env,'login-identifier',email,8,900);if(limitedAccount)return limitedAccount;
  const record=await env.DB.prepare('SELECT id,email,password_hash FROM users WHERE email=?').bind(email).first<{id:string;email:string;password_hash:string}>();
  if(!record||!await verifyPassword(password,record.password_hash))return error('Invalid credentials',401);
  const cookie=await createSession(req,env,record.id);
  return json({user:{id:record.id,email:record.email}},200,{'set-cookie':cookie});
 }
 const user=await session(req,env);
 if(!user)return error('Sign in required',401);
 if(method==='POST'&&['/api/stores','/api/suppliers','/api/products','/api/evidence','/api/claims','/api/trace','/api/listings'].includes(path)){
  const limited=await throttle(req,env,'merchant-create',user.id,120,3600);if(limited)return limited;
 }
 if(method==='POST'&&path==='/api/auth/logout'){
  const token=req.headers.get('cookie')?.match(/ec_session=([0-9a-f]{64})/)?.[1];
  if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  return json({ok:true},200,{'set-cookie':'ec_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});
 }
 if(method==='GET'&&(path==='/api/me'||path==='/api/stores')){
  const result=await env.DB.prepare('SELECT s.id,s.slug,s.name,s.description,s.theme_color,m.role FROM stores s JOIN store_members m ON s.id=m.store_id WHERE m.user_id=? ORDER BY s.created_at DESC').bind(user.id).all();
  return json({user,stores:result.results||[]});
 }
 if(method==='POST'&&path==='/api/stores'){
  const b=await readBody(req),name=str(b.name,100),slug=safeSlug(str(b.slug||b.name,100));
  if(name.length<3||slug.length<3)return error('Store name and slug must be at least 3 characters');
  if(await env.DB.prepare('SELECT id FROM stores WHERE slug=?').bind(slug).first())return error('Store address already taken',409);
  const sid=id();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO stores(id,owner_user_id,slug,name) VALUES(?,?,?,?)').bind(sid,user.id,slug,name),
   env.DB.prepare("INSERT INTO store_members(store_id,user_id,role) VALUES(?,?,'owner')").bind(sid,user.id)
  ]);
  await audit(env.DB,sid,user.id,'create','store',sid);
  return json({id:sid,slug,name},201);
 }
 const storeRoute=path.match(/^\/api\/stores\/([a-f0-9-]{36})$/);
 if(method==='PATCH'&&storeRoute){
  const sid=storeRoute[1];if(!await access(env,user,sid,true))return error('Forbidden',403);
  const b=await readBody(req),name=str(b.name,100),description=str(b.description,1000),theme=str(b.themeColor,7);
  if(name.length<3||!/^#[0-9a-fA-F]{6}$/.test(theme))return error('Valid store name and hex theme required');
  await env.DB.prepare('UPDATE stores SET name=?,description=?,theme_color=? WHERE id=?').bind(name,description,theme,sid).run();
  await audit(env.DB,sid,user.id,'update','store',sid);
  return json({ok:true});
 }
 if(method==='GET'&&path==='/api/suppliers'){
  const sid=str(u.searchParams.get('storeId'),60);
  if(!await access(env,user,sid))return error('Forbidden',403);
  const r=await env.DB.prepare('SELECT * FROM suppliers WHERE store_id=? ORDER BY created_at DESC LIMIT 250').bind(sid).all();
  return json({suppliers:r.results||[]});
 }
 if(method==='POST'&&path==='/api/suppliers'){
  const b=await readBody(req),sid=str(b.storeId,60),name=str(b.name,150),country=str(b.country,100),website=safeHttpsUrl(b.website),notes=str(b.riskNotes,1000);
  if(!await access(env,user,sid,true))return error('Forbidden',403);
  if(name.length<2)return error('Supplier name required');
  const key=id();
  await env.DB.prepare('INSERT INTO suppliers(id,store_id,name,country,website,risk_notes) VALUES(?,?,?,?,?,?)').bind(key,sid,name,country,website,notes).run();
  await audit(env.DB,sid,user.id,'create','supplier',key);
  return json({id:key},201);
 }
 if(method==='GET'&&path==='/api/products'){
  const sid=str(u.searchParams.get('storeId'),60);
  if(!await access(env,user,sid))return error('Forbidden',403);
  const r=await env.DB.prepare('SELECT p.*,s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.store_id=? ORDER BY p.updated_at DESC LIMIT 500').bind(sid).all();
  return json({products:r.results||[]});
 }
 if(method==='POST'&&path==='/api/products'){
  const b=await readBody(req),sid=str(b.storeId,60),name=str(b.name,160),slug=safeSlug(str(b.slug||b.name,160));
  if(!await access(env,user,sid,true))return error('Forbidden',403);
  const price=number(b.priceMinor),stock=number(b.stock??0),supplier=str(b.supplierId,60);
  if(name.length<2||!slug||price===null||stock===null||stock>100000000)return error('Invalid name, price or stock');
  if(supplier&&!await env.DB.prepare('SELECT id FROM suppliers WHERE id=? AND store_id=?').bind(supplier,sid).first())return error('Supplier not in this store');
  const key=id();
  await env.DB.prepare('INSERT INTO products(id,store_id,supplier_id,slug,name,description,category,image_url,price_minor,stock) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(key,sid,supplier||null,slug,name,str(b.description,4000),str(b.category,100),safeHttpsUrl(b.imageUrl),price,stock).run();
  await audit(env.DB,sid,user.id,'create','product',key);
  return json({id:key},201);
 }
 const prodRoute=path.match(/^\/api\/products\/([a-f0-9-]{36})$/);
 if(method==='PATCH'&&prodRoute){
  const p=await storedProduct(env,user,prodRoute[1],true);if(!p)return error('Forbidden',403);
  const b=await readBody(req),sid=String(p.store_id),name=str(b.name??p.name,160),price=number(b.priceMinor??p.price_minor),stock=number(b.stock??p.stock),status=str(b.status??p.status,20),supplier=str(b.supplierId??p.supplier_id,60);
  if(name.length<2||price===null||stock===null||stock>100000000||!['draft','published','archived'].includes(status))return error('Invalid product details');
  if(supplier&&!await env.DB.prepare('SELECT id FROM suppliers WHERE id=? AND store_id=?').bind(supplier,sid).first())return error('Invalid supplier');
  await env.DB.prepare("UPDATE products SET name=?,description=?,category=?,image_url=?,price_minor=?,stock=?,status=?,supplier_id=?,updated_at=datetime('now') WHERE id=?")
   .bind(name,str(b.description??p.description,4000),str(b.category??p.category,100),safeHttpsUrl(b.imageUrl??p.image_url),price,stock,status,supplier||null,prodRoute[1]).run();
  await audit(env.DB,sid,user.id,'update','product',prodRoute[1]);
  return json({ok:true});
 }
 const passportRoute=path.match(/^\/api\/products\/([a-f0-9-]{36})\/passport$/);
 if(method==='GET'&&passportRoute){
  if(!await storedProduct(env,user,passportRoute[1]))return error('Forbidden',403);
  return sendPassport(env,passportRoute[1],false);
 }
 if(method==='POST'&&path==='/api/evidence'){
  const b=await readBody(req),pid=str(b.productId,60),p=await storedProduct(env,user,pid,true);
  if(!p)return error('Forbidden',403);
  const title=str(b.title,160),url=safeHttpsUrl(b.sourceUrl),issuer=str(b.issuer,160);
  if(title.length<4)return error('Evidence title required');
  const key=id(),sid=String(p.store_id);
  await env.DB.prepare('INSERT INTO evidence(id,store_id,product_id,title,issuer,source_url,details) VALUES(?,?,?,?,?,?,?)').bind(key,sid,pid,title,issuer,url,str(b.details,2000)).run();
  await audit(env.DB,sid,user.id,'submit','evidence',key);
  return json({id:key,status:'supplier_declared'},201);
 }
 if(method==='POST'&&path==='/api/claims'){
  const b=await readBody(req),pid=str(b.productId,60),p=await storedProduct(env,user,pid,true);
  if(!p)return error('Forbidden',403);
  const facet=str(b.facet,30),statement=str(b.statement,1000),evid=str(b.evidenceId,60),sid=String(p.store_id);
  if(!isKnownFacet(facet)||statement.length<8||!await evidenceBelongs(env,sid,pid,evid))return error('Invalid facet, claim or evidence reference');
  const key=id();
  await env.DB.prepare('INSERT INTO passport_claims(id,store_id,product_id,facet,statement,evidence_id) VALUES(?,?,?,?,?,?)').bind(key,sid,pid,facet,statement,evid||null).run();
  await audit(env.DB,sid,user.id,'declare','claim',key);
  return json({id:key,note:'Claim is not automatically verified'},201);
 }
 if(method==='POST'&&path==='/api/trace'){
  const b=await readBody(req),pid=str(b.productId,60),p=await storedProduct(env,user,pid,true);
  if(!p)return error('Forbidden',403);
  const stage=str(b.stage,30),actor=str(b.actorName,160),place=str(b.place,160),date=str(b.happenedAt,32),evid=str(b.evidenceId,60),sid=String(p.store_id);
  if(!isKnownStage(stage)||actor.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!await evidenceBelongs(env,sid,pid,evid))return error('Invalid trace event');
  const key=id();
  await env.DB.prepare('INSERT INTO trace_events(id,store_id,product_id,stage,actor_name,place,happened_at,evidence_id) VALUES(?,?,?,?,?,?,?,?)').bind(key,sid,pid,stage,actor,place,date,evid||null).run();
  await audit(env.DB,sid,user.id,'declare','trace',key);
  return json({id:key},201);
 }
 if(method==='GET'&&path==='/api/listings'){
  const sid=str(u.searchParams.get('storeId'),60);if(!await access(env,user,sid))return error('Forbidden',403);
  const r=await env.DB.prepare('SELECT j.*,p.name AS product_name FROM listing_jobs j JOIN products p ON p.id=j.product_id WHERE j.store_id=? ORDER BY j.created_at DESC LIMIT 250').bind(sid).all();
  return json({listings:r.results||[]});
 }
 if(method==='POST'&&path==='/api/listings'){
  const b=await readBody(req),pid=str(b.productId,60),channel=str(b.channel,30),p=await storedProduct(env,user,pid,true);
  if(!p)return error('Forbidden',403);
  if(!channels.includes(channel))return error('Unsupported channel');
  const key=id(),sid=String(p.store_id),state=channel==='csv'?'export_ready':'needs_connection';
  await env.DB.prepare('INSERT OR IGNORE INTO listing_jobs(id,store_id,product_id,channel,status) VALUES(?,?,?,?,?)').bind(key,sid,pid,channel,state).run();
  await audit(env.DB,sid,user.id,'prepare','listing',key);
  return json({channel,status:state,note:state==='needs_connection'?'Requires approved marketplace credentials and a verified publishing adapter':'Export the product catalogue as CSV'},201);
 }
 if(method==='GET'&&path==='/api/channels/export.csv'){
  const sid=str(u.searchParams.get('storeId'),60);if(!await access(env,user,sid))return error('Forbidden',403);
  const r=await env.DB.prepare('SELECT p.*,v.name AS supplier FROM products p LEFT JOIN suppliers v ON v.id=p.supplier_id WHERE p.store_id=? ORDER BY p.name LIMIT 5000').bind(sid).all();
  const csv=exportCsv((r.results||[]).map((p:any)=>({sku:p.id,name:p.name,description:p.description,price_gbp:(p.price_minor/100).toFixed(2),stock:p.stock,category:p.category,image_url:p.image_url,supplier:p.supplier,passport_url:p.status==='published'?new URL('/product/'+p.id,req.url).href:''})));
  return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="ethical-commerce-catalog.csv"','cache-control':'no-store'}});
 }
 if(method==='GET'&&path==='/api/stats'){
  const sid=str(u.searchParams.get('storeId'),60);if(!await access(env,user,sid))return error('Forbidden',403);
  const [products,suppliers,claims,reports]=await Promise.all([
   env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE store_id=?').bind(sid).first<{count:number}>(),
   env.DB.prepare('SELECT COUNT(*) AS count FROM suppliers WHERE store_id=?').bind(sid).first<{count:number}>(),
   env.DB.prepare('SELECT COUNT(*) AS count FROM passport_claims WHERE store_id=?').bind(sid).first<{count:number}>(),
   env.DB.prepare("SELECT COUNT(*) AS count FROM complaints WHERE store_id=? AND category!='worker_welfare' AND status!='resolved'").bind(sid).first<{count:number}>()
  ]);
  return json({products:products?.count||0,suppliers:suppliers?.count||0,claims:claims?.count||0,openReports:reports?.count||0,orders:0,livePayments:false});
 }
 if(method==='GET'&&path==='/api/reports'){
  const sid=str(u.searchParams.get('storeId'),60);if(!await access(env,user,sid,true))return error('Forbidden',403);
  const r=await env.DB.prepare("SELECT id,product_id,category,message,contact_email,status,created_at FROM complaints WHERE store_id=? AND category!='worker_welfare' ORDER BY created_at DESC LIMIT 100").bind(sid).all();
  return json({reports:r.results||[]});
 }
 const reportRoute=path.match(/^\/api\/reports\/([a-f0-9-]{36})$/);
 if(method==='PATCH'&&reportRoute){
  const report=await env.DB.prepare("SELECT id,store_id FROM complaints WHERE id=? AND category!='worker_welfare'").bind(reportRoute[1]).first<{store_id:string}>();
  if(!report||!await access(env,user,report.store_id,true))return error('Forbidden',403);
  const b=await readBody(req),status=str(b.status,30);
  if(!['open','reviewing','resolved'].includes(status))return error('Invalid report status');
  await env.DB.prepare('UPDATE complaints SET status=? WHERE id=?').bind(status,reportRoute[1]).run();
  await audit(env.DB,report.store_id,user.id,'update','report',reportRoute[1]);
  return json({ok:true});
 }
 if(method==='GET'&&path==='/api/audit'){
  const sid=str(u.searchParams.get('storeId'),60);if(!await access(env,user,sid,true))return error('Forbidden',403);
  const r=await env.DB.prepare('SELECT id,action,resource_type,resource_id,previous_hash,event_hash,created_at FROM audit_events WHERE store_id=? ORDER BY rowid DESC LIMIT 100').bind(sid).all();
  return json({events:r.results||[]});
 }
 if(path.startsWith('/api/admin/')){
  if(!user.is_platform_admin)return error('Platform administrator required',403);
  if(method==='GET'&&path==='/api/admin/worker-reports'){
   const r=await env.DB.prepare("SELECT id,store_id,product_id,category,message,contact_email,status,created_at FROM complaints WHERE category='worker_welfare' ORDER BY created_at DESC LIMIT 100").all();
   return json({reports:r.results||[],warning:'Sensitive records: authorised independent review only'});
  }
  if(method==='GET'&&path==='/api/admin/evidence'){
   const r=await env.DB.prepare("SELECT e.id,e.title,e.issuer,e.source_url,e.status,e.details,p.name AS product_name FROM evidence e JOIN products p ON e.product_id=p.id WHERE e.status='supplier_declared' ORDER BY e.created_at DESC LIMIT 100").all();
   return json({evidence:r.results||[]});
  }
  const match=path.match(/^\/api\/admin\/evidence\/([a-f0-9-]{36})\/review$/);
  if(method==='POST'&&match){
   const b=await readBody(req),status=str(b.status,30),record=await env.DB.prepare('SELECT store_id FROM evidence WHERE id=?').bind(match[1]).first<{store_id:string}>();
   if(!record)return error('Not found',404);
   if(!['evidence_checked','rejected'].includes(status))return error('Review may check evidence or reject it, not self-issue independent certification');
   await env.DB.prepare("UPDATE evidence SET status=?,checked_by=?,checked_at=datetime('now') WHERE id=?").bind(status,user.id,match[1]).run();
   await audit(env.DB,record.store_id,user.id,'review','evidence',match[1]);
   return json({ok:true,status});
  }
 }
 return error('API route not found',404);
}
export default {
 async fetch(request:Request,env:CommerceEnv):Promise<Response>{
  try{
   const path=new URL(request.url).pathname;
   const result=path.startsWith('/api/')?await api(request,env):await env.ASSETS.fetch(request);
   const headers=new Headers(result.headers);
   headers.set('referrer-policy','strict-origin-when-cross-origin');
   headers.set('x-frame-options','DENY');
   headers.set('x-content-type-options','nosniff');
   headers.set('permissions-policy','camera=(), microphone=(), geolocation=(), payment=()');
   headers.set('content-security-policy',"default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'");
   headers.set('x-robots-tag','noindex, nofollow, noarchive');
   return new Response(result.body,{status:result.status,statusText:result.statusText,headers});
  }catch(e){
   const m=info(e);
   if(m.includes('JSON')||m.includes('Invalid')||m.includes('required')||m.includes('large'))return error(m,400);
   console.error('API operation failed',e);
   return error('The request could not be completed',500);
  }
 }
 ,async scheduled(_event:ScheduledController,env:CommerceEnv,ctx:ExecutionContext){
  ctx.waitUntil(scheduledCommerce(env));
 }
} satisfies ExportedHandler<CommerceEnv>;
