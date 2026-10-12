import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {safeStagingOrigin,stagingSmoke} from '../scripts/staging-smoke.ts';

test('staging probe cannot target production, unknown domains or redirects',()=>{
 assert.equal(safeStagingOrigin(),'https://ethical-commerce-staging.martin-e01.workers.dev');
 assert.throws(()=>safeStagingOrigin('https://ethical-commerce.martin-e01.workers.dev'));
 assert.throws(()=>safeStagingOrigin('https://not-ours.example.com'));
 assert.throws(()=>safeStagingOrigin('http://ethical-commerce-staging.martin-e01.workers.dev'));
});
test('staging probe validates all fail-closed commerce controls without network access',async()=>{
 const seen:string[]=[];
 const transport=async(input:any,opts:any)=>{
  const u=new URL(String(input));seen.push(u.pathname);
  let code=200,value:any={};
  if(u.pathname==='/api/health')value={ok:true,payments:'disabled',paymentMode:'none',external_publishing:'disabled'};
  else if(u.pathname==='/api/ready')value={ready:true,schema:'available',database:'configured'};
  else if(u.pathname==='/api/public/products')value={products:[]};
  else if(u.pathname==='/api/commerce/admin/commissioning'||u.pathname==='/api/commerce/admin/test-email'){code=401;value={error:'Sign in required'}}
  else if(u.pathname==='/api/commerce/checkout'||u.pathname==='/api/webhooks/stripe'){code=503;value={error:'Disabled'}}
  else throw Error('Unexpected staging test path '+u.pathname);
  assert.equal(u.origin,safeStagingOrigin());
  assert.equal(opts.redirect,'error');
  return new Response(JSON.stringify(value),{status:code,headers:{'content-type':'application/json'}});
 };
 const checks=await stagingSmoke({transport:transport as typeof fetch});
 assert.equal(checks.length,7);
 assert.equal(seen.filter(x=>x==='/api/commerce/checkout').length,1);
 assert.equal(seen.filter(x=>x==='/api/commerce/admin/test-email').length,1);
});
test('staging probe fails if disabled checkout or webhook becomes active',async()=>{
 const wrong=async (input:any)=>{
  const path=new URL(String(input)).pathname;
  return new Response(JSON.stringify(path==='/api/health'?{ok:true,payments:'configuration-enabled',paymentMode:'test',external_publishing:'disabled'}:{}),
   {status:200,headers:{'content-type':'application/json'}});
 };
 await assert.rejects(stagingSmoke({transport:wrong as typeof fetch}),/no-commerce gates failed/);
});
