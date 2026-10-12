/** Pure evidence logic. Values are *not* moral scores or regulatory certifications. */
export const FACETS = ['origin','workers','environment','animals','safety','durability','commercial'] as const;
export const STAGES = ['source','process','manufacture','package','transport','warehouse','retail','repair','reuse'] as const;
export type Facet = typeof FACETS[number];
export type Stage = typeof STAGES[number];
export type EvidenceStatus = 'missing'|'supplier_declared'|'evidence_checked'|'independently_verified'|'rejected';

export function safeSlug(input: string): string {
 return input.replace(/[™®©]/g,'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
}
export function cleanText(value: unknown, max=240): string {
 return typeof value==='string' ? value.trim().slice(0,max) : '';
}
export function safeHttpsUrl(input: unknown): string {
 if (typeof input!=='string' || !input.trim()) return '';
 try {
   const url = new URL(input);
   if (url.protocol!=='https:' || url.username || url.password) return '';
   return url.toString().slice(0,1000);
 } catch { return ''; }
}
export function moneyMinor(value: unknown): number | null {
 const n=Number(value);
 return Number.isSafeInteger(n) && n>=0 && n<=10000000000 ? n : null;
}
export function evidenceStatus(evidence: {status?:string}|null): EvidenceStatus {
 if (!evidence) return 'missing';
 return (['supplier_declared','evidence_checked','independently_verified','rejected'] as string[]).includes(evidence.status||'')
   ? evidence.status as EvidenceStatus : 'missing';
}
/** Coverage measures disclosure completeness only, NOT whether a product is ethical. */
export function traceCoverage(stages: string[]): {covered:number;total:number;missing:string[]} {
 const required=['source','manufacture','transport','retail'];
 const known=new Set(stages);
 return {covered:required.filter(s=>known.has(s)).length,total:required.length,missing:required.filter(s=>!known.has(s))};
}
export function isKnownFacet(value: unknown): value is Facet {
 return typeof value==='string' && (FACETS as readonly string[]).includes(value);
}
export function isKnownStage(value: unknown): value is Stage {
 return typeof value==='string' && (STAGES as readonly string[]).includes(value);
}
export function exportCsv(items: Array<Record<string,unknown>>): string {
 const fields=['sku','name','description','price_gbp','stock','category','image_url','supplier','passport_url'];
 const cell=(v:unknown) => '"'+String(v??'').replace(/"/g,'""').replace(/^[=+@\-\t\r]/,v=>"'"+v)+'"';
 return [fields.join(','),...items.map(row=>fields.map(f=>cell(row[f])).join(','))].join('\r\n')+'\r\n';
}
