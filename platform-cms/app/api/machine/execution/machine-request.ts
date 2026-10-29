import{CollectionError}from'../../../../lib/collection-core';
import{verifySignature}from'../../../../lib/execution-core';
/** Gate before delegating to the unchanged gateway. A signed packet never grants browser operations. */
export async function machineExecutionRequest(request:Request,secret:string|undefined):Promise<Request>{
 if(request.method!=='POST')throw new CollectionError(405,'Machine execution accepts POST only');
 if(new URL(request.url).search)throw new CollectionError(400,'Machine execution does not accept query parameters');
 const declared=Number(request.headers.get('content-length')??0);
 if(Number.isFinite(declared)&&declared>500000)throw new CollectionError(413,'Machine execution request exceeds 500000 bytes');
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();throw new CollectionError(413,'Machine execution request exceeds 500000 bytes');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const raw=new TextDecoder().decode(bytes);
 await verifySignature(raw,request.headers.get('x-bridge-time'),request.headers.get('x-bridge-signature'),secret);
 let body:unknown;try{body=JSON.parse(raw);}catch{throw new CollectionError(400,'Invalid machine execution JSON');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new CollectionError(400,'Invalid machine execution packet');
 // Deliberately reject presence, not just rollback's current spelling/value.
 // Next headers() retains the original visitor context, so stripping JWT headers is not an authorization boundary.
 if(Object.hasOwn(body,'operation'))throw new CollectionError(403,'Browser operations are not accepted by machine execution');
 const headers=new Headers({'content-type':'application/json'});
 for(const key of['x-bridge-time','x-bridge-signature']){const value=request.headers.get(key);if(value)headers.set(key,value);}
 return new Request(request.url,{method:'POST',headers,body:bytes.buffer});
}
export async function forwardMachineExecution(request:Request,secret:string|undefined,handler:(request:Request)=>Promise<Response>):Promise<Response>{return handler(await machineExecutionRequest(request,secret));}
