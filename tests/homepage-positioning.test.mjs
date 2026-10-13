import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const begin=app.indexOf('async function discover(){');
const end=app.indexOf('async function loadCatalog(',begin);
const homepage=app.slice(begin,end);
const afterAssignment=homepage.split('main.innerHTML=')[1];
const markup=JSON.parse(afterAssignment.slice(0,afterAssignment.indexOf(';\n await loadCatalog')));

test('the first screen says what the product is and tells sellers what to do',()=>{
 const headline=markup.indexOf('ethical dropshipping store.');
 const action=markup.indexOf('Create your store');
 const productCatalog=markup.indexOf('id="discover"');
 assert.ok(headline>=0,'must clearly say ethical dropshipping store');
 assert.ok(action>headline,'lead with the primary seller CTA');
 assert.ok(productCatalog>action,'do not put the shopper catalogue before the offer');
 assert.match(markup,/href="\/dashboard" data-link/,'seller CTA must point to a working Seller Studio');
});

test('no false claims about unlaunched payment and fulfilment tools',()=>{
 assert.match(markup,/from where it starts to how it reaches your customer/);
 assert.match(markup,/Payment-split reporting: in development/);
 assert.match(markup,/automatic fulfilment, live checkout and payment-split reporting are not yet active/);
 assert.match(markup,/ILLUSTRATIVE PREVIEW/);
 assert.match(markup,/Declarations are not independent verification/);
});

test('page remains usable by shoppers and at mobile widths',()=>{
 assert.match(app,/async function loadCatalog/);
 assert.match(markup,/id="catalog"/);
 assert.match(markup,/id="how-it-works"/);
 assert.match(html,/Create your ethical dropshipping store/);
 assert.match(html,/Create your store/);
 assert.match(css,/\.home-hero\{/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
