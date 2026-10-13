import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const begin=app.indexOf('async function discover(){');
const end=app.indexOf('async function loadCatalog(',begin);
const homepage=app.slice(begin,end);
const markup=JSON.parse(homepage.split('main.innerHTML=')[1].split(';\n}')[0]);

test('home is hero-first and the CTA reaches functional seller studio',()=>{
 assert.match(markup,/WHAT IF DOING/);
 assert.match(markup,/ethical dropshipping store/);
 assert.match(markup,/href="\/dashboard" data-link/);
 assert.match(markup,/data-overlay-open="how"/);
 assert.ok(markup.indexOf('ethical dropshipping store')<markup.indexOf('Create your store'));
});

test('original home content moves to accessible overlay panels, not a long scrolling page',()=>{
 for(const name of ['how','proof','products']){
  assert.match(markup,new RegExp('id="ec-overlay-'+name+'"'));
  assert.match(markup,new RegExp('data-overlay-open="'+name+'"'));
 }
 assert.match(markup,/id="how-it-works"/);
 assert.match(markup,/id="catalog"/);
 assert.match(markup,/aria-modal="true"/);
 assert.match(markup,/data-overlay-close/);
 assert.match(css,/html:has\(\.home-shell\)\{overflow:hidden\}/);
 assert.match(css,/\.ec-overlay-host\.is-open/);
 assert.doesNotMatch(markup,/class="ec-overlay-display"/);
 assert.match(css,/\.ec-zoom-flight\{/);
 assert.match(css,/\.ec-zoom-curtain\.is-revealing/);
 assert.match(css,/body:has\(\.home-shell\) \.site-header\{position:relative;top:0;bottom:auto/);
 assert.match(css,/body:has\(\.home-shell\) \.site-footer\{display:block/);
 assert.match(css,/body:has\(\.home-shell\) \.site-footer \.footer-grid/);
 assert.match(html,/class="container home-mini-footer"/);
 assert.match(html,/data-home-overlay="how"/);
 assert.match(html,/data-home-overlay="proof"/);
 assert.match(html,/data-home-overlay="products"/);
});

test('overlay is closable, focus-aware and respects reduced motion',()=>{
 assert.match(app,/function closeEthicalOverlay/);
 assert.match(app,/function openEthicalOverlay/);
 assert.match(app,/e\.key==='Escape'/);
 assert.match(app,/e\.key!=='Tab'/);
 assert.match(app,/trigger\.focus/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('ethical and reward disclosures remain honest',()=>{
 assert.match(markup,/Reward payments and payment-split reporting are/);
 assert.match(markup,/REWARDS &amp; PAYMENT INSIGHTS: PLANNED/);
 assert.match(markup,/CONCEPT PREVIEW/);
 assert.match(markup,/Live checkout and automated fulfilment are also disabled/);
 assert.match(css,/body:has\(\.home-shell\).*background:#000!important/);
 assert.ok(!css.includes('body{background:#000!important}'));
 assert.match(app,/async function loadCatalog/);
 assert.match(html,/Create your store/);
});

test('top header is preserved and the compact footer replaces lower homepage sections',()=>{
 assert.match(html,/<header class="site-header">/);
 assert.match(html,/class="container header-inner"/);
 assert.match(html,/class="container home-mini-footer"/);
 assert.match(css,/body:has\(\.home-shell\) #main\{height:auto;flex:1 1 auto;min-height:0;overflow:hidden\}/);
 assert.match(css,/body:has\(\.home-shell\) \.site-footer \.home-mini-footer\{display:flex/);
 assert.doesNotMatch(css,/body:has\(\.home-shell\) \.site-header\{position:fixed;top:auto;bottom:0/);
 assert.match(app,/function navigate\(to\)\{closeEthicalOverlay\(true\);/);
});

test('ETHICAL enlarges from the homepage phrase slowly, never rests as a duplicate headline',()=>{
 assert.doesNotMatch(markup,/class="ec-overlay-display"/);
 assert.match(app,/document\.querySelector\('\.home-lead strong'\)/);
 assert.match(app,/word\.textContent='ETHICAL'/);
 assert.match(app,/duration:2700/);
 assert.match(app,/curtain\.classList\.add\('is-revealing'\)/);
 assert.match(app,/cancelEthicalZoom\(\)/);
 assert.match(css,/\.ec-zoom-flight\{/);
 assert.match(css,/\.ec-zoom-curtain\{/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
