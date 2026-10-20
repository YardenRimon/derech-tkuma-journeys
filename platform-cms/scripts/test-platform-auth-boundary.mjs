import assert from 'node:assert/strict';
import { stripIdentityHeaders, platformAuthBoundary, isCmsBrowserPath } from '../build/platform-auth-boundary.ts';
const origin='https://fixture.workers.dev';
const identity={userId:'verified-subject',email:'owner@example.invalid',displayName:'בעלים',fullName:'בעלים',aal:'aal2'};
for(const path of ['/admin','/admin/collections/','/api/cms/upload/','/api/users/','/api/tasks/','/api/reports/','/api/execution/','/api/contact/manage','/api/contact/manage/'])assert(isCmsBrowserPath(path));
for(const path of ['/','/login/','/auth/callback/','/api/auth/session/','/api/machine/execution/','/api/backup/','/api/public/collections/','/media/fixture'])assert(!isCmsBrowserPath(path));
const source=new Request(origin+'/api/cms/upload/',{method:'POST',headers:{'oai-authenticated-user-id':'forged','x-platform-authenticated-id':'forged','x-platform-authenticated-email':'owner@example.invalid','x-platform-authenticated-aal':'aal2','content-type':'image/webp'},body:new Uint8Array([1,2,3,254])});
const stripped=stripIdentityHeaders(source);
assert(![...stripped.headers.keys()].some(key=>key.startsWith('oai-authenticated-user-')||key.startsWith('x-platform-authenticated-')));
let verified=0;
const accepted=await platformAuthBoundary(stripped,async request=>{verified++;assert.equal(request.headers.get('x-platform-authenticated-id'),null);return {identity,cookiesToSet:['__Host-platform-auth=renewed; Path=/; HttpOnly; Secure']};});
assert.equal(verified,1);assert.equal(accepted.request.headers.get('x-platform-authenticated-id'),identity.userId);assert.equal(accepted.request.headers.get('x-platform-authenticated-email'),identity.email);assert.equal(accepted.cookiesToSet.length,1);assert.deepEqual(new Uint8Array(await accepted.request.arrayBuffer()),new Uint8Array([1,2,3,254]));
for(const [status,code]of [[401,'unauthenticated'],[403,'mfa_required'],[503,'auth_unavailable']]){
 const verify=async()=>{throw {status,code,cookiesToSet:['fixture-refresh']};};
 const api=await platformAuthBoundary(stripIdentityHeaders(new Request(origin+'/api/users/')),verify);assert.equal(api.response.status,status);assert.deepEqual(api.cookiesToSet,['fixture-refresh']);assert.match(api.response.headers.get('cache-control'),/no-store/);assert(!(await api.response.text()).includes('fixture-refresh'));
 const page=await platformAuthBoundary(stripIdentityHeaders(new Request(origin+'/admin/tasks/?filter=mine')),verify);assert.equal(page.response.status,status===503?503:302);if(status!==503){assert.match(page.response.headers.get('location'),/^\/login\/\?next=/);assert(!page.response.headers.get('location').includes('https:'));}
}
const downgraded=await platformAuthBoundary(new Request(origin+'/api/users/'),async()=>({identity:{...identity,aal:'aal1'},cookiesToSet:['refreshed-aal1']}));assert.equal(downgraded.response.status,403);assert.deepEqual(downgraded.cookiesToSet,['refreshed-aal1']);
// Only an explicit server policy may accept a VERIFIED AAL1 identity. Caller
// headers/query parameters and invalid assurance values cannot disable MFA.
const optional=await platformAuthBoundary(stripIdentityHeaders(new Request(origin+'/admin/?mfa=false')),
 async request=>{assert.equal(request.headers.get('x-platform-authenticated-id'),null);return{identity:{...identity,aal:'aal1'},cookiesToSet:['renewed']};},{requireMfa:false});
assert(!optional.response);assert.equal(optional.request.headers.get('x-platform-authenticated-aal'),'aal1');assert.deepEqual(optional.cookiesToSet,['renewed']);
const optionalInvalid=await platformAuthBoundary(new Request(origin+'/api/users/'),async()=>({identity:{...identity,aal:'invalid'},cookiesToSet:[]}),{requireMfa:false});assert.equal(optionalInvalid.response.status,401);
const spoofedPolicy=await platformAuthBoundary(new Request(origin+'/admin/?requireMfa=false',{headers:{'x-platform-authenticated-aal':'aal2'}}),async()=>({identity:{...identity,aal:'aal1'},cookiesToSet:[]}));assert.equal(spoofedPolicy.response.status,302);assert.match(spoofedPolicy.response.headers.get('location'),/mfa=required/);
for(const path of ['/api/machine/execution/','/api/backup/','/api/auth/session/']){const bypass=await platformAuthBoundary(new Request(origin+path),async()=>{throw new Error('browser verifier must not intercept machine/auth routes');});assert(!bypass.response);}
console.log('Shared auth Worker boundary: inbound identity forgery stripped, trusted MFA identity only, no downgrade, refreshed cookies preserved, binary body intact, API/page fail-closed, machine/backup unchanged.');
