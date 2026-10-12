import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function buildStagingConfig(example,production,uuid,confirmation){
  if(confirmation!=='DEPLOY_STAGING_ONLY')throw Error('Staging deployment confirmation required');
  const pattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if(!pattern.test(uuid||''))throw Error('Staging database must have a valid UUID');
  const existing=production.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
  if(!existing||!pattern.test(existing))throw Error('Production database identity could not be checked');
  if(existing.toLowerCase()===uuid.toLowerCase())throw Error('Refusing to reuse production D1');
  if(!example.includes('RUNTIME_TIER = "staging"')||!example.includes('name = "ethical-commerce-staging"'))throw Error('Wrong deployment target');
  // Require the staging sender to be version-controlled alongside other public vars.
  // Resend's secret API key must remain exclusively in Cloudflare settings.
  if(!example.includes('EMAIL_FROM = "Ethical Commerce <verification@theraeburngroup.com>"'))
    throw Error('Missing Ethical Commerce staging transactional sender');
  if(/^\s*RESEND_API_KEY\s*=/m.test(example))throw Error('Resend API credentials must never appear in the Wrangler template');
  for(const flag of ['SALES_ENABLED','PUBLISHING_ENABLED','TEST_CHECKOUT_ENABLED','NOTIFICATIONS_ENABLED']){
    if(!example.includes(flag+' = "false"'))throw Error('Unsafe staging release toggle '+flag);
  }
  if(!example.includes('REPLACE_WITH_SEPARATE_STAGING_D1_DATABASE_UUID'))throw Error('Missing staging template marker');
  return example.replace('REPLACE_WITH_SEPARATE_STAGING_D1_DATABASE_UUID',uuid.toLowerCase());
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const config=buildStagingConfig(readFileSync('wrangler.staging.example.toml','utf8'),
    readFileSync('wrangler.toml','utf8'),process.env.STAGING_D1_UUID,process.env.CONFIRM_STAGING);
  writeFileSync('wrangler.staging.toml',config,{mode:0o600});
  console.log('Validated separate staging configuration is ready');
}
