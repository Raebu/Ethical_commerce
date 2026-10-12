import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reserveStockStatements,cancelUnpaid} from '../src/inventory.ts';

type Params=(string|number|null)[];
type Statement={sql:string;params:Params;bind:(...args:Params)=>Statement};
class LocalD1 {
 conn=new DatabaseSync(':memory:');
 prepare(sql:string):Statement {
  const statement:Statement={sql,params:[],bind(...params:Params){this.params=params;return this}};
  return statement;
 }
 async batch(statements:Statement[]){
  this.conn.exec('BEGIN');
  try {
   for(const statement of statements){
    this.conn.prepare(statement.sql).run(...statement.params);
   }
   this.conn.exec('COMMIT');
  }catch(e){
   this.conn.exec('ROLLBACK');
   throw e;
  }
 }
 setup(){
  this.conn.exec('PRAGMA foreign_keys=ON;');
  const base=readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
  const abuse=readFileSync(new URL('../migrations/0002_abuse_controls.sql',import.meta.url),'utf8');
  const commerce=readFileSync(new URL('../migrations/0003_commercial_foundations.sql',import.meta.url),'utf8');
  assert.equal(/CREATE\s+TRIGGER/i.test(commerce.replace(/--[^\n]*/g,'')),false,'Remote D1 migration must not rely on trigger statements');
  this.conn.exec(base);this.conn.exec(abuse);this.conn.exec(commerce);
  const tables=this.conn.prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name IN ('orders','order_items','merchant_compliance')").get() as {n:number};
  assert.equal(tables.n,3);
  this.conn.prepare("INSERT INTO users(id,email,password_hash) VALUES('owner','owner@example.test','stub')").run();
  this.conn.prepare("INSERT INTO stores(id,owner_user_id,slug,name) VALUES('store','owner','test-store','Test Store')").run();
  this.conn.prepare("INSERT INTO products(id,store_id,slug,name,price_minor,stock,status,currency) VALUES('product1','store','p1','Cotton bag',1000,3,'published','GBP')").run();
  this.conn.prepare("INSERT INTO products(id,store_id,slug,name,price_minor,stock,status,currency) VALUES('product2','store','p2','Wool hat',1500,1,'published','GBP')").run();
 }
 async reserve(id:string,items:Array<{id:string;name:string;price_minor:number;quantity:number}>){
  await this.batch([
   this.prepare("INSERT INTO orders(id,store_id,client_key_hash,access_token_hash,subtotal_minor,stripe_connected_account,session_expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id,'store','key-'+id,'secret-'+id,1000,'acct_test',9999999999),
   ...reserveStockStatements(this as unknown as Parameters<typeof reserveStockStatements>[0],id,
    items.map(item=>({...item,store_id:'store'}))) as unknown as Statement[]
  ]);
 }
 stock(id:string){return (this.conn.prepare('SELECT stock FROM products WHERE id=?').get(id) as {stock:number}).stock}
 orders(){return (this.conn.prepare('SELECT COUNT(*) AS n FROM orders').get() as {n:number}).n}
 close(){this.conn.close()}
}

test('0003 commercial schema is valid without triggers and reservations are atomic',async()=>{
 const db=new LocalD1();try{
  db.setup();
  await db.reserve('order1',[{id:'product1',name:'Cotton bag',price_minor:1000,quantity:2}]);
  assert.equal(db.stock('product1'),1);
  await assert.rejects(db.reserve('order2',[{id:'product1',name:'Cotton bag',price_minor:1000,quantity:2}]));
  assert.equal(db.orders(),1,'Insufficient stock must roll back the order insert');
  assert.equal(db.stock('product1'),1,'Failed reservations cannot remove stock');
  await cancelUnpaid(db as unknown as Parameters<typeof cancelUnpaid>[0],'order1');
  assert.equal(db.stock('product1'),3);
  await cancelUnpaid(db as unknown as Parameters<typeof cancelUnpaid>[0],'order1');
  assert.equal(db.stock('product1'),3,'Cancellation must never return stock twice');
  const released=db.conn.prepare('SELECT status,reservation_released FROM orders WHERE id=?').get('order1') as any;
  assert.equal(released.status,'cancelled');
  assert.equal(released.reservation_released,1);
 }finally{db.close()}
});

test('multi-product reservations roll back all line items when one item is unavailable',async()=>{
 const db=new LocalD1();try{
  db.setup();
  await assert.rejects(db.reserve('order3',[
   {id:'product1',name:'Cotton bag',price_minor:1000,quantity:2},
   {id:'product2',name:'Wool hat',price_minor:1500,quantity:2}
  ]));
  assert.equal(db.orders(),0);
  assert.equal(db.stock('product1'),3);
  assert.equal(db.stock('product2'),1);
  const items=db.conn.prepare('SELECT count(*) AS n FROM order_items').get() as {n:number};
  assert.equal(items.n,0);
 }finally{db.close()}
});

test('price changes reject reservations and paid orders cannot release stock',async()=>{
 const db=new LocalD1();try{
  db.setup();
  await assert.rejects(db.reserve('stale-price',[{id:'product1',name:'Cotton bag',price_minor:999,quantity:1}]));
  assert.equal(db.orders(),0);
  await db.reserve('paid-order',[{id:'product1',name:'Cotton bag',price_minor:1000,quantity:1}]);
  db.conn.prepare("UPDATE orders SET status='paid' WHERE id='paid-order'").run();
  await cancelUnpaid(db as unknown as Parameters<typeof cancelUnpaid>[0],'paid-order');
  assert.equal(db.stock('product1'),2);
  const order=db.conn.prepare("SELECT status,reservation_released FROM orders WHERE id='paid-order'").get() as any;
  assert.equal(order.status,'paid');assert.equal(order.reservation_released,0);
 }finally{db.close()}
});
