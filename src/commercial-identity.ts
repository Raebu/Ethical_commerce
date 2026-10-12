import {CommerceEnv,authenticate,needLogin,isResponse,member,owner,sendEmail,safeEmail,textField,requireHttps,strongToken,stripe,form,htmlSafe} from './commercial-utils';
import {json,error,readBody,digest} from './security';
import {throttle} from './abuse';
const base='/api/commerce';

async function requestVerification(req:Request,env:CommerceEnv):Promise<Response>{
 const user=await needLogin(req,env);if(isResponse(user))return user;
 const limited=await throttle(req,env,'email-verify',user.id,3,3600);if(limited)return limited;
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return error('Email verification is not yet configured',503);
 const exists=await env.DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(user.id).first<{email_verified_at:string|null}>();
 if(exists?.email_verified_at)return json({verified:true});
 const token=strongToken(),hash=await digest(token);
 await env.DB.prepare('DELETE FROM email_challenges WHERE user_id=?').bind(user.id).run();
 await env.DB.prepare('INSERT INTO email_challenges(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash,user.id,Date.now()+20*60*1000).run();
 const url=new URL('/verify?token='+token,req.url).href;
 try{
  await sendEmail(env,user.email,'Verify your Ethical Commerce email',
   '<p>Confirm that this email belongs to you. This link expires in 20 minutes.</p><p><a href="'+htmlSafe(url)+'">Verify email address</a></p><p>If you did not request this, ignore it.</p>');
 }catch{await env.DB.prepare('DELETE FROM email_challenges WHERE token_hash=?').bind(hash).run();return error('Verification email could not be sent',503)}
 return json({sent:true,expiresInSeconds:1200});
}
async function confirmVerification(req:Request,env:CommerceEnv):Promise<Response>{
 const body=await readBody(req),token=textField(body.token,128);
 if(!/^[a-f0-9]{64}$/.test(token))return error('Invalid or expired verification link',400);
 const limited=await throttle(req,env,'email-confirm','confirm',15,900);if(limited)return limited;
 const hash=await digest(token);
 const found=await env.DB.prepare('SELECT user_id FROM email_challenges WHERE token_hash=? AND expires_at>?').bind(hash,Date.now()).first<{user_id:string}>();
 if(!found)return error('Invalid or expired verification link',400);
 await env.DB.batch([
  env.DB.prepare("UPDATE users SET email_verified_at=datetime('now') WHERE id=?").bind(found.user_id),
  env.DB.prepare('DELETE FROM email_challenges WHERE user_id=?').bind(found.user_id)
 ]);
 return json({verified:true});
}
export async function identityRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(path==='/api/auth/email/request'&&method==='POST')return requestVerification(req,env);
 if(path==='/api/auth/email/confirm'&&method==='POST')return confirmVerification(req,env);
 if(path==='/api/auth/email/status'&&method==='GET'){
  const u=await needLogin(req,env);if(isResponse(u))return u;
  const x=await env.DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(u.id).first<{email_verified_at:string|null}>();
  return json({verified:!!x?.email_verified_at,serviceConfigured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM)});
 }
 const publicSeller=path.match(/^\/api\/commerce\/public\/sellers\/([a-z0-9-]+)$/);
 if(publicSeller&&method==='GET'){
  const d=await env.DB.prepare("SELECT s.name AS store_name,s.slug,c.legal_seller_name,c.trading_address,c.contact_email,c.company_registration,c.return_policy_url,c.shipping_policy_url,c.terms_url,c.privacy_url,c.cancellation_notice FROM stores s LEFT JOIN merchant_compliance c ON c.store_id=s.id WHERE s.slug=?").bind(publicSeller[1]).first();
  return d?json({seller:d}):error('Seller not found',404);
 }
 const match=path.match(/^\/api\/commerce\/stores\/([a-f0-9-]{36})\/(compliance|onboarding|connect-status|pause)$/);
 if(!match)return null;
 const storeId=match[1],action=match[2];
 const user=await needLogin(req,env);if(isResponse(user))return user;
 if(!await owner(env,user,storeId))return error('Store owner permission required',403);
 if(action==='compliance'&&method==='GET'){
  const d=await env.DB.prepare('SELECT * FROM merchant_compliance WHERE store_id=?').bind(storeId).first();
  return json({compliance:d||null});
 }
 if(action==='compliance'&&method==='POST'){
  const b=await readBody(req);
  const legal=textField(b.legalSellerName,160),address=textField(b.tradingAddress,500),contact=safeEmail(b.contactEmail),
  reg=textField(b.companyRegistration,100),returns=requireHttps(b.returnPolicyUrl),
  shipping=requireHttps(b.shippingPolicyUrl),terms=requireHttps(b.termsUrl),privacy=requireHttps(b.privacyUrl),
  notice=textField(b.cancellationNotice,1000);
  if(legal.length<3||address.length<12||!contact||!returns||!shipping||!terms||!privacy||notice.length<30||b.acceptConsumerDuties!==true)
   return error('Complete legal seller identity, contact, address, published policies, cancellation information and acceptance of consumer duties');
  const existing=await env.DB.prepare('SELECT stripe_account_id FROM merchant_compliance WHERE store_id=?').bind(storeId).first<{stripe_account_id:string|null}>();
  await env.DB.prepare(`INSERT INTO merchant_compliance
   (store_id,legal_seller_name,trading_address,contact_email,company_registration,return_policy_url,shipping_policy_url,terms_url,privacy_url,cancellation_notice,consumer_terms_accepted_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
   ON CONFLICT(store_id) DO UPDATE SET legal_seller_name=excluded.legal_seller_name,trading_address=excluded.trading_address,
   contact_email=excluded.contact_email,company_registration=excluded.company_registration,return_policy_url=excluded.return_policy_url,
   shipping_policy_url=excluded.shipping_policy_url,terms_url=excluded.terms_url,privacy_url=excluded.privacy_url,
   cancellation_notice=excluded.cancellation_notice,consumer_terms_accepted_at=datetime('now'),updated_at=datetime('now')`)
   .bind(storeId,legal,address,contact,reg,returns,shipping,terms,privacy,notice).run();
  return json({saved:true,existingConnectAccount:!!existing?.stripe_account_id});
 }
 if(action==='onboarding'&&method==='POST'){
  if(!env.STRIPE_SECRET_KEY)return error('Stripe Connect integration is not configured',503);
  const verified=await env.DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(user.id).first<{email_verified_at:string|null}>();
  if(!verified?.email_verified_at)return error('Verify your email before onboarding',403);
  const c=await env.DB.prepare('SELECT * FROM merchant_compliance WHERE store_id=?').bind(storeId).first<any>();
  if(!c?.legal_seller_name||!c?.consumer_terms_accepted_at)return error('Complete the seller compliance profile before onboarding',403);
  const existing=c.stripe_account_id;
  let account=existing;
  if(!account){
   const created=await stripe(env,'accounts',{method:'POST',idempotency:'connect-'+storeId,body:form({
    type:'express',country:'GB',email:user.email,
    'capabilities[card_payments][requested]':'true',
    'capabilities[transfers][requested]':'true',
    'metadata[ethical_commerce_store_id]':storeId
   })});
   if(!/^acct_[a-zA-Z0-9]+$/.test(created.id||''))return error('Stripe did not return an account ID',502);
   account=created.id;
   await env.DB.prepare('UPDATE merchant_compliance SET stripe_account_id=? WHERE store_id=?').bind(account,storeId).run();
  }
  const origin=new URL(req.url).origin;
  const link=await stripe(env,'account_links',{method:'POST',body:form({
   account,type:'account_onboarding',refresh_url:origin+'/dashboard',return_url:origin+'/dashboard'
  })});
  return json({onboardingUrl:link.url,notice:'Identity verification is performed by Stripe, not by this platform'});
 }
 if(action==='connect-status'&&method==='GET'){
  const c=await env.DB.prepare('SELECT stripe_account_id FROM merchant_compliance WHERE store_id=?').bind(storeId).first<{stripe_account_id:string|null}>();
  if(!c?.stripe_account_id)return json({connected:false,chargesEnabled:false,payoutsEnabled:false,detailsSubmitted:false});
  if(!env.STRIPE_SECRET_KEY)return json({connected:true,verificationUnavailable:true});
  const s=await stripe(env,'accounts/'+encodeURIComponent(c.stripe_account_id));
  await env.DB.prepare("UPDATE merchant_compliance SET stripe_details_submitted=?,stripe_charges_enabled=?,stripe_payouts_enabled=?,stripe_reviewed_at=datetime('now') WHERE store_id=?")
   .bind(Number(!!s.details_submitted),Number(!!s.charges_enabled),Number(!!s.payouts_enabled),storeId).run();
  return json({connected:true,chargesEnabled:!!s.charges_enabled,payoutsEnabled:!!s.payouts_enabled,detailsSubmitted:!!s.details_submitted});
 }
 if(action==='pause'&&method==='POST'){
  const b=await readBody(req);if(typeof b.paused!=='boolean')return error('paused must be boolean');
  if(!b.paused){
   if(env.SALES_ENABLED!=='true')return error('Platform sales remain disabled until operator approval',503);
   const c=await env.DB.prepare('SELECT stripe_charges_enabled,stripe_payouts_enabled,consumer_terms_accepted_at FROM merchant_compliance WHERE store_id=?').bind(storeId).first<any>();
   const u=await env.DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(user.id).first<any>();
   if(!c?.stripe_charges_enabled||!c?.stripe_payouts_enabled||!c?.consumer_terms_accepted_at||!u?.email_verified_at)
    return error('Verified account, Stripe payout readiness and consumer disclosures required',403);
  }
  await env.DB.prepare('UPDATE stores SET sales_paused=? WHERE id=?').bind(b.paused?1:0,storeId).run();
  return json({paused:b.paused});
 }
 return null;
}
