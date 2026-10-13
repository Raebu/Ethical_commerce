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

test('first screen leads with an ethical-rewards question and explains exactly what can be built',()=>{
 assert.ok(markup.indexOf('WHAT IF DOING')>=0,'ethical hook must be immediate');
 assert.ok(markup.indexOf('GOOD</span> ACTUALLY')>=0,'first-screen reward hook present');
 const explanation=markup.indexOf('ethical dropshipping store');
 const button=markup.indexOf('Create your store');
 const catalogue=markup.indexOf('id="discover"');
 assert.ok(explanation>=0&&explanation<button&&catalogue>button,'seller explanation and action must precede shopper catalogue');
 assert.match(markup,/href="\/dashboard" data-link/,'seller CTA must reach real Seller Studio');
});

test('future rewards and money-flow features are not misrepresented as operational',()=>{
 assert.match(markup,/Reward payments and payment-split reporting are/);
 assert.match(markup,/in development/);
 assert.match(markup,/not available yet/);
 assert.match(markup,/REWARDS &amp; PAYMENT INSIGHTS: PLANNED/);
 assert.match(markup,/ILLUSTRATIVE|CONCEPT PREVIEW/);
 assert.match(markup,/seller declaration is not independent verification/);
 assert.match(markup,/Live checkout and automated fulfilment are also disabled/);
});

test('public homepage is black with electric accent while merchant dashboard remains scoped out',()=>{
 assert.match(html,/<meta name="theme-color" content="#000000">/);
 assert.match(css,/body:has\(\.home-shell\).*background:#000!important/);
 assert.match(css,/\.home-hero h1\{[^}]*color:#f7f7f4/);
 assert.match(css,/\.home-hero h1 span[^}]*color:#d3ff5c/);
 assert.ok(!css.includes('body{background:#000!important}'),'do not invert merchant forms and dashboard globally');
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('public shopping and product-passport navigation remain present',()=>{
 assert.match(app,/async function loadCatalog/);
 assert.match(markup,/id="catalog"/);
 assert.match(markup,/id="how-it-works"/);
 assert.match(markup,/href="\/about" data-link/);
 assert.match(html,/Create your store/);
});
