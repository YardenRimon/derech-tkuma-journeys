/** The current cache defers all UI scripts behind a WordPress cache replay loader.
 * In the independent review document use native ordered defer instead. Keep the
 * original UI implementations/configuration and all review submission guards.
 */
export function prepareReviewRuntime(html:string):string{
 return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attributes:string,body:string)=>{
  if(body.includes('class RocketLazyLoadScripts'))return '<!-- review: native script loading replaces the source cache replay loader -->';
  if(!/\btype="text\/rocketlazyloadscript"/.test(attributes))return whole;
  const moduleType=/\bdata-rocket-type="module"/.test(attributes);
  const attrs=attributes.replace(/\s*type="text\/rocketlazyloadscript"/,'').replace(/\s*data-rocket-type="[^"]*"/,'').replace(/\bdata-rocket-src=/,'src=').replace(/\s+data-rocket-defer\b/g,'');
  return '<script'+attrs+(moduleType?' type="module"':'')+'>'+body+'</script>';
 });
}
