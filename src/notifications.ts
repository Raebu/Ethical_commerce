import type {CommerceEnv} from './commercial-utils';
import {htmlSafe,safeEmail} from './commercial-utils';

export type NotificationTemplate='buyer_paid'|'seller_paid'|'buyer_tracking'|'seller_consumer_request'|'supplier_purchase_order'|'buyer_refund';
export interface PendingNotification {
 key:string;storeId:string;orderId?:string|null;purchaseOrderId?:string|null;
 recipient:string;template:NotificationTemplate;
}
export async function queueNotification(env:CommerceEnv,n:PendingNotification):Promise<void>{
 const to=safeEmail(n.recipient);
 if(!to||n.key.length>180||!n.key)return;
 await env.DB.prepare(`INSERT OR IGNORE INTO notification_outbox
 (id,event_key,store_id,order_id,purchase_order_id,recipient_email,template)
 VALUES(?,?,?,?,?,?,?)`)
 .bind(crypto.randomUUID(),n.key,n.storeId,n.orderId||null,n.purchaseOrderId||null,to,n.template).run();
}
export async function queuePaidNotifications(env:CommerceEnv,orderId:string):Promise<void>{
 const order=await env.DB.prepare(`SELECT o.id,o.store_id,o.customer_email,o.status,u.email AS owner_email,
 u.email_verified_at FROM orders o JOIN stores s ON s.id=o.store_id
 JOIN users u ON u.id=s.owner_user_id WHERE o.id=?`).bind(orderId).first<any>();
 if(!order||!['paid','fulfilled','partially_refunded','refunded'].includes(order.status))return;
 if(order.customer_email)await queueNotification(env,{key:'buyer-paid:'+orderId,storeId:order.store_id,orderId,recipient:order.customer_email,template:'buyer_paid'});
 if(order.owner_email&&order.email_verified_at)await queueNotification(env,{key:'seller-paid:'+orderId,storeId:order.store_id,orderId,recipient:order.owner_email,template:'seller_paid'});
}
export async function queueTrackingNotification(env:CommerceEnv,orderId:string,trackingReference:string):Promise<void>{
 const order=await env.DB.prepare("SELECT store_id,customer_email,status FROM orders WHERE id=?").bind(orderId).first<any>();
 if(!order?.customer_email||!['paid','fulfilled'].includes(order.status))return;
 await queueNotification(env,{key:'buyer-tracking:'+orderId+':'+trackingReference,storeId:order.store_id,orderId,recipient:order.customer_email,template:'buyer_tracking'});
}
export async function queueConsumerRequestNotification(env:CommerceEnv,orderId:string,requestId:string):Promise<void>{
 const data=await env.DB.prepare(`SELECT o.store_id,u.email AS owner_email,u.email_verified_at
 FROM orders o JOIN stores s ON s.id=o.store_id JOIN users u ON u.id=s.owner_user_id WHERE o.id=?`)
 .bind(orderId).first<any>();
 if(!data?.owner_email||!data.email_verified_at)return;
 await queueNotification(env,{key:'seller-request:'+requestId,storeId:data.store_id,orderId,recipient:data.owner_email,template:'seller_consumer_request'});
}
export async function queueRefundNotification(env:CommerceEnv,orderId:string,refundId:string):Promise<void>{
 const o=await env.DB.prepare("SELECT store_id,customer_email FROM orders WHERE id=?").bind(orderId).first<any>();
 if(o?.customer_email)await queueNotification(env,{key:'buyer-refund:'+orderId+':'+refundId,storeId:o.store_id,orderId,recipient:o.customer_email,template:'buyer_refund'});
}
type OutboxRow={
 id:string;event_key:string;store_id:string;order_id:string|null;purchase_order_id:string|null;
 recipient_email:string;template:NotificationTemplate;attempts:number;
};
async function renderEmail(env:CommerceEnv,n:OutboxRow):Promise<{subject:string;html:string;text:string}|null>{
 const store=await env.DB.prepare('SELECT name FROM stores WHERE id=?').bind(n.store_id).first<{name:string}>();
 if(!store)return null;
 const storeName=store.name;
 const safeName=htmlSafe(storeName),safeOrder=htmlSafe(n.order_id||''),base='Ethical Commerce';
 let subject='',message='';
 if(n.template==='buyer_paid'){
  subject='Your order has been confirmed — '+storeName;
  message='Stripe has confirmed payment for order '+safeOrder+'. The seller will arrange fulfilment. This confirmation does not imply independent ethical certification.';
 }else if(n.template==='seller_paid'){
  subject='New paid order for '+storeName;
  message='Payment is confirmed for order '+safeOrder+'. Sign in to Seller Studio to approve supplier purchase orders and arrange dispatch.';
 }else if(n.template==='buyer_tracking'){
  const f=await env.DB.prepare('SELECT carrier,tracking_reference,tracking_url,status FROM order_fulfillment WHERE order_id=?').bind(n.order_id).first<any>();
  if(!f||!['dispatched','delivered'].includes(f.status)||!f.tracking_reference)return null;
  subject='Delivery update for order '+(n.order_id||'');
  message='Your order '+safeOrder+' has a shipping update. Carrier: '+htmlSafe(f.carrier)+'; tracking reference: '+htmlSafe(f.tracking_reference)+'.';
  // Never blindly interpolate third-party untrusted links into email HTML.
 }else if(n.template==='seller_consumer_request'){
  subject='Customer request requires review — '+storeName;
  message='A customer has submitted an order or consumer-rights request for '+safeOrder+'. Please review promptly in Seller Studio. Consumer statutory rights continue to apply.';
 }else if(n.template==='supplier_purchase_order'){
  const po=await env.DB.prepare(`SELECT po.id,po.status,po.supplier_id,s.name AS supplier_name
   FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=?`).bind(n.purchase_order_id).first<any>();
  if(!po||!['queued','requested','accepted'].includes(po.status))return null;
  const items=await env.DB.prepare('SELECT product_name,sku,quantity FROM purchase_order_items WHERE purchase_order_id=?').bind(po.id).all<any>();
  subject='Purchase order request '+po.id+' — '+storeName;
  message='An authorised merchant has requested a purchase order from your organisation. Order reference: '+htmlSafe(po.id)+'.<ul>'+
   (items.results||[]).map(i=>'<li>'+htmlSafe(i.product_name)+' — SKU '+htmlSafe(i.sku)+' × '+Number(i.quantity)+'</li>').join('')+
   '</ul>No personal customer address is included. Contact the merchant through your existing approved fulfilment arrangement. Do not dispatch without a confirmed delivery arrangement.';
 }else if(n.template==='buyer_refund'){
  subject='Refund update for order '+(n.order_id||'');
  message='A refund update has been recorded for order '+safeOrder+'. The final amount and payment timing are determined by the payment provider. Contact the seller for details.';
 }else return null;
 const html='<div style="font-family:system-ui,sans-serif;max-width:600px"><h2>'+htmlSafe(base)+'</h2><p><strong>'+safeName+'</strong></p><p>'+message+'</p><p style="font-size:12px;color:#667">Please contact the seller directly for statutory return and consumer-rights requests. This is a transactional message, not marketing.</p></div>';
 const text=message.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'");
 return {subject,html,text};
}
export async function processNotifications(env:CommerceEnv,limit=12):Promise<{processed:number;sent:number}>{
 if(env.NOTIFICATIONS_ENABLED!=='true'||!env.RESEND_API_KEY||!env.EMAIL_FROM)return {processed:0,sent:0};
 const now=Date.now(),results=await env.DB.prepare(
  "SELECT id FROM notification_outbox WHERE ((status='pending' OR status='failed') AND retry_after<=?) OR (status='sending' AND lease_until<?) ORDER BY created_at ASC LIMIT ?"
 ).bind(now,now,Math.min(Math.max(limit,1),20)).all<{id:string}>();
 let processed=0,sent=0;
 for(const candidate of results.results||[]){
  // Lease claims are atomic; stalled invocations can recover after five minutes.
  const n=await env.DB.prepare(`UPDATE notification_outbox SET status='sending',lease_until=?,attempts=attempts+1
   WHERE id=? AND attempts<6 AND (((status='pending' OR status='failed') AND retry_after<=?) OR (status='sending' AND lease_until<?))
   RETURNING id,event_key,store_id,order_id,purchase_order_id,recipient_email,template,attempts`)
   .bind(now+300000,candidate.id,now,now).first<OutboxRow>();
  if(!n)continue;
  processed++;
  try{
   const email=await renderEmail(env,n);
   if(!email){await env.DB.prepare("UPDATE notification_outbox SET status='cancelled',lease_until=0 WHERE id=?").bind(n.id).run();continue}
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{
    authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json','idempotency-key':n.event_key
   },body:JSON.stringify({from:env.EMAIL_FROM,to:[n.recipient_email],subject:email.subject,html:email.html,text:email.text})});
   if(!response.ok)throw Error(response.status===429||response.status>=500?'transient':'rejected');
   const result=await response.json() as {id?:string};
   await env.DB.prepare("UPDATE notification_outbox SET status='sent',provider_message_id=?,sent_at=datetime('now'),lease_until=0 WHERE id=?")
    .bind(result.id||'',n.id).run();
   if(n.template==='supplier_purchase_order'&&n.purchase_order_id){
    await env.DB.prepare("UPDATE purchase_orders SET status='requested',updated_at=datetime('now') WHERE id=? AND status='queued'").bind(n.purchase_order_id).run();
   }
   sent++;
  }catch(err){
   const retry=Date.now()+Math.min(3600000,15000*2**Math.min(n.attempts,8));
   const failed=n.attempts>=6;
   await env.DB.prepare("UPDATE notification_outbox SET status=?,last_error_class=?,retry_after=?,lease_until=0 WHERE id=?")
    .bind('failed',err instanceof Error&&err.message==='rejected'?'provider_rejected':'delivery_unavailable',failed?9007199254740991:retry,n.id).run();
  }
 }
 return {processed,sent};
}
