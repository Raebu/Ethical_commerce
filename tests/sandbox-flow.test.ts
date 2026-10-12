import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {checkout,orderRoutes} from '../src/commercial-orders.ts';
import {stripeWebhook} from '../src/commercial-webhooks.ts';

const STORE='22222222-2222-4222-8222-222222222222';
const PRODUCT='33333333-3333-4333-8333-333333333333';
const USER='11111111-1111-4111-8111-111111111111';
const SUPPLIER='44444444-4444-4444-8444-444444444444';
const sessionId='cs_test_mock_ch_12345';
class D1Mock{
 conn=new DatabaseSync(':memory:');
 constructor(){
  this.conn.exec('PRAGMA foreign_keys=ON;');
  for(const file of ['0001_initial.sql','0002_abuse_controls.sql','0003_commercial_foundations.sql','0004_order_notifications.sql','0005_payment_recovery.sql'])
   this.conn.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  this.conn.prepare("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES(?,?,?,datetime('now'))").run(USER,'seller@example.test','not-a-real-password');
  this.conn.prepare("INSERT INTO stores(id,owner_user_id,slug,name,sales_paused) VALUES(?,?,?, ?,0)").run(STORE,USER,'fixture-store','Fixture Store');
  this.conn.prepare("INSERT INTO suppliers(id,store_id,name) VALUES(?,?,?)").run(SUPPLIER,STORE,'Fixture Supplier');
  this.conn.prepare("INSERT INTO products(id,store_id,supplier_id,slug,name,description,price_minor,currency,stock,status) VALUES(?,?,?,?,?,?,?,'GBP',3,'published')")
   .run(PRODUCT,STORE,SUPPLIER,'fixture-bag','Fixture bag','Locally simulated checkout product',1500);
  this.conn.prepare(`INSERT INTO merchant_compliance(store_id,legal_seller_name,return_policy_url,shipping_policy_url,terms_url,privacy_url,
    consumer_terms_accepted_at,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled)
   VALUES(?,'Test Seller','https://example.test/returns','https://example.test/shipping',
   'https://example.test/terms','https://example.test/privacy',datetime('now'),'acct_test_mock',1,1)`).run(STORE);
 }
 prepare(sql:string){
  const conn=this.conn;
  return {
   bind(...params:any[]){
    return {
     async run(){return conn.prepare(sql).run(...params)},
     async first<T=any>():Promise<T|null>{return (conn.prepare(sql).get(...params) as T)||null},
     async all<T=any>(){return {results:conn.prepare(sql).all(...params) as T[]}}
    };
   }
  };
 }
 async batch(statements:any[]){
  this.conn.exec('BEGIN');
  try{for(const statement of statements)await statement.run();this.conn.exec('COMMIT')}
  catch(err){this.conn.exec('ROLLBACK');throw err}
 }
 first(sql:string){return this.conn.prepare(sql).get() as any}
 close(){this.conn.close()}
}
const staging={
 RUNTIME_TIER:'staging',TEST_CHECKOUT_ENABLED:'true',STRIPE_TAX_ENABLED:'true',
 STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_mock',
 NOTIFICATIONS_ENABLED:'false',SALES_ENABLED:'false',PUBLISHING_ENABLED:'false'
};
const commercialReq=(idempotencyKey=crypto.randomUUID(),quantity=1)=>
 new Request('https://stage.example.test/api/commerce/checkout',{method:'POST',
 headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.19'},
 body:JSON.stringify({storeId:STORE,idempotencyKey,items:[{productId:PRODUCT,quantity}],acceptPolicies:true})});
