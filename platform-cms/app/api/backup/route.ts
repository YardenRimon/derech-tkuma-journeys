import {env} from 'cloudflare:workers';
import {getD1,getBucket} from '@/lib/cms';
import {siteScope} from '@/lib/site-scope';
import release from '@/lib/site-release.json';
import {BackupError,verifyBackupSignature,backupRequest,assertBackupScope,exportBackup,sha256} from '@/lib/backup-core';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store, private','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};
export async function POST(request:Request){try{
 const config=env as unknown as {CMS_BACKUP_SECRET?:string;CMS_BACKUP_BUCKET_SCOPE?:string;CMS_ADAPTER_MODE?:string};
 if(config.CMS_ADAPTER_MODE!=='isolated-d1'||config.CMS_BACKUP_BUCKET_SCOPE!=='deployment-isolated')throw new BackupError(503,'Isolated backup storage is not configured');
 const url=new URL(request.url);if(url.search)throw new BackupError(400,'Backup query parameters are not supported');
 if(Number(request.headers.get('content-length')??0)>2048)throw new BackupError(413,'Backup request is too large');
 const reader=request.body?.getReader(),parts:Uint8Array[]=[];let length=0;
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048){await reader.cancel();throw new BackupError(413,'Backup request is too large');}parts.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}const raw=new TextDecoder().decode(bytes);
 await verifyBackupSignature(raw,request.headers.get('x-backup-time'),request.headers.get('x-backup-signature'),config.CMS_BACKUP_SECRET,url.pathname);
 let body;try{body=JSON.parse(raw);}catch{throw new BackupError(400,'Invalid backup JSON');}
 const scope=siteScope(),operation=backupRequest(body,scope),db=getD1();await assertBackupScope(db,scope);
 if(operation.operation==='snapshot')return Response.json(await exportBackup(db,getBucket(),scope,release),{headers});
 const object=await getBucket().get(operation.key,{onlyIf:{etagMatches:operation.etag}});
 if(!object||!('body'in object)||object.etag!==operation.etag)throw new BackupError(409,'Backup object changed or is missing');
 if(object.size>5*1024*1024)throw new BackupError(507,'Backup object exceeds supported upload bound');
 const content=new Uint8Array(await object.arrayBuffer());
 return new Response(content,{headers:{...headers,'content-type':'application/octet-stream','content-length':String(content.length),'x-content-sha256':await sha256(content),'x-backup-etag':object.etag}});
 }catch(error){const known=error instanceof BackupError;return Response.json({error:known?error.message:'Backup unavailable; no partial snapshot returned'},{status:known?error.status:503,headers});}}
