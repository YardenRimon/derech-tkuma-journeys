/** Anonymous release acceptance only; never stores/logs real sessions or CSRF values. */
export async function verifyPlatformAuthLive(origin,sha,fetcher=fetch){
 const checks=[];
 for(const path of ['/login/','/api/auth/session','/admin/','/api/users/']){
  const response=await fetcher(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'user-agent':'DerechSharedAuthVerifier/1.0','x-platform-authenticated-id':'forged','x-platform-authenticated-email':'22yarden22@gmail.com','x-platform-authenticated-aal':'aal2','oai-authenticated-user-id':'forged','cf-access-jwt-assertion':'forged'}});
  const check={path,status:response.status,passed:false};
  const safe=response.headers.get('x-derech-release')===sha&&response.headers.get('x-robots-tag')?.includes('noindex');
  if(path==='/login/'){
   const html=await response.text(),csp=response.headers.get('content-security-policy')??'';
   check.passed=Boolean(safe&&response.status===200&&response.headers.get('cache-control')?.includes('no-store')&&html.length<100000&&html.includes('google-login')&&html.includes('email-code')&&html.includes('mfa-code')&&/script-src 'nonce-[a-f0-9]+/.test(csp)&&csp.includes("frame-ancestors 'none'"));
  }else if(path==='/api/auth/session'){
   let session;try{session=await response.json();}catch{}
   const cookies=response.headers.getSetCookie?.()??[];
   check.passed=Boolean(safe&&response.status===200&&response.headers.get('cache-control')?.includes('no-store')&&session?.configured===true&&session?.authenticated===false&&/^[a-f0-9]{64}$/.test(session?.csrfToken??'')&&cookies.some(cookie=>cookie.startsWith('__Host-platform-csrf=')&&cookie.includes('HttpOnly')&&cookie.includes('Secure')&&!/Domain=/i.test(cookie)));
  }else if(path==='/admin/'){
   let target;try{target=new URL(response.headers.get('location'),origin);}catch{}
   check.passed=Boolean(safe&&response.status===302&&target?.origin===origin&&target?.pathname==='/login/');await response.body?.cancel();
  }else{check.passed=Boolean(safe&&response.status===401&&!response.headers.has('location'));await response.body?.cancel();}
  checks.push(check);
 }
 return {passed:checks.every(check=>check.passed),checks,realUserLoginVerified:false};
}
