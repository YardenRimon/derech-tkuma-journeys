/** Run the captured UI scripts in original parser order.
 * Native defer can let jQuery ready fire before the later Pro handlers register.
 * Retain original handlers/configuration, module semantics and review guards.
 */
export function prepareReviewRuntime(html:string):string{
 const prepared=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attributes:string,body:string)=>{
  if(body.includes('class RocketLazyLoadScripts'))return '<!-- review: native script loading replaces the source cache replay loader -->';
  const promoted=/\btype="text\/rocketlazyloadscript"/.test(attributes);
  const moduleType=/\b(?:data-rocket-)?type="module"/.test(attributes);
  let attrs=attributes;
  if(promoted)attrs=attrs.replace(/\s*type="text\/rocketlazyloadscript"/,'').replace(/\s*data-rocket-type="[^"]*"/,'').replace(/\bdata-rocket-src=/,'src=').replace(/\s+data-rocket-defer\b/g,'')+(moduleType?' type="module"':'');
  if(!moduleType&&/\bsrc\s*=\s*["']\/(?!\/)/i.test(attrs))attrs=attrs.replace(/\s+(?:defer|async)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,'');
  return attrs===attributes?whole:'<script'+attrs+'>'+body+'</script>';
 });
 // Keep the original guard and source scripts in order; the local module has
 // no provider/network dispatcher and cannot bypass the review guard.
 const visitorScript='<script type="module" src="/visitor-policy.js" data-visitor-policy="review"></script>';
 return prepared.includes('src="/visitor-policy.js"')?prepared:prepared.replace(/<\/head\s*>/i,visitorScript+'</head>');
}
