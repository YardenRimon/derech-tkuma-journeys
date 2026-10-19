import type{Plugin}from'vite';
import{readFileSync}from'node:fs';
import{brotliCompressSync,brotliDecompressSync,constants}from'node:zlib';
/** Lossless standalone transport, not a content transform. Sites keeps its native JSON import. */
export function compressedSourcePages():Plugin{
 const virtual='\0derech:verified-source-pages';
 return{name:'derech-lossless-source-pages',enforce:'pre',
  resolveId(source){if(source==='@/lib/generated-pages.json'||source.replaceAll('\\','/').endsWith('/lib/generated-pages.json'))return virtual;},
  load(id){if(id!==virtual)return;const source=readFileSync(new URL('../lib/generated-pages.json',import.meta.url)),packed=brotliCompressSync(source,{params:{[constants.BROTLI_PARAM_QUALITY]:7}});
   if(!brotliDecompressSync(packed).equals(source))throw new Error('Lossless source packing verification failed');
   return `import{brotliDecompressSync}from"node:zlib";import{Buffer}from"node:buffer";const bytes=brotliDecompressSync(Buffer.from(${JSON.stringify(packed.toString('base64'))},"base64"));export default JSON.parse(bytes.toString("utf8"));`;
  }
 };
}
