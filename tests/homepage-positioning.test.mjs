import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const homepage=app.slice(app.indexOf('async function discover(){'),app.indexOf('async function loadCatalog('));

test('homepage explains the product and conversion action before any shopper catalogue',()=>{
 const hero=homepage.indexOf('Create your ');
 const selling=homepage.indexOf('ethical dropshipping store.');
 const action=homepage.indexOf('Create your store');
 const products=homepage.indexOf('id=\\"discover\\"');
 assert.ok(hero>=0&&selling>hero,'must immediately explain ethical dropshipping');
 assert.ok(action>selling,'the first CTA must tell sellers what to do');
 assert.ok(products>action,'shopper catalogue must not precede the seller offer');
 assert.match(homepage,/href=\\\"\\/dashboard\\\"/,'seller CTA must route to real Seller Studio');
});

test('homepage distinguishes live traceability from planned payment flow',()=>{
 assert.match(homepage,/from where it starts to how it reaches your customer/);
 assert.match(homepage,/Payment-split reporting: in development/);
 assert.match(homepage,/automatic fulfilment, live checkout and payment-split reporting are not yet active/);
 assert.match(homepage,/ILLUSTRATIVE PREVIEW/);
 assert.match(homepage,/Declarations are not independent verification/);
});

test('seller journey remains accessible, mobile-friendly, and does not break shoppers',()=>{
 assert.match(app,/async function loadCatalog/);
 assert.match(homepage,/id=\\\"catalog\\\"/);
 assert.match(homepage,/id=\\\"how-it-works\\\"/);
 assert.match(html,/Create your ethical dropshipping store/);
 assert.match(html,/Create your store/);
 assert.match(css,/\.home-hero\{/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
