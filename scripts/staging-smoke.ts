// Read-only and deliberately blocked-action checks against staging.
// NEVER authenticates as a merchant or sends real payments/emails.
const DEFAULT_ORIGIN='https://ethical-commerce-staging.martin-e01.workers.dev';
const knownProduction='https://ethical-commerce.martin-e01.workers.dev';

export function safeStagingOrigin(value=DEFAULT_ORIGIN){
 const url=new URL(value);
 if(url.origin!==DEFAULT_ORIGIN||url.origin===knownProduction||url.pathname!=='/'||url.search||url.hash)
  throw Error('Refusing to probe an unapproved or production Worker');
 return url.origin;
}

export async function stagingSmoke({origin=DEFAULT_ORIGIN,transport=fetch}:{
 origin?:string;transport?:typeof fetch
}={}):Promise<Array<{name:string;status:number}>>{
 const target=safeStagingOrigin(origin);
 async function call(path:string,method='GET',body?:unknown){
  const resp=await transport(target+path,{
   method,
   headers:body===undefined?{}:{'content-type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body),
   signal:AbortSignal.timeout(12000),
   cache:'no-store',
   redirect:'error'
  });
  let decoded:any={};
  try{decoded=await resp.json()}catch{throw Error('Expected JSON from staging '+path)}
  return {status:resp.status,data:decoded};
 }
 const output:Array<{name:string;status:number}>=[];
 const health=await call('/api/health');
 if(health.status!==200||health.data.ok!==true||health.data.payments!=='disabled'
   ||health.data.paymentMode!=='none'||health.data.external_publishing!=='disabled')
  throw Error('Staging health or no-commerce gates failed');
 output.push({name:'service and payments disabled',status:health.status});
 const readiness=await call('/api/ready');
 if(readiness.status!==200||readiness.data.ready!==true||readiness.data.schema!=='available')
  throw Error('Staging schema is not ready');
 output.push({name:'isolated database readiness',status:readiness.status});
 const admin=await call('/api/commerce/admin/commissioning');
 if(admin.status!==401)throw Error('Private commissioning endpoint is not protected');
 output.push({name:'admin-only commissioning access',status:admin.status});
 const email=await call('/api/commerce/admin/test-email','POST',{confirm:'SEND_SELF_TEST'});
 if(email.status!==401)throw Error('Unauthenticated commissioning email action was not blocked');
 output.push({name:'no unauthorised email sends',status:email.status});
 const fakeOrder=await call('/api/commerce/checkout','POST',{
  storeId:'11111111-1111-4111-8111-111111111111',
  idempotencyKey:'22222222-2222-4222-8222-222222222222',
  items:[{productId:'33333333-3333-4333-8333-333333333333',quantity:1}],acceptPolicies:true
 });
 if(fakeOrder.status!==503)throw Error('Staging checkout unexpectedly accepted a charge attempt');
 output.push({name:'Stripe checkout safely gated off',status:fakeOrder.status});
 const webhook=await call('/api/webhooks/stripe','POST',{id:'evt_dummy',type:'checkout.session.completed'});
 if(webhook.status!==503)throw Error('Webhook unexpectedly accepted without signing secret');
 output.push({name:'unsigned Stripe events blocked',status:webhook.status});
 const publicProducts=await call('/api/public/products');
 if(publicProducts.status!==200||!Array.isArray(publicProducts.data.products))
  throw Error('Staging public catalogue API failed');
 output.push({name:'public product API',status:publicProducts.status});
 return output;
}

if(process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url){
 stagingSmoke().then(results=>{
  for(const x of results)console.log('PASS: '+x.name+' (HTTP '+x.status+')');
  console.log('Staging smoke passed. No customer payment or email was attempted.');
 },err=>{console.error('Staging smoke failed:',err.message);process.exitCode=1});
}
