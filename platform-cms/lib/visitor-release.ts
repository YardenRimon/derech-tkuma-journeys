import release from './site-release.json';
import sourceManifest from '../source-manifest.json';
import sourceIndexing from '../source-pages/source-indexing.json';
import {createHash} from 'node:crypto';
import {validateProductionProfile,productionOrigin,productionAlias,canonicalProductionProfile} from '../../production/release-profile.mjs';
declare const __DERECH_PRODUCTION_BUILD__:boolean;
declare const __DERECH_PRODUCTION_PROFILE__:unknown;
export type ProductionMeasurement={verified:true;strategy:'gtm';revision:string;containerSha256:string;ga4Id:'G-DV3E8J77EX';gtmId:'GTM-5N7NPTL4';metaPixelId:'766863783155971';basicConsentOnly:true;purposeTagsVerified:true;enhancedMeasurementDisabled:true;noCustomHtml:true;sandboxAccepted:true;noPersonalDataVariables:true};
export type ProductionPaymentEvidence={provider:'grow';environment:'production';currency:'ILS';acceptanceHash:string;currencyEvidenceHash:string;acknowledgmentEvidenceHash:string;termsHash:string;callbackVerification:'stored-process-token-and-approved-readback/v1';acknowledgmentContract:'full-documented-form/v1'};
export type ProductionProfile={schema:1;stage:'production';origin:string;aliasOrigin:string;sourceRelease:string;sourceCommit:string;approvalReceiptHash:string;gates:Record<string,true>;resources:{accountId:string;databaseId:string;databaseName:string;bucketName:string};contactReady:boolean;paymentsReady:boolean;paymentEvidence:ProductionPaymentEvidence|null;measurement:ProductionMeasurement|null};
export function productionRelease(url:URL):ProductionProfile|null{
 if(!sourceIndexingValid)return null;
 if(typeof __DERECH_PRODUCTION_BUILD__==='undefined'||__DERECH_PRODUCTION_BUILD__!==true||typeof __DERECH_PRODUCTION_PROFILE__==='undefined')return null;
 if(![productionOrigin,productionAlias].includes(url.origin))return null;
 try{return validateProductionProfile(__DERECH_PRODUCTION_PROFILE__,release.contentRelease) as ProductionProfile;}catch{return null;}
}
export const publicProductionPaths=new Set(Object.keys(sourceManifest));
type IndexingPolicy={version:number;origin:string;snapshotId:string;capturedAt:string;routeCount:number;provenanceSha256:string;sourceManifestCanonicalSha256:string;expectedSitemapCount:number;policySha256:string;pages:Record<string,{fixture:string;sourceSha256:string;noindex:boolean;robots:{name:string;content:string}[]}>;noindexPaths:string[]};
const indexing=sourceIndexing as unknown as IndexingPolicy;
function validateSourceIndexing(){try{
 const hash=(value:unknown)=>createHash('sha256').update(canonicalProductionProfile(value)).digest('hex');
 const supported:Record<number,{snapshot:string;date:string;noindex:number;sitemap:number}>={37:{snapshot:'source-20261019',date:'2026-10-19',noindex:4,sitemap:32},51:{snapshot:'wordpress-public-20261028',date:'2026-10-28',noindex:18,sitemap:32}},expected=supported[indexing.routeCount];
 const {policySha256,...payload}=indexing,paths=Object.keys(sourceManifest).sort();
 if(!expected||indexing.version!==1||indexing.origin!==productionOrigin||indexing.snapshotId!==expected.snapshot||!indexing.capturedAt.startsWith(expected.date)||indexing.routeCount!==paths.length||indexing.expectedSitemapCount!==expected.sitemap||!/^[a-f0-9]{64}$/.test(indexing.provenanceSha256)||hash(payload)!==policySha256||hash(sourceManifest)!==indexing.sourceManifestCanonicalSha256||JSON.stringify(Object.keys(indexing.pages).sort())!==JSON.stringify(paths))return false;
 const derived:string[]=[];
 for(const path of paths){const page=indexing.pages[path],source=sourceManifest[path as keyof typeof sourceManifest];if(!page||page.fixture!==source.fixture||page.sourceSha256!==source.sourceSha256||!Array.isArray(page.robots)||page.robots.some(tag=>!['robots','googlebot','bingbot'].includes(tag.name)||typeof tag.content!=='string'))return false;const noindex=page.robots.some(tag=>/(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])/i.test(tag.content));if(page.noindex!==noindex)return false;if(noindex)derived.push(path);}
 return derived.length===expected.noindex&&JSON.stringify(derived)===JSON.stringify(indexing.noindexPaths);
 }catch{return false;}}
