/** Node-only test fixture. Never imported by Worker production modules.
 * Incremental node:crypto stand-in; actual Workerd tests use native DigestStream.
 */
import {createHash} from 'node:crypto';
export function installNodeDigestStreamFixture(){
 if(typeof crypto.DigestStream==='function')return;
 class NodeTestDigestStream extends WritableStream{
  constructor(algorithm){if(algorithm!=='SHA-256')throw new Error('fixture_algorithm');const hash=createHash('sha256');let complete,fail;const result=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});super({write(bytes){hash.update(bytes);},close(){complete(Uint8Array.from(hash.digest()).buffer);},abort(reason){fail(reason);}});this.digest=result;}
 }
 Object.defineProperty(crypto,'DigestStream',{configurable:true,value:NodeTestDigestStream});
}
