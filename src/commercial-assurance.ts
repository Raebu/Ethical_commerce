import {CommerceEnv,needLogin,isResponse,textField,requireHttps,member,validShopDomain,encrypt,decrypt} from './commercial-utils';
import {error,json,readBody,audit} from './security';
export async function reviewRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname,method=req.method;
 if(!path.startsWith('/api/commerce/assurance/'))return null;
 const user=await needLogin(req,env);if(isResponse(user))return user;
 if(method==='GET'&&path==='/api/commerce/assurance/product'){
  const pid=new URL(req.url).searchParams.get('productId')||'';
  const prod=await env.DB.prepare('SELECT store_id FROM products WHERE id=?').bind(pid).first<{store_id:string}>();
  if(!prod||!await member(env,user,prod.store_id))return error('Forbidden',403);
  const e=await env.DB.prepare(`SELECT e.id,e.title,e.issuer,e.source_url,e.status,e.created_at,a.verdict,a.report_url,a.report_reference,
  a.valid_until,v.legal_name AS verifier_name,v.registry_url,v.status AS verifier_status
  FROM evidence e LEFT JOIN independent_assessments a ON a.id=(SELECT aa.id FROM independent_assessments aa WHERE aa.evidence_id=e.id ORDER BY aa.reviewed_at DESC,aa.rowid DESC LIMIT 1)
  LEFT JOIN approved_verifiers v ON v.id=a.verifier_id WHERE e.product_id=?`).bind(pid).all();
  return json({evidence:e.results||[]});
 }
 if(!user.is_platform_admin)return error('Independent assurance administration requires platform authorization',403);
 if(method==='GET'&&path==='/api/commerce/assurance/verifiers'){
  const v=await env.DB.prepare('SELECT id,legal_name,registry_url,accreditation_reference,status,approved_at FROM approved_verifiers ORDER BY created_at DESC LIMIT 200').all();
  return json({verifiers:v.results||[]});
 }
 if(method==='POST'&&path==='/api/commerce/assurance/verifiers'){
  const b=await readBody(req),name=textField(b.legalName,160),url=requireHttps(b.registryUrl),ref=textField(b.accreditationReference,150);
  if(name.length<3||!url||ref.length<5)return error('Registry URL, legal identity and accreditation reference required');
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO approved_verifiers(id,legal_name,registry_url,accreditation_reference) VALUES(?,?,?,?)').bind(id,name,url,ref).run();
  return json({id,status:'pending',notice:'Must be independently checked before platform approval'},201);
 }
 const verifier=path.match(/^\/api\/commerce\/assurance\/verifiers\/([a-f0-9-]{36})\/approve$/);
 if(verifier&&method==='POST'){
  const b=await readBody(req);
  if(b.confirmIndependentCredentialReview!==true)return error('Independent accreditation checks must be confirmed',403);
  const result=await env.DB.prepare("UPDATE approved_verifiers SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=? AND status='pending' RETURNING id").bind(user.id,verifier[1]).first();
  if(!result)return error('Verifier was not pending approval',409);
  return json({approved:true,warning:'Approval represents an administrative review of external credentials, not an automatic certification'});
 }
 const rev=path.match(/^\/api\/commerce\/assurance\/evidence\/([a-f0-9-]{36})\/assessment$/);
 if(rev&&method==='POST'){
  const b=await readBody(req),vid=textField(b.verifierId,80),verdict=textField(b.verdict,30),report=requireHttps(b.reportUrl),
  reference=textField(b.reportReference,180),validUntil=textField(b.validUntil,10);
  if(!/^[a-f0-9-]{36}$/.test(vid)||!['verified','rejected','revoked'].includes(verdict)||!report||reference.length<5
   ||(validUntil&&!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)))return error('Valid external assessor, decision, report and reference required');
  if(verdict==='verified'&&(!validUntil||validUntil<new Date().toISOString().slice(0,10)))return error('Active assessment must have a valid future expiry date');
  const e=await env.DB.prepare('SELECT id,store_id FROM evidence WHERE id=?').bind(rev[1]).first<{id:string;store_id:string}>();
  const v=await env.DB.prepare("SELECT id FROM approved_verifiers WHERE id=? AND status='approved'").bind(vid).first();
  if(!e||!v)return error('Evidence or approved independent verifier not found',404);
  const record=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO independent_assessments(id,evidence_id,verifier_id,verdict,report_url,report_reference,valid_until,reviewed_by) VALUES(?,?,?,?,?,?,?,?)')
    .bind(record,e.id,vid,verdict,report,reference,validUntil||null,user.id),
   env.DB.prepare("UPDATE evidence SET status=?,checked_by=?,checked_at=datetime('now') WHERE id=?")
    .bind(verdict==='verified'?'independently_verified':verdict==='rejected'?'rejected':'evidence_checked',user.id,e.id)
  ]);
  await audit(env.DB,e.store_id,user.id,'independent_assessment','evidence',e.id);
  return json({record,verdict,warning:'This record depends on verified external assessor evidence. It is not a universal ethical product certification'},201);
 }
 return error('Unknown assurance route',404);
}
/** Any expired or suspended review must lose its independent status on public passports. */
export async function expireAssessments(env:CommerceEnv):Promise<void>{
 await env.DB.prepare(`UPDATE evidence SET status='evidence_checked' WHERE status='independently_verified' AND id IN (
 SELECT e.id FROM evidence e
 LEFT JOIN independent_assessments a ON a.id=(
 SELECT x.id FROM independent_assessments x WHERE x.evidence_id=e.id ORDER BY x.reviewed_at DESC,x.rowid DESC LIMIT 1)
 LEFT JOIN approved_verifiers v ON v.id=a.verifier_id
 WHERE a.id IS NULL OR a.verdict!='verified' OR a.valid_until<date('now') OR v.status!='approved'
 )`).run();
}
