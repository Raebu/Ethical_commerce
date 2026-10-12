import type {CommerceEnv} from './commercial-utils.ts';
import {needLogin,isResponse,textField,cleanId} from './commercial-utils.ts';
import {readBody,json,error} from './security.ts';

export type PaymentIncidentReason=
 'unknown_checkout_result'|'checkout_persistence_failed'|'late_paid_after_cancel'|
 'session_mismatch'|'missing_session_after_timeout';

export async function paymentIncident(env:CommerceEnv,orderId:string,reason:PaymentIncidentReason,eventId=''):Promise<void>{
 const order=await env.DB.prepare('SELECT store_id FROM orders WHERE id=?').bind(orderId).first<{store_id:string}>();
 if(!order)return;
 await env.DB.prepare(`INSERT INTO payment_incidents(id,order_id,store_id,reason,stripe_event_id)
 VALUES(?,?,?,?,?) ON CONFLICT(order_id,reason) DO UPDATE SET
 stripe_event_id=CASE WHEN excluded.stripe_event_id!='' THEN excluded.stripe_event_id ELSE payment_incidents.stripe_event_id END,
 updated_at=datetime('now')`).bind(crypto.randomUUID(),orderId,order.store_id,reason,eventId).run();
}
/** Only a platform operator can assess an incident; this never makes payments or cancels orders. */
export async function paymentRecoveryRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const pathname=new URL(req.url).pathname,method=req.method;
 if(pathname!=='/api/commerce/admin/payment-incidents'&&!/^\/api\/commerce\/admin\/payment-incidents\/[a-f0-9-]{36}$/.test(pathname))return null;
 const user=await needLogin(req,env);if(isResponse(user))return user;
 if(!user.is_platform_admin)return error('Platform administrator required',403);
 if(pathname==='/api/commerce/admin/payment-incidents'&&method==='GET'){
  const incidents=await env.DB.prepare(`SELECT p.id,p.order_id,p.store_id,p.reason,p.status,p.stripe_event_id,p.ops_note,
    p.created_at,p.updated_at,o.status AS order_status,o.stripe_session_id,o.reservation_released
    FROM payment_incidents p JOIN orders o ON o.id=p.order_id
    ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,p.created_at ASC LIMIT 100`).all();
  return json({incidents:incidents.results||[],notice:'This queue requires manual Stripe reconciliation. Do not treat listed orders as paid or release reserved stock without verification.'});
 }
 const id=pathname.split('/').pop()||'';
 if(method!=='POST'||!cleanId(id))return error('Unknown recovery action',404);
 const body=await readBody(req),status=textField(body.status,20),note=textField(body.note,1500);
 if(!['in_review','resolved'].includes(status)||note.length<20||body.confirmManualProviderReview!==true)
  return error('Explicit verified Stripe provider review and detailed operator note required');
 const record=await env.DB.prepare("UPDATE payment_incidents SET status=?,ops_note=?,reviewed_by=?,updated_at=datetime('now') WHERE id=? RETURNING id")
  .bind(status,note,user.id,id).first();
 if(!record)return error('Incident not found',404);
 return json({recorded:true,warning:'Incident status is administrative only. No inventory, order, charge or refund was modified.'});
}
