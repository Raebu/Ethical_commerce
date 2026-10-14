/** Truthful, non-financially-executing disclosure helpers.
 * Never convert merchant assertions or hypothetical splits into certified facts.
 */
export const MONEY_CATEGORIES=['materials','manufacturing','logistics','platform','tax','retailer','other'] as const;
export type MoneyCategory=typeof MONEY_CATEGORIES[number];
export type MoneyRecord={category:string;amount_minor:number;public_consent?:number|boolean;note?:string;evidence_url?:string;evidence_status?:string};
export function isMoneyCategory(x:unknown):x is MoneyCategory{
 return typeof x==='string'&&(MONEY_CATEGORIES as readonly string[]).includes(x);
}
export function disclosureBreakdown(priceMinor:number,records:MoneyRecord[]){
 const amount=Number(priceMinor);
 if(!Number.isSafeInteger(amount)||amount<0)throw new Error('Invalid product price');
 const eligible=records.filter(r=>r.public_consent===1||r.public_consent===true);
 const disclosedMinor=eligible.reduce((sum,r)=>sum+r.amount_minor,0);
 const reconciled=disclosedMinor<=amount;
 return {
  totalMinor:amount,
  disclosedMinor,
  undisclosedMinor:reconciled?amount-disclosedMinor:null,
  overAllocatedMinor:reconciled?0:disclosedMinor-amount,
  reconciled,
  coverage:amount===0?null:Math.round(10000*Math.min(disclosedMinor,amount)/amount)/100,
  entries:eligible.map(r=>({
   category:r.category,amount_minor:r.amount_minor,note:r.note||'',
   evidence_url:r.evidence_url||'',evidence_status:'merchant_declared'
  })),
  disclaimer:'Optional seller-entered allocations only. No payouts, bank transfers or independently verified cost audit. Unallocated amounts do not establish profit.'
 };
}
export function impactFromRecords(row:{products?:number;trace_events?:number;linked_evidence?:number;claims?:number;independent_assessments?:number;published_disclosures?:number;public_suppliers?:number;unresolved_reports?:number}){
 const count=(v:number|undefined)=>Number.isSafeInteger(v)&&v!>=0?v!:0;
 return {
  products:count(row.products),recordedHandoffs:count(row.trace_events),
  linkedEvidence:count(row.linked_evidence),claims:count(row.claims),
  independentlyAssessedEvidence:count(row.independent_assessments),
  publicMoneyDisclosures:count(row.published_disclosures),
  optedInSuppliers:count(row.public_suppliers),openConcerns:count(row.unresolved_reports),
  label:'Activity and disclosure counters, not an ethical rating, certification, environmental impact measure or eligibility for financial rewards.'
 };
}
