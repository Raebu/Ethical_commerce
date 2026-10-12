import {spawn} from 'node:child_process';
import {strict as assert} from 'node:assert';
import {setTimeout as pause} from 'node:timers/promises';
const base='http://127.0.0.1:8787';
const server=spawn('npx',['wrangler','dev','--local','--port','8787'],{stdio:['ignore','pipe','pipe'],detached:true,env:{...process.env,CI:'true'}});
let output='';
for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{output=(output+String(b)).slice(-30000)});
async function call(path,{method='GET',body,token}={}){
 const headers={accept:'application/json'};if(body)headers['content-type']='application/json';if(method!=='GET')headers.origin=base;if(token)headers.cookie=token;
 const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
 const v=(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text();
 return {code:r.status,headers:r.headers,data:v};
}
try{
 let ok=false;
 for(let n=0;n<120;n++){if(server.exitCode!==null)throw Error('Worker failed: '+output);try{ok=(await call('/api/health')).code===200;if(ok)break}catch{}await pause(250)}
 if(!ok)throw Error('Worker startup timed out: '+output);
 const home=await call('/');assert.equal(home.code,200);assert.match(home.headers.get('content-security-policy')||'',/script-src 'self'/);assert.equal(home.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
 const ready=await call('/api/ready');assert.equal(ready.code,200);assert.equal(ready.data.ready,true);
 const owner=await call('/api/auth/register',{method:'POST',body:{email:'owner-'+crypto.randomUUID()+'@example.test',password:'verystrongpassphrase2026'}});
 assert.equal(owner.code,201,JSON.stringify(owner.data));
 const cookie=owner.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const s=await call('/api/stores',{method:'POST',token:cookie,body:{name:'Ethical Store',slug:'smoke-'+crypto.randomUUID().slice(0,8)}});
 assert.equal(s.code,201,JSON.stringify(s.data));const storeId=s.data.id;
 const unverified=await call('/api/auth/email/status',{token:cookie});assert.equal(unverified.code,200);assert.equal(unverified.data.verified,false);
 assert.equal((await call('/api/auth/email/request',{method:'POST',token:cookie,body:{}})).code,503);
 const cp=await call('/api/commerce/stores/'+storeId+'/compliance',{method:'POST',token:cookie,body:{
  legalSellerName:'Ethical Demo Limited',tradingAddress:'1 Example Street, UK',
  contactEmail:'support@example.com',companyRegistration:'00000000',
  returnPolicyUrl:'https://example.com/returns',
  shippingPolicyUrl:'https://example.com/shipping',
  termsUrl:'https://example.com/terms',privacyUrl:'https://example.com/privacy',
  cancellationNotice:'UK consumer cancellation and faulty goods rights apply to every qualifying order.',
  acceptConsumerDuties:true
 }});assert.equal(cp.code,200,JSON.stringify(cp.data));
 const saved=await call('/api/commerce/stores/'+storeId+'/compliance',{token:cookie});assert.equal(saved.code,200);
 assert.equal(saved.data.compliance.legal_seller_name,'Ethical Demo Limited');
 const connect=await call('/api/commerce/stores/'+storeId+'/connect-status',{token:cookie});
 assert.equal(connect.code,200);assert.equal(connect.data.connected,false);
 assert.equal((await call('/api/commerce/stores/'+storeId+'/onboarding',{method:'POST',token:cookie,body:{}})).code,503);
 assert.equal((await call('/api/commerce/checkout',{method:'POST',body:{storeId,idempotencyKey:crypto.randomUUID(),items:[],acceptPolicies:true}})).code,503);

 const supplier=await call('/api/suppliers',{method:'POST',token:cookie,body:{storeId,name:'Sample Supplier',country:'GB'}});assert.equal(supplier.code,201);
 const supStatus=await call('/api/commerce/stores/'+storeId+'/supplier-order-settings',{token:cookie});
 assert.equal(supStatus.code,200);assert.equal(supStatus.data.suppliers.length,1);
 const supAdd=await call('/api/commerce/stores/'+storeId+'/supplier-order-settings',{method:'POST',token:cookie,body:{
  supplierId:supplier.data.id,orderingEmail:'fulfilment@example.com',confirmSupplierContact:true
 }});assert.equal(supAdd.code,200);
 const unsent=await call('/api/commerce/stores/'+storeId+'/purchase-orders',{token:cookie});
 assert.equal(unsent.code,200);assert.equal(unsent.data.purchaseOrders.length,0);
 const notificationDisabled=await call('/api/commerce/purchase-orders/'+crypto.randomUUID()+'/send',{method:'POST',token:cookie,body:{confirm:'SEND_TO_SUPPLIER'}});
 assert.equal(notificationDisabled.code,403);
 const product=await call('/api/products',{method:'POST',token:cookie,body:{storeId,name:'Cotton Tote',priceMinor:1900,stock:5,supplierId:supplier.data.id}});
 assert.equal(product.code,201,JSON.stringify(product.data));const productId=product.data.id;
 assert.equal((await call('/api/public/products/'+productId)).code,404);
 const ev=await call('/api/evidence',{method:'POST',token:cookie,body:{productId,title:'Origin declaration',issuer:'Merchant',sourceUrl:'https://example.org/source'}});
 assert.equal(ev.code,201);assert.equal(ev.data.status,'supplier_declared');
 assert.equal((await call('/api/claims',{method:'POST',token:cookie,body:{productId,facet:'origin',statement:'Supplier declares UK origin',evidenceId:ev.data.id}})).code,201);
 assert.equal((await call('/api/trace',{method:'POST',token:cookie,body:{productId,stage:'source',actorName:'Supplier',happenedAt:'2026-10-10',evidenceId:ev.data.id}})).code,201);
 assert.equal((await call('/api/products/'+productId,{method:'PATCH',token:cookie,body:{status:'published'}})).code,200);
 const pub=await call('/api/public/products/'+productId);assert.equal(pub.code,200);
 assert.equal(pub.data.claims[0].evidence_status,'supplier_declared');assert.equal(pub.data.coverage.covered,1);
 assert.ok(pub.data.coverage.missing.includes('manufacture'));
 assert.equal((await call('/api/admin/evidence/'+ev.data.id+'/review',{method:'POST',token:cookie,body:{status:'independently_verified'}})).code,403);
 const listing=await call('/api/listings',{method:'POST',token:cookie,body:{productId,channel:'ebay'}});
 assert.equal(listing.code,201);assert.equal(listing.data.status,'needs_connection');
 const catalog=await call('/api/channels/export.csv?storeId='+storeId,{token:cookie});
 assert.equal(catalog.code,200);assert.match(catalog.data,/Cotton Tote/);
 assert.equal((await call('/api/reports',{method:'POST',body:{productId,category:'misleading_claim',message:'Please investigate the origin statement being made.'}})).code,201);
 assert.equal((await call('/api/reports?storeId='+storeId,{token:cookie})).data.reports.length,1);
 const sensitive=await call('/api/reports',{method:'POST',body:{productId,category:'worker_welfare',message:'Sensitive workplace report that must not be shared.'}});
 assert.equal(sensitive.code,503,'Seller-visible whistleblower disclosure must be refused');
 const concern={productId,category:'misleading_claim',message:'Please investigate the origin claim documented for this product.'};
 for(let i=0;i<3;i++)assert.equal((await call('/api/reports',{method:'POST',body:concern})).code,201);
 const reportLimit=await call('/api/reports',{method:'POST',body:concern});
 assert.equal(reportLimit.code,429,'Public report submissions must be throttled');
 assert.ok(Number(reportLimit.headers.get('retry-after'))>0);
 const other=await call('/api/auth/register',{method:'POST',body:{email:'other-'+crypto.randomUUID()+'@example.test',password:'anotherlongpassphrase2026'}});
 assert.equal(other.code,201);const otherCookie=other.headers.get('set-cookie')?.split(';')[0];
 assert.equal((await call('/api/products?storeId='+storeId,{token:otherCookie})).code,403);
 assert.equal((await call('/api/reports?storeId='+storeId,{token:otherCookie})).code,403);
 assert.equal((await call('/api/commerce/stores/'+storeId+'/compliance',{token:otherCookie})).code,403);
 assert.equal((await call('/api/commerce/stores/'+storeId+'/orders',{token:otherCookie})).code,403);
 assert.equal((await call('/api/commerce/stores/'+storeId+'/supplier-order-settings',{token:otherCookie})).code,403);
 assert.equal((await call('/api/commerce/stores/'+storeId+'/purchase-orders',{token:otherCookie})).code,403);

 assert.equal((await call('/api/commerce/assurance/verifiers',{token:cookie})).code,403);
 assert.equal((await call('/api/commerce/admin/payment-incidents',{token:cookie})).code,403,'Non-admin sellers must never inspect payment recovery records');
 assert.equal((await call('/api/commerce/admin/commissioning',{token:cookie})).code,403,'Non-admin sellers cannot inspect provider readiness');
 assert.equal((await call('/api/commerce/admin/test-email',{method:'POST',token:cookie,body:{confirm:'SEND_SELF_TEST'}})).code,403,'Non-admin sellers cannot send commissioning emails');

 const unknownEmail='unknown-'+crypto.randomUUID()+'@example.test';
 for(let i=0;i<8;i++)assert.equal((await call('/api/auth/login',{method:'POST',body:{email:unknownEmail,password:'incorrectsecret'}})).code,401);
 assert.equal((await call('/api/auth/login',{method:'POST',body:{email:unknownEmail,password:'incorrectsecret'}})).code,429,'Password guessing must be throttled');
 const csrf=await fetch(base+'/api/stores',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json',cookie},body:JSON.stringify({name:'Attack'})});
 assert.equal(csrf.status,403);
 console.log('PASS end-to-end: registration, isolation, store, catalogue, passport, claims, sensitive-report protection, rate limits, CSP, CSRF, D1 and CSV');
}finally{try{process.kill(-server.pid,'SIGTERM')}catch{server.kill('SIGTERM')}}
