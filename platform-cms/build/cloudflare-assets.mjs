/** Generated browser chunks are not in Vinext's publicFiles set. With worker-first
 * routing they must reach ASSETS explicitly, before the App Router's 404 path.
 * This deliberately does not act as a fallback for admin, API or public routes.
 * @param {Request} request
 * @param {{ASSETS?: {fetch: (request: Request) => Promise<Response>}}} env
 * @returns {Promise<Response|null>}
 */
export async function serveCloudflareBuildAsset(request,env){
 const pathname=new URL(request.url).pathname;
 if(!pathname.startsWith('/_next/static/'))return null;
 if(!/^\/_next\/static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(pathname))return new Response('Not Found',{status:404});
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD'}});
 if(!env.ASSETS)return new Response('Build assets unavailable',{status:503});
 return env.ASSETS.fetch(request);
}
