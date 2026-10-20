/** Shared managed identity boundary. Authentication never grants tenant membership. */
export type PlatformAuthConfig={url:string;publishableKey:string;origin:string;emailOtpReady:boolean};
export const PLATFORM_AUTH_PROJECT_URL='https://uawcxvkekfqxosfblpxr.supabase.co';
export type PlatformIdentity={userId:string;email:string;displayName:string;fullName:string|null;aal:'aal1'|'aal2'};
export type CookieValue={name:string;value:string;options?:{maxAge?:number;expires?:Date;path?:string;domain?:string;httpOnly?:boolean;secure?:boolean;sameSite?:string|boolean}};
export const AUTH_COOKIE='__Host-platform-auth',CSRF_COOKIE='__Host-platform-csrf',FLOW_COOKIE='__Host-platform-auth-flow-state';
export class PlatformAuthError extends Error{
 status:number;code:string;cookiesToSet:string[];
 constructor(status:number,code:string,cookiesToSet:string[]=[]){super(code);this.name='PlatformAuthError';this.status=status;this.code=code;this.cookiesToSet=cookiesToSet;}
}
export const authFailure=(status:number,code:string):never=>{throw new PlatformAuthError(status,code);};
export function platformAuthConfig(env:Record<string,unknown>):PlatformAuthConfig{
 const url=env.PLATFORM_AUTH_SUPABASE_URL,key=env.PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY,origin=env.PLATFORM_AUTH_ORIGIN;
 if(url!==PLATFORM_AUTH_PROJECT_URL||typeof key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{12,200}$/.test(key)||typeof origin!=='string')return authFailure(503,'auth_unavailable');
 try{const parsed=new URL(origin);if(parsed.origin!==origin||parsed.protocol!=='https:'||parsed.username||parsed.password)throw 0;}catch{return authFailure(503,'auth_unavailable');}
 return{url,publishableKey:key,origin,emailOtpReady:env.PLATFORM_AUTH_EMAIL_OTP_READY==='true'};
}
export function safeAuthReturnTo(value:unknown):string{
 if(value===undefined||value===null||value==='')return'/admin/';
 if(typeof value!=='string'||value.length>2048||/[\\\u0000-\u0020\u007f]/.test(value))return authFailure(400,'invalid_request');
 try{const decoded=decodeURIComponent(value.split(/[?#]/)[0]);if(decoded.includes('//')||decoded.includes('\\')||/[\u0000-\u0020\u007f]/.test(decoded))throw 0;const parsed=new URL(value,'https://auth.invalid');if(parsed.origin!=='https://auth.invalid'||!(parsed.pathname==='/admin'||parsed.pathname.startsWith('/admin/')))throw 0;return parsed.pathname+parsed.search;}catch{return authFailure(400,'invalid_request');}
}
export function normalizeAuthEmail(value:unknown):string{
 if(typeof value!=='string')return authFailure(400,'invalid_request');const email=value.trim().toLowerCase();if(email.length>254||!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email))return authFailure(400,'invalid_request');return email;
}
export function authUuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))return authFailure(400,'invalid_request');return value;}
export function authCode(value:unknown):string{if(typeof value!=='string'||!/^\d{6}$/.test(value))return authFailure(400,'invalid_request');return value;}
/** Managed project email OTPs are eight digits; authenticator TOTP stays six. */
export function authEmailOtpCode(value:unknown):string{if(typeof value!=='string'||!/^\d{8}$/.test(value))return authFailure(400,'invalid_request');return value;}
export class PlatformCookieJar{
 private values=new Map<string,string>();private changes=new Map<string,string>();
 constructor(header:string|null){
  if((header?.length??0)>24000)return authFailure(400,'invalid_request');
  for(const part of(header??'').split(';')){const index=part.indexOf('=');if(index<0)continue;const name=part.slice(0,index).trim();if(!this.allowed(name))continue;if(this.values.has(name))return authFailure(400,'invalid_request');if(this.values.size>=32)return authFailure(400,'invalid_request');try{const value=decodeURIComponent(part.slice(index+1).trim());if(value.length>12000)throw 0;this.values.set(name,value);}catch{return authFailure(400,'invalid_request');}}
 }
 private allowed(name:string){return name===CSRF_COOKIE||/^__Host-platform-auth(?:[-.][A-Za-z0-9_.-]{1,120})?$/.test(name);}
 get(name:string){return this.values.get(name);}
 getAll(){return[...this.values].map(([name,value])=>({name,value}));}
 setAll(items:CookieValue[]){for(const item of items)this.set(item.name,item.value,item.options?.maxAge===0?0:item.options?.maxAge);}
 set(name:string,value:string,maxAge?:number){
  if(!this.allowed(name)||typeof value!=='string'||value.length>12000)return authFailure(503,'auth_unavailable');
  const duration=maxAge===0?0:name.includes('code-verifier')||name===FLOW_COOKIE?600:28800;
  if(duration===0)this.values.delete(name);else this.values.set(name,value);
  this.changes.set(name,`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${duration}; Secure; HttpOnly; SameSite=Lax`);
 }
 clearAuth(){for(const name of this.values.keys())if(name.startsWith(AUTH_COOKIE))this.set(name,'',0);}
 clearFlow(){for(const name of this.values.keys())if(name===FLOW_COOKIE||name.includes('code-verifier'))this.set(name,'',0);}
 hasVerifier(){return this.getAll().some(item=>item.name.startsWith(AUTH_COOKIE)&&item.name.includes('code-verifier')&&item.value.length>0);}
 csrf(){let value=this.get(CSRF_COOKIE);if(!value||!/^[a-f0-9]{64}$/.test(value)){value=randomAuthState();this.set(CSRF_COOKIE,value);}return value;}
 pending(){return[...this.changes.values()];}
}
export function randomAuthState(){return[...crypto.getRandomValues(new Uint8Array(32))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function sameValue(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let index=0;index<a.length;index++)difference|=a.charCodeAt(index)^b.charCodeAt(index);return difference===0;}
export function assertAuthMutation(request:Request,config:PlatformAuthConfig,jar:PlatformCookieJar){
 const origin=request.headers.get('origin'),fetchSite=request.headers.get('sec-fetch-site'),token=request.headers.get('x-platform-auth-csrf'),expected=jar.get(CSRF_COOKIE);
 if(request.method!=='POST'||new URL(request.url).origin!==config.origin||origin!==config.origin||(fetchSite&&fetchSite!=='same-origin')||!token||!expected||!/^[a-f0-9]{64}$/.test(token)||!sameValue(token,expected))return authFailure(403,'csrf_rejected');
}
export async function readAuthJson(request:Request):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return authFailure(400,'invalid_request');
 const reader=request.body?.getReader();if(!reader)return authFailure(400,'invalid_request');let total=0;const chunks:Uint8Array[]=[];
 for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>8192){await reader.cancel();return authFailure(413,'invalid_request');}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result))throw 0;return result as Record<string,unknown>;}catch{return authFailure(400,'invalid_request');}
}
export function exactAuthFields(input:Record<string,unknown>,allowed:string[]){if(Object.keys(input).some(key=>!allowed.includes(key)))return authFailure(400,'invalid_request');}
export type ManagedUser={id:string;email?:string;email_confirmed_at?:string;is_anonymous?:boolean;user_metadata?:Record<string,unknown>};
export type ManagedFactor={id:string;factor_type:string;status:string;friendly_name?:string};
type Result<T>={data:T|null;error:unknown};
export type ManagedAuthProvider={
 getSession():Promise<Result<{session:{access_token:string}|null}>>;
 getUser(token:string):Promise<Result<{user:ManagedUser|null}>>;
 signInWithPassword(input:{email:string;password:string}):Promise<{error:unknown}>;
 updateUser(input:{password:string}):Promise<{error:unknown}>;
 signInWithOtp(input:{email:string;options:{shouldCreateUser:false}}):Promise<{error:unknown}>;
 verifyOtp(input:{email:string;token:string;type:'email'}):Promise<{error:unknown}>;
 signInWithOAuth(input:{provider:'google';options:{redirectTo:string;skipBrowserRedirect:true}}):Promise<Result<{url:string|null}>>;
 exchangeCodeForSession(code:string):Promise<{error:unknown}>;
 signOut(input:{scope:'local'}):Promise<{error:unknown}>;
 mfa:{
  listFactors():Promise<Result<{all:ManagedFactor[]}>>;
  enroll(input:{factorType:'totp';friendlyName:string;issuer:string}):Promise<Result<{id:string;totp:{qr_code:string;secret:string;uri:string}}>>;
  unenroll(input:{factorId:string}):Promise<{error:unknown}>;
  challenge(input:{factorId:string}):Promise<Result<{id:string}>>;
  verify(input:{factorId:string;challengeId:string;code:string}):Promise<{error:unknown}>;
 };
};
export type PlatformProviderFactory=(config:PlatformAuthConfig,jar:PlatformCookieJar)=>ManagedAuthProvider;
/** getSession supplies transport material only. Trust starts with remote getUser
 * for THIS token; claims are inspected only after that authoritative verification. */
