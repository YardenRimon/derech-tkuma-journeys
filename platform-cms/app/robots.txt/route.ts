export function GET(){
 // Allow crawling of review HTML so its noindex directive can be observed.
 return new Response('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth-required\n',{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
