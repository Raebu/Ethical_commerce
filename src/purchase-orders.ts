import type {CommerceEnv} from './commercial-utils';
import {needLogin,isResponse,owner,member,safeEmail,textField,cleanId} from './commercial-utils';
import {json,error,readBody,audit} from './security';
import {queueNotification} from './notifications';

/** Merchant authorisation means the merchant is allowed to contact this supplier.
 * It is not independent verification, a fulfilment contract or a guarantee.
 */
export async function purchaseOrderRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname,method=req.method;
 const storeRoute=path.match(/^\/api\/commerce\/stores\/([a-f0-9-]{36})\/(supplier-orders|supplier-order-settings|purchase-orders)$/);
 if(storeRoute){
  const storeId=storeRoute[1],operation=storeRoute[2];
  const user=await needLogin(req,env);if(isResponse(user))return user;
  if(!await member(env,user,storeId))return error('Forbidden',403);
  if(method==='GET'&&operation==='purchase-orders'){
   const rows=await env.DB.prepare(`SELECT p.id,p.order_id,p.supplier_id,p.status,p.supplier_reference,p.notes,p.requested_at,p.created_at,
    s.name AS supplier_name, n.status AS notification_status
    FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
    LEFT JOIN notification_outbox n ON n.purchase_order_id=p.id AND n.template='supplier_purchase_order'
    WHERE p.store_id=? ORDER BY p.created_at DESC LIMIT 200`).bind(storeId).all();
   return json({purchaseOrders:rows.results||[],automaticSupplierDispatch:false});
  }
  if(method==='GET'&&operation==='supplier-order-settings'){
   const rows=await env.DB.prepare(`SELECT s.id,s.name,s.country,ss.ordering_email,ss.merchant_confirmed_authorization,ss.merchant_authorized_at
    FROM suppliers s LEFT JOIN supplier_order_settings ss ON ss.supplier_id=s.id
    WHERE s.store_id=? ORDER BY s.name`).bind(storeId).all();
   return json({suppliers:rows.results||[]});
  }
  if(method==='POST'&&operation==='supplier-order-settings'){
   if(!await owner(env,user,storeId))return error('Only the store owner can authorise supplier emails',403);
   const b=await readBody(req),supplierId=cleanId(b.supplierId),email=safeEmail(b.orderingEmail),approved=b.confirmSupplierContact===true;
   if(!supplierId||!email||!approved)return error('Select a supplier, enter their business email and explicitly confirm authorisation');
   const supplier=await env.DB.prepare('SELECT id FROM suppliers WHERE id=? AND store_id=?').bind(supplierId,storeId).first();
   if(!supplier)return error('Supplier is not associated with this store',404);
   await env.DB.prepare(`INSERT INTO supplier_order_settings
    (supplier_id,store_id,ordering_email,merchant_confirmed_authorization,merchant_authorized_at)
    VALUES(?,?,?,1,datetime('now')) ON CONFLICT(supplier_id) DO UPDATE SET
    ordering_email=excluded.ordering_email,merchant_confirmed_authorization=1,merchant_authorized_at=datetime('now'),updated_at=datetime('now')`)
    .bind(supplierId,storeId,email).run();
   await audit(env.DB,storeId,user.id,'authorize_supplier_contact','supplier',supplierId);
   return json({saved:true,note:'Supplier contact was merchant-authorised, not independently verified'});
  }
  if(method==='POST'&&operation==='supplier-orders'){
   const b=await readBody(req),orderId=cleanId(b.orderId);
   if(!orderId)return error('Order ID required');
   const order=await env.DB.prepare('SELECT id,status FROM orders WHERE id=? AND store_id=?').bind(orderId,storeId).first<any>();
   if(!order||!['paid','fulfilled','partially_refunded'].includes(order.status))return error('Only paid orders can be prepared for supplier fulfilment',409);
   const items=await env.DB.prepare(`SELECT i.product_id,i.product_name,i.quantity,i.supplier_id,s.name AS supplier_name
     FROM order_items i LEFT JOIN suppliers s ON s.id=i.supplier_id AND s.store_id=?
     WHERE i.order_id=? ORDER BY i.product_name`).bind(storeId,orderId).all<any>();
   if(!items.results?.length)return error('No order items found',409);
   if(items.results.some(i=>!i.supplier_id||!i.supplier_name))return error('At least one product lacks an assigned supplier in the original checkout; manual review required',409);
   const grouped=new Map<string,typeof items.results>();
   for(const item of items.results)grouped.set(item.supplier_id,[...(grouped.get(item.supplier_id)||[]),item]);
   let added=0;
   for(const [supplierId,group] of grouped){
    let po=await env.DB.prepare('SELECT id FROM purchase_orders WHERE order_id=? AND supplier_id=?').bind(orderId,supplierId).first<{id:string}>();
    if(po)continue;
    const poId=crypto.randomUUID();
    try{
     await env.DB.batch([
      env.DB.prepare("INSERT INTO purchase_orders(id,order_id,store_id,supplier_id) VALUES(?,?,?,?)").bind(poId,orderId,storeId,supplierId),
      ...group.map(i=>env.DB.prepare('INSERT INTO purchase_order_items(id,purchase_order_id,product_id,sku,product_name,quantity) VALUES(?,?,?,?,?,?)')
       .bind(crypto.randomUUID(),poId,i.product_id,i.product_id,i.product_name,i.quantity))
     ]);
     added++;
    }catch(e){
     // A concurrent request may have prepared this same supplier order.
     const concurrent=await env.DB.prepare('SELECT id FROM purchase_orders WHERE order_id=? AND supplier_id=?').bind(orderId,supplierId).first();
     if(!concurrent)throw e;
    }
   }
   if(added)await audit(env.DB,storeId,user.id,'prepare_purchase_order','order',orderId);
   return json({prepared:true,created:added,supplierCount:grouped.size,note:'Drafts only. No supplier was contacted.'});
  }
  return null;
 }
 const poRoute=path.match(/^\/api\/commerce\/purchase-orders\/([a-f0-9-]{36})\/(send|status)$/);
 if(!poRoute)return null;
 const user=await needLogin(req,env);if(isResponse(user))return user;
 const po=await env.DB.prepare('SELECT * FROM purchase_orders WHERE id=?').bind(poRoute[1]).first<any>();
 if(!po||!await member(env,user,po.store_id,true))return error('Forbidden',403);
 if(method==='POST'&&poRoute[2]==='send'){
  if(env.NOTIFICATIONS_ENABLED!=='true'||!env.RESEND_API_KEY||!env.EMAIL_FROM)return error('Transactional supplier email is not configured',503);
  if(po.status==='queued'||po.status==='requested')return json({alreadyQueued:true,status:po.status});
  if(po.status!=='draft')return error('Supplier order cannot be sent from this state',409);
  const b=await readBody(req);
  if(b.confirm!=='SEND_TO_SUPPLIER')return error('Explicit supplier email authorisation required');
  const recipient=await env.DB.prepare(`SELECT ordering_email FROM supplier_order_settings
    WHERE supplier_id=? AND store_id=? AND merchant_confirmed_authorization=1`).bind(po.supplier_id,po.store_id).first<{ordering_email:string}>();
  if(!recipient||!safeEmail(recipient.ordering_email))return error('Approved supplier ordering email required',403);
  const note=textField(b.notes,400);
  await env.DB.batch([
   env.DB.prepare(`UPDATE purchase_orders SET status='queued',notes=?,requested_by=?,requested_at=datetime('now'),updated_at=datetime('now')
    WHERE id=? AND status='draft'`).bind(note,user.id,po.id),
   env.DB.prepare(`INSERT OR IGNORE INTO notification_outbox
    (id,event_key,store_id,order_id,purchase_order_id,recipient_email,template)
    VALUES(?,?,?,?,?,?,'supplier_purchase_order')`).bind(crypto.randomUUID(),'supplier-po:'+po.id,po.store_id,po.order_id,po.id,recipient.ordering_email)
  ]);
  await audit(env.DB,po.store_id,user.id,'supplier_po_email_authorized','purchase_order',po.id);
  return json({queued:true,note:'Explicitly authorised supplier email queued. It contains no customer address or contact information.'});
 }
 if(method==='POST'&&poRoute[2]==='status'){
  const b=await readBody(req),status=textField(b.status,24),reference=textField(b.supplierReference,120);
  const allowed:Record<string,string[]>={draft:['cancelled'],queued:['requested','cancelled'],requested:['accepted','issue'],accepted:['dispatched','issue'],dispatched:['delivered','issue'],issue:['accepted','cancelled'],delivered:[],cancelled:[]};
  if(!allowed[po.status]?.includes(status))return error('Invalid supplier order transition',409);
  if(status==='dispatched'&&!reference)return error('Supplier shipment reference required',400);
  await env.DB.prepare("UPDATE purchase_orders SET status=?,supplier_reference=?,updated_at=datetime('now') WHERE id=? AND status=?")
   .bind(status,reference,po.id,po.status).run();
  await audit(env.DB,po.store_id,user.id,'purchase_order_status_'+status,'purchase_order',po.id);
  return json({updated:true,status,note:'The status was recorded by seller staff; no supplier confirmation was independently verified.'});
 }
 return null;
}
