import release from '@/lib/site-release.json';
export function GET(){
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
 // Keep original canonical identities in this review inventory. No fake lastmod.
 return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+release.canonicals.filter((url):url is string=>typeof url==='string').map(url=>`<url><loc>${escape(url)}</loc></url>`).join('')+'</urlset>',{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
