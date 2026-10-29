import {productionRelease} from '@/lib/visitor-release';
import {readConsent} from '@/public/consent-state';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),profile=productionRelease(url),base={'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
 if(!profile||url.origin!==profile.origin||url.search||!profile.measurement)return new Response('Not found',{status:404,headers:base});
 const choice=readConsent(request.headers.get('cookie')??'',profile.measurement.revision),analytics=choice?.analytics===true,marketing=choice?.marketing===true;
 const nonce=crypto.randomUUID().replaceAll('-',''),scripts=["'self'",`'nonce-${nonce}'`,...(analytics||marketing?['https://www.googletagmanager.com/gtm.js']:[]),...(analytics?['https://www.googletagmanager.com/gtag/js','https://www.google-analytics.com']:[]),...(marketing?['https://connect.facebook.net']:[])];
 const targets=[...(analytics?['https://www.google-analytics.com','https://region1.google-analytics.com']:[]),...(marketing?['https://www.facebook.com']:[])];
 const csp=`default-src 'none'; script-src ${scripts.join(' ')}; connect-src ${targets.length?targets.join(' '):"'none'"}; img-src ${targets.length?targets.join(' '):"'none'"}; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${profile.origin}; object-src 'none'`;
 const configuration={...profile.measurement,allowedPurposes:{analytics,marketing}},json=JSON.stringify(configuration).replaceAll('<','\\u003c');
 return new Response('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>כלי מדידה לפי העדפות פרטיות</title><script type="application/json" id="dt-measurement-config" nonce="'+nonce+'">'+json+'</script><script type="module" src="/measurement-frame.js" nonce="'+nonce+'"></script></head><body></body></html>',{headers:{...base,'content-type':'text/html; charset=utf-8','content-security-policy':csp,'x-frame-options':'SAMEORIGIN'}});
}
