import {productionRelease,productionRobots} from '@/lib/visitor-release';
export function GET(request?:Request){
 const profile=request?productionRelease(new URL(request.url)):null;if(profile&&new URL(request!.url).origin===profile.origin)return new Response(productionRobots(profile),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-derech-public-profile':profile.sourceCommit}});
 // Allow crawling of review HTML so its noindex directive can be observed.
 return new Response('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth-required\n',{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
