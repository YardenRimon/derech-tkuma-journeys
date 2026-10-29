import {NATIVE_COMMERCE_ENABLED,NATIVE_FORM_REPLACEMENT_ENABLED} from '@/lib/business-scope';
import {managedPageResponse,appendPublishedManagedCards} from '@/lib/managed-page-runtime';
import { getPublishedPage, CmsError } from '@/lib/cms';
import {preparePublicQuote} from '@/lib/quote-client';
import {preparePublicRating} from '@/lib/rating-client';
import {publicRatingConfiguration,publicQuoteConfiguration,type SubmissionRuntimeBindings} from '@/lib/submission-runtime';
import {prepareCommercePage,checkoutPageResponse} from '@/lib/commerce-page';
import type {CartBindings} from '@/lib/cart-runtime';
import {siteScope} from '@/lib/site-scope';
import {sourcePublicRedirect} from '@/lib/source-redirect';
import { env } from 'cloudflare:workers';
import { preparePublicContacts } from '@/lib/contact-client';
import type { ContactConfig } from '@/lib/contact-core';
import {productionRelease,prepareProductionPage,productionCsp,productionIndexablePath} from '@/lib/visitor-release';
export const dynamic = 'force-dynamic';
async function prepareNativeForms(html:string,url:URL){
 if(!NATIVE_FORM_REPLACEMENT_ENABLED)return html;
 // Tracking queries/fragments never select workflow identity or enter payloads.
 const canonicalPageUrl=new URL(url.origin+url.pathname);
 const bindings=env as unknown as SubmissionRuntimeBindings;
 const rating=preparePublicRating(html,url,await publicRatingConfiguration(canonicalPageUrl,bindings));
 return preparePublicQuote(rating,url,await publicQuoteConfiguration(canonicalPageUrl,bindings));
}
const headers = { 'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=0, s-maxage=60','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','permissions-policy':'camera=(), microphone=(), geolocation=()' };
export async function GET(request: Request) {
  const slug = new URL(request.url).pathname;
  try {
    const url=new URL(request.url),checkout=NATIVE_COMMERCE_ENABLED?await checkoutPageResponse(request,env as unknown as CartBindings,siteScope,getPublishedPage):null;
    if(checkout)return checkout;
    const managed=await managedPageResponse(request,env as unknown as CartBindings,siteScope,getPublishedPage);if(managed)return managed;
    const redirect=sourcePublicRedirect(url.pathname,request.method);
    if(redirect)return new Response(null,{status:redirect.status,headers:{...headers,'cache-control':'no-store',location:redirect.location}});
    const profile=productionRelease(url),sourceHtml=await getPublishedPage(slug),html=await appendPublishedManagedCards(sourceHtml,url,env as unknown as CartBindings,siteScope);
    if(!profile)return new Response(await prepareNativeForms((NATIVE_COMMERCE_ENABLED?prepareCommercePage(html,url,env as unknown as CartBindings):html),url),{headers});
    const prepared=prepareProductionPage(html,url,profile),body=NATIVE_FORM_REPLACEMENT_ENABLED&&profile.contactReady?preparePublicContacts(prepared,url,env as unknown as ContactConfig):prepared;
    const publicHeaders=new Headers(headers);if(productionIndexablePath(url.pathname))publicHeaders.delete('x-robots-tag');publicHeaders.set('content-security-policy',productionCsp);publicHeaders.set('x-derech-public-profile',profile.sourceCommit);
    return new Response(await prepareNativeForms((NATIVE_COMMERCE_ENABLED?prepareCommercePage(body,url,env as unknown as CartBindings):body),url),{headers:publicHeaders});
  }
  catch(error) { const status=error instanceof CmsError?error.status:503; return new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status===404?'העמוד לא נמצא':'האתר אינו זמין כרגע'} | דרך התקומה</title><link rel="stylesheet" href="/site.css"></head><body><main class="page-404"><h1>${status===404?'העמוד לא נמצא':'האתר אינו זמין כרגע'}</h1><p>${status===404?'ייתכן שהקישור השתנה. אפשר לחזור לדף הבית.':'נסה שוב בעוד מספר רגעים.'}</p><a class="button" href="/">לדף הבית</a></main></body></html>`,{status,headers:{...headers,'cache-control':'no-store'}}); }
}