export async function verifiedPlatformIdentity(provider:ManagedAuthProvider,config:PlatformAuthConfig,requireAal2=false,now=Date.now()):Promise<PlatformIdentity>{
 const session=await provider.getSession();const token=session.data?.session?.access_token;if(session.error||typeof token!=='string'||token.length>20000)return authFailure(401,'unauthenticated');
 const result=await provider.getUser(token);const user=result.data?.user;if(result.error||!user||user.is_anonymous||typeof user.id!=='string'||!user.id||typeof user.email!=='string'||!user.email_confirmed_at)return authFailure(401,'unauthenticated');
 let claims:Record<string,unknown>,header:Record<string,unknown>;
 try{const pieces=token.split('.');if(pieces.length!==3||pieces.some(piece=>!piece||!/^[A-Za-z0-9_-]+$/.test(piece)))throw 0;const decode=(value:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0))));header=decode(pieces[0]);claims=decode(pieces[1]);if(!header||typeof header!=='object'||Array.isArray(header)||!claims||typeof claims!=='object'||Array.isArray(claims))throw 0;}catch{return authFailure(401,'unauthenticated');}
 let email:string;try{email=normalizeAuthEmail(user.email);authUuid(user.id);}catch{return authFailure(401,'unauthenticated');}const aal=claims.aal;
 if(!['ES256','RS256','HS256'].includes(String(header.alg))||claims.iss!==config.url+'/auth/v1'||claims.aud!=='authenticated'||claims.sub!==user.id||!Number.isFinite(Date.parse(user.email_confirmed_at))||typeof claims.email!=='string'||claims.email.toLowerCase()!==email||typeof claims.exp!=='number'||!Number.isFinite(claims.exp)||claims.exp*1000<=now||typeof claims.iat!=='number'||!Number.isFinite(claims.iat)||claims.iat*1000>now+60000||claims.exp<=claims.iat||('nbf'in claims&&(typeof claims.nbf!=='number'||!Number.isFinite(claims.nbf)||claims.nbf*1000>now))||(aal!=='aal1'&&aal!=='aal2'))return authFailure(401,'unauthenticated');
 if(requireAal2&&aal!=='aal2')return authFailure(403,'mfa_required');
 const name=user.user_metadata?.full_name;const fullName=typeof name==='string'&&name.length<=200?name:null;
 return{userId:user.id,email,displayName:fullName??email,fullName,aal};
}
export function appendPlatformAuthCookies(response:Response,cookiesToSet:string[]):Response{
 const result=new Response(response.body,response);for(const cookie of cookiesToSet)result.headers.append('set-cookie',cookie);
 result.headers.set('cache-control','private, no-store, max-age=0');result.headers.set('pragma','no-cache');result.headers.set('expires','0');result.headers.set('x-robots-tag','noindex, nofollow');result.headers.set('referrer-policy','no-referrer');result.headers.set('x-content-type-options','nosniff');result.headers.append('vary','Cookie');return result;
}
