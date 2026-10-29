import {CollectionError,type Scope} from '../../../../lib/collection-core';
import {SeoDraftStore,SEO_ORIGIN} from '../../../../lib/seo-draft-core';
export const SEO_PURPOSE='cms-seo-snapshot/v1';
export const SEO_ENDPOINT=SEO_ORIGIN+'/api/machine/seo/';
function fail(status:number):never{throw new CollectionError(status,'בקשת תמונת SEO אינה מורשית או אינה תקינה');}
/** Read-only purpose-separated machine protocol. No URL, selector, IDs or write operation supplied by caller. */
export async function validateSeoRequest(request:Request,secret:string|undefined,now=Date.now()){
 if(request.method!=='POST')fail(405);
 if(request.url!==SEO_ENDPOINT||new URL(request.url).search)fail(403);
 const origin=request.headers.get('origin');if(origin!==null&&origin!==SEO_ORIGIN)fail(403);
 const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>2048))fail(413);
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();fail(413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(typeof secret!=='string'||secret.length<40||secret.length>256)fail(503);
 const timestamp=request.headers.get('x-bridge-time'),signature=request.headers.get('x-bridge-signature');
 if(!timestamp||!/^\d{10,13}$/.test(timestamp)||!Number.isFinite(now)||Math.abs(now/1000-Number(timestamp))>120||!signature||!/^[a-f0-9]{64}$/.test(signature))fail(401);
 const prefix=new TextEncoder().encode(timestamp+'\n'+SEO_PURPOSE+'\n'),signed=new Uint8Array(prefix.length+bytes.length);signed.set(prefix);signed.set(bytes,prefix.length);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const digest=Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',key,digest,signed))fail(401);
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='operation,purpose,siteId,tenantId'||body.purpose!==SEO_PURPOSE||body.operation!=='readback'||body.tenantId!=='derech'||body.siteId!=='derech-main')fail(403);
}
export async function seoSnapshot(db:D1Database,scope:Scope,now=Date.now()){
 if(scope.tenantId!=='derech'||scope.siteId!=='derech-main')fail(403);
 const store=new SeoDraftStore(db),tours=await store.published(scope,'tour');
 if(tours.length>4)fail(409);
 const tourIds=new Set(tours.map(t=>t.id));
 const occurrences=(await store.published(scope,'occurrence')).filter(o=>'tourId' in o.content&&tourIds.has(o.content.tourId));
 if(occurrences.length>20)fail(409);
 const readbacks=[];
 // Sequential bounded reads preserve the existing D1 invocation budget.
 for(const tour of tours){const readback=await store.readback(scope,tour.id);if(JSON.stringify(readback.source)!==JSON.stringify(tour))fail(409);readbacks.push(readback);}
 return {schema:SEO_PURPOSE,origin:SEO_ORIGIN,...scope,observedAt:Math.floor(now/1000),projection:{tours:{records:tours},occurrences:{records:occurrences}},readbacks};
}
