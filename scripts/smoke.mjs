import {spawn} from 'node:child_process';
import {strict as assert} from 'node:assert';
import {setTimeout as pause} from 'node:timers/promises';
const base='http://127.0.0.1:8787';
const server=spawn('npx',['wrangler','dev','--local','--port','8787'],{stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'true'}});
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
 assert.equal((await call('/')).code,200);
 const owner=await call('/api/auth/register',{method:'POST',body:{email:'owner-'+crypto.randomUUID()+'@example.test',password:'verystrongpassphrase2026'}});
 assert.equal(owner.code,201,JSON.stringify(owner.data));
 const cookie=owner.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const s=await call('/api/stores',{method:'POST',token:cookie,body:{name:'Ethical Store',slug:'smoke-'+crypto.randomUUID().slice(0,8)}});
 assert.equal(s.code,201,JSON.stringify(s.data));const storeId=s.data.id;
 const supplier=await call('/api/suppliers',{method:'POST',token:cookie,body:{storeId,name:'Sample Supplier',country:'GB'}});assert.equal(supplier.code,201);
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
 const other=await call('/api/auth/register',{method:'POST',body:{email:'other-'+crypto.randomUUID()+'@example.test',password:'anotherlongpassphrase2026'}});
 assert.equal(other.code,201);const otherCookie=other.headers.get('set-cookie')?.split(';')[0];
 assert.equal((await call('/api/products?storeId='+storeId,{token:otherCookie})).code,403);
 assert.equal((await call('/api/reports?storeId='+storeId,{token:otherCookie})).code,403);
 const csrf=await fetch(base+'/api/stores',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json',cookie},body:JSON.stringify({name:'Attack'})});
 assert.equal(csrf.status,403);
 console.log('PASS end-to-end: register, isolation, store, product, supplier, claim, production trace, marketplace record, CSV, complaints and CSRF');
}finally{server.kill('SIGTERM')}
