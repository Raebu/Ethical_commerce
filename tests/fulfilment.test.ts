import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {queueNotification,processNotifications} from '../src/notifications.ts';
class MockD1{
 conn=new DatabaseSync(':memory:');
 constructor(){
  this.conn.exec('PRAGMA foreign_keys=ON;');
  for(const file of ['0001_initial.sql','0002_abuse_controls.sql','0003_commercial_foundations.sql','0004_order_notifications.sql']){
   this.conn.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  this.conn.prepare("INSERT INTO users(id,email,password_hash) VALUES('owner','owner@example.com','stub')").run();
  this.conn.prepare("INSERT INTO stores(id,owner_user_id,slug,name) VALUES('store','owner','test','Test Store')").run();
  this.conn.prepare("INSERT INTO suppliers(id,store_id,name) VALUES('supplier','store','Test Supplier')").run();
  this.conn.prepare("INSERT INTO products(id,store_id,slug,name,price_minor,stock,status,supplier_id) VALUES('product','store','p','A test bag',1200,5,'published','supplier')").run();
  this.conn.prepare("INSERT INTO orders(id,store_id,client_key_hash,access_token_hash,subtotal_minor,stripe_connected_account,session_expires_at,status) VALUES('order','store','key','hash',1200,'acct_stub',9999999999,'paid')").run();
  this.conn.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price_minor,supplier_id) VALUES('item','order','product','A test bag',1,1200,'supplier')").run();
 }
 prepare(sql:string){
  const conn=this.conn;
  return {bind(...args:any[]){return {async run(){conn.prepare(sql).run(...args);return {success:true}},async first(){return conn.prepare(sql).get(...args)},async all(){return {results:conn.prepare(sql).all(...args)}}}}};
 }
 async batch(statements:any[]){
  this.conn.exec('BEGIN');
  try{for(const stmt of statements)await stmt.run();this.conn.exec('COMMIT')}
  catch(e){this.conn.exec('ROLLBACK');throw e}
 }
 close(){this.conn.close()}
}

test('order notification migration creates auditable supplier and email structures',()=>{
 const db=new MockD1();
 try{
  const tables=db.conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('purchase_orders','purchase_order_items','supplier_order_settings','notification_outbox')").all();
  assert.equal(tables.length,4);
  const cols=db.conn.prepare('PRAGMA table_info(order_items)').all() as Array<{name:string}>;
  assert.ok(cols.some(c=>c.name==='supplier_id'),'Order items must snapshot source suppliers');
  assert.equal(db.conn.prepare('SELECT supplier_id AS id FROM order_items WHERE id=?').get('item')?.id,'supplier');
 }finally{db.close()}
});
test('notifications queue once per event and remain disabled without explicit release gate',async()=>{
 const db=new MockD1();
 try{
  const env={DB:db,NOTIFICATIONS_ENABLED:'false',RESEND_API_KEY:'example',EMAIL_FROM:'noreply@example.com'} as any;
  const n={key:'buyer-paid:order',storeId:'store',orderId:'order',recipient:'customer@example.com',template:'buyer_paid' as const};
  await queueNotification(env,n);
  await queueNotification(env,n);
  const count=db.conn.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get() as {n:number};
  assert.equal(count.n,1,'Repeated payment events cannot create duplicate emails');
  const r=await processNotifications(env);
  assert.deepEqual(r,{processed:0,sent:0});
  assert.equal(db.conn.prepare('SELECT status FROM notification_outbox').get()?.status,'pending');
 }finally{db.close()}
});
test('suppliers cannot be emailed without separate seller authorisation',()=>{
 const db=new MockD1();
 try{
  const name=db.conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_order_settings'").get();
  assert.ok(name);
  assert.equal(db.conn.prepare('SELECT count(*) AS n FROM supplier_order_settings').get()?.n,0);
 }finally{db.close()}
});
