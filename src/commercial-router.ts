import {CommerceEnv} from './commercial-utils';
import {identityRoutes} from './commercial-identity';
import {orderRoutes} from './commercial-orders';
import {channelRoutes} from './commercial-channels';
import {reviewRoutes,expireAssessments} from './commercial-assurance';
import {stripeWebhook,reconcileSessions} from './commercial-webhooks';

export async function commerceRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(path==='/api/webhooks/stripe'&&req.method==='POST')return stripeWebhook(req,env);
 if(!path.startsWith('/api/commerce/')&&!path.startsWith('/api/auth/email/'))return null;
 return await identityRoutes(req,env)
  ||await orderRoutes(req,env)
  ||await channelRoutes(req,env)
  ||await reviewRoutes(req,env);
}
export async function scheduledCommerce(env:CommerceEnv):Promise<void>{
 await reconcileSessions(env);
 await expireAssessments(env);
 await env.DB.prepare('DELETE FROM email_challenges WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('DELETE FROM abuse_counters WHERE expires_at<?').bind(Date.now()).run();
}
