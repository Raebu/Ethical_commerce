import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {stripeWebhook,reconcileSessions} from '../src/commercial-webhooks.ts';

class TestD1{
 conn=new DatabaseSync(':memory:');
 constructor(){
  this.conn.exec('PRAGMA foreign_keys=ON;');
  for(const file of ['0001_initial.sql','0002_abuse_controls.sql','0003_commercial_foundations.sql',
    '0004_order_notifications.sql','0005_payment_recovery.sql']){
   this.conn.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  this.conn.prepare("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES('owner','seller@example.test','stub',datetime('now'))").run();
  this.conn.prepare("INSERT INTO stores(id,owner_user_id,slug,name) VALUES('store','owner','test-store','Seller')").run();
  this.conn.prepare("INSERT INTO products(id,store_id,slug,name,price_minor,stock,status,currency) VALUES('product','store','p','Ethical bag',1500,3,'published','GBP')").run();
 }
 prepare(sql:string){
  const conn=this.conn;
  return {
   bind(...params:any[]){
    return {
     async run(){return conn.prepare(sql).run(...params)},
     async first<T=any>():Promise<T|null>{return (conn.prepare(sql).get(...params) as T)||null},
     async all<T=any>(){return {results:conn.prepare(sql).all(...params) as T[]}}
    }
   }
  };
 }
 async batch(statements:any[]){
  this.conn.exec('BEGIN');
  try{for(const statement of statements)await statement.run();this.conn.exec('COMMIT')}
  catch(e){this.conn.exec('ROLLBACK');throw e}
 }
 seed({id='a1b2c3d4-1234-4000-8000-001122334455',state='pending_payment',session='cs_test_abc123',released=0}={}){
  const db=this.conn;
  db.prepare(`INSERT INTO orders (id,store_id,client_key_hash,access_token_hash,subtotal_minor,
   stripe_connected_account,stripe_session_id,status,session_expires_at,reservation_released)
   VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,'store',id,id,1500,'acct_test',session,state,Date.now()/1000-5000,released);
  db.prepare('INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price_minor) VALUES(?,?,?,?,?,?)')
   .run('item-'+id,id,'product','Ethical bag',1,1500);
  return id;
 }
 order(id:string){return this.conn.prepare('SELECT status,stripe_session_id FROM orders WHERE id=?').get(id) as any}
 incident(id:string){return this.conn.prepare('SELECT reason FROM payment_incidents WHERE order_id=?').get(id) as any}
 count(table:string){return (this.conn.prepare('SELECT COUNT(*) AS c FROM '+table).get() as {c:number}).c}
 close(){this.conn.close()}
}
async function signedWebhook(event:any,secret='whsec_test_secret',override?:string){
 const body=JSON.stringify(event),at=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const result=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(at+'.'+body));
 const signature=Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
 return new Request('https://commerce.example.test/api/webhooks/stripe',{
  method:'POST',headers:{'stripe-signature':'t='+at+',v1='+(override||signature)},body
 });
}
function eventFor(id:string,opts:{session?:string;account?:string;subtotal?:number;eventId?:string}={}){
 return {
  id:opts.eventId||'evt_accepted1',
  type:'checkout.session.completed',livemode:false,account:opts.account||'acct_test',
  data:{object:{
   id:opts.session||'cs_test_abc123',metadata:{order_id:id,store_id:'store'},
   payment_status:'paid',currency:'gbp',amount_subtotal:opts.subtotal??1500,
   payment_intent:'pi_good',customer_details:{email:'buyer@example.test'}
  }}
 };
}
test('signed Connect payment confirms one reserved order, fulfilment and outbox once',async()=>{
 const db=new TestD1(),env={DB:db,RUNTIME_TIER:'staging',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_test_secret',NOTIFICATIONS_ENABLED:'false'} as any;
 try{
  const id=db.seed(),event=eventFor(id);
  let res=await stripeWebhook(await signedWebhook(event),env);
  assert.equal(res.status,200,await res.text());
  assert.equal(db.order(id).status,'paid');
  assert.equal(db.count('order_fulfillment'),1);
  assert.equal(db.count('notification_outbox'),2);
  res=await stripeWebhook(await signedWebhook(event),env);
  assert.equal(res.status,200);
  assert.equal(db.count('notification_outbox'),2);
  assert.equal(db.count('stripe_events'),1);
 }finally{db.close()}
});
test('invalid webhook signature cannot change an order',async()=>{
 const db=new TestD1(),env={DB:db,RUNTIME_TIER:'staging',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_test_secret'} as any;
 try{
  const id=db.seed();
  const res=await stripeWebhook(await signedWebhook(eventFor(id),'whsec_test_secret','0'.repeat(64)),env);
  assert.equal(res.status,400);
  assert.equal(db.order(id).status,'pending_payment');
  assert.equal(db.count('stripe_events'),0);
 }finally{db.close()}
});
test('a wrong checkout session is rejected and recorded for operator review',async()=>{
 const db=new TestD1(),env={DB:db,RUNTIME_TIER:'staging',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_test_secret'} as any;
 try{
  const id=db.seed(),evt=eventFor(id,{session:'cs_test_wrong',eventId:'evt_wrong'});
  const res=await stripeWebhook(await signedWebhook(evt),env);
  assert.equal(res.status,200);
  assert.equal(db.order(id).status,'pending_payment');
  assert.equal(db.incident(id)?.reason,'session_mismatch');
  assert.equal(db.count('order_fulfillment'),0);
 }finally{db.close()}
});
test('a paid event after stock was released is never silently fulfilled',async()=>{
 const db=new TestD1(),env={DB:db,RUNTIME_TIER:'staging',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_test_secret'} as any;
 try{
  const id=db.seed({state:'cancelled',released:1});
  const res=await stripeWebhook(await signedWebhook(eventFor(id,{eventId:'evt_late'})),env);
  assert.equal(res.status,200);
  assert.equal(db.order(id).status,'cancelled');
  assert.equal(db.incident(id)?.reason,'late_paid_after_cancel');
  assert.equal(db.count('order_fulfillment'),0);
 }finally{db.close()}
});
test('signed delayed success can reconcile a known checkout-persistence incident',async()=>{
 const db=new TestD1(),env={DB:db,RUNTIME_TIER:'staging',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_test_secret'} as any;
 try{
  const id=db.seed({session:null as unknown as string});
  db.conn.prepare("INSERT INTO payment_incidents(id,order_id,store_id,reason) VALUES(?,?,?,'checkout_persistence_failed')")
   .run('incident',id,'store');
  const res=await stripeWebhook(await signedWebhook(eventFor(id,{session:'cs_test_recovered',eventId:'evt_recovered'})),env);
  assert.equal(res.status,200);
  assert.equal(db.order(id).stripe_session_id,'cs_test_recovered');
  assert.equal(db.order(id).status,'paid');
 }finally{db.close()}
});
test('reconciler never cancels a checkout lacking a known Stripe session',async()=>{
 const db=new TestD1(),env={DB:db,STRIPE_SECRET_KEY:'sk_test_unused'} as any;
 try{
  const id=db.seed({session:null as unknown as string});
  await reconcileSessions(env);
  assert.equal(db.order(id).status,'pending_payment');
  assert.equal(db.incident(id)?.reason,'missing_session_after_timeout');
 }finally{db.close()}
});
