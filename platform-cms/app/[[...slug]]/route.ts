import { getPublishedPage, CmsError } from '@/lib/cms';
import {sourcePublicRedirect} from '@/lib/source-redirect';
import { env } from 'cloudflare:workers';
import { preparePublicContacts } from '@/lib/contact-client';
import type { ContactConfig } from '@/lib/contact-core';
import {productionRelease,prepareProductionPage,productionCsp,productionIndexablePath} from '@/lib/visitor-release';
export const dynamic = 'force-dynamic';
const headers = { 'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=0, s-maxage=60','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','permissions-policy':'camera=(), microphone=(), geolocation=()' };
export async function GET(request: Request) {
  const slug = new URL(request.url).pathname;
  try {
    const url=new URL(request.url),redirect=sourcePublicRedirect(url.pathname,request.method);
    if(redirect)return new Response(null,{status:redirect.status,headers:{...headers,'cache-control':'no-store',location:redirect.location}});
    const profile=productionRelease(url),html=await getPublishedPage(slug);
    if(!profile)return new Response(preparePublicContacts(html,url,env as unknown as ContactConfig),{headers});
    const prepared=prepareProductionPage(html,url,profile),body=profile.contactReady?preparePublicContacts(prepared,url,env as unknown as ContactConfig):prepared;
    const publicHeaders=new Headers(headers);if(productionIndexablePath(url.pathname))publicHeaders.delete('x-robots-tag');publicHeaders.set('content-security-policy',productionCsp);publicHeaders.set('x-derech-public-profile',profile.sourceCommit);
    return new Response(body,{headers:publicHeaders});
  }
  catch(error) { const status=error instanceof CmsError?error.status:503; return new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status===404?'העמוד לא נמצא':'האתר אינו זמין כרגע'} | דרך התקומה</title><link rel="stylesheet" href="/site.css"></head><body><main class="page-404"><h1>${status===404?'העמוד לא נמצא':'האתר אינו זמין כרגע'}</h1><p>${status===404?'ייתכן שהקישור השתנה. אפשר לחזור לדף הבית.':'נסה שוב בעוד מספר רגעים.'}</p><a class="button" href="/">לדף הבית</a></main></body></html>`,{status,headers:{...headers,'cache-control':'no-store'}}); }
}
