import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {passwordHash,verifyPassword} from '../src/security.ts';

test('Cloudflare-compatible password hashes use no PBKDF2 call over 100,000 iterations',async()=>{
 const encoded=await passwordHash('a-unique-twelve-character-password');
 assert.match(encoded,/^pbkdf2-chain-v1\$100000x3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
 assert.equal(await verifyPassword('a-unique-twelve-character-password',encoded),true);
 assert.equal(await verifyPassword('not-the-password',encoded),false);
});

test('password hashes have unique per-account salts',async()=>{
 const a=await passwordHash('the same secure passphrase');
 const b=await passwordHash('the same secure passphrase');
 assert.notEqual(a,b);
 assert.equal(await verifyPassword('the same secure passphrase',a),true);
 assert.equal(await verifyPassword('the same secure passphrase',b),true);
});

test('tampered or malformed password hash formats fail closed',async()=>{
 const encoded=await passwordHash('another valid passphrase');
 assert.equal(await verifyPassword('another valid passphrase',encoded.replace('100000x3','100000x1')),false);
 assert.equal(await verifyPassword('another valid passphrase',encoded.replace('pbkdf2-chain-v1','pbkdf2')),false);
 assert.equal(await verifyPassword('another valid passphrase',encoded+'$extra'),false);
 assert.equal(await verifyPassword('another valid passphrase',''),false);
});

test('legacy PBKDF2(210000) hashes remain verifiable in compatible runtimes',async()=>{
 const password='legacy-password-check-example', salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},key,256));
 const hex=(a:Uint8Array)=>Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');
 const enc='pbkdf2$210000$'+hex(salt)+'$'+hex(bits);
 assert.equal(await verifyPassword(password,enc),true);
 assert.equal(await verifyPassword('wrong',enc),false);
});
