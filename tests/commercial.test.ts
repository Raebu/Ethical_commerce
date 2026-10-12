import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {form,safeEmail,validShopDomain,amount,stripeSignatureValid,requireHttps} from '../src/commercial-utils.ts';

test('reject unsafe provider API destinations',()=>{
 assert.equal(validShopDomain('https://127.0.0.1','woocommerce'),'');
 assert.equal(validShopDomain('https://localhost','woocommerce'),'');
 assert.equal(validShopDomain('http://store.example.com','woocommerce'),'');
 assert.equal(validShopDomain('https://legitimate.myshopify.com','shopify'),'https://legitimate.myshopify.com');
 assert.equal(validShopDomain('https://shop.myshopify.com.attacker.io','shopify'),'');
 assert.equal(validShopDomain('https://shop.example.com','woocommerce'),'https://shop.example.com');
});
test('stripe form parameters keep line-item structure',()=>{
 const encoded=form({'line_items[0][price_data][unit_amount]':1250,'mode':'payment'});
 assert.ok(encoded.includes('line_items%5B0%5D'));
 assert.ok(encoded.includes('1250'));
});
test('email and URL validation prohibit unsafe input',()=>{
 assert.equal(safeEmail('Person@Example.com'),'person@example.com');
 assert.equal(safeEmail('bad address'),'');
 assert.equal(requireHttps('javascript:alert(1)'),'');
 assert.equal(requireHttps('https://example.com/path'),'https://example.com/path');
});
test('integer payment amounts are bounded',()=>{
 assert.equal(amount(1500),1500);
 assert.equal(amount(-3),null);
 assert.equal(amount(19.9),null);
});
test('webhook authentication rejects wrong, missing and stale signatures',async()=>{
 const body='{"id":"evt_test","type":"checkout.session.completed"}';
 const secret='whsec_unit_test';
 const timestamp=1730000000;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body));
 const hex=Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
 const header='t='+timestamp+',v1='+hex;
 assert.equal(await stripeSignatureValid(body,header,secret,timestamp),true);
 assert.equal(await stripeSignatureValid(body+'evil',header,secret,timestamp),false);
 assert.equal(await stripeSignatureValid(body,header,'another-key',timestamp),false);
 assert.equal(await stripeSignatureValid(body,header,secret,timestamp+301),false);
});