export const sourceIndexingValid=validateSourceIndexing();
export const sourceNoindexPaths=new Set(sourceIndexingValid?indexing.noindexPaths:Object.keys(sourceManifest));
export function productionIndexablePath(path:string){try{return sourceIndexingValid&&productionPublicPath(path)&&!sourceNoindexPaths.has(decodeURIComponent(path));}catch{return false;}}
export function productionPublicPath(path:string){try{return publicProductionPaths.has(decodeURIComponent(path));}catch{return false;}}
const reviewPolicy="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; form-action 'none'; base-uri 'self'";
export const exactReviewProtection='<meta name="robots" content="noindex,nofollow,noarchive" data-pilot-policy="current-source-review"><meta name="referrer" content="strict-origin-when-cross-origin"><meta http-equiv="Content-Security-Policy" content="'+reviewPolicy.replaceAll("'",'&#x27;')+'"><script src="/__pilot__/guard.js" data-pilot-policy="guard-first"></script>';
export const exactReviewVisitor='<script type="module" src="/visitor-policy.js" data-visitor-policy="review"></script>';
export const productionCsp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; form-action 'none'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'";
export function productionInsertion(html:string,url:URL){
 const path=decodeURIComponent(url.pathname),entry=sourceManifest[path as keyof typeof sourceManifest];if(!entry)throw new Error('production_source_policy_mismatch');
 const canonicalTags=(html.match(/<link\b[^>]*>/gi)??[]).filter(tag=>/\brel=["']canonical["']/i.test(tag));
 if(entry.canonical){
  const href=canonicalTags[0]?.match(/\bhref=["']([^"']+)/i)?.[1];
  if(canonicalTags.length!==1||!href||decodeURIComponent(new URL(href).href)!==decodeURIComponent(new URL(entry.canonical).href))throw new Error('production_canonical_mismatch');
 }else if(canonicalTags.length)throw new Error('production_canonical_mismatch');
 const extra=entry.canonical?'':'<link rel="canonical" href="'+productionOrigin+path+'" data-production-policy="source-self-canonical">';
 return'<meta name="referrer" content="strict-origin-when-cross-origin">'+extra+(path==='/thanks/'?'<meta name="robots" content="noindex,nofollow" data-production-policy="private-receipt">':'')+'<script src="/production-guard.js" data-production-policy="guard-first"></script><script type="module" src="/production-visitor.js" data-production-policy="consent"></script>';
}
export function prepareProductionPage(html:string,url:URL,profile:ProductionProfile){
 if(url.origin!==profile.origin||!productionPublicPath(url.pathname)||html.split(exactReviewProtection).length!==2||html.split(exactReviewVisitor).length!==2)throw new Error('production_source_policy_mismatch');
 // Remove only these exact known local insertions. Disabled original SDK hash
 // comments, source DOM, canonical/metadata, inline code and order are retained.
 let output=html.replace(exactReviewProtection,'').replace(exactReviewVisitor,'');
 if(/data-pilot-policy=|src=["']\/__pilot__\/guard\.js|data-visitor-policy=["']review/i.test(output))throw new Error('production_source_policy_mismatch');
 const injected=productionInsertion(html,url);
 output=output.replace(/<head(?:\s[^>]*)?>/i,head=>head+injected);
 return output;
}
export function visitorConfiguration(profile:ProductionProfile){return{schema:1,origin:profile.origin,policyVersion:'2026-10-20',configuration:profile.measurement};}
export function productionRobots(profile:ProductionProfile){return'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth-required\nDisallow: /measurement-frame/\nDisallow: /visitor-configuration/\nSitemap: '+profile.origin+'/sitemap.xml\n';}

export function productionSitemap(){
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
 return'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(Object.entries(sourceManifest).filter(([path])=>productionIndexablePath(path)).map(([path,entry])=>entry.canonical??productionOrigin+path))].map(url=>`<url><loc>${escape(url)}</loc></url>`).join('')+'</urlset>';
}
