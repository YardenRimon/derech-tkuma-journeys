/** Bounded purpose choice only: no identity, URL, form or provider data. */
export const POLICY_VERSION='2026-10-20',CONSENT_COOKIE='dt_privacy',MAX_AGE=180*86400;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(key=>Object.hasOwn(x,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function readConsent(cookie,revision,now=Math.floor(Date.now()/1000)){
 try{
  const parts=cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith(CONSENT_COOKIE+'='));if(parts.length!==1||parts[0].length>600)return null;
  const c=JSON.parse(decodeURIComponent(parts[0].slice(CONSENT_COOKIE.length+1)));
  if(!exact(c,['v','policyVersion','revision','analytics','marketing','at','expires'])||c.v!==1||c.policyVersion!==POLICY_VERSION||c.revision!==revision||typeof c.analytics!=='boolean'||typeof c.marketing!=='boolean'||!Number.isSafeInteger(c.at)||!Number.isSafeInteger(c.expires)||c.at>now+60||c.expires<=now||c.expires-c.at!==MAX_AGE||now-c.at>MAX_AGE)return null;
  return Object.freeze(c);
 }catch{return null;}
}
export function consentValue(analytics,marketing,revision,now=Math.floor(Date.now()/1000)){
 if(typeof analytics!=='boolean'||typeof marketing!=='boolean'||!(hash(revision)||revision==='disabled')||!Number.isSafeInteger(now))throw new Error('invalid_consent');
 return{v:1,policyVersion:POLICY_VERSION,revision,analytics,marketing,at:now,expires:now+MAX_AGE};
}
