import type {CommerceEnv} from './commercial-utils.ts';
import {needLogin,isResponse,safeEmail,stripeKeyMode,sandboxCheckoutConfigured,productionCheckoutConfigured,stripe} from './commercial-utils.ts';
import {json,error} from './security.ts';
import {throttle} from './abuse.ts';

export function commissioningSnapshot(env:CommerceEnv){
 const staging=env.RUNTIME_TIER==='staging',production=env.RUNTIME_TIER==='production';
 const stripeMode=stripeKeyMode(env.STRIPE_SECRET_KEY);
 const checkpoints=[
  {name:'deployment_tier',passed:staging||production},
  {name:'stripe_secret_configured',passed:stripeMode==='test'||stripeMode==='live'},
  {name:'stripe_mode_matches_tier',passed:(staging&&stripeMode==='test')||(production&&stripeMode==='live')},
  {name:'signed_stripe_webhook',passed:!!env.STRIPE_CONNECT_WEBHOOK_SECRET},
  {name:'automatic_tax_approved',passed:env.STRIPE_TAX_ENABLED==='true'},
  {name:'transactional_sender_configured',passed:!!env.RESEND_API_KEY&&!!safeEmail(env.EMAIL_FROM)},
  {name:'staging_isolated',passed:staging&&env.TEST_CHECKOUT_ENABLED==='true'},
  {name:'production_operator_approval',passed:production&&env.COMMERCIAL_LAUNCH_APPROVED==='true'},
  {name:'notifications_enabled',passed:env.NOTIFICATIONS_ENABLED==='true'}
 ];
 return {
  tier:staging?'staging':production?'production':'unconfigured',
  stripeMode,
  sandboxCheckoutEnabled:sandboxCheckoutConfigured(env),
  liveCheckoutEnabled:productionCheckoutConfigured(env),
  externalPublishingEnabled:env.PUBLISHING_ENABLED==='true',
  checks:checkpoints,
  notice:'Configuration evidence only. Does not validate real Stripe merchant status, tax treatment, supplier permission, email delivery or regulatory approval.'
 };
}

/**
 * Operator-initiated, read-only call to Stripe. Never expose its secret key,
 * account ID, company details, documents or detailed requirement data.
 */
export async function stripeAccountReadiness(env:CommerceEnv){
 const mode=stripeKeyMode(env.STRIPE_SECRET_KEY);
 const tier=env.RUNTIME_TIER;
 if(mode==='missing'||mode==='unrecognized')return {configured:false,mode,providerChecked:false,reason:'No valid Stripe key installed on this Worker'};
 if((tier==='staging'&&mode!=='test')||(tier==='production'&&mode!=='live')||!['staging','production'].includes(tier||''))
  return {configured:true,mode,providerChecked:false,reason:'Stripe key is not permitted in this deployment tier'};
 try{
  const account=await stripe(env,'account');
  const chargesEnabled=account?.charges_enabled===true;
  const payoutsEnabled=account?.payouts_enabled===true;
  const cardPayments=typeof account?.capabilities?.card_payments==='string'?account.capabilities.card_payments:'unknown';
  const transfers=typeof account?.capabilities?.transfers==='string'?account.capabilities.transfers:'unknown';
  const outstandingRequirements=Array.isArray(account?.requirements?.currently_due)?account.requirements.currently_due.length>0:null;
  return {
   configured:true,mode,providerChecked:true,
   accountType:account?.type||'unknown',
   country:account?.country||'unknown',
   chargesEnabled,payoutsEnabled,cardPayments,transfers,outstandingRequirements,
   readyForTestCardCheckout:chargesEnabled&&cardPayments==='active'&&tier==='staging',
   note:'This is a read-only snapshot of the configured Stripe account, not proof of platform Connect approval, seller compliance or a successful payment.'
  };
 }catch{
  return {configured:true,mode,providerChecked:false,reason:'Stripe account lookup failed. Verify the secret and provider permissions without disclosing the key.'};
 }
}

/** No secrets, Stripe account ids, buyer addresses, tokens or personally-identifying data in diagnostics. */
export async function commissioningRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(!['/api/commerce/admin/commissioning','/api/commerce/admin/test-email','/api/commerce/admin/stripe-status'].includes(path))return null;
 const user=await needLogin(req,env);if(isResponse(user))return user;
 if(!user.is_platform_admin)return error('Platform administrator required',403);
 if(path.endsWith('/commissioning')&&req.method==='GET')return json(commissioningSnapshot(env));
 if(path.endsWith('/stripe-status')&&req.method==='GET'){
  const limit=await throttle(req,env,'commissioning-stripe-status',user.id,6,3600);
  if(limit)return limit;
  return json(await stripeAccountReadiness(env));
 }
 if(path.endsWith('/test-email')&&req.method==='POST'){
  const limited=await throttle(req,env,'commissioning-test-email',user.id,2,3600);if(limited)return limited;
  if(!env.RESEND_API_KEY||!safeEmail(env.EMAIL_FROM))return error('Transactional sending not configured',503);
  const record=await env.DB.prepare('SELECT email,email_verified_at FROM users WHERE id=?').bind(user.id).first<{email:string;email_verified_at:string|null}>();
  if(!record?.email_verified_at||!safeEmail(record.email))return error('Operator must verify their account email first',403);
  let data:unknown;
  try{data=await req.json()}catch{return error('Expected JSON confirmation',400)}
  if(!data||typeof data!=='object'||(data as any).confirm!=='SEND_SELF_TEST')return error('Explicit operator confirmation required',403);
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{
    Authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json'
   },body:JSON.stringify({
    from:env.EMAIL_FROM,to:[record.email],
    subject:'Ethical Commerce transactional email test',
    html:'<p>Ethical Commerce transactional email is configured for a self-test.</p><p>This is a commissioning test only. No real customer purchase or supplier contact has occurred.</p>'
   })});
   if(!response.ok)return error('Email provider did not accept the test message',502);
   return json({accepted:true,recipient:'your verified account email',notice:'Accepted by provider, not proof of inbox delivery'});
  }catch{return error('Test email delivery unavailable',503)}
 }
 return error('Unsupported commissioning operation',405);
}
