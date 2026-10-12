import {CommerceEnv,needLogin,isResponse,member,owner,stripe,form,amount,strongToken,cleanId,safeEmail,textField,requireHttps,liveCheckoutConfigured} from './commercial-utils.ts';
import {json,error,readBody,digest} from './security.ts';
import {throttle} from './abuse.ts';
import {cancelUnpaid,reserveStockStatements} from './inventory.ts';
import {queueTrackingNotification,queueConsumerRequestNotification} from './notifications.ts';
import {paymentIncident} from './payment-recovery.ts';

export async function checkout(req:Request,env:CommerceEnv):Promise<Response>{
 if(!liveCheckoutConfigured(env))
  return error('Live checkout is disabled until verified payments, tax and consumer safeguards are configured',503);
 const limited=await throttle(req,env,'checkout','new-order',10,3600);if(limited)return limited;
 const b=await readBody(req),storeId=cleanId(b.storeId),key=textField(b.idempotencyKey,100);
 const items=Array.isArray(b.items)?b.items:[];
 if(!storeId||!/^[a-f0-9-]{36,100}$/i.test(key)||items.length<1||items.length>10||b.acceptPolicies!==true)
  return error('Store, cart, customer policy acknowledgement and unique checkout key required');
 const quantities=new Map<string,number>();
 for(const entry of items){
  const pid=cleanId(entry?.productId),qty=amount(entry?.quantity);
  if(!pid||qty===null||qty<1||qty>100||quantities.has(pid))return error('Invalid product or quantity');
  quantities.set(pid,qty);
 }
 const store=await env.DB.prepare(`SELECT s.id,s.slug,s.name,s.sales_paused,c.stripe_account_id,c.stripe_charges_enabled,c.stripe_payouts_enabled,
 c.legal_seller_name,c.return_policy_url,c.shipping_policy_url,c.terms_url,c.privacy_url,c.consumer_terms_accepted_at,
 u.email_verified_at FROM stores s JOIN merchant_compliance c ON c.store_id=s.id JOIN users u ON u.id=s.owner_user_id WHERE s.id=?`)
  .bind(storeId).first<any>();
 if(!store||store.sales_paused||!store.stripe_account_id||!store.stripe_charges_enabled||!store.stripe_payouts_enabled
  ||!store.legal_seller_name||!store.return_policy_url||!store.shipping_policy_url||!store.terms_url||!store.privacy_url
  ||!store.consumer_terms_accepted_at||!store.email_verified_at)
  return error('Store is not approved for live checkout',403);
 const keyHash=await digest('checkout:'+storeId+':'+key);
 const existing=await env.DB.prepare('SELECT id,status,stripe_session_id,session_expires_at FROM orders WHERE client_key_hash=?').bind(keyHash).first<any>();
 if(existing)return json({existing:true,orderId:existing.id,status:existing.status,note:'An existing checkout key cannot initiate a duplicate order. Generate a new key for a new cart.'},409);
 const products:any[]=[];
 for(const [productId,qty] of quantities){
  const p=await env.DB.prepare("SELECT id,store_id,name,price_minor,currency,stock,status,supplier_id FROM products WHERE id=? AND store_id=?").bind(productId,storeId).first<any>();
  if(!p||p.status!=='published'||p.currency!=='GBP'||p.stock<qty||p.price_minor<1)return error('A product is unavailable or out of stock',409);
  products.push({...p,quantity:qty});
 }
 const subtotal=products.reduce((total,p)=>total+p.price_minor*p.quantity,0);
 if(!Number.isSafeInteger(subtotal)||subtotal<50||subtotal>100000000)return error('Basket outside supported total');
 const orderId=crypto.randomUUID(),token=strongToken(),expiresAt=Math.floor(Date.now()/1000)+1800;
 const batch=[
  env.DB.prepare('INSERT INTO orders(id,store_id,client_key_hash,access_token_hash,subtotal_minor,stripe_connected_account,session_expires_at) VALUES(?,?,?,?,?,?,?)')
   .bind(orderId,storeId,keyHash,await digest(token),subtotal,store.stripe_account_id,expiresAt),
  ...reserveStockStatements(env,orderId,products)
 ];
 try{await env.DB.batch(batch)}catch{return error('A product was sold or changed while preparing checkout; refresh your cart',409)}
 let providerSessionCreated=false;
 try{
  const returnBase=new URL('/order-result',req.url);
  returnBase.searchParams.set('order',orderId);
  returnBase.searchParams.set('token',token);
  const success=new URL(returnBase);success.searchParams.set('result','success');
  const cancel=new URL(returnBase);cancel.searchParams.set('result','cancelled');
  const data:Record<string,string|number>={
   mode:'payment',
   success_url:success.href,
   cancel_url:cancel.href,
   client_reference_id:orderId,
   'metadata[order_id]':orderId,
   'metadata[store_id]':storeId,
   'shipping_address_collection[allowed_countries][0]':'GB',
   'automatic_tax[enabled]':'true',
   expires_at:expiresAt
  };
  products.forEach((p,index)=>{
   data['line_items['+index+'][quantity]']=p.quantity;
   data['line_items['+index+'][price_data][currency]']='gbp';
   data['line_items['+index+'][price_data][unit_amount]']=p.price_minor;
   data['line_items['+index+'][price_data][product_data][name]']=p.name;
  });
  const res=await stripe(env,'checkout/sessions',{method:'POST',account:store.stripe_account_id,idempotency:'ec-checkout-'+orderId,body:form(data)});
  if(!res.id||!/^https:\/\/checkout\.stripe\.com\//.test(res.url||''))throw Error('Stripe did not return a valid Checkout Session');
  providerSessionCreated=true;
  await env.DB.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').bind(res.id,orderId).run();
  return json({orderId,checkoutUrl:res.url,customerToken:token,expiresAt,notice:'Payment is processed by the verified seller through Stripe Connect'},201);
 }catch(err){
  // A timed-out Stripe API request may already have created a payable session.
  // Never blindly release stock: a delayed paid webhook could otherwise lead
  // to an accepted charge for inventory sold to somebody else.
  try{await paymentIncident(env,orderId,providerSessionCreated?'checkout_persistence_failed':'unknown_checkout_result')}
  catch(recordingError){console.error('Checkout incident could not be recorded',recordingError)}
  console.error('Checkout session setup uncertain; reserved stock retained for operator review',orderId,err);
  return error('We could not confirm checkout. Please do not retry this payment until the seller has confirmed its status.',503);
 }
}

async function customerOrder(req:Request,env:CommerceEnv):Promise<Response>{
 const b=await readBody(req),orderId=cleanId(b.orderId),token=textField(b.customerToken,80);
 const limited=await throttle(req,env,'order-lookup','customer',20,900);if(limited)return limited;
 if(!orderId||!/^[a-f0-9]{64}$/.test(token))return error('Invalid order reference',400);
 const order=await env.DB.prepare('SELECT id,store_id,status,subtotal_minor,currency,access_token_hash,created_at FROM orders WHERE id=?').bind(orderId).first<any>();
 if(!order||order.access_token_hash!==await digest(token))return error('Order not found',404);
 const [items,fulfil]=await Promise.all([
  env.DB.prepare('SELECT product_name,quantity,unit_price_minor FROM order_items WHERE order_id=?').bind(orderId).all(),
  env.DB.prepare('SELECT status,carrier,tracking_reference,tracking_url,updated_at FROM order_fulfillment WHERE order_id=?').bind(orderId).first()
 ]);
 return json({order:{id:order.id,status:order.status,subtotalMinor:order.subtotal_minor,currency:order.currency,createdAt:order.created_at},items:items.results||[],fulfillment:fulfil||null});
}
async function consumerRequest(req:Request,env:CommerceEnv):Promise<Response>{
 const b=await readBody(req),orderId=cleanId(b.orderId),token=textField(b.customerToken,80),kind=textField(b.kind,32),details=textField(b.details,2000),contact=safeEmail(b.contactEmail);
 if(!orderId||!/^[a-f0-9]{64}$/.test(token)||!['cancellation','return','refund','fault','complaint'].includes(kind)||details.length<15||!contact)
  return error('Order reference, contact email, request type and details required');
 const limited=await throttle(req,env,'consumer-request','new',4,3600);if(limited)return limited;
 const order=await env.DB.prepare('SELECT id,store_id,access_token_hash FROM orders WHERE id=?').bind(orderId).first<any>();
 if(!order||order.access_token_hash!==await digest(token))return error('Order not found',404);
 const requestId=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO consumer_requests(id,order_id,store_id,kind,details,contact_email) VALUES(?,?,?,?,?,?)')
  .bind(requestId,orderId,order.store_id,kind,details,contact).run();
 await queueConsumerRequestNotification(env,orderId,requestId);
 return json({received:true,note:'Your request was recorded for the legal seller. A seller response is still required.'},201);
}
async function sellerRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname,method=req.method;
 const match=path.match(/^\/api\/commerce\/stores\/([a-f0-9-]{36})\/(orders|fulfillment|requests)$/);
 if(match){
  const user=await needLogin(req,env);if(isResponse(user))return user;
  const storeId=match[1],section=match[2];
  if(!await member(env,user,storeId))return error('Forbidden',403);
  if(method==='GET'&&section==='orders'){
   const d=await env.DB.prepare(`SELECT o.id,o.status,o.subtotal_minor,o.currency,o.customer_email,o.created_at,
   f.status AS fulfillment_status FROM orders o LEFT JOIN order_fulfillment f ON f.order_id=o.id
   WHERE o.store_id=? ORDER BY o.created_at DESC LIMIT 100`).bind(storeId).all();
   return json({orders:d.results||[]});
  }
  if(method==='GET'&&section==='fulfillment'){
   const d=await env.DB.prepare('SELECT * FROM order_fulfillment WHERE store_id=? ORDER BY created_at DESC LIMIT 100').bind(storeId).all();
   return json({fulfillments:d.results||[]});
  }
  if(method==='GET'&&section==='requests'){
   const d=await env.DB.prepare('SELECT * FROM consumer_requests WHERE store_id=? ORDER BY created_at DESC LIMIT 100').bind(storeId).all();
   return json({requests:d.results||[]});
  }
 }
 const fulfillment=path.match(/^\/api\/commerce\/fulfillment\/([a-f0-9-]{36})$/);
 if(fulfillment&&method==='POST'){
  const user=await needLogin(req,env);if(isResponse(user))return user;
  const f=await env.DB.prepare('SELECT f.*,o.status AS order_status FROM order_fulfillment f JOIN orders o ON o.id=f.order_id WHERE f.id=?').bind(fulfillment[1]).first<any>();
  if(!f||!await member(env,user,f.store_id,true))return error('Forbidden',403);
  if(!['paid','fulfilled'].includes(f.order_status))return error('Only paid orders may be fulfilled',409);
  const b=await readBody(req),status=textField(b.status,32),carrier=textField(b.carrier,80),tracking=textField(b.trackingReference,140),url=requireHttps(b.trackingUrl),notes=textField(b.sellerNotes,400);
  const next:Record<string,string[]>={
   awaiting_action:['supplier_requested','issue'],
   supplier_requested:['supplier_accepted','issue'],
   supplier_accepted:['dispatched','issue'],
   dispatched:['delivered','issue'],
   delivered:[],
   issue:['supplier_requested','supplier_accepted','dispatched']
  };
  if(!next[f.status]?.includes(status))return error('Invalid fulfillment transition',409);
  if(status==='dispatched'&&(!carrier||!tracking))return error('Tracking details required for dispatch');
  await env.DB.prepare("UPDATE order_fulfillment SET status=?,carrier=?,tracking_reference=?,tracking_url=?,seller_notes=?,updated_at=datetime('now') WHERE id=?")
   .bind(status,carrier,tracking,url,notes,f.id).run();
  if(status==='delivered')await env.DB.prepare("UPDATE orders SET status='fulfilled',updated_at=datetime('now') WHERE id=? AND status='paid'").bind(f.order_id).run();
  if(status==='dispatched')await queueTrackingNotification(env,f.order_id,tracking);
  return json({updated:true,status});
 }
 const requestPath=path.match(/^\/api\/commerce\/consumer-requests\/([a-f0-9-]{36})$/);
 if(requestPath&&method==='PATCH'){
  const user=await needLogin(req,env);if(isResponse(user))return user;
  const cr=await env.DB.prepare('SELECT store_id FROM consumer_requests WHERE id=?').bind(requestPath[1]).first<{store_id:string}>();
  if(!cr||!await member(env,user,cr.store_id,true))return error('Forbidden',403);
  const b=await readBody(req),status=textField(b.status,30),note=textField(b.resolutionNote,1000);
  if(!['in_review','accepted','rejected','resolved'].includes(status)||!note)return error('Valid status and reason required');
  await env.DB.prepare("UPDATE consumer_requests SET status=?,resolution_note=?,updated_at=datetime('now') WHERE id=?").bind(status,note,requestPath[1]).run();
  return json({updated:true,note:'This does not automatically issue a card refund'});
 }
 const shipping=path.match(/^\/api\/commerce\/orders\/([a-f0-9-]{36})\/shipping$/);
 if(shipping&&method==='GET'){
  const user=await needLogin(req,env);if(isResponse(user))return user;
  const order=await env.DB.prepare('SELECT id,store_id,status,stripe_session_id,stripe_connected_account FROM orders WHERE id=?').bind(shipping[1]).first<any>();
  // Delivery addresses are sensitive: restrict viewing to the verified store owner.
  if(!order||!await owner(env,user,order.store_id))return error('Forbidden',403);
  if(!['paid','fulfilled','partially_refunded'].includes(order.status)||!order.stripe_session_id)return error('No paid delivery record available',409);
  if(!env.STRIPE_SECRET_KEY)return error('Stripe delivery data access is not configured',503);
  try{
   const result=await stripe(env,'checkout/sessions/'+encodeURIComponent(order.stripe_session_id),{account:order.stripe_connected_account});
   if(result.payment_status!=='paid'||result.id!==order.stripe_session_id)return error('Order payment status could not be confirmed',409);
   const shippingDetails=result.collected_information?.shipping_details||result.shipping_details;
   if(!shippingDetails?.address)return error('Shipping address unavailable; contact the customer using your approved support process',409);
   const a=shippingDetails.address;
   return json({orderId:order.id,recipient:shippingDetails.name||'',address:{
    line1:a.line1||'',line2:a.line2||'',city:a.city||'',state:a.state||'',postcode:a.postal_code||'',country:a.country||''
   },notice:'Confidential customer delivery information. Do not forward without appropriate consent and a lawful fulfilment purpose.'});
  }catch(e){
   if(e instanceof Response)return e;
   console.error('Stripe shipping lookup failed');
   return error('Unable to retrieve Stripe delivery details',503);
  }
 }
 const refund=path.match(/^\/api\/commerce\/orders\/([a-f0-9-]{36})\/refund$/);
 if(refund&&method==='POST'){
  const user=await needLogin(req,env);if(isResponse(user))return user;
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(refund[1]).first<any>();
  if(!order||!await owner(env,user,order.store_id))return error('Only the store owner may authorise a refund',403);
  const b=await readBody(req);if(b.confirm!=='REFUND')return error('Explicit refund confirmation required');
  if(!['paid','fulfilled','partially_refunded'].includes(order.status)||!order.stripe_payment_intent_id)return error('Order is not eligible for a Stripe refund',409);
  if(!env.STRIPE_SECRET_KEY)return error('Stripe refund service not configured',503);
  const amountMinor=amount(b.amountMinor);
  if(amountMinor===null||amountMinor<1||amountMinor>order.subtotal_minor)return error('Invalid refund amount');
  const refundKey=textField(b.requestKey,100);
  if(!/^[a-f0-9-]{36,100}$/i.test(refundKey))return error('Unique refund request key required');
  try{
   const res=await stripe(env,'refunds',{method:'POST',account:order.stripe_connected_account,
    idempotency:'ec-refund-'+refund[1]+'-'+refundKey,body:form({payment_intent:order.stripe_payment_intent_id,amount:amountMinor})});
   return json({submitted:true,stripeRefundId:res.id,status:res.status,note:'Final order status will be reconciled from signed Stripe events'});
  }catch{return error('Stripe refund could not be submitted',503)}
 }
 return null;
}
export async function orderRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(path==='/api/commerce/checkout'&&req.method==='POST')return checkout(req,env);
 if(path==='/api/commerce/customer-order'&&req.method==='POST')return customerOrder(req,env);
 if(path==='/api/commerce/customer-request'&&req.method==='POST')return consumerRequest(req,env);
 return sellerRoutes(req,env);
}
