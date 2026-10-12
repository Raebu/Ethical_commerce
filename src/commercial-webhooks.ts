import {CommerceEnv,stripe,stripeSignatureValid} from './commercial-utils.ts';
import {json,error} from './security.ts';
import {cancelUnpaid} from './inventory.ts';
import {queuePaidNotifications,queueRefundNotification} from './notifications.ts';
import {paymentIncident} from './payment-recovery.ts';
type StripeEvent={id:string;type:string;account?:string;data?:{object?:any}};
async function applyCompleted(env:CommerceEnv,event:StripeEvent,session:any):Promise<void>{
 const orderId=session?.metadata?.order_id||session?.client_reference_id,storeId=session?.metadata?.store_id;
 if(!/^[a-f0-9-]{36}$/.test(orderId||''))return;
 const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
 if(!order)return;
 if(!event.account||order.store_id!==storeId||event.account!==order.stripe_connected_account)return;
 if(session.payment_status!=='paid'||session.currency?.toLowerCase()!=='gbp'
   ||session.amount_subtotal!==order.subtotal_minor){
  await paymentIncident(env,order.id,'session_mismatch',event.id);
  return;
 }
 if(order.status==='cancelled'){
  await paymentIncident(env,order.id,'late_paid_after_cancel',event.id);
  return; // Never fulfil a payment against released stock.
 }
 if(order.status!=='pending_payment')return;
 if(order.reservation_released){
  await paymentIncident(env,order.id,'late_paid_after_cancel',event.id);
  return;
 }
 if(!order.stripe_session_id){
  const recovery=await env.DB.prepare(`SELECT 1 FROM payment_incidents
   WHERE order_id=? AND reason IN ('unknown_checkout_result','checkout_persistence_failed','missing_session_after_timeout')
   LIMIT 1`).bind(order.id).first();
  if(!recovery){
   await paymentIncident(env,order.id,'session_mismatch',event.id);
   return;
  }
  // Stripe signed this connected-account payment, with an exact merchant, item
  // subtotal, session id, and order metadata match; repair the lost session ID.
  if(!/^cs_(test_|live_)[A-Za-z0-9_]+$/.test(session.id||'')){
   await paymentIncident(env,order.id,'session_mismatch',event.id);
   return;
  }
  await env.DB.prepare(`UPDATE orders SET stripe_session_id=? WHERE id=? AND
   stripe_session_id IS NULL AND status='pending_payment'`).bind(session.id,order.id).run();
 }else if(order.stripe_session_id!==session.id){
  await paymentIncident(env,order.id,'session_mismatch',event.id);
  return;
 }
 const email=String(session.customer_details?.email||'').trim().toLowerCase().slice(0,254);
 await env.DB.batch([
  env.DB.prepare("UPDATE orders SET status='paid',stripe_payment_intent_id=?,customer_email=?,updated_at=datetime('now') WHERE id=? AND status='pending_payment'")
   .bind(session.payment_intent||null,email,order.id),
  env.DB.prepare("INSERT OR IGNORE INTO order_fulfillment(id,order_id,store_id,status) VALUES(?,?,?,'awaiting_action')")
   .bind(crypto.randomUUID(),order.id,order.store_id)
 ]);
 await queuePaidNotifications(env,order.id);
}
export async function processStripeEvent(env:CommerceEnv,event:StripeEvent):Promise<void>{
 const obj=event.data?.object||{};
 if(event.type==='account.updated'){
  if(!/^acct_[a-zA-Z0-9]+$/.test(obj.id||''))return;
  await env.DB.prepare("UPDATE merchant_compliance SET stripe_details_submitted=?,stripe_charges_enabled=?,stripe_payouts_enabled=?,stripe_reviewed_at=datetime('now') WHERE stripe_account_id=?")
   .bind(Number(!!obj.details_submitted),Number(!!obj.charges_enabled),Number(!!obj.payouts_enabled),obj.id).run();
 }
 if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded')
  await applyCompleted(env,event,obj);
 if(event.type==='checkout.session.expired'){
  const order=await env.DB.prepare('SELECT id,stripe_session_id,stripe_connected_account FROM orders WHERE id=?').bind(obj.metadata?.order_id||'').first<any>();
  if(order&&order.stripe_session_id===obj.id&&event.account===order.stripe_connected_account)
   await cancelUnpaid(env,order.id);
 }
 if(event.type==='charge.refunded'){
  const pi=obj.payment_intent;
  if(!pi||!event.account)return;
  const order=await env.DB.prepare('SELECT id,subtotal_minor,stripe_connected_account FROM orders WHERE stripe_payment_intent_id=?').bind(pi).first<any>();
  if(!order||order.stripe_connected_account!==event.account)return;
  const isFull=Number(obj.amount_refunded)>=Number(obj.amount);
  await env.DB.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=? AND status IN ('paid','fulfilled','partially_refunded')")
   .bind(isFull?'refunded':'partially_refunded',order.id).run();
  await queueRefundNotification(env,order.id,event.id);
 }
}
export async function stripeWebhook(req:Request,env:CommerceEnv):Promise<Response>{
 if(!env.STRIPE_CONNECT_WEBHOOK_SECRET)return error('Stripe webhook receiver is not configured',503);
 const body=await req.text();
 if(body.length>512000)return error('Webhook payload too large',413);
 const valid=await stripeSignatureValid(body,req.headers.get('stripe-signature'),env.STRIPE_CONNECT_WEBHOOK_SECRET);
 if(!valid)return error('Invalid Stripe webhook signature',400);
 let evt:StripeEvent;try{evt=JSON.parse(body)}catch{return error('Invalid JSON',400)}
 if(!evt?.id||!evt?.type||!/^evt_[a-zA-Z0-9]+$/.test(evt.id))return error('Invalid Stripe event',400);
 if(!['account.updated','checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','charge.refunded'].includes(evt.type))
  return json({received:true,ignored:true});
 if(await env.DB.prepare('SELECT event_id FROM stripe_events WHERE event_id=?').bind(evt.id).first())return json({received:true,duplicate:true});
 try{
  await processStripeEvent(env,evt);
  await env.DB.prepare('INSERT OR IGNORE INTO stripe_events(event_id,event_type,connected_account) VALUES(?,?,?)').bind(evt.id,evt.type,evt.account||'').run();
  return json({received:true});
 }catch(e){
  console.error('Stripe event processing failed',evt.id,e);
  return error('Unable to apply event; Stripe should retry',500);
 }
}
/** Scheduled recovery: verify remote session state before freeing expired stock. */
export async function reconcileSessions(env:CommerceEnv):Promise<void>{
 if(!env.STRIPE_SECRET_KEY)return;
 const old=await env.DB.prepare("SELECT id,stripe_session_id,stripe_connected_account FROM orders WHERE status='pending_payment' AND session_expires_at<? LIMIT 25")
  .bind(Math.floor(Date.now()/1000)-900).all<any>();
 for(const order of old.results||[]){
  try{
   if(!order.stripe_session_id){
    // No confirmed Stripe session: API timeouts are ambiguous. Hold the
    // reservation and escalate rather than make an unsafe saleable stock credit.
    await paymentIncident(env,order.id,'missing_session_after_timeout');
    continue;
   }
   const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(order.stripe_session_id),{account:order.stripe_connected_account});
   if(session.payment_status==='paid'){
    await applyCompleted(env,{id:'reconcile-'+order.id,type:'checkout.session.completed',account:order.stripe_connected_account},session);
   }else if(session.status==='expired'){
    await cancelUnpaid(env,order.id);
   }
  }catch(e){console.error('Session reconciliation postponed',order.id,e)}
 }
}
