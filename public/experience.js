/* Presentation only. No payment execution, impact scoring or certification. */
export const DEMO_STEPS=[
 {stage:'source',actor_name:'Example material supplier',place:'Origin disclosed by the supplier',happened_at:'',evidence_status:'supplier_declared',evidence_title:'Illustrative declaration'},
 {stage:'manufacture',actor_name:'Example manufacturer',place:'Factory record (illustrative)',happened_at:'',evidence_status:'evidence_checked',evidence_title:'Example document'},
 {stage:'transport',actor_name:'Unknown transport operator',place:'Transport details missing',happened_at:'',evidence_status:'missing',evidence_title:''},
 {stage:'retail',actor_name:'Example seller',place:'Store presentation',happened_at:'',evidence_status:'supplier_declared',evidence_title:''}
];
export const DEMO_MONEY=[
 {category:'materials',amount_minor:1900},{category:'manufacturing',amount_minor:2500},
 {category:'logistics',amount_minor:1300},{category:'platform',amount_minor:900},
 {category:'tax',amount_minor:1100},{category:'retailer',amount_minor:2300}
];
export const MONEY_LABELS={materials:'Materials',manufacturing:'Manufacturing',logistics:'Logistics',platform:'Platform costs',tax:'Tax',retailer:'Retailer allocation',other:'Other disclosed costs'};
const resultStatus=s=>({
 independently_verified:'Independently verified evidence',
 evidence_checked:'Evidence checked (not independent verification)',
 supplier_declared:'Seller / supplier declared',
 missing:'Missing information',rejected:'Rejected evidence'
})[s]||'Unverified statement';
export function journeyMarkup(data,escape,{demo=false}={}){
 const h=escape;
 const product=data?.product||{};
 const records=Array.isArray(data?.events)&&data.events.length?data.events:(demo?DEMO_STEPS:[]);
 const stages=['source','process','manufacture','package','transport','warehouse','retail','repair','reuse'];
 const entries=demo?DEMO_STEPS:stages.map(stage=>{
  const found=records.find(e=>e.stage===stage);
  return found||{stage,actor_name:'Not disclosed',place:'No record has been provided for this stage',evidence_status:'missing',evidence_title:''};
 });
 const visible=demo?entries:entries.filter(e=>['source','manufacture','transport','retail'].includes(e.stage)||records.some(r=>r.stage===e.stage));
 return '<section class="ec-x-journey" aria-label="Explorable product journey">'+
 '<div class="ec-x-heading"><span class="ec-x-kicker">'+(demo?'DEMONSTRATION — NOT A REAL PRODUCT':'RECORDED PRODUCT DISCLOSURES')+'</span><h3>FOLLOW EVERY HANDOFF.</h3>'+
 '<p>Open a stage to examine its actor, place and evidence status. A documented handoff is not proof of ethical conduct.</p></div>'+
 '<div class="ec-x-track">'+visible.map((e,i)=>'<details class="ec-x-stage" '+(i===0?'open':'')+'><summary>'+
 '<span class="ec-x-index">'+String(i+1).padStart(2,'0')+'</span><span class="ec-x-stage-copy"><strong>'+h(e.stage.toUpperCase())+'</strong><small>'+h(e.actor_name||'Not disclosed')+'</small></span>'+
 '<span class="ec-x-stage-status '+(e.evidence_status==='missing'?'ec-x-missing':'')+'">'+h(resultStatus(e.evidence_status||'missing'))+'</span><span class="ec-x-chevron" aria-hidden="true">↗</span></summary>'+
 '<div class="ec-x-details"><p><b>Place or context:</b> '+h(e.place||'Undisclosed')+'</p>'+
 '<p><b>Supporting evidence:</b> '+h(e.evidence_title||'No linked evidence')+'</p>'+
 (e.happened_at?'<p><b>Recorded date:</b> '+h(e.happened_at)+'</p>':'')+
 (e.source_url&&/^https:\/\//.test(e.source_url)?'<a href="'+h(e.source_url)+'" target="_blank" rel="noopener noreferrer">View seller-linked source ↗</a>':'')+
 '</div></details>').join('')+'</div>'+
 '<p class="ec-x-guardrail">'+(demo?'All names, locations and example evidence on this illustration are fictional.':'Records and labels come from seller submissions. Missing records remain visibly missing; this is not independent supply-chain verification.')+'</p></section>';
}
export function moneyMarkup(input,escape,{demo=false}={}){
 const h=escape;
 const rows=demo?DEMO_MONEY:(input?.money?.entries||[]);
 const amount=demo?10000:Number(input?.money?.totalMinor||input?.product?.price_minor||0);
 const total=rows.reduce((a,e)=>a+Number(e.amount_minor||0),0);
 const inconsistent=total>amount;
 const undisclosed=Math.max(0,amount-total);
 const show=rows.length>0;
 const fmt=n=>'£'+(Math.round(n)/100).toFixed(2);
 return '<section class="ec-x-money"><div class="ec-x-heading"><span class="ec-x-kicker">'+(demo?'INTERACTIVE EXAMPLE / £100 PURCHASE':'VOLUNTARY MERCHANT DISCLOSURES')+'</span>'+
 '<h3>WHERE DOES THE MONEY GO?</h3><p>'+(demo?'Move the hypothetical purchase amount to see how an illustrative allocation scales. It is not based on actual suppliers, transfers or customer purchases.':'These are only categories the merchant has explicitly made public. Amounts are self-reported and do not reflect verified payments or profit.')+'</p></div>'+
 (demo?'<label class="ec-x-slider">Hypothetical basket amount <strong id="ec-demo-total">£100.00</strong><input type="range" id="ec-demo-money-slider" min="25" max="250" step="5" value="100"></label>':'')+
 '<div class="ec-x-money-list" id="'+(demo?'ec-demo-money-lines':'ec-public-money-lines')+'" data-base="'+h(amount)+'">'+
 (show?rows.map(row=>{
 const pct=amount?Math.round(1000*row.amount_minor/amount)/10:0;
 return '<div class="ec-x-money-line" data-money-base="'+h(row.amount_minor)+'"><div class="ec-x-money-label"><strong>'+h(MONEY_LABELS[row.category]||'Other disclosed costs')+'</strong><span>'+fmt(row.amount_minor)+'</span></div><div class="ec-x-bar"><span style="width:'+Math.min(pct,100)+'%"></span></div><small>'+ (demo?h(pct)+'% · example only':'Seller-declared'+(row.evidence_url?' · evidence linked (not verified)':''))+'</small></div>';
 }).join(''):'<div class="ec-x-no-data">No financial breakdown has been voluntarily published. An unknown amount does not indicate a hidden fee or a specific margin.</div>')+
 (!demo&&undisclosed>0?'<div class="ec-x-money-line ec-x-undisclosed"><div class="ec-x-money-label"><strong>Undisclosed / unallocated</strong><span>'+fmt(undisclosed)+'</span></div><div class="ec-x-bar"><span style="width:'+(amount?Math.min(100,Math.round(100*undisclosed/amount)):0)+'%"></span></div><small>Unknown distribution; not necessarily retailer profit.</small></div>':'')+
 '</div>'+(inconsistent?'<div class="notice">Disclosed categories exceed the product price. They cannot be represented as a reconciled money split.</div>':'')+
 '<p class="ec-x-guardrail">'+(demo?'Illustrative proportions are fictional. No payments were processed.':'Costs are seller-declared, voluntary and not independently audited. No transfers, payouts or earned rewards are performed by this feature.')+'</p></section>';
}
export function supplierDirectoryMarkup(records,escape){
 const h=escape;
 const list=Array.isArray(records)?records:[];
 return '<section class="ec-x-suppliers"><div class="ec-x-heading"><span class="ec-x-kicker">OPT-IN SUPPLIER DIRECTORY</span><h3>PEOPLE BEHIND PRODUCTS.</h3><p>Suppliers appear here only when a merchant opts in. Listings and fulfilment claims are merchant-supplied, not vetted, verified or endorsed.</p></div>'+
 '<form data-action="supplier-search" class="ec-x-search"><label for="ec-supplier-search">Search name, category or country</label><div><input id="ec-supplier-search" class="input" name="q" maxlength="80" placeholder="Search disclosed suppliers" type="search"><button class="btn btn-dark">Find suppliers</button></div></form>'+
 '<div class="ec-x-supplier-results" id="ec-x-supplier-results">'+
 (list.length?list.map(s=>'<article class="ec-x-supplier"><span class="ec-x-kicker">SELLER-DECLARED</span><h4>'+h(s.name)+'</h4><p>'+h(s.description||'No public description')+'</p><div><span>'+h(s.country||'Country undisclosed')+'</span><span>'+h(s.categories||'Category undisclosed')+'</span></div>'+(s.website?'<a href="'+h(s.website)+'" rel="noopener noreferrer" target="_blank">Supplier website ↗</a>':'')+'</article>').join(''):
 '<div class="ec-x-no-data">No matching opted-in suppliers have been published. This is not a list of pre-approved suppliers.</div>')+
 '</div></section>';
}
export function impactMarkup(impact,escape){
 const h=escape;
 const parts=[['Products recorded',impact.products],['Handoffs recorded',impact.recordedHandoffs],
  ['Evidence records',impact.linkedEvidence],['Product claims',impact.claims],
  ['Independent assessments',impact.independentlyAssessedEvidence],['Public cost declarations',impact.publicMoneyDisclosures],
  ['Opt-in supplier listings',impact.optedInSuppliers],['Open customer concerns',impact.openConcerns]];
 return '<section class="ec-x-impact"><div class="ec-x-heading"><span class="ec-x-kicker">TRANSPARENCY ACTIVITY</span><h3>DOCUMENT THE WORK.</h3><p>Progress means more recorded information and fewer unaddressed gaps—not a fabricated ethical score.</p></div>'+
 '<div class="ec-x-impact-grid">'+parts.map(([label,value])=>'<div><strong>'+h(value||0)+'</strong><span>'+h(label)+'</span></div>').join('')+'</div>'+
 '<p class="ec-x-guardrail">'+h(impact.label||'Activity counters are not verified sustainability outcomes or eligibility for rewards.')+'</p></section>';
}
export function wizardMarkup(escape){
 const h=escape;
 return '<div class="container ec-x-wizard"><div class="ec-x-heading"><span class="ec-x-kicker">SELLER STUDIO / GET STARTED</span><h1>LAUNCH YOUR <em>STORY.</em></h1><p>Three short steps and a live preview. No payment details required.</p></div>'+
 '<div class="ec-x-wizard-grid"><form class="panel ec-x-wizard-form" data-action="store">'+
 '<fieldset class="ec-x-wizard-step" data-wizard-step="1"><legend>01 — Your identity</legend><label>Store name<input class="input" name="name" id="ec-wizard-name" maxlength="100" minlength="3" required placeholder="e.g. Fair Goods Collective"></label>'+
 '<label>Store URL (optional)<input class="input" name="slug" maxlength="70" placeholder="fair-goods-collective"></label><button type="button" class="btn btn-dark" data-wizard-next="2">Next: your story →</button></fieldset>'+
 '<fieldset class="ec-x-wizard-step" data-wizard-step="2" hidden><legend>02 — Your story</legend>'+
 '<label>What makes this shop different?<textarea rows="4" name="description" id="ec-wizard-description" maxlength="1000" placeholder="A short description. Claims still need evidence."></textarea></label>'+
 '<div class="row"><button type="button" class="btn btn-light" data-wizard-back="1">← Back</button><button type="button" class="btn btn-dark" data-wizard-next="3">Next: design →</button></div></fieldset>'+
 '<fieldset class="ec-x-wizard-step" data-wizard-step="3" hidden><legend>03 — Make it yours</legend>'+
 '<label>Storefront accent colour<input type="color" name="themeColor" id="ec-wizard-color" value="#256b59"></label>'+
 '<p class="small muted">You can change the design and add products later. Payments and fulfilment remain disabled during early access.</p>'+
 '<div class="row"><button type="button" class="btn btn-light" data-wizard-back="2">← Back</button><button type="submit" class="btn btn-dark">Create my store ↗</button></div></fieldset></form>'+
 '<div class="ec-x-wizard-preview"><span class="ec-x-kicker">LIVE STOREFRONT PREVIEW</span><div class="ec-x-demo-store" id="ec-wizard-preview">'+
 '<div class="ec-x-preview-title" id="ec-preview-title">Your brand</div><p id="ec-preview-story">A brand new storefront with a clear product story.</p>'+
 '<div class="ec-x-preview-product">✳<span>YOUR FIRST PRODUCT<br><small>Product passport comes next</small></span></div></div>'+
 '<p>Preview only; no shop has been created yet.</p></div></div></div>';
}
export function updateWizardPreview(form){
 const title=document.querySelector('#ec-preview-title'),story=document.querySelector('#ec-preview-story'),preview=document.querySelector('#ec-wizard-preview');
 if(title)title.textContent=form.elements.namedItem('name')?.value||'Your brand';
 if(story)story.textContent=form.elements.namedItem('description')?.value||'A brand new storefront with a clear product story.';
 if(preview)preview.style.setProperty('--preview-accent',form.elements.namedItem('themeColor')?.value||'#256b59');
}
export function updateDemoMoney(value){
 const amount=Number(value);
 if(!Number.isFinite(amount))return;
 const total=document.querySelector('#ec-demo-total');
 if(total)total.textContent='£'+amount.toFixed(2);
 document.querySelectorAll('#ec-demo-money-lines [data-money-base]').forEach(el=>{
  const fraction=Number(el.dataset.moneyBase||0)/10000;
  const label=el.querySelector('.ec-x-money-label span');
  if(label)label.textContent='£'+(fraction*amount).toFixed(2);
 });
}
