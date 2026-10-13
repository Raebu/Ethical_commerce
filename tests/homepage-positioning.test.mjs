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
 assert.match(css,/\.ec-zoom-mask\{/);
 assert.match(css,/\.ec-overlay-host\.ec-mask-stage\{/);
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

test('ETHICAL is a genuine content-window mask, not an opaque flying word',()=>{
 assert.doesNotMatch(markup,/class="ec-overlay-display"/);
 assert.match(app,/function ethicalRevealOrigin\(\)/);
 assert.match(app,/range\.setStart\(node,match\.index\)/);
 assert.match(app,/range\.setEnd\(node,match\.index\+match\[0\]\.length\)/);
 assert.match(app,/function playEthicalTextMask\(host,panel,name,trigger,options=\{\}\)/);
 assert.match(app,/ctx\.globalCompositeOperation='destination-out'/);
 assert.match(app,/ctx\.fillText\(word,0,0\)/);
 assert.match(app,/ctx\.fillRect\(0,0,width,height\)/);
 assert.match(app,/const total=3800/);
 assert.match(app,/endScale/);
 assert.match(app,/host\.classList\.add\('ec-mask-stage'\)/);
 assert.match(css,/\.ec-overlay-host\.ec-mask-stage\{/);
 assert.match(css,/\.ec-zoom-mask\{/);
 assert.doesNotMatch(app,/word\.className='ec-zoom-flight'/);
 assert.doesNotMatch(css,/\.ec-zoom-flight\{/);
 assert.doesNotMatch(css,/\.ec-zoom-curtain\{/);
});
test('masked view becomes the full underlying overlay and supports cancellation',()=>{
 assert.match(app,/mask\.style\.opacity=String\(p<\.96/);
 assert.match(app,/run\.mask\.remove\(\)/);
 assert.match(app,/cancelAnimationFrame\(run\.frameId\)/);
 assert.match(app,/function cancelEthicalZoom\(\)/);
 assert.match(app,/window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
 assert.match(app,/panel\.querySelector\('\.ec-overlay-close'\)\?\.focus/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/body:has\(\.home-shell\) \.site-header\{position:relative/);
 assert.match(html,/class="container home-mini-footer"/);
});

test('the three journey cards replace redundant bottom actions',()=>{
 const cards=[...markup.matchAll(/<a class="home-step ec-action-card"[^>]*>/g)].map(m=>m[0]);
 assert.equal(cards.length,3,'the three on-screen cards must all be links');
 assert.match(cards[0],/href="\/dashboard" data-ethical-route="dashboard"/);
 assert.match(cards[1],/data-overlay-open="proof"/);
 assert.match(cards[2],/data-overlay-open="rewards"/);
 assert.doesNotMatch(markup,/class="overlay-actions"/,'do not duplicate cards as bottom CTAs');
 assert.match(css,/\.ec-overlay-panel \.ec-action-card:focus-visible/);
});
test('reward card has an honest dedicated full-page explanation',()=>{
 assert.match(markup,/id="ec-overlay-rewards"/);
 assert.match(markup,/id="ec-rewards-title"/);
 assert.match(markup,/There is no active cash-rewards programme/);
 assert.match(markup,/IN DEVELOPMENT/);
 assert.match(markup,/FUTURE CONCEPT/);
 assert.match(app,/\['how','proof','products','rewards'\]/);
});
test('switching from a card replays the actual ETHICAL glyph-mask and seller store navigation uses it',()=>{
 assert.match(app,/function ethicalRevealOrigin\(trigger\)/);
 assert.match(app,/trigger\?\.closest\?\.\('\.ec-action-card'\)/);
 assert.match(app,/const origin=ethicalRevealOrigin\(trigger\);/);
 assert.match(app,/playEthicalTextMask\(host,panel,name,trigger,\{origin\}\)/);
 assert.doesNotMatch(app,/if\(switching\|\|window\.matchMedia/,'nested navigation should no longer skip animation');
 assert.match(app,/async function navigateWithEthicalMask\(to,trigger\)/);
 assert.match(app,/await render\(\);\s*if\(!playEthicalTextMask\(null,null,'route',trigger/);
 assert.match(app,/ctx\.globalCompositeOperation='destination-out'/);
 assert.match(app,/document\.body\.append\(canvas\);\s*closeEthicalOverlay\(true\);/);
});
