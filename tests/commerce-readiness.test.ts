import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {liveCheckoutConfigured,stripeKeyMode,sandboxCheckoutConfigured,productionCheckoutConfigured} from '../src/commercial-utils.ts';
import {commissioningSnapshot,commissioningRoutes} from '../src/commissioning.ts';

const liveConfig={
 RUNTIME_TIER:'production', SALES_ENABLED:'true', COMMERCIAL_LAUNCH_APPROVED:'true',
 STRIPE_TAX_ENABLED:'true', NOTIFICATIONS_ENABLED:'true',
 STRIPE_SECRET_KEY:'sk_live_dummy', STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_dummy',
 RESEND_API_KEY:'re_dummy', EMAIL_FROM:'noreply@example.test'
};
const stageConfig={
 RUNTIME_TIER:'staging', TEST_CHECKOUT_ENABLED:'true', STRIPE_TAX_ENABLED:'true',
 STRIPE_SECRET_KEY:'sk_test_dummy', STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_stage'
};
test('production checkout remains disabled unless every live control and secret is present',()=>{
 assert.equal(liveCheckoutConfigured({} as any),false);
 assert.equal(liveCheckoutConfigured({SALES_ENABLED:'true'} as any),false);
 assert.equal(liveCheckoutConfigured(liveConfig as any),true);
 for(const k of Object.keys(liveConfig)){
  assert.equal(liveCheckoutConfigured({...liveConfig,[k]:undefined} as any),false,'Missing '+k+' must block live checkout');
 }
});
test('Stripe test and live secrets must not cross deployment tiers',()=>{
 assert.equal(stripeKeyMode('sk_test_123abc'),'test');
 assert.equal(stripeKeyMode('sk_live_123abc'),'live');
 assert.equal(stripeKeyMode(''),'missing');
 assert.equal(stripeKeyMode('rk_live_abc123'),'live');
 assert.equal(stripeKeyMode('bearer_confused'),'unrecognized');
 assert.equal(liveCheckoutConfigured({...liveConfig,STRIPE_SECRET_KEY:'sk_test_dummy'} as any),false);
 assert.equal(liveCheckoutConfigured({...stageConfig,STRIPE_SECRET_KEY:'sk_live_dummy'} as any),false);
 assert.equal(liveCheckoutConfigured({...liveConfig,RUNTIME_TIER:'staging'} as any),false);
 assert.equal(productionCheckoutConfigured(liveConfig as any),true);
 assert.equal(sandboxCheckoutConfigured(stageConfig as any),true);
 assert.equal(liveCheckoutConfigured(stageConfig as any),true);
 assert.equal(liveCheckoutConfigured({...stageConfig,TEST_CHECKOUT_ENABLED:'false'} as any),false);
 assert.equal(liveCheckoutConfigured({...stageConfig,RUNTIME_TIER:'production'} as any),false);
});
test('administrator checklist exposes only redacted readiness data',()=>{
 const obj=commissioningSnapshot(stageConfig as any);
 assert.equal(obj.tier,'staging');
 assert.equal(obj.stripeMode,'test');
 assert.equal(obj.sandboxCheckoutEnabled,true);
 assert.equal(obj.liveCheckoutEnabled,false);
 assert.ok(JSON.stringify(obj).includes('signed_stripe_webhook'));
 assert.equal(JSON.stringify(obj).includes('sk_test_dummy'),false);
 assert.equal(JSON.stringify(obj).includes('whsec_stage'),false);
});
test('commissioning endpoints reject visitors and never send email',async()=>{
 const noSessionEnv={...stageConfig,DB:{prepare:()=>{throw Error('No query required for missing auth')}}} as any;
 const r=await commissioningRoutes(new Request('https://example.com/api/commerce/admin/commissioning'),noSessionEnv);
 assert.equal(r?.status,401);
 const send=await commissioningRoutes(new Request('https://example.com/api/commerce/admin/test-email',{method:'POST'}),noSessionEnv);
 assert.equal(send?.status,401);
});
