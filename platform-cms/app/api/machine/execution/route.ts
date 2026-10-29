import{env}from'cloudflare:workers';
import{POST as executionPost}from'../../execution/route';
import{CollectionError}from'@/lib/collection-core';
import{CmsError}from'@/lib/access';
import{jsonError}from'@/lib/cms';
import{forwardMachineExecution}from'./machine-request';
export const dynamic='force-dynamic';
/** Outside interactive Access routing, protected solely by the existing bounded/scoped machine HMAC protocol. */
export async function POST(request:Request){
 try{return await forwardMachineExecution(request,(env as unknown as {CMS_EXECUTION_SECRET?:string}).CMS_EXECUTION_SECRET,executionPost);}
 catch(error){const response=jsonError(error instanceof CollectionError?new CmsError(error.status,error.message):error);response.headers.set('x-robots-tag','noindex, nofollow');return response;}
}
