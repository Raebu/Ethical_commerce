import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {buildStagingConfig} from '../scripts/prepare-staging.mjs';

const example=readFileSync(new URL('../wrangler.staging.example.toml',import.meta.url),'utf8');
const production=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
const stageId='11111111-2222-4333-8444-555555555555';
const liveId=production.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];

test('staging template creates an isolated, disabled-by-default Worker configuration',()=>{
 const config=buildStagingConfig(example,production,stageId,'DEPLOY_STAGING_ONLY');
 assert.match(config,/name = "ethical-commerce-staging"/);
 assert.match(config,/database_id = "11111111-2222-4333-8444-555555555555"/);
 assert.match(config,/RUNTIME_TIER = "staging"/);
 assert.doesNotMatch(config,/REPLACE_WITH_SEPARATE_/);
 for(const flag of ['TEST_CHECKOUT_ENABLED','SALES_ENABLED','PUBLISHING_ENABLED','NOTIFICATIONS_ENABLED'])
  assert.ok(config.includes(flag+' = "false"'));
});
test('staging refuses the production D1 database even with confirmation',()=>{
 assert.ok(liveId);
 assert.throws(()=>buildStagingConfig(example,production,liveId,'DEPLOY_STAGING_ONLY'),/Refusing to reuse/);
});
test('staging refuses malformed database IDs and missing confirmation',()=>{
 assert.throws(()=>buildStagingConfig(example,production,'invalid','DEPLOY_STAGING_ONLY'),/UUID/);
 assert.throws(()=>buildStagingConfig(example,production,stageId,''),/confirmation/);
});
test('staging refuses accidental flags enabled in the template',()=>{
 assert.throws(()=>buildStagingConfig(example.replace('SALES_ENABLED = "false"','SALES_ENABLED = "true"'),production,stageId,'DEPLOY_STAGING_ONLY'),/Unsafe staging/);
});

test('approved staging workflow is bound to a separate actual D1 database',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/staging.yml',import.meta.url),'utf8');
 const supplied='11d8e5ce-2bbb-491a-9099-b6e7085ea0a1';
 assert.ok(workflow.includes(supplied));
 assert.ok(workflow.includes('ops/staging-deploy-request.txt'));
 assert.ok(workflow.includes('environment: staging'));
 assert.ok(workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
 assert.notEqual(supplied.toLowerCase(),liveId?.toLowerCase());
 const config=buildStagingConfig(example,production,supplied,'DEPLOY_STAGING_ONLY');
 assert.ok(config.includes('database_id = "'+supplied+'"'));
 assert.ok(!config.includes('database_id = "'+liveId+'"'));
});
