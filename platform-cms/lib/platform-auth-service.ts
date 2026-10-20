import{FLOW_COOKIE,PlatformAuthError,PlatformCookieJar,appendPlatformAuthCookies,assertAuthMutation,authCode,authEmailOtpCode,authFailure,authUuid,exactAuthFields,normalizeAuthEmail,randomAuthState,readAuthJson,safeAuthReturnTo,verifiedPlatformIdentity}from'./platform-auth-core';
import type{ManagedAuthProvider,ManagedFactor,PlatformAuthConfig,PlatformIdentity,PlatformProviderFactory}from'./platform-auth-core';
export type PlatformAuthLimiter=(request:Request,action:string,actor?:string)=>Promise<void>;
export const platformAuthMessages:Record<string,string>={auth_unavailable:'שירות ההתחברות אינו זמין כרגע',method_unavailable:'כניסה בקוד במייל תהיה זמינה לאחר חיבור דומיין המערכת',invalid_request:'פרטי הבקשה אינם תקינים',csrf_rejected:'יש לרענן את עמוד ההתחברות ולנסות שוב',credentials_invalid:'לא ניתן להתחבר באמצעות הפרטים האלה',otp_invalid:'הקוד שגוי או שפג תוקפו',mfa_invalid:'קוד האימות הנוסף שגוי או שפג תוקפו',mfa_required:'נדרש אימות נוסף כדי להיכנס לניהול',rate_limited:'בוצעו ניסיונות רבים. נסה שוב בעוד כמה דקות',unauthenticated:'יש להתחבר מחדש',mfa_already_enrolled:'כבר מוגדר אימות נוסף לחשבון',callback_failed:'ההתחברות לא הושלמה. נסה שוב',password_update_failed:'לא ניתן לשמור את הסיסמה. התחבר מחדש ונסה שוב'};
export type AuthServiceOptions={config:PlatformAuthConfig;providerFactory:PlatformProviderFactory;limiter:PlatformAuthLimiter;now?:()=>number};
function json(value:unknown,status=200){return Response.json(value,{status});}
function errorResponse(error:unknown){const known=error instanceof PlatformAuthError?error:new PlatformAuthError(503,'auth_unavailable');return json({...(known.code==='auth_unavailable'?{configured:false}:{}),error:{code:known.code,message:platformAuthMessages[known.code]??platformAuthMessages.auth_unavailable}},known.status);}
export function platformAuthUnavailable(){return appendPlatformAuthCookies(errorResponse(new PlatformAuthError(503,'auth_unavailable')),[]);}
async function factors(provider:ManagedAuthProvider):Promise<ManagedFactor[]>{const result=await provider.mfa.listFactors();if(result.error||!Array.isArray(result.data?.all))return authFailure(503,'auth_unavailable');return result.data.all.filter(item=>item.factor_type==='totp'&&(item.status==='verified'||item.status==='unverified'));}
async function ownFactor(provider:ManagedAuthProvider,value:unknown){const id=authUuid(value),all=await factors(provider);const factor=all.find(item=>item.id===id);if(!factor)return authFailure(400,'invalid_request');return factor;}
async function loginResult(provider:ManagedAuthProvider,config:PlatformAuthConfig,returnTo:unknown,now:number){const identity=await verifiedPlatformIdentity(provider,config,false,now);return{authenticated:true,identity,mfaRequired:identity.aal!=='aal2',returnTo:safeAuthReturnTo(returnTo)};}
/** All provider exceptions are redacted. No password/token/challenge/TOTP secret
 * is logged, put in URLs, echoed in an error, or returned as a browser session. */
