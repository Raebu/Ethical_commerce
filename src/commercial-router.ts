import {CommerceEnv} from './commercial-utils';
import {identityRoutes} from './commercial-identity';
import {orderRoutes} from './commercial-orders';
import {channelRoutes} from './commercial-channels';
import {reviewRoutes,expireAssessments} from './commercial-assurance';
import {stripeWebhook,reconcileSessions} from './commercial-webhooks';
import {purchaseOrderRoutes} from './purchase-orders';
import {processNotifications,queuePaidNotifications} from './notifications';
import {paymentRecoveryRoutes} from './payment-recovery';
import {commissioningRoutes} from './commissioning';

export async function commerceRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(path==='/api/webhooks/stripe'&&req.method==='POST')return stripeWebhook(req,env);
 if(!path.startsWith('/api/commerce/')&&!path.startsWith('/api/auth/email/'))return null;
 return await identityRoutes(req,env)
  ||await orderRoutes(req,env)
  ||await channelRoutes(req,env)
  ||await purchaseOrderRoutes(req,env)
  ||await paymentRecoveryRoutes(req,env)
  ||await commissioningRoutes(req,env)
  ||await reviewRoutes(req,env);
}
export async function scheduledCommerce(env:CommerceEnv):Promise<void>{
 await reconcileSessions(env);
 await expireAssessments(env);
 const paid=await env.DB.prepare("SELECT id FROM orders WHERE status IN ('paid','fulfilled') ORDER BY created_at DESC LIMIT 15").all<{id:string}>();
 for(const order of paid.results||[])await queuePaidNotifications(env,order.id);
 await processNotifications(env,10);
 await env.DB.prepare('DELETE FROM email_challenges WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('DELETE FROM abuse_counters WHERE expires_at<?').bind(Date.now()).run();
}
