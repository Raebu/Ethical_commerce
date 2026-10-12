import {CommerceEnv,needLogin,isResponse,owner,member,textField,validShopDomain,encrypt,decrypt,requireHttps} from './commercial-utils';
import {json,error,readBody,audit} from './security';
export async function channelRoutes(req:Request,env:CommerceEnv):Promise<Response|null>{
 const path=new URL(req.url).pathname,method=req.method;
 const m=path.match(/^\/api\/commerce\/stores\/([a-f0-9-]{36})\/(connections|publish)$/);
 if(!m)return null;
 const storeId=m[1],action=m[2];
 const user=await needLogin(req,env);if(isResponse(user))return user;
 if(!await owner(env,user,storeId))return error('Store owner required',403);
 if(action==='connections'&&method==='GET'){
  const r=await env.DB.prepare('SELECT id,channel,base_url,status,created_at FROM channel_connections WHERE store_id=?').bind(storeId).all();
  return json({connections:r.results||[],publishingEnabled:env.PUBLISHING_ENABLED==='true',officialProvidersNeedingAuthorization:['eBay','Amazon','Etsy','TikTok Shop']});
 }
 if(action==='connections'&&method==='POST'){
  const b=await readBody(req),channel=textField(b.channel,30);
  if(!['woocommerce','shopify'].includes(channel))return error('Only WooCommerce and Shopify merchant-managed connections can be configured');
  const base=validShopDomain(b.baseUrl,channel as 'woocommerce'|'shopify');
  const credentials=b.credentials as any;
  if(!base||!credentials||typeof credentials!=='object')return error('Valid HTTPS store domain and API credentials required');
  if(channel==='woocommerce'&&(!/^ck_[a-z0-9]{20,80}$/i.test(credentials.consumerKey||'')||!/^cs_[a-z0-9]{20,80}$/i.test(credentials.consumerSecret||'')))
   return error('WooCommerce consumer key and secret required');
  if(channel==='shopify'&&!/^shpat_[a-zA-Z0-9]{20,}$/.test(credentials.accessToken||''))
   return error('Shopify custom app access token required');
  const ciphertext=await encrypt(env,JSON.stringify(credentials));
  await env.DB.prepare(`INSERT INTO channel_connections(id,store_id,channel,base_url,encrypted_credentials,status)
   VALUES(?,?,?,?,?,'configured') ON CONFLICT(store_id,channel) DO UPDATE SET
   base_url=excluded.base_url,encrypted_credentials=excluded.encrypted_credentials,status='configured'`)
   .bind(crypto.randomUUID(),storeId,channel,base,ciphertext).run();
  return json({saved:true,channel,notice:'Credentials encrypted at rest; provider permissions and product publication still require verification'});
 }
 if(action==='publish'&&method==='POST'){
  if(env.PUBLISHING_ENABLED!=='true')return error('Live third-party publishing remains disabled until integration approval',503);
  const b=await readBody(req),channel=textField(b.channel,30),productId=textField(b.productId,60);
  if(channel!=='woocommerce')return error('This marketplace publishing adapter requires separate official-provider authorization',501);
  const p=await env.DB.prepare('SELECT * FROM products WHERE id=? AND store_id=?').bind(productId,storeId).first<any>();
  if(!p||p.status!=='published'||!p.supplier_id||!p.name||!p.description||!p.price_minor||p.stock<0)return error('Publish a complete product and disclose the supplier first',409);
  const con=await env.DB.prepare('SELECT * FROM channel_connections WHERE store_id=? AND channel=?').bind(storeId,channel).first<any>();
  if(!con||con.status==='disabled')return error('Connected WooCommerce store required',403);
  const domain=validShopDomain(con.base_url,'woocommerce');
  if(!domain||domain!==con.base_url)return error('Untrusted external store domain',403);
  const keys=JSON.parse(await decrypt(env,con.encrypted_credentials));
  const auth=btoa(keys.consumerKey+':'+keys.consumerSecret);
  const payload={name:p.name,type:'simple',status:'draft',description:p.description,sku:p.id,
   regular_price:(p.price_minor/100).toFixed(2),manage_stock:true,stock_quantity:p.stock,
   ...(p.image_url?{images:[{src:p.image_url}]}:{})};
  // Products default to draft: seller must review destination compliance and publish there.
  const result=await fetch(domain+'/wp-json/wc/v3/products',{method:'POST',headers:{
    authorization:'Basic '+auth,'content-type':'application/json'},body:JSON.stringify(payload)});
  const returned=await result.json() as any;
  if(!result.ok||!returned.id)return error('WooCommerce rejected the draft listing; check API permissions and product details',502);
  await env.DB.prepare(`INSERT INTO listing_jobs(id,store_id,product_id,channel,status,external_ref)
   VALUES(?,?,?,?,?,?) ON CONFLICT(product_id,channel) DO UPDATE SET status='queued',external_ref=excluded.external_ref`)
   .bind(crypto.randomUUID(),storeId,p.id,'woocommerce','queued',String(returned.id)).run();
  await audit(env.DB,storeId,user.id,'draft_listing_created','product',p.id);
  return json({created:true,destination:'woocommerce',externalId:String(returned.id),status:'draft',
   notice:'External listing was created as a DRAFT, not publicly sold. Review it in WooCommerce.'},201);
 }
 return null;
}
