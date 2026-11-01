/** Coreco's server is the only issuer. Never trust forwarded browser identity. */
export type CorecoBridgeClaims={v:1;ts:number;nonce:string;tenant:'derech';site:'derech-main';actor:string;role:'admin'|'editor';method:'POST';path:'/api/machine/coreco/content';body:string};
export class CorecoBridgeError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const fail=():never=>{throw new CorecoBridgeError(403,'הבקשה אינה מורשית');};
export async function verifyCorecoBridge(request:Request,body:string,config:{key?:string;tenant?:string;site?:string},consume:(nonce:string,expires:number)=>Promise<boolean>,now=Math.floor(Date.now()/1000)):Promise<CorecoBridgeClaims>{
 if(!config.key||new TextEncoder().encode(config.key).length<32||config.tenant!=='derech'||config.site!=='derech-main')throw new CorecoBridgeError(503,'חיבור קורקו טרם הוגדר');
 if(request.method!=='POST'||new URL(request.url).pathname!=='/api/machine/coreco/content'||new URL(request.url).search||new TextEncoder().encode(body).length>50000)fail();
 const token=request.headers.get('x-coreco-bridge')??'';if(token.length>3000)fail();
 const parts=token.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))fail();
 const signature=new Uint8Array(parts[1].match(/../g)!.map(x=>parseInt(x,16)));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(parts[0])))fail();
 const decode=():CorecoBridgeClaims=>{try{return JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));}catch{return fail();}};const claims=decode();
 if(!claims||claims.v!==1||!Number.isSafeInteger(claims.ts)||Math.abs(now-claims.ts)>20||claims.tenant!==config.tenant||claims.site!==config.site||claims.method!=='POST'||claims.path!=='/api/machine/coreco/content'||!['admin','editor'].includes(claims.role)||!(/^[a-f0-9-]{36}$/.test(claims.actor))||!(/^[A-Za-z0-9_-]{24,100}$/.test(claims.nonce)))fail();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(claims.body!==hash)fail();
 if(!await consume(claims.nonce,claims.ts+21))fail();
 return claims;
}