async function webhookReq(orderId:string){
 const event={id:'evt_'+orderId.replaceAll('-',''),type:'checkout.session.completed',livemode:false,
  account:'acct_test_mock',data:{object:{
   id:sessionId,metadata:{order_id:orderId,store_id:STORE},
   payment_status:'paid',currency:'gbp',amount_subtotal:1500,payment_intent:'pi_mock_1',
   customer_details:{email:'buyer@example.test'}
  }}};
 const body=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('whsec_mock'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hmac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body));
 const hash=Array.from(new Uint8Array(hmac),x=>x.toString(16).padStart(2,'0')).join('');
 return new Request('https://stage.example.test/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':'t='+timestamp+',v1='+hash},body});
}
test('complete offline checkout → signed payment → fulfilment queue; no real provider requests',async()=>{
 const db=new D1Mock();
 const calls:Array<{url:string;headers:Headers;body:string}>=[];
 const original=globalThis.fetch;
 globalThis.fetch=async (input:any,init:any)=>{
  const url=String(input);
  if(url!=='https://api.stripe.com/v1/checkout/sessions')throw Error('Unexpected outbound provider: '+url);
  calls.push({url,headers:new Headers(init?.headers),body:String(init?.body||'')});
  return new Response(JSON.stringify({id:sessionId,url:'https://checkout.stripe.com/c/pay/'+sessionId}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const env={...staging,DB:db,ASSETS:null} as any;
  const key=crypto.randomUUID(),res=await checkout(commercialReq(key),env);
  assert.equal(res.status,201,await res.clone().text());
  const data=await res.json() as any;
  assert.equal(data.checkoutUrl,'https://checkout.stripe.com/c/pay/'+sessionId);
  assert.match(data.customerToken,/^[a-f0-9]{64}$/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].headers.get('Stripe-Account'),'acct_test_mock');
  assert.match(calls[0].headers.get('Idempotency-Key')||'',/^ec-checkout-/);
  assert.equal(new URLSearchParams(calls[0].body).get('automatic_tax[enabled]'),'true');
  assert.equal(db.first('SELECT stock FROM products').stock,2);
  assert.equal(db.first('SELECT status FROM orders').status,'pending_payment');
  assert.equal(db.first('SELECT supplier_id FROM order_items').supplier_id,SUPPLIER);
  const duplicate=await checkout(commercialReq(key),env);
  assert.equal(duplicate.status,409,'Checkout key must not create another charge');
  assert.equal(calls.length,1);
  const paid=await stripeWebhook(await webhookReq(data.orderId),env);
  assert.equal(paid.status,200,await paid.clone().text());
  assert.equal(db.first('SELECT status FROM orders').status,'paid');
  assert.equal(db.first('SELECT COUNT(*) as count FROM order_fulfillment').count,1);
  assert.equal(db.first('SELECT COUNT(*) as count FROM notification_outbox').count,2);
  assert.equal(db.first('SELECT stock FROM products').stock,2);
  const replay=await stripeWebhook(await webhookReq(data.orderId),env);
  assert.equal(replay.status,200);
  assert.equal(db.first('SELECT COUNT(*) AS count FROM order_fulfillment').count,1);
  assert.equal(db.first('SELECT COUNT(*) AS count FROM notification_outbox').count,2);
  const lookup=await orderRoutes(new Request('https://stage.example.test/api/commerce/customer-order',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({orderId:data.orderId,customerToken:data.customerToken})
  }),env);
  assert.equal(lookup?.status,200);
  const customerData=await lookup?.json() as any;
  assert.equal(customerData.order.status,'paid');
  assert.equal(customerData.items.length,1);
 }finally{globalThis.fetch=original;db.close()}
});
test('staging checkout cannot bypass test-mode key, tax or enabled switch',async()=>{
 const cases=[
  {...staging,STRIPE_SECRET_KEY:'sk_live_should_be_blocked'},
  {...staging,STRIPE_TAX_ENABLED:'false'},
  {...staging,TEST_CHECKOUT_ENABLED:'false'},
  {...staging,RUNTIME_TIER:'production'}
 ];
 for(const flags of cases){
  const db=new D1Mock();
  try{
   const res=await checkout(commercialReq(),{...flags,DB:db} as any);
   assert.equal(res.status,503);
   assert.equal(db.first('SELECT count(*) AS n FROM orders').n,0);
   assert.equal(db.first('SELECT stock FROM products').stock,3);
  }finally{db.close()}
 }
});