export async function handlePlatformAuth(request:Request,options:AuthServiceOptions):Promise<Response>{
 let jar:PlatformCookieJar|undefined;let response:Response;
 const{config,providerFactory,limiter}=options,now=options.now??Date.now;
 try{
  if(new URL(request.url).origin!==config.origin)return authFailure(403,'csrf_rejected');
  jar=new PlatformCookieJar(request.headers.get('cookie'));
  const url=new URL(request.url),callback=url.pathname==='/auth/callback/'||url.pathname==='/auth/callback',action=url.pathname.replace(/^\/api\/auth\//,'').replace(/\/$/,'');
  if(callback){
   if(request.method!=='GET')return authFailure(405,'invalid_request');
   await limiter(request,'oauth-callback');
   const state=url.searchParams.get('state'),code=url.searchParams.get('code');
   if(url.searchParams.has('error')||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!state||!/^[a-f0-9]{64}$/.test(state)||!code||code.length>2048||/[\u0000-\u0020\u007f]/.test(code)||!jar.hasVerifier())return authFailure(401,'callback_failed');
   let flow:{state:string;returnTo:string;at:number};try{flow=JSON.parse(jar.get(FLOW_COOKIE)??'null');if(!flow||flow.state!==state||typeof flow.at!=='number'||now()-flow.at>600000||flow.at>now()+60000)throw 0;flow.returnTo=safeAuthReturnTo(flow.returnTo);}catch{return authFailure(401,'callback_failed');}
   jar.set(FLOW_COOKIE,'',0);
   const provider=providerFactory(config,jar);try{const exchange=await provider.exchangeCodeForSession(code);if(exchange.error)return authFailure(401,'callback_failed');}finally{jar.clearFlow();}
   const identity=await verifiedPlatformIdentity(provider,config,false,now());
   const location=identity.aal==='aal2'?flow.returnTo:'/login/?mfa=required&next='+encodeURIComponent(flow.returnTo);
   response=new Response(null,{status:303,headers:{location}});
  }else if(action==='session'&&request.method==='GET'){
   await limiter(request,'session');const csrfToken=jar.csrf(),provider=providerFactory(config,jar);let identity:PlatformIdentity|null=null;
   try{identity=await verifiedPlatformIdentity(provider,config,false,now());}catch(error){if(!(error instanceof PlatformAuthError)||error.status!==401)throw error;jar.clearAuth();}
   const methods={google:true,password:true,emailOtp:config.emailOtpReady===true};
   if(!identity)response=json({configured:true,authenticated:false,csrfToken,methods});
   else response=json({configured:true,authenticated:true,csrfToken,methods,identity,mfaRequired:identity.aal!=='aal2',factors:(await factors(provider)).map(item=>({id:item.id,friendlyName:item.friendly_name??'אפליקציית אימות',status:item.status}))});
  }else{
   const allowed=['password','password/set','otp/send','otp/verify','oauth/google','logout','mfa/enroll','mfa/challenge','mfa/verify'];
   if(!allowed.includes(action)||request.method!=='POST')return authFailure(405,'invalid_request');
   assertAuthMutation(request,config,jar);const input=await readAuthJson(request);
   const fields:Record<string,string[]>={password:['email','password','returnTo'],'password/set':['password'],'otp/send':['email','returnTo'],'otp/verify':['email','token','returnTo'],'oauth/google':['returnTo'],logout:[],'mfa/enroll':[],'mfa/challenge':['factorId'],'mfa/verify':['factorId','challengeId','code','returnTo']};exactAuthFields(input,fields[action]);
   // Validate navigation before touching provider or sending an email.
   if('returnTo'in input)safeAuthReturnTo(input.returnTo);
   // Sender-domain readiness is an explicit deployment capability. A disabled
   // method cannot contact Auth/mail or return an accepted/sent receipt.
   if((action==='otp/send'||action==='otp/verify')&&config.emailOtpReady!==true)return authFailure(503,'method_unavailable');
   // Bound requests before even attempting token refresh or remote identity
   // verification. Per-account/subject limits below add an independent bucket.
   await limiter(request,'request/'+action);
   const provider=providerFactory(config,jar);
   if(action==='password'){
    const email=normalizeAuthEmail(input.email);if(typeof input.password!=='string'||input.password.length<1||input.password.length>1024)return authFailure(400,'invalid_request');await limiter(request,action,email);
    if((await provider.signInWithPassword({email,password:input.password})).error)return authFailure(401,'credentials_invalid');response=json(await loginResult(provider,config,input.returnTo,now()));
   }else if(action==='password/set'){
    const identity=await verifiedPlatformIdentity(provider,config,true,now());await limiter(request,action,identity.userId);
    if(typeof input.password!=='string'||input.password.length<12||input.password.length>1024)return authFailure(400,'invalid_request');
    if((await provider.updateUser({password:input.password})).error)return authFailure(400,'password_update_failed');response=json({passwordUpdated:true});
   }else if(action==='otp/send'){
    const email=normalizeAuthEmail(input.email);await limiter(request,action,email);await provider.signInWithOtp({email,options:{shouldCreateUser:false}});
    // Uniform anti-enumeration receipt: not proof that mail was delivered.
    response=json({sent:true},202);
   }else if(action==='otp/verify'){
    const email=normalizeAuthEmail(input.email),token=authEmailOtpCode(input.token);await limiter(request,action,email);if((await provider.verifyOtp({email,token,type:'email'})).error)return authFailure(401,'otp_invalid');response=json(await loginResult(provider,config,input.returnTo,now()));
   }else if(action==='oauth/google'){
    await limiter(request,action);jar.clearFlow();const state=randomAuthState(),returnTo=safeAuthReturnTo(input.returnTo),redirectTo=new URL('/auth/callback/',config.origin);redirectTo.searchParams.set('state',state);
    const result=await provider.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo.href,skipBrowserRedirect:true}});if(result.error||!result.data?.url)return authFailure(503,'auth_unavailable');
    const destination=new URL(result.data.url);if(destination.origin!==config.url||destination.pathname!=='/auth/v1/authorize'||destination.searchParams.get('provider')!=='google'||destination.searchParams.get('redirect_to')!==redirectTo.href||destination.searchParams.get('code_challenge_method')!=='s256'||!/^[A-Za-z0-9_-]{43}$/.test(destination.searchParams.get('code_challenge')??'')||!jar.hasVerifier())return authFailure(503,'auth_unavailable');
    jar.set(FLOW_COOKIE,JSON.stringify({state,returnTo,at:now()}),600);response=json({redirectUrl:destination.href});
   }else if(action==='logout'){
    await limiter(request,action);try{await provider.signOut({scope:'local'});}finally{jar.clearAuth();}response=json({signedOut:true});
   }else{
    const identity=await verifiedPlatformIdentity(provider,config,false,now());await limiter(request,action,identity.userId);
    if(action==='mfa/enroll'){
     const own=await factors(provider);if(own.some(factor=>factor.status==='verified'))return authFailure(409,'mfa_already_enrolled');
     // Unverified enrollments cannot authenticate. Clean only our own abandoned
     // setup so reloading an enrollment does not strand the user at the limit.
     for(const pending of own.filter(factor=>factor.status==='unverified'&&factor.friendly_name==='Platform CMS'))if((await provider.mfa.unenroll({factorId:pending.id})).error)return authFailure(503,'auth_unavailable');
     const result=await provider.mfa.enroll({factorType:'totp',friendlyName:'Platform CMS',issuer:'Yarden Platform'});if(result.error||!result.data?.totp)return authFailure(503,'auth_unavailable');const totp=result.data.totp;
     if(typeof totp.qr_code!=='string'||totp.qr_code.length>60000||!totp.qr_code.startsWith('data:image/svg+xml')||typeof totp.secret!=='string'||totp.secret.length>200||typeof totp.uri!=='string'||!totp.uri.startsWith('otpauth://totp/'))return authFailure(503,'auth_unavailable');
     response=json({factorId:authUuid(result.data.id),qrCode:totp.qr_code,secret:totp.secret,uri:totp.uri});
    }else if(action==='mfa/challenge'){
     const factor=await ownFactor(provider,input.factorId),result=await provider.mfa.challenge({factorId:factor.id});if(result.error||!result.data?.id)return authFailure(401,'mfa_invalid');response=json({challengeId:authUuid(result.data.id)});
    }else{
     const factor=await ownFactor(provider,input.factorId),challengeId=authUuid(input.challengeId),code=authCode(input.code);if((await provider.mfa.verify({factorId:factor.id,challengeId,code})).error)return authFailure(401,'mfa_invalid');const result=await loginResult(provider,config,input.returnTo,now());if(result.identity.aal!=='aal2')return authFailure(403,'mfa_required');response=json(result);
    }
   }
  }
 }catch(error){response=errorResponse(error);if(error instanceof PlatformAuthError&&error.code==='unauthenticated')jar?.clearAuth();}
 return appendPlatformAuthCookies(response,jar?.pending()??[]);
}
export async function readVerifiedPlatformIdentity(request:Request,config:PlatformAuthConfig,providerFactory:PlatformProviderFactory,options:{requireAal2?:boolean}={requireAal2:true}){
 let jar:PlatformCookieJar|undefined;
 try{
  if(new URL(request.url).origin!==config.origin)return authFailure(401,'unauthenticated');
  jar=new PlatformCookieJar(request.headers.get('cookie'));const identity=await verifiedPlatformIdentity(providerFactory(config,jar),config,options.requireAal2!==false);
  return{identity,cookiesToSet:jar.pending()};
 }catch(error){
  const failure=error instanceof PlatformAuthError?error:new PlatformAuthError(503,'auth_unavailable');
  if(failure.status===401)jar?.clearAuth();failure.cookiesToSet=jar?.pending()??[];throw failure;
 }
}
