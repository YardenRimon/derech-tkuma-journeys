import {productionRelease,visitorConfiguration} from '@/lib/visitor-release';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),profile=productionRelease(url),headers={'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'};
 if(!profile||url.origin!==profile.origin||url.search)return new Response('Not found',{status:404,headers});
 return Response.json(visitorConfiguration(profile),{headers});
}
