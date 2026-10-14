import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {disclosureBreakdown,impactFromRecords,isMoneyCategory} from '../src/transparency.ts';
// @ts-expect-error Plain browser JS is tested at runtime; TypeScript declarations are not shipped.
import {journeyMarkup,moneyMarkup,supplierDirectoryMarkup,wizardMarkup,impactMarkup} from '../public/experience.js';

const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,(c:string)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[c]||c);
test('cost categories are fixed and amounts only publish on explicit consent',()=>{
 assert.equal(isMoneyCategory('materials'),true);
 assert.equal(isMoneyCategory('employee_wages'),false);
 const data=disclosureBreakdown(10000,[
  {category:'materials',amount_minor:2400,public_consent:1,note:'Seller declaration'},
  {category:'retailer',amount_minor:7600,public_consent:0,note:'CONFIDENTIAL'}
 ]);
 assert.equal(data.disclosedMinor,2400);
 assert.equal(data.undisclosedMinor,7600);
 assert.equal(data.entries.length,1);
 assert.equal(JSON.stringify(data).includes('CONFIDENTIAL'),false);
 assert.match(data.disclaimer,/No payouts/);
});
test('overallocations are detected and never represented as a reconciled breakdown',()=>{
 const d=disclosureBreakdown(1000,[{category:'materials',amount_minor:1100,public_consent:1}]);
 assert.equal(d.reconciled,false);
 assert.equal(d.undisclosedMinor,null);
 assert.equal(d.overAllocatedMinor,100);
 assert.throws(()=>disclosureBreakdown(-1,[]));
});
test('impact displays factual counters and avoids an ethical ranking',()=>{
 const d=impactFromRecords({products:2,trace_events:5,linked_evidence:7,unresolved_reports:3});
 assert.equal(d.products,2);
 assert.equal(d.recordedHandoffs,5);
 assert.equal(d.openConcerns,3);
 assert.equal('ethicsScore' in d,false);
 assert.match(d.label,/not an ethical rating/);
});
test('journey presents missing stages honestly and encodes seller text',()=>{
 const markup=journeyMarkup({events:[{stage:'source',actor_name:'<img src=x>',evidence_status:'supplier_declared'}]},escape);
 assert.match(markup,/SOURCE/);
 assert.match(markup,/TRANSPORT/);
 assert.match(markup,/Missing information/);
 assert.doesNotMatch(markup,/<img src=x>/);
 assert.match(markup,/&lt;img src=x&gt;/);
});
test('financial demo cannot be confused with a genuine payout',()=>{
 const markup=moneyMarkup(null,escape,{demo:true});
 assert.match(markup,/DEMONSTRATION|INTERACTIVE EXAMPLE/);
 assert.match(markup,/Hypothetical basket/);
 assert.match(markup,/No payments were processed/);
 assert.match(markup,/£100.00/);
 const actual=moneyMarkup({product:{price_minor:10000},money:disclosureBreakdown(10000,[])},escape);
 assert.match(actual,/No financial breakdown/);
 assert.doesNotMatch(actual,/£100.00 PURCHASE/);
});
test('supplier directory is opt-in and escapes untrusted names',()=>{
 const markup=supplierDirectoryMarkup([{name:'<script>bad</script>',country:'UK',categories:'textiles',website:''}],escape);
 assert.match(markup,/SELLER-DECLARED/);
 assert.doesNotMatch(markup,/<script>/);
 assert.match(markup,/&lt;script&gt;/);
});
test('wizard and impact preview are data-driven, non-payment user interfaces',()=>{
 const wiz=wizardMarkup(escape);
 assert.match(wiz,/data-action="store"/);
 assert.match(wiz,/data-wizard-step="1"/);
 assert.match(wiz,/data-wizard-step="2"/);
 assert.match(wiz,/data-wizard-step="3"/);
 assert.match(wiz,/LIVE STOREFRONT PREVIEW/);
 const impact=impactMarkup(impactFromRecords({products:1}),escape);
 assert.match(impact,/Products recorded/);
 assert.match(impact,/not an ethical rating/);
});
test('frontend wiring keeps commercial launch gates intact',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../src/worker.ts',import.meta.url),'utf8');
 const schema=readFileSync(new URL('../migrations/0007_voluntary_transparency.sql',import.meta.url),'utf8');
 assert.match(app,/journeyMarkup\(d,h\)/);
 assert.match(app,/moneyMarkup\(d,h\)/);
 assert.match(app,/supplierDirectoryPage\(\)/);
 assert.match(app,/wizardMarkup\(h\)/);
 assert.match(app,/data-action="money-disclosure"/);
 assert.match(app,/data-action="supplier-public-profile"/);
 assert.match(worker,/b\.publicConsent!==true&&b\.publicConsent!==false/);
 assert.match(worker,/method==='GET'&&path==='\/api\/public\/suppliers'/);
 assert.match(worker,/const impactRoute=/);
 assert.match(schema,/public_consent INTEGER NOT NULL DEFAULT 0/);
 assert.doesNotMatch(schema,/CREATE TABLE\s+payments\s*\(/i);
});

test('impact counts only latest active independent findings, never stale or revoked ones',async()=>{
 const {readFileSync}=await import('node:fs');
 const code=readFileSync(new URL('../src/worker.ts',import.meta.url),'utf8');
 assert.match(code,/COUNT\(DISTINCT e\.id\)/);
 assert.match(code,/e\.status='independently_verified'/);
 assert.match(code,/ia\.valid_until>=date\('now'\)/);
 assert.match(code,/ia\.id=\(SELECT recent\.id FROM independent_assessments recent/);
 assert.match(code,/recent\.reviewed_at DESC,recent\.rowid DESC LIMIT 1/);
});
