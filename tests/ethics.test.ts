import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {safeSlug,cleanText,safeHttpsUrl,moneyMinor,evidenceStatus,traceCoverage,exportCsv} from '../src/ethics.ts';

test('slugs are predictable and bounded',()=>{
 assert.equal(safeSlug('Fair Cotton™ Shirt!'),'fair-cotton-shirt');
 assert.equal(safeSlug('a'.repeat(100)).length,70);
});
test('reject dangerous URLs',()=>{
 assert.equal(safeHttpsUrl('javascript:alert(1)'),'');
 assert.equal(safeHttpsUrl('http://example.com'),'');
 assert.equal(safeHttpsUrl('https://example.com/a'),'https://example.com/a');
});
test('money is always a safe nonnegative integer minor unit',()=>{
 assert.equal(moneyMinor(-1),null);
 assert.equal(moneyMinor(12.34),null);
 assert.equal(moneyMinor('1200'),1200);
});
test('unknown or missing evidence is never called verified',()=>{
 assert.equal(evidenceStatus(null),'missing');
 assert.equal(evidenceStatus({status:'fake'}),'missing');
 assert.equal(evidenceStatus({status:'supplier_declared'}),'supplier_declared');
});
test('traceability gaps remain explicit',()=>{
 assert.deepEqual(traceCoverage(['source','retail']),{covered:2,total:4,missing:['manufacture','transport']});
});
test('CSV spreadsheet formula values are escaped',()=>{
 const csv=exportCsv([{name:'=HYPERLINK("x")',sku:'ABC',price_gbp:'12.00'}]);
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.ok(csv.includes('""x""'));
});
test('text is normalised and bounded',()=>assert.equal(cleanText(' hello ',3),'hel'));
