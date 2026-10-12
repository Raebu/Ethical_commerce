import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {liveCheckoutConfigured} from '../src/commercial-utils.ts';
const complete={
 SALES_ENABLED:'true',
 COMMERCIAL_LAUNCH_APPROVED:'true',
 STRIPE_TAX_ENABLED:'true',
 NOTIFICATIONS_ENABLED:'true',
 STRIPE_SECRET_KEY:'sk_test_dummy',
 STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_dummy',
 RESEND_API_KEY:'re_dummy',
 EMAIL_FROM:'noreply@example.test'
};
test('live checkout is refused by default',()=>{
 assert.equal(liveCheckoutConfigured({} as any),false);
 assert.equal(liveCheckoutConfigured({SALES_ENABLED:'true'} as any),false);
});
test('one missing commercial safeguard prevents card charges',()=>{
 for(const key of Object.keys(complete)){
  const config={...complete,[key]:undefined};
  assert.equal(liveCheckoutConfigured(config as any),false,'Should refuse checkout without '+key);
 }
});
test('all configured safeguards are necessary, but separate seller approval is still required',()=>{
 assert.equal(liveCheckoutConfigured(complete as any),true);
});
