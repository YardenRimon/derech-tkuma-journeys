import release from './site-release.json';
/** Only captured source GET/HEAD redirects. Visitor queries and hosts cannot
 * choose a destination. Checkout currently captures the source's empty cart. */
export function sourcePublicRedirect(pathname:string,method='GET'):{status:302;location:string}|null{
 if(!['GET','HEAD'].includes(method))return null;
 let path:string;try{path=decodeURIComponent(pathname);}catch{return null;}
 const redirects=(release as unknown as {redirects?:unknown}).redirects;
 if(!Array.isArray(redirects))return null;
 const row=redirects.find(item=>item?.route===path);
 if(!row)return null;
 // This is the single explicitly captured empty-cart source behavior. A real
 // checkout must dispatch its cart state before applying this source fallback.
 if(row.route!=='/checkout/'||row.status!==302||row.location!=='https://derech-tkuma.com/cart/'||Object.keys(row).sort().join(',')!=='location,route,status')throw new Error('source_redirect_policy_mismatch');
 return{status:302,location:'/cart/'};
}
