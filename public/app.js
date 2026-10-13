const main=document.querySelector('#main');
const toast=document.querySelector('#toast');
const state={user:null,stores:[],storeId:localStorage.getItem('ec-store')||'',tab:'overview',selectedProduct:'',editProduct:null,lastEvidenceId:'',authMode:'register',salesEnabled:false,orderAccess:null};
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=(minor,currency='GBP')=>new Intl.NumberFormat('en-GB',{style:'currency',currency:currency||'GBP'}).format((Number(minor)||0)/100);
const image=url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:''}catch{return ''}};
const art=(url,alt='Product image')=>image(url)?'<img src="'+h(image(url))+'" alt="'+h(alt)+'" loading="lazy">':'<span aria-hidden="true">✳</span>';
function flash(message){toast.textContent=message;toast.hidden=false;clearTimeout(flash.timer);flash.timer=setTimeout(()=>toast.hidden=true,5600)}
function sellerFormFeedback(form,err){
 // Keep the merchant's input intact and surface every actionable error.
 const summary=form.querySelector('#seller-compliance-feedback');
 form.querySelectorAll('[data-seller-field-error]').forEach(node=>node.remove());
 form.querySelectorAll('[aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));
 if(summary){summary.hidden=false;summary.textContent=err.message||'Unable to save seller disclosures';summary.dataset.result='error'}
 const errors=err.fieldErrors&&typeof err.fieldErrors==='object'?err.fieldErrors:{};
 let first=null;
 for(const [name,message] of Object.entries(errors)){
  const field=form.elements.namedItem(name);
  if(!(field instanceof HTMLElement))continue;
  first=first||field;
  field.setAttribute('aria-invalid','true');
  const hint=document.createElement('span');
  hint.className='seller-field-error';
  hint.dataset.sellerFieldError='true';
  hint.setAttribute('role','alert');
  hint.textContent=String(message);
  (field.closest('label')||field.parentElement)?.append(hint);
 }
 if(first){first.focus({preventScroll:false})}
 else if(summary){summary.focus()}
}
function emailVerificationFeedback(message,kind='info'){
 const target=document.querySelector('#email-verification-feedback');
 if(target){target.hidden=false;target.dataset.result=kind;target.textContent=message;target.focus({preventScroll:false})}
 else flash(message);
}
function emailVerificationWidget(email,editing=false){
 const configured=!!email.serviceConfigured;
 const value=email.pendingEmail||email.email||state.user?.email||'';
 if(email.pending&&!editing)return '<div class="notice" role="status"><strong>Email under verification — check your email</strong><p>We sent a verification link to <strong>'+h(value)+'</strong>. Open the link to verify your address. It expires after 20 minutes.</p><p class="small">If the message has not arrived, check your junk or spam folder.</p></div><div class="row"><button type="button" class="btn btn-soft" data-op="resend-verification" data-email="'+h(value)+'" '+(configured?'':'disabled')+'>Resend verification email</button><button type="button" class="btn btn-light" data-op="change-verification-email">Use a different email</button></div><p id="email-verification-feedback" class="inline-feedback" role="status" tabindex="-1" aria-live="polite" hidden></p>';
 if(email.verified&&!editing)return '<div class="notice" role="status"><strong>Email verified</strong><p>'+h(email.email||value)+' has been verified successfully.</p></div><button type="button" class="btn btn-light" data-op="change-verification-email">Change email address</button><p id="email-verification-feedback" class="inline-feedback" role="status" tabindex="-1" aria-live="polite" hidden></p>';
 return '<form class="form" data-action="verify-email"><label>Email address<input name="email" class="input" type="email" autocomplete="email" required maxlength="254" value="'+h(value)+'" placeholder="you@example.com"></label><button class="btn btn-dark" type="submit" '+(configured?'':'disabled')+'>Verify email</button></form>'+(!configured?'<div class="notice">Email verification is not available yet: the staging operator needs to configure the verified transactional sender. You can enter your email now, but the verification request cannot be sent until then.</div>':'<p class="small muted">We will email a private verification link to this address. Your current login email stays unchanged until you open the link.</p>')+'<p id="email-verification-feedback" class="inline-feedback" role="status" tabindex="-1" aria-live="polite" hidden></p>';
}
async function refreshEmailVerification(editing=false){
 const target=document.querySelector('#email-verification-control');
 if(!target)return;
 const status=await api('/api/auth/email/status');
 target.innerHTML=emailVerificationWidget(status,editing);
}
async function sendVerificationRequest(email,button){
 if(button)button.disabled=true;
 emailVerificationFeedback('Sending a verification link…');
 try{
  const result=await post('/api/auth/email/request',{email});
  if(result.sent){await refreshEmailVerification()}
  else if(result.verified){await refreshEmailVerification()}
  else emailVerificationFeedback('We could not start email verification. Please try again.','error');
 }catch(ex){emailVerificationFeedback(ex.message||'Unable to request verification.','error')}
 finally{if(button&&button.isConnected)button.disabled=false}
}

async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',headers:{'accept':'application/json',...(options.body?{'content-type':'application/json'}:{})},...options});
 const contentType=res.headers.get('content-type')||'';
 const data=contentType.includes('application/json')?await res.json():null;
 if(!res.ok){const err=new Error(data?.error||'Request failed');if(data?.fieldErrors&&typeof data.fieldErrors==='object')err.fieldErrors=data.fieldErrors;throw err;}
 return data;
}
const post=(path,body,method='POST')=>api(path,{method,body:JSON.stringify(body)});
function navigate(to){closeEthicalOverlay(true);document.body.classList.remove('ec-overlay-active');history.pushState({},'',to);window.scrollTo(0,0);render()}
const currencyNotice='<div class="notice">Checkout is not active. Browsing and product information are available; orders and payment processing require additional compliance and provider integration.</div>';
const noData=(title,help)=>'<div class="empty"><h3>'+h(title)+'</h3><p>'+h(help)+'</p></div>';
function productCard(p){return '<article class="product-card"><div class="product-image">'+art(p.image_url,h(p.name))+'</div><div class="product-body"><span class="pill">Origin evidence available if provided</span><h3>'+h(p.name)+'</h3><p>'+h((p.description||'Product details provided by the seller.').slice(0,135))+'</p><div class="product-meta"><span class="product-price">'+h(price(p.price_minor,p.currency))+'</span><a class="card-link" href="/product/'+h(p.id)+'" data-link>View evidence ↗</a></div></div></article>'}
async function discover(){
 closeEthicalOverlay(true);
 main.innerHTML="<div class=\"container home-shell\">\n<section class=\"home-hero\" aria-labelledby=\"home-hero-title\">\n <div class=\"home-hero-copy\">\n  <span class=\"home-kicker\"><span class=\"home-kicker-dot\" aria-hidden=\"true\"></span> THE FUTURE OF ETHICAL COMMERCE / EARLY ACCESS</span>\n  <h1 id=\"home-hero-title\">WHAT IF DOING <span>GOOD</span> ACTUALLY <span>PAID?</span></h1>\n  <p class=\"home-lead\">Create your <strong>ethical dropshipping store</strong>. Trace every product from source to doorstep. Show the evidence, uncover the gaps and help customers see where their money goes.</p>\n  <p class=\"home-second-line\">Because being ethical shouldn't be just another marketing claim. It should be something you can <strong>prove.</strong></p>\n  <div class=\"home-actions\"><a href=\"/dashboard\" data-link class=\"btn btn-dark home-main-cta\">Create your store <span aria-hidden=\"true\">↗</span></a><a href=\"#how-it-works\" class=\"btn btn-light home-secondary-cta\" data-overlay-open=\"how\">Show me how <span aria-hidden=\"true\">↓</span></a></div>\n  <div class=\"home-quick-proof\" aria-label=\"Available features\"><span>✓ Build your storefront</span><span>✓ Trace suppliers</span><span>✓ Publish evidence passports</span></div>\n  <p class=\"home-availability\"><strong>Our vision:</strong> reward actions backed by evidence, not empty promises. Reward payments and payment-split reporting are <strong>in development</strong>, not available yet. Live checkout and automated fulfilment are also disabled during early access.</p>\n </div>\n <div class=\"home-visual\" aria-label=\"Illustrative supply chain traceability view. This is not a verified product or a real payment report.\">\n  <div class=\"home-visual-top\"><span class=\"visual-live-dot\" aria-hidden=\"true\"></span><span>THE PROOF BEHIND THE PRODUCT</span><span class=\"home-preview-label\">CONCEPT PREVIEW</span></div>\n  <div class=\"home-visual-product\"><div class=\"visual-product-symbol\" aria-hidden=\"true\">↗</div><div><span class=\"home-visual-eyebrow\">An example product passport</span><h2>Every product has a story.</h2><p>Make yours visible, honest and traceable.</p></div></div>\n  <ol class=\"home-journey\">\n   <li><span class=\"home-journey-node checked\" aria-hidden=\"true\">✓</span><div><strong>01 / SOURCE</strong><span>Origin and supplier recorded</span></div><span class=\"journey-chip\">Declared</span></li>\n   <li><span class=\"home-journey-node checked\" aria-hidden=\"true\">✓</span><div><strong>02 / PRODUCE</strong><span>Materials and manufacturing evidence</span></div><span class=\"journey-chip\">Evidence linked</span></li>\n   <li><span class=\"home-journey-node unknown\" aria-hidden=\"true\">?</span><div><strong>03 / MOVE</strong><span>Transport and handoffs</span></div><span class=\"journey-chip gap\">Evidence missing</span></li>\n   <li><span class=\"home-journey-node unknown\" aria-hidden=\"true\">?</span><div><strong>04 / DELIVER</strong><span>Final journey to the buyer</span></div><span class=\"journey-chip gap\">Not disclosed</span></li>\n  </ol>\n  <div class=\"home-money-card\"><div class=\"home-money-head\"><span class=\"money-icon\" aria-hidden=\"true\">£</span><div><strong>WHO REALLY GETS PAID?</strong><p>Our goal: make supplier costs and money flow easier to understand.</p></div></div><span class=\"money-roadmap\">PAYMENT TRANSPARENCY / IN DEVELOPMENT</span></div>\n  <div class=\"home-visual-foot\">Illustrative data only. A seller declaration is not independent verification.</div>\n </div>\n</section><div class=\"ec-home-openers\"><button type=\"button\" data-overlay-open=\"how\">HOW IT WORKS ↗</button><button type=\"button\" data-overlay-open=\"proof\">OUR STANDARD ↗</button><button type=\"button\" data-overlay-open=\"products\">DISCOVER PRODUCTS ↗</button></div></div><div class=\"ec-overlay-host\" id=\"ec-overlay-host\" aria-hidden=\"true\"><section class=\"ec-overlay-panel\" id=\"ec-overlay-how\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"ec-how-title\" tabindex=\"-1\" hidden><div class=\"ec-overlay-top\"><span>ETHICAL COMMERCE / THE JOURNEY</span><button class=\"ec-overlay-close\" type=\"button\" data-overlay-close aria-label=\"Close and return to homepage\">✕ <span>Close</span></button></div><div class=\"ec-overlay-content\"><div class=\"ec-overlay-heading\"><span>EXPLORE / THE JOURNEY</span><h2 id=\"ec-how-title\">HOW IT WORKS.</h2></div><section class=\"home-explain section\" id=\"how-it-works\" aria-labelledby=\"home-explain-title\">\n <div class=\"home-section-intro\"><span class=\"eyebrow\">STOP GUESSING. START SHOWING.</span><h2 id=\"home-explain-title\">DON'T JUST SAY <span>ETHICAL.</span> PROVE IT.</h2><p>Ever wish you could look behind a product before buying it? Ethical Commerce is being built around that idea — with a store and traceability tools you can start using in early access.</p></div>\n <div class=\"home-step-grid\">\n  <article class=\"home-step\"><span class=\"home-step-number\">01</span><div class=\"home-step-symbol\" aria-hidden=\"true\">↗</div><h3>CREATE YOUR STORE.</h3><p>Build your storefront, publish products and manage suppliers. Start selling differently, with better information at the centre.</p><span class=\"step-availability\">AVAILABLE IN PREVIEW</span></article>\n  <article class=\"home-step\"><span class=\"home-step-number\">02</span><div class=\"home-step-symbol\" aria-hidden=\"true\">◎</div><h3>PROVE THE JOURNEY.</h3><p>Record sourcing, manufacturing and transport stages. Attach evidence to product passports and disclose the parts you cannot yet verify.</p><span class=\"step-availability\">AVAILABLE IN PREVIEW</span></article>\n  <article class=\"home-step\"><span class=\"home-step-number\">03</span><div class=\"home-step-symbol\" aria-hidden=\"true\">£</div><h3>MAKE ETHICS REWARDING.</h3><p>Imagine rewarding verifiable good practice and showing how money moves through the supply chain. This is our ambition — not an active earnings programme.</p><span class=\"step-availability roadmap\">REWARDS &amp; PAYMENT INSIGHTS: PLANNED</span></article>\n </div>\n</section>\n<div class=\"overlay-actions\"><a href=\"/dashboard\" data-link class=\"btn btn-dark\">Create your ethical store ↗</a><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"proof\">See the proof →</button><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"products\">Explore products →</button></div></div></section><section class=\"ec-overlay-panel\" id=\"ec-overlay-proof\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"ec-proof-title\" tabindex=\"-1\" hidden><div class=\"ec-overlay-top\"><span>ETHICAL COMMERCE / OUR STANDARD</span><button class=\"ec-overlay-close\" type=\"button\" data-overlay-close aria-label=\"Close and return to homepage\">✕ <span>Close</span></button></div><div class=\"ec-overlay-content\"><div class=\"ec-overlay-heading\"><span>EXPLORE / OUR STANDARD</span><h2 id=\"ec-proof-title\">WHAT CAN YOU PROVE?</h2></div><section class=\"home-difference\" aria-labelledby=\"home-difference-title\"><div class=\"home-difference-copy\"><span class=\"eyebrow\">THE WORLD DOESN'T NEED ANOTHER EMPTY BADGE.</span><h2 id=\"home-difference-title\">PROOF IS THE <em>NEW LUXURY.</em></h2><p>What matters isn't whether a brand says “ethical”. It's what they can show you. Product passports distinguish seller statements from checked evidence, highlight missing steps and never invent independent certification.</p><a href=\"/about\" data-link class=\"home-inline-link\">Our evidence standard <span aria-hidden=\"true\">↗</span></a></div><div class=\"home-difference-detail\"><div class=\"home-detail-header\">WHAT CAN A PRODUCT PASSPORT SHOW?</div><div><span class=\"detail-dot green\" aria-hidden=\"true\"></span><strong>Supplier &amp; origin</strong><span>Recorded</span></div><div><span class=\"detail-dot green\" aria-hidden=\"true\"></span><strong>Manufacturing &amp; materials</strong><span>Documented</span></div><div><span class=\"detail-dot green\" aria-hidden=\"true\"></span><strong>Evidence classification</strong><span>Visible</span></div><div><span class=\"detail-dot amber\" aria-hidden=\"true\"></span><strong>Unknown or missing details</strong><span>Unhidden</span></div><p>Disclosure is not proof of ethical certification. The platform shows evidence status and gaps.</p></div></section>\n<div class=\"overlay-actions\"><a href=\"/dashboard\" data-link class=\"btn btn-dark\">Create your ethical store ↗</a><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"proof\">See the proof →</button><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"products\">Explore products →</button></div></div></section><section class=\"ec-overlay-panel\" id=\"ec-overlay-products\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"ec-products-title\" tabindex=\"-1\" hidden><div class=\"ec-overlay-top\"><span>ETHICAL COMMERCE / DISCOVER</span><button class=\"ec-overlay-close\" type=\"button\" data-overlay-close aria-label=\"Close and return to homepage\">✕ <span>Close</span></button></div><div class=\"ec-overlay-content\"><div class=\"ec-overlay-heading\"><span>EXPLORE / DISCOVER</span><h2 id=\"ec-products-title\">EXPLORE PRODUCTS.</h2></div><section id=\"discover\" class=\"section home-catalogue\" aria-labelledby=\"catalogue-heading\"><div class=\"section-heading\"><div><span class=\"eyebrow\">FOR PEOPLE WHO ASK MORE QUESTIONS</span><h2 id=\"catalogue-heading\">SHOP WITH YOUR EYES OPEN.</h2><p>Explore published products and examine seller-provided evidence. Missing information stays visible.</p></div><form data-action=\"search\" class=\"search\"><input class=\"input\" name=\"q\" type=\"search\" placeholder=\"Search transparent products\" aria-label=\"Search products\"><button class=\"btn btn-dark\">Search</button></form></div><div id=\"catalog\" aria-live=\"polite\"><div class=\"empty\">Loading published products…</div></div></section>\n<div class=\"overlay-actions\"><a href=\"/dashboard\" data-link class=\"btn btn-dark\">Create your ethical store ↗</a><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"proof\">See the proof →</button><button type=\"button\" class=\"btn btn-light\" data-overlay-open=\"products\">Explore products →</button></div></div></section></div>";
}
async function loadCatalog(q){
 const target=document.querySelector('#catalog');if(!target)return;
 try{const d=await api('/api/public/products?search='+encodeURIComponent(q));target.innerHTML=d.products.length?'<div class="grid">'+d.products.map(productCard).join('')+'</div>':noData('No products published yet','Merchants can prepare transparent listings in Seller Studio. Evidence submissions are not independent certification.');}
 catch(e){target.innerHTML=noData('Catalogue unavailable',e.message)}
}
function statusLabel(s){return ({supplier_declared:'Supplier declared',evidence_checked:'Evidence checked',independently_verified:'Independently verified',rejected:'Rejected',missing:'No evidence'})[s]||'No evidence'}
function badge(s){return '<span class="badge '+(s==='rejected'?'negative':s==='missing'||s==='supplier_declared'?'warn':'')+'">'+h(statusLabel(s))+'</span>'}
async function passport(productId){
 const d=await api('/api/public/products/'+encodeURIComponent(productId)),p=d.product;
 const claims=d.claims||[],events=d.events||[],cov=d.coverage;
 main.innerHTML='<div class="container"><div class="page-head"><a href="/" data-link class="small">← Back to discover</a><p class="eyebrow" style="margin:20px 0 8px">Product transparency passport</p></div><article class="detail"><div class="detail-top"><div class="detail-visual">'+art(p.image_url,p.name)+'</div><div class="detail-copy"><span class="pill">'+h(p.category||'Product')+'</span><h1>'+h(p.name)+'</h1><p>'+h(p.description||'No description provided.')+'</p><p class="price">'+h(price(p.price_minor,p.currency))+'</p><p><strong>Seller:</strong> '+h(p.store_name)+'<br><strong>Supplier:</strong> '+h(p.supplier_name||'Not disclosed')+'<br><strong>Supplier country:</strong> '+h(p.supplier_country||'Not disclosed')+'</p>'+currencyNotice+'</div></div></article><section class="section"><div class="section-heading"><div><span class="eyebrow">Evidence ledger</span><h2>What can we actually verify?</h2><p>Submitted statements are not automatically independent audits or certifications.</p></div></div>'+ (claims.length?'<div class="evidence-grid">'+claims.map(c=>'<article class="evidence-entry"><div class="row"><strong>'+h(c.facet)+'</strong><span class="spacer"></span>'+badge(c.evidence_status||'missing')+'</div><p>'+h(c.statement)+'</p><div class="small muted">Document: '+h(c.evidence_title||'Not supplied')+'<br>Issuer: '+h(c.issuer||'Unknown')+'</div>'+(image(c.source_url)?'<p><a href="'+h(image(c.source_url))+'" target="_blank" rel="noopener noreferrer">View external source ↗</a></p>':'')+'</article>').join('')+'</div>':noData('No supporting claims published','The seller has not submitted evidence-backed claims for this product. Do not assume it meets any ethical standard.'))+'</section><section class="section"><div class="section-heading"><div><span class="eyebrow">End to end</span><h2>Supply-chain journey</h2><p>'+h(cov.covered)+' of '+h(cov.total)+' disclosure milestones recorded. This is a completeness indicator, not an ethical rating.</p></div></div>'+(cov.missing.length?'<div class="notice">Missing milestones: '+h(cov.missing.join(', '))+'. These gaps have not been independently resolved.</div>':'<div class="notice green">All core milestones have entries. This does not confirm their accuracy.</div>')+(events.length?'<div class="panel" style="margin-top:18px"><div class="timeline">'+events.map(ev=>'<div class="timeline-item"><strong>'+h(ev.stage)+' · '+h(ev.actor_name)+'</strong><p>'+h(ev.place||'Location not provided')+' · '+h(ev.happened_at)+'</p><p>'+badge(ev.evidence_status||'missing')+' '+h(ev.evidence_title||'No linked evidence')+'</p></div>').join('')+'</div></div>':noData('No journey records yet','The supplier has not supplied a traceable production history.'))+'</section><section class="section"><div class="panel"><h2>Raise a concern</h2><p class="muted">Have information about a misleading claim, product safety or environmental harm? Reports go to authorised seller staff. Do not submit confidential worker information: an independent protected whistleblower channel is not yet available.</p><form data-action="report" class="form"><input type="hidden" name="productId" value="'+h(p.id)+'"><label>Concern category<select name="category" required><option value="misleading_claim">Misleading claim</option><option value="product_safety">Product safety</option><option value="animal_welfare">Animal welfare</option><option value="environment">Environment</option><option value="other">Other</option></select></label><label>Details<textarea name="message" rows="4" minlength="20" maxlength="2000" required></textarea></label><label>Email (optional)<input class="input" type="email" name="contactEmail" placeholder="For follow-up only"></label><button class="btn btn-dark">Submit concern</button></form></div></section></div>';
 try{
  const [hinfo,sellerInfo]=await Promise.all([api('/api/health'),api('/api/commerce/public/sellers/'+encodeURIComponent(p.store_slug))]);
  const info=sellerInfo.seller||{},target=main.querySelector('.detail-copy');
  if(target){
   const urls=[['Returns',info.return_policy_url],['Shipping',info.shipping_policy_url],['Terms',info.terms_url],['Privacy',info.privacy_url]];
   const legal=info.legal_seller_name?'<div class="evidence-entry"><strong>Seller-declared legal name: '+h(info.legal_seller_name)+'</strong><p>'+h(info.trading_address||'Address not provided')+'</p><p>Customer support: '+h(info.contact_email||'Not disclosed')+'</p><div class="row">'+urls.filter(x=>image(x[1])).map(x=>'<a href="'+h(x[1])+'" target="_blank" rel="noopener noreferrer" class="small">'+h(x[0])+' ↗</a>').join('')+'</div></div>':'<div class="notice">This seller has not completed its legal trading disclosures.</div>';
   target.insertAdjacentHTML('beforeend',legal);
   if(hinfo.payments==='configuration-enabled'&&urls.every(x=>image(x[1]))){
    const offlineNotice=target.querySelector('.notice');if(offlineNotice)offlineNotice.remove();
    const isSandbox=hinfo.paymentMode==='test';
    target.insertAdjacentHTML('beforeend','<div class="panel"><h3>'+(isSandbox?'TEST MODE — no real card charges':'Secure seller checkout')+'</h3><p class="small muted">'+(isSandbox?'This checkout is for authorised sandbox testing only. Do not enter genuine payment or shipping information.':'Available for verified approved stores only. Stripe Checkout calculates applicable tax and shows the final payable total.')+'</p><label><input id="ack-policies" type="checkbox"> I have reviewed the seller’s returns, shipping, privacy and terms disclosures.</label><button class="btn btn-dark" data-buy="'+h(p.id)+'" data-store="'+h(p.store_id)+'">'+(isSandbox?'Continue to test checkout ↗':'Continue to secure checkout ↗')+'</button></div>');
   }
  }
 }catch(e){console.warn('Public seller disclosures unavailable',e)}
}
function landing(type){
 if(type==='sell')main.innerHTML="<div class=\"container seller-intro-page\"><section class=\"seller-intro-hero\"><span class=\"eyebrow\">Ethical dropshipping starts here</span><h1>Create your ethical dropshipping store. <span>Show every step.</span></h1><p>Give your customers a proper look behind the product: its origin, suppliers, evidence and missing links. Build towards money-flow transparency as those disclosures become available.</p><div class=\"home-actions\"><a href=\"/dashboard\" data-link class=\"btn btn-dark\">Create your store <span aria-hidden=\"true\">→</span></a><a href=\"/\" data-link class=\"btn btn-light\">See how it works <span aria-hidden=\"true\">↗</span></a></div><p class=\"home-availability\">Foundational storefront, supplier and product-passport tools are in preview. Automated dropshipping, payment-split reporting and live payments are not active.</p></section><section class=\"section\"><div class=\"three-features\"><article class=\"feature\"><div class=\"symbol\" aria-hidden=\"true\">▦</div><h3>Launch your storefront</h3><p>Create a hosted store, manage product listings and publish accurate seller details.</p></article><article class=\"feature\"><div class=\"symbol\" aria-hidden=\"true\">◎</div><h3>Trace the supply chain</h3><p>Record source, manufacture, transport and retail steps, with supporting evidence and openly labelled gaps.</p></article><article class=\"feature\"><div class=\"symbol\" aria-hidden=\"true\">£</div><h3>Explain the money trail</h3><p>Supplier and payout transparency is a development priority. It is not presented as an active or independently verified feature.</p></article></div></section></div>";
 else main.innerHTML='<div class="container"><div class="page-head"><span class="eyebrow">Our public standard</span><h1>Trust should be earned,<br>not advertised.</h1><p>We separate declarations from checked evidence, expose supply-chain gaps, protect customers from deceptive selling and create space for repair and reuse.</p></div><article class="prose section"><h2>Independent evidence first</h2><p>A product cannot become ethically certified just because a seller uploads a PDF. Each claim is displayed with its current evidence status, and independent certification requires appropriate third-party assurance.</p><h2>Humans are not a carbon offset</h2><p>We never let favourable packaging or emissions estimates negate evidence of forced labour, worker exploitation or unsafe manufacturing. Serious complaints must be assessed and remedied.</p><h2>Privacy and fairness</h2><p>No invented customer reviews, fabricated scarcity, hidden paid rankings or fictional provenance. We minimise collected data and never advertise unverified information as fact.</p><h2>Our current limitations</h2><p>This is an early technology release. It is not an independently audited certification scheme. Secure worker reporting, independent inspections, product-safety verification, payment processing and marketplace API approvals are not yet live.</p><a href="/dashboard" class="btn btn-dark" data-link>Build a transparent store →</a></article></div>';
}
function auth(){
 main.innerHTML='<div class="container"><div class="auth-shell"><span class="eyebrow">Merchant access</span><h1>Seller Studio.</h1><p class="muted">Manage products, suppliers and the evidence behind every claim.</p><div class="panel"><form class="form" data-action="'+h(state.authMode)+'"><h2>'+ (state.authMode==='register'?'Create your account':'Welcome back')+'</h2><label>Email<input class="input" name="email" type="email" required autocomplete="email"></label><label>Password<input class="input" name="password" type="password" minlength="12" maxlength="128" required autocomplete="'+(state.authMode==='register'?'new-password':'current-password')+'"><span class="field-hint">12 characters minimum. This is a pre-launch test environment: email verification and seller identity checks are not operational. Do not enter sensitive customer data.</span></label><button class="btn btn-dark">'+(state.authMode==='register'?'Create account':'Sign in')+'</button><button class="btn btn-soft" type="button" data-op="toggle-auth">'+(state.authMode==='register'?'Already registered? Sign in':'Need an account? Register')+'</button></form></div></div></div>';
}
function createStore(){
 main.innerHTML='<div class="container"><div class="auth-shell"><span class="eyebrow">Welcome to Seller Studio</span><h1>Start with your store.</h1><p class="muted">Create a name and permanent shop address. Your account can operate multiple separate stores.</p><div class="panel"><form class="form" data-action="store"><label>Store name<input class="input" name="name" maxlength="100" required placeholder="e.g. Fair Goods Collective"></label><label>Store URL slug (optional)<input class="input" name="slug" maxlength="70" placeholder="fair-goods-collective"></label><button class="btn btn-dark">Create store →</button></form></div></div></div>';
}
function input(name,label,value='',kind='text',extra=''){return '<label>'+h(label)+'<input class="input" name="'+h(name)+'" type="'+h(kind)+'" value="'+h(value)+'" '+extra+'></label>'}
function field(name,label,value='',rows=3){return '<label>'+h(label)+'<textarea name="'+h(name)+'" rows="'+rows+'">'+h(value)+'</textarea></label>'}
function storeSelect(){return '<label class="small">Working store<select id="store-select" class="layout-select" aria-label="Select store">'+state.stores.map(s=>'<option value="'+h(s.id)+'" '+(s.id===state.storeId?'selected':'')+'>'+h(s.name)+'</option>').join('')+'</select></label>'}
function panel(title,body){return '<div class="panel"><div class="section-title"><h2>'+h(title)+'</h2></div>'+body+'</div>'}
const tabs=[['overview','Overview'],['products','Products'],['suppliers','Suppliers'],['passport','Traceability'],['channels','Sales channels'],['commerce','Verified selling'],['orders','Orders & returns'],['supplier-orders','Supplier orders'],['integrations','Store connections'],['reports','Concerns'],['settings','Store settings']];
async function dashboard(){
 if(!state.user){auth();return}
 if(!state.stores.length){createStore();return}
 if(!state.stores.some(s=>s.id===state.storeId))state.storeId=state.stores[0].id;
 localStorage.setItem('ec-store',state.storeId);
 const store=state.stores.find(s=>s.id===state.storeId);
 main.innerHTML='<div class="container"><div class="dashboard-header"><div><span class="eyebrow">Seller Studio</span><h1>'+h(store.name)+'</h1><p class="muted compact">Build your commerce business around evidence and accountability.</p></div><div class="actions">'+storeSelect()+(state.user?.is_platform_admin?'<a href="/operator" data-link class="btn btn-soft btn-small">Platform commissioning</a>':'')+'<a href="/shop/'+h(store.slug)+'" data-link class="btn btn-light btn-small">View storefront ↗</a><button class="btn btn-light btn-small" data-op="logout">Sign out</button></div></div><div class="dashboard"><aside class="sidebar" aria-label="Seller Studio sections">'+tabs.map(([key,label])=>'<button data-tab="'+key+'" class="'+(key===state.tab?'active':'')+'">'+label+'</button>').join('')+'</aside><div class="workspace" id="workspace">'+noData('Loading workspace','Connecting securely…')+'</div></div></div>';
 const work=document.querySelector('#workspace');
 try{
  if(state.tab==='overview'){
   const s=await api('/api/stats?storeId='+encodeURIComponent(state.storeId));
   work.innerHTML='<div class="stats">'+[['Products',s.products],['Suppliers',s.suppliers],['Claims',s.claims],['Open concerns',s.openReports]].map(([l,n])=>'<div class="stat"><b>'+h(n)+'</b><small>'+h(l)+'</small></div>').join('')+'</div>'+panel('Your ethical commerce workspace','<p class="muted">Add products, connect each to a supplier, attach meaningful evidence and record the production journey. Use the CSV export to prepare external sales channels.</p><div class="row"><button class="btn btn-dark" data-tab="products">Manage products →</button><button class="btn btn-soft" data-tab="passport">Build a product passport</button></div>')+panel('Current launch readiness','<div class="notice"><strong>Preview — transactions disabled.</strong> Payment collection, real supplier order routing and automated external marketplace posting have not been activated. No merchant should treat this as a production selling system yet.</div>');
  }
  if(state.tab==='products')await products(work);
  if(state.tab==='suppliers')await suppliers(work);
  if(state.tab==='passport')await traceability(work);
  if(state.tab==='channels')await channels(work);
  if(state.tab==='reports')await reports(work);
  if(state.tab==='commerce')await merchantCompliance(work);
  if(state.tab==='orders')await merchantOrders(work);
  if(state.tab==='supplier-orders')await merchantSupplierOrders(work);
  if(state.tab==='integrations')await connections(work);
  if(state.tab==='settings')settings(work,store);
 }catch(e){work.innerHTML=noData('Unable to load section',e.message)}
}
async function products(work){
 const [data,ss]=await Promise.all([api('/api/products?storeId='+state.storeId),api('/api/suppliers?storeId='+state.storeId)]);
 const edit=data.products.find(p=>p.id===state.editProduct)||null;
 const form='<form class="form" data-action="'+(edit?'edit-product':'product')+'"><input name="productId" type="hidden" value="'+h(edit?.id||'')+'"><div class="form-grid">'+input('name','Product name',edit?.name||'','text','required maxlength="160"')+input('price','Price in GBP',edit?(edit.price_minor/100).toFixed(2):'','number','required min="0" step="0.01"')+input('stock','Stock quantity',edit?.stock??0,'number','required min="0" step="1"')+input('category','Category',edit?.category||'')+'<label>Supplier<select name="supplierId"><option value="">Not disclosed</option>'+ss.suppliers.map(s=>'<option value="'+h(s.id)+'" '+(edit?.supplier_id===s.id?'selected':'')+'>'+h(s.name)+'</option>').join('')+'</select></label>'+input('imageUrl','HTTPS image URL',edit?.image_url||'','url')+'<div class="full">'+field('description','Description',edit?.description||'',3)+'</div></div><div class="form-actions"><button class="btn btn-dark">'+(edit?'Save product':'Create product')+'</button>'+(edit?'<button type="button" data-op="cancel-edit" class="btn btn-soft">Cancel editing</button>':'')+'</div></form>';
 work.innerHTML=panel(edit?'Edit product':'Add a product',form)+panel('Your catalogue',data.products.length?'<div class="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+data.products.map(p=>'<tr><td><strong>'+h(p.name)+'</strong><div class="small muted">'+h(p.supplier_name||'Supplier undisclosed')+'</div></td><td>'+h(price(p.price_minor,p.currency))+'</td><td>'+h(p.stock)+'</td><td><span class="badge">'+h(p.status)+'</span></td><td><div class="row"><button class="btn btn-soft" data-edit="'+h(p.id)+'">Edit</button><button class="btn btn-light" data-product="'+h(p.id)+'">Evidence</button><button class="btn btn-light" data-publish="'+h(p.id)+'" data-status="'+(p.status==='published'?'draft':'published')+'">'+(p.status==='published'?'Unpublish':'Publish')+'</button></div></td></tr>').join('')+'</tbody></table></div>':noData('No products yet','Create your first product using the form above.'));
}
async function suppliers(work){
 const d=await api('/api/suppliers?storeId='+state.storeId);
 work.innerHTML=panel('Register a supplier','<p class="muted small">Supplier names and countries are provided by the merchant, not independently verified.</p><form class="form" data-action="supplier"><div class="form-grid">'+input('name','Supplier name','','text','required maxlength="150"')+input('country','Country')+input('website','Official HTTPS website','','url')+'<div class="full">'+field('riskNotes','Private risk notes (not published)')+'</div></div><button class="btn btn-dark">Add supplier</button></form>')+panel('Supplier records',d.suppliers.length?'<div class="stack">'+d.suppliers.map(s=>'<div class="evidence-entry"><strong>'+h(s.name)+'</strong><p>'+h(s.country||'Country not disclosed')+'</p><span class="badge warn">Merchant supplied information</span></div>').join('')+'</div>':noData('No suppliers registered','Add manufacturers and distributors and start documenting their production chain.'));
}
async function traceability(work){
 const d=await api('/api/products?storeId='+state.storeId);
 const p=d.products.find(p=>p.id===state.selectedProduct)||d.products[0];
 if(!p){work.innerHTML=noData('Add a product first','You need a product before recording its journey.');return}
 state.selectedProduct=p.id;
 const selector='<label>Select product<select id="passport-select">'+d.products.map(x=>'<option value="'+h(x.id)+'" '+(x.id===p.id?'selected':'')+'>'+h(x.name)+'</option>').join('')+'</select></label>';
 const pp=await api('/api/products/'+p.id+'/passport');
 const evidenceForm='<form class="form" data-action="evidence"><h3>1. Submit supporting evidence</h3>'+input('title','Evidence title','','text','required minlength="4"')+input('issuer','Issuer or organisation')+input('sourceUrl','Public HTTPS evidence link','','url')+field('details','Evidence description')+'<button class="btn btn-dark">Save evidence declaration</button><p class="small muted">New evidence is supplier-declared, not independently verified. '+(state.lastEvidenceId?'Most recent evidence ID: <span class="code">'+h(state.lastEvidenceId)+'</span>':'Save evidence to receive a reference ID.')+'</p></form>';
 const claimForm='<form class="form" data-action="claim"><h3>2. Describe a product claim</h3><label>Category<select name="facet">'+['origin','workers','environment','animals','safety','durability','commercial'].map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select></label>'+field('statement','Precise, supportable statement')+input('evidenceId','Evidence ID (optional)',state.lastEvidenceId)+'<button class="btn btn-dark">Add claim</button></form>';
 const traceForm='<form class="form" data-action="trace"><h3>3. Record a production stage</h3><label>Stage<select name="stage">'+['source','process','manufacture','package','transport','warehouse','retail','repair','reuse'].map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select></label>'+input('actorName','Organisation responsible','','text','required')+input('place','Location (public)')+input('happenedAt','Event date',new Date().toISOString().slice(0,10),'date','required')+input('evidenceId','Evidence ID (optional)',state.lastEvidenceId)+'<button class="btn btn-dark">Record stage</button></form>';
 work.innerHTML=panel('Product passport',selector+'<p class="muted small">Completeness: '+pp.coverage.covered+' / '+pp.coverage.total+' core milestones documented. Missing: '+h(pp.coverage.missing.join(', ')||'none')+'. This is not an ethical score.</p>'+(p.status==='published'?'<a href="/product/'+h(p.id)+'" data-link class="btn btn-soft btn-small">View public passport ↗</a>':'<div class="notice">Draft product — its passport is not yet public.</div>'))+'<div class="split" style="margin-top:16px">'+panel('Evidence',evidenceForm)+panel('Claims',claimForm)+'</div>'+panel('Production timeline',traceForm)+'<div class="split" style="margin-top:16px">'+panel('Recorded claims',pp.claims.length?'<div class="stack">'+pp.claims.map(c=>'<div class="evidence-entry"><strong>'+h(c.facet)+'</strong><p>'+h(c.statement)+'</p>'+badge(c.evidence_status||'missing')+'</div>').join('')+'</div>':noData('No claims','Add a statement and link its evidence.'))+panel('Recorded stages',pp.events.length?'<div class="timeline">'+pp.events.map(ev=>'<div class="timeline-item"><strong>'+h(ev.stage)+'</strong><p>'+h(ev.actor_name)+' · '+h(ev.place)+' · '+h(ev.happened_at)+'</p>'+badge(ev.evidence_status||'missing')+'</div>').join('')+'</div>':noData('No stages','Add origin and production events.'))+'</div>';
}
async function channels(work){
 const [prods,ls]=await Promise.all([api('/api/products?storeId='+state.storeId),api('/api/listings?storeId='+state.storeId)]);
 work.innerHTML=panel('Multichannel distribution','<div class="notice">Only CSV catalogue export is working. Amazon, eBay, Etsy, Shopify, WooCommerce and TikTok posting require OAuth/API permissions, compliance rules and dedicated approved adapters. No live connection is claimed.</div><p><a class="btn btn-dark" href="/api/channels/export.csv?storeId='+encodeURIComponent(state.storeId)+'">Download catalogue CSV ↓</a></p><form data-action="listing" class="form"><label>Product<select name="productId">'+prods.products.map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('')+'</select></label><label>Target channel<select name="channel">'+['csv','ebay','amazon','etsy','shopify','woocommerce','tiktok'].map(c=>'<option value="'+c+'">'+c+'</option>').join('')+'</select></label><button class="btn btn-soft">Prepare listing record</button></form>')+panel('Listing records',ls.listings.length?'<div class="table-wrap"><table><thead><tr><th>Product</th><th>Channel</th><th>State</th></tr></thead><tbody>'+ls.listings.map(l=>'<tr><td>'+h(l.product_name)+'</td><td>'+h(l.channel)+'</td><td>'+h(l.status.replace('_',' '))+'</td></tr>').join('')+'</tbody></table></div>':noData('No listing requests','Prepare a listing above or export the catalogue to CSV.'));
}
async function reports(work){
 const d=await api('/api/reports?storeId='+state.storeId);
 work.innerHTML=panel('Customer concerns','<div class="notice">Reports may contain sensitive personal information. Limit staff access and do not publish complainant details. A separately governed whistleblowing channel is required before promising anonymity.</div>'+(d.reports.length?'<div class="stack" style="margin-top:18px">'+d.reports.map(r=>'<div class="evidence-entry"><div class="row"><strong>'+h(r.category.replaceAll('_',' '))+'</strong><span class="spacer"></span><span class="badge">'+h(r.status)+'</span></div><p>'+h(r.message)+'</p><p class="muted small">Received '+h(r.created_at)+' · '+h(r.contact_email||'No contact supplied')+'</p><form data-action="report-status" class="row"><input type="hidden" name="id" value="'+h(r.id)+'"><label>Status<select name="status"><option value="open" '+(r.status==='open'?'selected':'')+'>Open</option><option value="reviewing" '+(r.status==='reviewing'?'selected':'')+'>Reviewing</option><option value="resolved" '+(r.status==='resolved'?'selected':'')+'>Resolved</option></select></label><button class="btn btn-small btn-soft">Update</button></form></div>').join('')+'</div>':noData('No concerns reported','Submitted customer concerns will appear here for review.')));
}
function settings(work,store){
 work.innerHTML=panel('Your storefront','<form data-action="settings" class="form">'+input('name','Store name',store.name,'text','required')+field('description','Store introduction',store.description||'')+input('themeColor','Theme colour',store.theme_color||'#256b59','color')+'<button class="btn btn-dark">Save store details</button></form><p class="small muted">Permanent storefront address: <a href="/shop/'+h(store.slug)+'" data-link>/shop/'+h(store.slug)+'</a></p>')+panel('Trading status','<div class="notice">Payment processing and supplier order placement are disabled. External channels export to CSV only. Configure verified seller accounts, privacy and consumer-rights policies and integration credentials before go-live.</div>');
}
async function storefront(slug){
 const data=await api('/api/public/stores/'+encodeURIComponent(slug)),s=data.store;
 main.innerHTML='<div class="container"><div class="page-head"><span class="eyebrow">Independent storefront</span><h1>'+h(s.name)+'</h1><p>'+h(s.description||'Discover the products and view their origin evidence.')+'</p><p class="small muted">Products and claims are supplied by the store owner. Evidence levels appear on individual passports.</p></div><section class="section">'+(data.products.length?'<div class="grid">'+data.products.map(productCard).join('')+'</div>':noData('No products listed','This seller has not published products yet.'))+'</section>'+currencyNotice+'</div>';
}
async function merchantCompliance(work){
 const [email,details,connect]=await Promise.all([
  api('/api/auth/email/status'),
  api('/api/commerce/stores/'+state.storeId+'/compliance'),
  api('/api/commerce/stores/'+state.storeId+'/connect-status')
 ]);
 const c=details.compliance||{};
 const verify='<div id="email-verification-control">'+emailVerificationWidget(email)+'</div>';
 const compliance='<form class="form" data-action="seller-compliance"><div class="form-grid">'+
  input('legalSellerName','Legal seller name',c.legal_seller_name||'','text','required minlength="3"')+
  input('contactEmail','Public customer support email',c.contact_email||'','email','required')+
  input('tradingAddress','Business correspondence address',c.trading_address||'','text','required minlength="12"')+
  input('companyRegistration','Company number (if applicable)',c.company_registration||'')+
  input('returnPolicyUrl','Public returns policy URL',c.return_policy_url||'','url','required')+
  input('shippingPolicyUrl','Public shipping policy URL',c.shipping_policy_url||'','url','required')+
  input('termsUrl','Public terms URL',c.terms_url||'','url','required')+
  input('privacyUrl','Public privacy URL',c.privacy_url||'','url','required')+
  '<div class="full">'+field('cancellationNotice','Statutory cancellation rights and exceptions',c.cancellation_notice||'',4)+'</div>'+
  '<label class="full"><input type="checkbox" name="acceptConsumerDuties" value="yes" required> I confirm these details are truthful and I accept applicable consumer protection, returns, privacy and product-safety duties.</label></div><p class="small muted">Policy links must begin with https:// and point to your actual published policies. The cancellation description must be at least 30 characters. Company registration is optional where not applicable.</p><div id="seller-compliance-feedback" class="inline-feedback" role="status" tabindex="-1" aria-live="polite" hidden></div><button class="btn btn-dark">Save seller disclosures</button></form>';
 const status=connect.connected?'<span class="badge">'+(connect.chargesEnabled&&connect.payoutsEnabled?'Stripe charges and payouts enabled':'Stripe onboarding incomplete')+'</span>':'<span class="badge warn">No connected Stripe account</span>';
 work.innerHTML=panel('Account verification',verify+'<p class="small muted">Email verification is not proof of company identity. Stripe performs financial identity checks separately.</p>')+
 panel('Seller identity and legal disclosures',compliance)+
 panel('Payments and merchant verification','<p class="muted">We use Stripe Connect Express for merchant financial onboarding. Customer payments are disabled platform-wide until legally approved and configured.</p>'+status+'<p><button class="btn btn-soft" data-op="stripe-onboard">Continue Stripe onboarding ↗</button></p>')+
 panel('Store sales control','<div class="notice">Live sales are disabled by the platform unless the operator explicitly enables them after payment, tax and consumer-rights checks. Merchant approval never bypasses this platform gate.</div><button class="btn btn-light" data-op="pause-sales">Pause sales now</button>');
}
async function merchantOrders(work){
 const [orders,requests,fulfil]=await Promise.all([
  api('/api/commerce/stores/'+state.storeId+'/orders'),
  api('/api/commerce/stores/'+state.storeId+'/requests'),
  api('/api/commerce/stores/'+state.storeId+'/fulfillment')
 ]);
 const tab='<div id="delivery-details" class="notice" role="status" hidden></div><div class="notice">Only paid orders may be dispatched. Track each supplier request and give customers accurate shipment information. Customer rights and chargeback handling remain mandatory.</div>';
 const t=orders.orders.length?'<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Customer</th></tr></thead><tbody>'+
  orders.orders.map(o=>'<tr><td class="code">'+h(o.id)+'</td><td>'+h(price(o.subtotal_minor,o.currency))+'</td><td>'+h(o.status)+'</td><td>'+h(o.customer_email||'Pending Stripe details')+(o.status==='paid'||o.status==='fulfilled'?'<button type="button" class="btn btn-light btn-small" data-shipping="'+h(o.id)+'">View delivery address</button>':'')+'</td></tr>').join('')+
  '</tbody></table></div>':noData('No transactions','Once seller onboarding and payments are approved, paid orders appear here.');
 const f=fulfil.fulfillments.map(x=>'<div class="evidence-entry"><strong>Order '+h(x.order_id)+'</strong><p>Status: '+h(x.status)+'</p><form class="form" data-action="fulfillment"><input type="hidden" name="id" value="'+h(x.id)+'"><label>Next status<select name="status">'+['supplier_requested','supplier_accepted','dispatched','delivered','issue'].map(st=>'<option value="'+st+'">'+st.replaceAll('_',' ')+'</option>').join('')+'</select></label>'+input('carrier','Carrier',x.carrier)+input('trackingReference','Tracking number',x.tracking_reference)+input('trackingUrl','Tracking URL',x.tracking_url,'url')+field('sellerNotes','Operational notes',x.seller_notes)+
 '<button class="btn btn-soft">Update fulfilment</button></form></div>').join('');
 const r=requests.requests.map(x=>'<div class="evidence-entry"><strong>'+h(x.kind)+' · Order '+h(x.order_id)+'</strong><p>'+h(x.details)+'</p><p class="small muted">Contact: '+h(x.contact_email)+'</p><form data-action="consumer-request-status" class="form"><input type="hidden" name="id" value="'+h(x.id)+'"><label>Resolution status<select name="status">'+['in_review','accepted','rejected','resolved'].map(st=>'<option value="'+st+'">'+st+'</option>').join('')+'</select></label>'+field('resolutionNote','Reason and next steps')+'<button class="btn btn-soft">Record decision</button></form></div>').join('');
 work.innerHTML=panel('Customer orders',tab+t)+panel('Supplier fulfilment',f||noData('No fulfillment tasks','When Stripe confirms payment, a fulfillment task appears.'))+panel('Consumer rights and return requests',r||noData('No requests','Customers can submit refunds, returns, faults and complaints using their private order reference.'));
}
async function merchantSupplierOrders(work){
 const [orders,suppliers,po]=await Promise.all([
  api('/api/commerce/stores/'+state.storeId+'/orders'),
  api('/api/commerce/stores/'+state.storeId+'/supplier-order-settings'),
  api('/api/commerce/stores/'+state.storeId+'/purchase-orders')
 ]);
 const paid=orders.orders.filter(o=>['paid','fulfilled','partially_refunded'].includes(o.status));
 const settings='<form class="form" data-action="supplier-order-settings"><label>Supplier<select name="supplierId" required>'+
 suppliers.suppliers.map(x=>'<option value="'+h(x.id)+'">'+h(x.name)+'</option>').join('')+
 '</select></label>'+input('orderingEmail','Authorised supplier orders email','','email','required')+
 '<label><input type="checkbox" name="confirmSupplierContact" required> I confirm this is an authorised supplier contact and we have an appropriate business relationship.</label>'+
 '<button class="btn btn-dark">Save supplier authorisation</button></form>';
 const settingsOverview=suppliers.suppliers.map(x=>'<div class="evidence-entry"><strong>'+h(x.name)+'</strong><p>'+h(x.ordering_email||'No ordering email provided')+'</p><span class="badge '+(x.merchant_confirmed_authorization?'':'warn')+'">'+(x.merchant_confirmed_authorization?'Merchant authorised':'Not authorised')+'</span></div>').join('');
 const eligible='<form class="form" data-action="supplier-order-prepare"><label>Paid customer order<select name="orderId" required>'+
 paid.map(x=>'<option value="'+h(x.id)+'">'+h(x.id)+' · '+h(x.status)+'</option>').join('')+'</select></label>'+
 '<button class="btn btn-soft" '+(paid.length?'':'disabled')+'>Prepare supplier order drafts</button></form>';
 const prepared=po.purchaseOrders.map(x=>'<article class="evidence-entry"><div class="row"><strong>'+h(x.supplier_name)+'</strong><span class="spacer"></span><span class="badge">'+h(x.status)+'</span></div>'+
 '<p class="small">Customer order '+h(x.order_id)+'<br>Supplier order '+h(x.id)+'<br>Email: '+h(x.notification_status||'not queued')+'</p>'+
 (x.status==='draft'?'<form class="form" data-action="supplier-order-send"><input name="id" type="hidden" value="'+h(x.id)+'">'+
 '<label><input type="checkbox" name="authorize" required> I explicitly authorise sending this purchase order to the supplier without customer personal data.</label>'+
 '<button class="btn btn-dark">Email supplier purchase order</button></form>':'')+
 (['requested','accepted','dispatched','issue'].includes(x.status)?'<form class="form" data-action="supplier-order-status"><input name="id" type="hidden" value="'+h(x.id)+'"><label>Update status<select name="status">'+
 ['accepted','dispatched','delivered','issue'].map(st=>'<option value="'+st+'">'+st+'</option>').join('')+'</select></label>'+
 input('supplierReference','Supplier dispatch reference')+'<button class="btn btn-soft">Record supplier update</button></form>':'')+
 '</article>').join('');
 work.innerHTML=panel('Supplier purchasing rules','<div class="notice">No supplier order is sent automatically. Merchants must authorise the business address and explicitly approve each paid order. Supplier responses and shipment status are seller-declared unless verified externally.</div>')+
 panel('Approved ordering contacts',settings+(settingsOverview?'<div class="stack" style="margin-top:16px">'+settingsOverview+'</div>':''))+
 panel('Prepare a supplier purchase order',paid.length?eligible:noData('No paid orders','Supplier order drafts can only be prepared from confirmed paid orders.'))+
 panel('Supplier order queue',prepared?'<div class="stack">'+prepared+'</div>':noData('No supplier orders yet','Prepare a paid order for each of its recorded product suppliers.'));
}
async function connections(work){
 const data=await api('/api/commerce/stores/'+state.storeId+'/connections');
 const products=await api('/api/products?storeId='+state.storeId);
 const available=data.connections.map(c=>'<div class="evidence-entry"><strong>'+h(c.channel)+'</strong><p>'+h(c.base_url)+'</p><span class="badge">'+h(c.status)+'</span></div>').join('');
 const form='<form data-action="channel-connection" class="form"><label>Platform<select name="channel"><option value="woocommerce">WooCommerce</option><option value="shopify">Shopify custom app</option></select></label>'+input('baseUrl','Store HTTPS origin','','url','required')+input('consumerKey','WooCommerce consumer key (Woo only)')+input('consumerSecret','WooCommerce consumer secret (Woo only)')+input('accessToken','Shopify custom app token (Shopify only)')+'<p class="small muted">Credentials are encrypted server-side; configure the ENCRYPTION_MASTER_KEY secret before connecting.</p><button class="btn btn-dark">Save encrypted connection</button></form>';
 const publish='<form data-action="external-publish" class="form"><label>Product<select name="productId">'+products.products.map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('')+'</select></label><input type="hidden" name="channel" value="woocommerce"><button class="btn btn-soft">Create WooCommerce draft listing</button></form>';
 work.innerHTML=panel('Connected stores',available||noData('No connections yet','Add a merchant-managed store API connection below.'))+
 panel('Manage store integration',form)+panel('External publishing', '<div class="notice">WooCommerce draft publishing can be enabled after credentials and approval. eBay, Amazon, Etsy and TikTok require official developer authorisation. Shopify publishing needs further integration.</div>'+publish);
}
async function verificationPage(){
 const token=new URLSearchParams(location.search).get('token')||'';
 history.replaceState({},'', '/verify');
 if(!/^[a-f0-9]{64}$/.test(token)){main.innerHTML='<div class="container page-head"><h1>Invalid verification link</h1><a href="/dashboard" data-link>Return to Seller Studio</a></div>';return}
 try{const d=await post('/api/auth/email/confirm',{token});main.innerHTML='<div class="container page-head"><h1>Email verified.</h1><p>You can now continue merchant onboarding.</p><a class="btn btn-dark" href="/dashboard" data-link>Continue to Seller Studio →</a></div>'}
 catch(e){main.innerHTML='<div class="container page-head"><h1>Verification could not be completed</h1><p>'+h(e.message)+'</p><a href="/dashboard" data-link>Return to Seller Studio</a></div>'}
}
async function orderResult(){
 const query=new URLSearchParams(location.search);
 const orderId=query.get('order')||'',token=query.get('token')||'';
 if(token)state.orderAccess={orderId,token};
 history.replaceState({},'', '/order-result');
 const access=state.orderAccess;
 if(!access){main.innerHTML='<div class="container page-head"><h1>Order lookup</h1><p>Open your private order link after Checkout to see its status.</p></div>';return}
 try{
 const d=await post('/api/commerce/customer-order',{orderId:access.orderId,customerToken:access.token});
 main.innerHTML='<div class="container page-head"><span class="eyebrow">Your purchase</span><h1>Order status: '+h(d.order.status.replaceAll('_',' '))+'</h1><p>Order reference: <span class="code">'+h(d.order.id)+'</span></p><p>Order total before any payment-service tax adjustments: '+h(price(d.order.subtotalMinor))+'</p><p class="notice">Payment, cancellation and refund eligibility are governed by the seller terms and applicable consumer law. A return to this page does not itself confirm a successful payment; wait for the paid order status.</p>'+
 panel('Request help or a return','<form data-action="consumer-help" class="form"><label>Request type<select name="kind">'+['cancellation','return','refund','fault','complaint'].map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select></label>'+input('contactEmail','Your email address','','email','required')+field('details','Describe your request')+'<button class="btn btn-dark">Submit request</button></form>')+'</div>';
 }catch(e){main.innerHTML='<div class="container page-head"><h1>Order lookup failed</h1><p>'+h(e.message)+'</p></div>'}
}
async function operatorDashboard(){
 const user=state.user;
 if(!user?.is_platform_admin){main.innerHTML='<div class="container page-head"><h1>Restricted area</h1><p>Platform administrator access is required.</p><a href="/dashboard" data-link>Return to Seller Studio</a></div>';return}
 const d=await api('/api/commerce/admin/commissioning');
 const cells=d.checks.map(x=>'<tr><td>'+h(x.name.replaceAll('_',' '))+'</td><td><span class="badge '+(x.passed?'':'warn')+'">'+(x.passed?'Configured':'Not configured')+'</span></td></tr>').join('');
 main.innerHTML='<div class="container"><div class="dashboard-header"><div><span class="eyebrow">Platform operations</span><h1>Commercial commissioning</h1><p class="muted">Private configuration checks. These do not constitute provider approval or evidence of live delivery.</p></div><div class="actions"><a class="btn btn-light btn-small" href="/dashboard" data-link>Seller Studio →</a></div></div>'+
 panel('Payment safety','<p><strong>Deployment:</strong> '+h(d.tier)+' · <strong>Stripe key mode:</strong> '+h(d.stripeMode)+'</p><p><strong>Sandbox checkout:</strong> '+(d.sandboxCheckoutEnabled?'Configured':'Disabled')+' · <strong>Live checkout:</strong> '+(d.liveCheckoutEnabled?'Configured':'Disabled')+'</p><div class="notice">Payment flags alone do not certify legal, tax, supplier or security readiness. Do not switch on live payments to test integration.</div>')+
 panel('Integration checks','<div class="table-wrap"><table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>'+cells+'</tbody></table></div>')+
 panel('Stripe account verification','<p>Check the Stripe account configured in this environment. This read-only request does not create charges or modify Stripe.</p><form class="form" data-action="operator-stripe-status"><button class="btn btn-soft">Check Stripe account readiness</button></form><div id="operator-stripe-result" class="notice" role="status" hidden></div>')+
 panel('Transactional email test','<p>Only available to a platform administrator with a previously verified email address. Sends to the signed-in account only, never to real customers or suppliers.</p><form class="form" data-action="operator-test-email"><label><input type="checkbox" name="confirm" value="yes" required> I authorise one test email to my verified account.</label><button class="btn btn-soft">Send one self-test email</button></form>')+
 panel('Provider setup','<p>Separate staging database, test-mode Stripe Connect credentials and transactional sender credentials must be configured outside GitHub before an end-to-end test can be run.</p><p><a href="https://github.com/Raebu/Ethical_commerce/blob/main/docs/SANDBOX_COMMISSIONING.md" target="_blank" rel="noopener noreferrer">Open staging commissioning guide ↗</a></p>');
}
async function render(){
 try{
  const pathname=location.pathname;
  if(pathname==='/'){await discover();return}
  if(pathname==='/about'||pathname==='/sell'){landing(pathname.slice(1));return}
  if(pathname==='/verify'){await verificationPage();return}
  if(pathname==='/order-result'){await orderResult();return}
  if(pathname==='/operator'){
   try{const d=await api('/api/me');state.user=d.user;state.stores=d.stores}catch{state.user=null;state.stores=[]}
   await operatorDashboard();return;
  }
  if(pathname==='/dashboard'){
   try{const d=await api('/api/me');state.user=d.user;state.stores=d.stores}catch{state.user=null;state.stores=[]}
   await dashboard();return;
  }
  if(pathname.startsWith('/product/')){await passport(pathname.split('/')[2]);return}
  if(pathname.startsWith('/shop/')){await storefront(pathname.split('/')[2]);return}
  main.innerHTML='<div class="container page-head"><h1>Page not found</h1><a href="/" data-link>Return to discover →</a></div>';
 }catch(e){main.innerHTML='<div class="container page-head"><h1>We could not load this page.</h1><p>'+h(e.message)+'</p><a href="/" data-link>Return home</a></div>'}
}

let ethicalOverlayTrigger=null;
let ethicalOverlayName='';
let ethicalZoomRun=null;
function cancelEthicalZoom(){
 const run=ethicalZoomRun;
 ethicalZoomRun=null;
 if(!run)return;
 run.cancelled=true;
 clearTimeout(run.revealTimer);
 run.animation?.cancel();
 run.word?.remove();
 run.curtain?.remove();
}
function closeEthicalOverlay(immediate=false){
 cancelEthicalZoom();
 const host=document.querySelector('#ec-overlay-host');
 if(!host||!ethicalOverlayName){ethicalOverlayName='';document.body.classList.remove('ec-overlay-active');return}
 const panel=host.querySelector('.ec-overlay-panel:not([hidden])');
 const trigger=ethicalOverlayTrigger;
 ethicalOverlayName='';
 host.classList.remove('is-open');
 host.setAttribute('aria-hidden','true');
 document.body.classList.remove('ec-overlay-active');
 if(panel)panel.hidden=true;
 if(!immediate&&trigger?.isConnected)trigger.focus();
 ethicalOverlayTrigger=null;
}
async function openEthicalOverlay(name,trigger){
 const valid=['how','proof','products'];
 if(!valid.includes(name))return;
 const host=document.querySelector('#ec-overlay-host');
 if(!host)return;
 const switching=!!ethicalOverlayName;
 cancelEthicalZoom();
 const current=host.querySelector('.ec-overlay-panel:not([hidden])');
 if(current)current.hidden=true;
 const panel=host.querySelector('#ec-overlay-'+name);
 if(!panel)return;
 ethicalOverlayTrigger=trigger||ethicalOverlayTrigger||document.querySelector('.home-secondary-cta');
 ethicalOverlayName=name;
 panel.hidden=false;
 host.setAttribute('aria-hidden','false');
 document.body.classList.add('ec-overlay-active');
 const finish=()=>{
  if(ethicalOverlayName!==name)return;
  host.classList.add('is-open');
  panel.querySelector('.ec-overlay-close')?.focus({preventScroll:true});
 };
 // Switching overlays or choosing reduced motion skips the cinematic sequence.
 if(switching||window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  finish();
  if(name==='products')await loadCatalog('');
  return;
 }
 const source=document.querySelector('.home-lead strong');
 const box=source?.getBoundingClientRect();
 if(!box||box.width===0||typeof Element.prototype.animate!=='function'){
  finish();
  if(name==='products')await loadCatalog('');
  return;
 }
 const curtain=document.createElement('div');
 curtain.className='ec-zoom-curtain';
 curtain.setAttribute('aria-hidden','true');
 const word=document.createElement('span');
 word.className='ec-zoom-flight';
 word.setAttribute('aria-hidden','true');
 word.textContent='ETHICAL';
 word.style.fontSize=window.getComputedStyle(source).fontSize;
 document.body.append(curtain,word);
 const startWidth=Math.max(word.getBoundingClientRect().width,60);
 const endScale=Math.min(28,Math.max(8,innerWidth*1.55/startWidth));
 const startTop=box.top;
 const startLeft=box.left;
 const wordHeight=word.getBoundingClientRect().height;
 const endWidth=startWidth*endScale;
 const endHeight=wordHeight*endScale;
 const finalX=(innerWidth-endWidth)/2;
 const finalY=(innerHeight-endHeight)/2;
 const at=(x,y,scale)=>'translate3d('+x+'px,'+y+'px,0) scale('+scale+')';
 // Begin on the homepage's "ethical", grow legibly, then reveal the content.
 const animation=word.animate([
  {transform:at(startLeft,startTop,1),opacity:1,offset:0},
  {transform:at(startLeft*.72+finalX*.28,startTop*.72+finalY*.28,1+(endScale-1)*.28),opacity:1,offset:.45},
  {transform:at(startLeft*.25+finalX*.75,startTop*.25+finalY*.75,1+(endScale-1)*.75),opacity:1,offset:.78},
  {transform:at(finalX,finalY,endScale),opacity:0,offset:1}
 ],{duration:2400,easing:'ease-in-out',fill:'forwards'});
 const run={word,curtain,animation,revealTimer:null,cancelled:false};
 ethicalZoomRun=run;
 run.revealTimer=setTimeout(()=>{
  if(ethicalZoomRun===run&&!run.cancelled)finish();
 },1700);
 if(name==='products')await loadCatalog('');
 try{await animation.finished}catch{}
 if(ethicalZoomRun!==run||run.cancelled)return;
 finish();
 cancelEthicalZoom();
}
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&ethicalOverlayName){e.preventDefault();closeEthicalOverlay();return}
 if(e.key!=='Tab'||!ethicalOverlayName)return;
 const panel=document.querySelector('#ec-overlay-'+ethicalOverlayName);
 if(!panel)return;
 const focusables=[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(el=>el.getClientRects().length);
 if(!focusables.length)return;
 const first=focusables[0],last=focusables[focusables.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
window.addEventListener('popstate',render);
document.addEventListener('click',async e=>{
 const overlayOpen=e.target.closest('[data-overlay-open]');
 if(overlayOpen&&location.pathname==='/'){e.preventDefault();await openEthicalOverlay(overlayOpen.dataset.overlayOpen,overlayOpen);return}
 if(e.target.closest('[data-overlay-close]')){e.preventDefault();closeEthicalOverlay();return}
 const navigationOverlay=e.target.closest('[data-home-overlay]');
 if(navigationOverlay&&location.pathname==='/'){e.preventDefault();await openEthicalOverlay(navigationOverlay.dataset.homeOverlay,navigationOverlay);return}
 const link=e.target.closest('a[data-link]');
 if(link){e.preventDefault();navigate(link.getAttribute('href'));return}
 const tab=e.target.closest('[data-tab]');
 if(tab){state.tab=tab.dataset.tab;state.editProduct=null;await dashboard();return}
 const buy=e.target.closest('[data-buy]');
 if(buy){
  if(!document.querySelector('#ack-policies')?.checked){flash('Please review and acknowledge the seller policies before checkout.');return}
  buy.disabled=true;
  try{const result=await post('/api/commerce/checkout',{storeId:buy.dataset.store,idempotencyKey:crypto.randomUUID(),items:[{productId:buy.dataset.buy,quantity:1}],acceptPolicies:true});
   if(result.checkoutUrl)location.assign(result.checkoutUrl);
  }catch(err){flash(err.message);buy.disabled=false}
  return;
 }
 const shipping=e.target.closest('[data-shipping]');
 if(shipping){
  shipping.disabled=true;
  try{
   const d=await api('/api/commerce/orders/'+encodeURIComponent(shipping.dataset.shipping)+'/shipping');
   const address=[d.recipient,d.address.line1,d.address.line2,d.address.city,d.address.state,d.address.postcode,d.address.country].filter(Boolean);
   const destination=document.querySelector('#delivery-details');
   if(destination){destination.textContent='CONFIDENTIAL — '+address.join(', ');destination.hidden=false}
   else flash('Delivery address retrieved but the display is unavailable');
  }catch(ex){flash(ex.message)}finally{shipping.disabled=false}
  return;
 }
 const op=e.target.closest('[data-op]');
 if(op){
  if(op.dataset.op==='toggle-auth'){state.authMode=state.authMode==='register'?'login':'register';auth()}
  if(op.dataset.op==='cancel-edit'){state.editProduct=null;await dashboard()}
  if(op.dataset.op==='resend-verification')await sendVerificationRequest(op.dataset.email,op);
  if(op.dataset.op==='change-verification-email')await refreshEmailVerification(true);
  if(op.dataset.op==='stripe-onboard'){try{const d=await post('/api/commerce/stores/'+state.storeId+'/onboarding',{});if(d.onboardingUrl)location.href=d.onboardingUrl}catch(ex){flash(ex.message)}}
  if(op.dataset.op==='pause-sales'){try{await post('/api/commerce/stores/'+state.storeId+'/pause',{paused:true});flash('Store sales paused')}catch(ex){flash(ex.message)}}
  if(op.dataset.op==='logout'){try{await post('/api/auth/logout',{});state.user=null;state.stores=[];navigate('/dashboard')}catch(ex){flash(ex.message)}}
  return;
 }
 const prod=e.target.closest('[data-product]');
 if(prod){state.selectedProduct=prod.dataset.product;state.tab='passport';await dashboard();return}
 const edit=e.target.closest('[data-edit]');
 if(edit){state.editProduct=edit.dataset.edit;state.tab='products';await dashboard();return}
 const publish=e.target.closest('[data-publish]');
 if(publish){try{await post('/api/products/'+publish.dataset.publish,{status:publish.dataset.status},'PATCH');flash('Product visibility changed.');await dashboard()}catch(ex){flash(ex.message)}}
});
document.addEventListener('change',async e=>{
 if(e.target.id==='store-select'){state.storeId=e.target.value;state.selectedProduct='';state.editProduct=null;await dashboard()}
 if(e.target.id==='passport-select'){state.selectedProduct=e.target.value;await dashboard()}
});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-action]');if(!f)return;e.preventDefault();
 const act=f.dataset.action;const data=Object.fromEntries(new FormData(f).entries());
 const btn=f.querySelector('button[type=submit],button:not([type])');if(btn)btn.disabled=true;
 try{
  if(act==='supplier-order-settings'){
   await post('/api/commerce/stores/'+state.storeId+'/supplier-order-settings',{supplierId:data.supplierId,orderingEmail:data.orderingEmail,confirmSupplierContact:data.confirmSupplierContact==='on'});
   flash('Supplier contact authorised by merchant');await dashboard();return
  }
  if(act==='supplier-order-prepare'){
   const result=await post('/api/commerce/stores/'+state.storeId+'/supplier-orders',{orderId:data.orderId});
   flash('Created '+result.created+' supplier order draft(s). No emails sent.');await dashboard();return
  }
  if(act==='supplier-order-send'){
   if(data.authorize!=='on')throw Error('Explicit authorisation required');
   const result=await post('/api/commerce/purchase-orders/'+data.id+'/send',{confirm:'SEND_TO_SUPPLIER'});
   flash(result.queued?'Supplier order queued for delivery':'Supplier order was already queued');await dashboard();return
  }
  if(act==='supplier-order-status'){
   await post('/api/commerce/purchase-orders/'+data.id+'/status',{status:data.status,supplierReference:data.supplierReference});
   flash('Supplier status recorded as a merchant declaration');await dashboard();return
  }
  if(act==='operator-stripe-status'){
   const r=await api('/api/commerce/admin/stripe-status');
   const area=document.querySelector('#operator-stripe-result');
   if(area){
    area.hidden=false;
    area.textContent=r.providerChecked?
     'Stripe mode: '+r.mode+'; account type: '+r.accountType+
     '; charges enabled: '+r.chargesEnabled+'; payouts enabled: '+r.payoutsEnabled+
     '; card payments: '+r.cardPayments+'; transfers: '+r.transfers+
     '; outstanding requirements: '+r.outstandingRequirements+
     '; test-card readiness: '+r.readyForTestCardCheckout+'. '+
     r.note:
     'Stripe check unavailable: '+r.reason;
   }
   return;
  }
  if(act==='operator-test-email'){
   if(data.confirm!=='yes')throw Error('Please explicitly authorise this test email');
   const result=await post('/api/commerce/admin/test-email',{confirm:'SEND_SELF_TEST'});
   flash(result.accepted?'Test accepted by provider; check the actual receiving inbox.':'Test not accepted');
   return;
  }
  if(act==='verify-email'){
   await sendVerificationRequest(String(data.email||'').trim(),btn);
   return;
  }
  if(act==='seller-compliance'){
   try{
    await post('/api/commerce/stores/'+state.storeId+'/compliance',{
     ...data,acceptConsumerDuties:data.acceptConsumerDuties==='yes'
    });
    flash('Seller disclosures saved successfully');
    await dashboard();
   }catch(ex){sellerFormFeedback(f,ex)}
   return;
  }
  if(act==='fulfillment'){
   await post('/api/commerce/fulfillment/'+data.id,data);flash('Fulfilment updated');await dashboard();return
  }
  if(act==='consumer-request-status'){
   await post('/api/commerce/consumer-requests/'+data.id,data,'PATCH');flash('Customer request reviewed');await dashboard();return
  }
  if(act==='channel-connection'){
   const credentials=data.channel==='shopify'?{accessToken:data.accessToken}:{consumerKey:data.consumerKey,consumerSecret:data.consumerSecret};
   await post('/api/commerce/stores/'+state.storeId+'/connections',{channel:data.channel,baseUrl:data.baseUrl,credentials});
   flash('Encrypted connection saved');await dashboard();return
  }
  if(act==='external-publish'){
   const d=await post('/api/commerce/stores/'+state.storeId+'/publish',data);
   flash(d.notice||'Draft listing prepared');await dashboard();return
  }
  if(act==='consumer-help'){
   if(!state.orderAccess)throw Error('Order token missing');
   await post('/api/commerce/customer-request',{...data,orderId:state.orderAccess.orderId,customerToken:state.orderAccess.token});
   flash('Request received for seller review');f.reset();return
  }
  if(act==='search'){await loadCatalog(data.q||'');return}
  if(act==='register'||act==='login'){await post('/api/auth/'+act,data);flash('Signed in');navigate('/dashboard');return}
  if(act==='store'){const result=await post('/api/stores',data);state.storeId=result.id;flash('Store created');navigate('/dashboard');return}
  if(act==='product'||act==='edit-product'){
   const body={name:data.name,description:data.description,category:data.category,imageUrl:data.imageUrl,supplierId:data.supplierId,priceMinor:Math.round(Number(data.price)*100),stock:Number(data.stock),storeId:state.storeId};
   if(act==='product')await post('/api/products',body);else await post('/api/products/'+data.productId,body,'PATCH');
   state.editProduct=null;flash('Product saved');await dashboard();return;
  }
  if(act==='supplier'){await post('/api/suppliers',{...data,storeId:state.storeId});flash('Supplier added');await dashboard();return}
  if(act==='evidence'){const d=await post('/api/evidence',{...data,productId:state.selectedProduct});state.lastEvidenceId=d.id;flash('Evidence submitted as supplier-declared. Reference: '+d.id);await dashboard();return}
  if(act==='claim'){await post('/api/claims',{...data,productId:state.selectedProduct});flash('Claim recorded — not independently verified');await dashboard();return}
  if(act==='trace'){await post('/api/trace',{...data,productId:state.selectedProduct});flash('Production stage recorded');await dashboard();return}
  if(act==='listing'){const d=await post('/api/listings',data);flash(d.note);await dashboard();return}
  if(act==='settings'){await post('/api/stores/'+state.storeId,data,'PATCH');flash('Store updated');navigate('/dashboard');return}
  if(act==='report'){await post('/api/reports',data);flash('Concern submitted for review');f.reset();return}
  if(act==='report-status'){await post('/api/reports/'+data.id,{status:data.status},'PATCH');flash('Concern updated');await dashboard();return}
 }catch(ex){flash(ex.message)}
 finally{if(btn)btn.disabled=false}
});
render();
