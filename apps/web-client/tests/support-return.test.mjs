import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSupportReturn} from '../src/utils/supportReturnPolicy.ts';

test('returns only the configured Support origin and preserves the original article',()=>{
 const target='http://localhost:5175/?article=free-ip-policy#section-1';
 assert.equal(validateSupportReturn(target,'http://localhost:5175'),target);
 assert.equal(validateSupportReturn('https://support.example/help/?article=credit-holds','https://support.example/help'),'https://support.example/help/?article=credit-holds');
});
test('rejects external, scheme-relative, credential, lookalike and protocol redirects',()=>{
 for(const target of ['https://evil.example','//evil.example','http://localhost:5175.evil.example','http://localhost:5175@evil.example','http://user:password@localhost:5175','javascript:alert(1)','data:text/html,hi','http://localhost:5174','https://localhost:5175','http://localhost:5175\\@evil.example'])assert.equal(validateSupportReturn(target,'http://localhost:5175'),null,target);
});
test('path deployments reject sibling routes and missing configuration',()=>{
 for(const target of ['https://support.example/other','https://support.example/help-other','https://support.example/help/../admin'])assert.equal(validateSupportReturn(target,'https://support.example/help'),null);
 assert.equal(validateSupportReturn('http://localhost:5175',null),null);
 assert.equal(validateSupportReturn('http://localhost:5175/'+ 'x'.repeat(2048),'http://localhost:5175'),null);
});
