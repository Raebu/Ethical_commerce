import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {stripeAccountReadiness,commissioningRoutes} from '../src/commissioning.ts';

test('Stripe account probe never contacts Stripe when no key exists',async()=>{
 const r=await stripeAccountReadiness({RUNTIME_TIER:'staging'} as any);
 assert.equal(r.providerChecked,false);
 assert.equal(r.configured,false);
});
test('live Stripe keys cannot be queried through staging',async()=>{
 const r=await stripeAccountReadiness({RUNTIME_TIER:'staging',STRIPE_SECRET_KEY:'sk_live_testfixture'} as any);
 assert.equal(r.providerChecked,false);
 assert.match(r.reason||'',/not permitted/);
});
test('read-only staging Stripe account health redacts all credential and legal details',async()=>{
 const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async(input:any,options:any)=>{
  calls++;
  assert.equal(input,'https://api.stripe.com/v1/account');
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer sk_test_mocksecret');
  return new Response(JSON.stringify({
   id:'acct_privateid123',type:'standard',country:'GB',business_profile:{name:'private legal company'},
   charges_enabled:false,payouts_enabled:false,capabilities:{card_payments:'inactive',transfers:'inactive'},
   requirements:{currently_due:['company.verification.document']}
  }),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const r=await stripeAccountReadiness({RUNTIME_TIER:'staging',STRIPE_SECRET_KEY:'sk_test_mocksecret'} as any);
  assert.equal(calls,1);
  assert.equal(r.providerChecked,true);
  assert.equal(r.chargesEnabled,false);
  assert.equal(r.payoutsEnabled,false);
  assert.equal(r.readyForTestCardCheckout,false);
  assert.equal(r.outstandingRequirements,true);
  assert.equal(JSON.stringify(r).includes('sk_test_mocksecret'),false);
  assert.equal(JSON.stringify(r).includes('acct_privateid123'),false);
  assert.equal(JSON.stringify(r).includes('private legal company'),false);
 }finally{globalThis.fetch=original}
});
test('Stripe account probe requires platform administrator session',async()=>{
 const res=await commissioningRoutes(new Request('https://example.test/api/commerce/admin/stripe-status'),{DB:{prepare(){throw Error('should not query without session')}}} as any);
 assert.equal(res?.status,401);
});
