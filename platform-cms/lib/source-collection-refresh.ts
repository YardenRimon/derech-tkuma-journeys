import previousSource from '../source-pages/previous-collections-20261019.json' with { type: 'json' };
import currentSource from './current-collections.json' with { type: 'json' };
import {CollectionError,validateContent,type Actor,type Scope,type Kind,type Content,type Record as ContentRecord,type CollectionStore,type Snapshot} from './collection-core';

/** One deployment-owned, offline source transition. The caller never supplies content or scope. */
export const SOURCE_COLLECTION_SNAPSHOT='wordpress-public-20261028';
const fixedScope={tenantId:'derech',siteId:'derech-main'};
type Entry={kind:Kind;id:string;content:Content};
type Revision={kind:Kind;id:string;expectedRevision:number};
export type RefreshActor=Actor & {role:string};
type Conflict={field:string;previousSource:unknown;published:unknown;nextSource:unknown};
export type RefreshItem={kind:Kind;id:string;title:string;action:'insert'|'refresh'|'withdraw'|'unchanged'|'preserve_deleted'|'already_applied';changedFields:string[];preservedDraft:boolean;conflicts:Conflict[]};
export type RefreshPlan={sourceHash:string;snapshotId:string;expectedRevisions:Revision[];items:RefreshItem[]};
export type RefreshRequest={operation:'preview'}|{operation:'apply';sourceHash:string;expectedRevisions:Revision[]};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const key=(entry:{kind:Kind;id:string})=>entry.kind+':'+entry.id;
const entries=(source:{records:unknown[]}):Entry[]=>source.records.map(raw=>{const entry=raw as Entry;return {kind:entry.kind,id:entry.id,content:validateContent(entry.kind,entry.content)};});
const previousEntries=entries(previousSource),currentEntries=entries(currentSource);
const oldMap=new Map(previousEntries.map(entry=>[key(entry),entry]));
const newMap=new Map(currentEntries.map(entry=>[key(entry),entry]));
const targets=[...new Map([...previousEntries,...currentEntries].map(entry=>[key(entry),entry])).values()].sort((a,b)=>a.kind===b.kind?a.id.localeCompare(b.id):a.kind==='tour'?-1:1);
function authorized(scope:Scope,actor:RefreshActor){
 const knownTours=['tour:open-tour','tour:route-contact','tour:route-oz','tour:route-points'];
 const knownOld=[...knownTours,...['7681','7844','7882','7891','7899','7920'].map(id=>'occurrence:source-product-'+id)].sort();
 const knownNew=[...knownTours,...['7681','7882','7891','7899','8249','8251','8253','8255','8257'].map(id=>'occurrence:source-product-'+id)].sort();
 if(previousSource.sourceCapturedAt!=='2026-10-19T14:23:11.773970+00:00'||!currentSource.sourceCapturedAt.startsWith('2026-10-28')||!equal([...oldMap.keys()].sort(),knownOld)||!equal([...newMap.keys()].sort(),knownNew))throw new CollectionError(503,'גרסת המקור אינה תואמת לעדכון שהוכן');
 if(scope.tenantId!==fixedScope.tenantId||scope.siteId!==fixedScope.siteId||!actor.id||actor.role!=='system_admin'||!actor.canPublish)throw new CollectionError(403,'עדכון המקור מחייב מנהל מערכת מורשה באתר הזה');
}
/** Full static evidence hash; forged hashes cannot select a different seed. */
export async function sourceCollectionHash(){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({snapshotId:SOURCE_COLLECTION_SNAPSHOT,previousSource,currentSource})));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equivalent(field:string,a:unknown,b:unknown){
 if(equal(a,b))return true;
 if(typeof a!=='string'||typeof b!=='string')return false;
 if(field==='image'){
  const original=(value:string)=>{try{return decodeURIComponent(value).replace(/^\/__source_assets__\/wordpress-public-20261028\//,'/');}catch{return value;}};
  return original(a)===original(b);
 }
 if(field==='dateLabel'){
  const date=(value:string)=>{const m=/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value);return m?(m[3].length===2?'20':'')+m[3]+'-'+m[2]+'-'+m[1]:value;};
  return date(a)===date(b);
 }
 return false;
}
function draftFollowsSource(draft:Content|null,published:Content|null,old:Content|undefined){
 if(draft===null)return false;
 if(equal(draft,published))return true;
 if(!old)return false;
 const a=draft as unknown as {[key:string]:unknown},b=old as unknown as {[key:string]:unknown};
 return [...new Set([...Object.keys(a),...Object.keys(b)])].every(field=>equivalent(field,a[field],b[field]));
}
function proposal(entry:Entry,record:ContentRecord|null,sourceHash:string){
 const old=oldMap.get(key(entry)),fresh=newMap.get(key(entry));
 const sourceContent=fresh?.content??old!.content;
 const title=(sourceContent.title??'סיור פתוח')+('dateLabel' in sourceContent?' · '+sourceContent.dateLabel:'');
 const item:RefreshItem={kind:entry.kind,id:entry.id,title,action:'unchanged',changedFields:[],preservedDraft:false,conflicts:[]};
 // The source transition is applied once per record. Later ordinary CMS
 // publications and drafts inherit this trusted marker and remain authoritative.
 if(record?.sourceRefreshHash===sourceHash){item.action='already_applied';item.preservedDraft=true;return {item,published:record.published,draft:record.draft};}
 if(!fresh){
  if(!record)return {item,published:null,draft:null};
  if(record.published===null){item.action='withdraw';item.preservedDraft=true;return {item,published:null,draft:record.draft};}
  item.action='withdraw';item.changedFields=['published'];item.preservedDraft=true;
  const oldFields=old!.content as unknown as {[key:string]:unknown},published=record.published as unknown as {[key:string]:unknown};
  for(const field of new Set([...Object.keys(oldFields),...Object.keys(published)]))if(!equivalent(field,published[field],oldFields[field]))item.conflicts.push({field,previousSource:oldFields[field]??null,published:published[field]??null,nextSource:null});
  return {item,published:null,draft:record.draft};
 }
 if(!record){item.action='insert';item.changedFields=Object.keys(fresh.content);return {item,published:fresh.content,draft:fresh.content};}
 // Explicit withdrawal is a state of the existing record, not a missing source seed.
 if(record.published===null&&record.publishedVersion>0){item.action=equal(old?.content,fresh.content)?'unchanged':'preserve_deleted';item.preservedDraft=true;return {item,published:null,draft:record.draft};}
 const oldFields=(old?.content??{}) as unknown as {[key:string]:unknown};
 const newFields=fresh.content as unknown as {[key:string]:unknown};
 const currentFields=(record.published??{}) as unknown as {[key:string]:unknown};
 const merged={...currentFields};
 for(const field of new Set([...Object.keys(oldFields),...Object.keys(newFields)])){
  if(equal(oldFields[field],newFields[field]))continue;
  if(!equal(currentFields[field],newFields[field])){
   item.changedFields.push(field);
   if(!equivalent(field,currentFields[field],oldFields[field])&&!equivalent(field,currentFields[field],newFields[field]))item.conflicts.push({field,previousSource:oldFields[field]??null,published:currentFields[field]??null,nextSource:newFields[field]??null});
   if(field in newFields)merged[field]=newFields[field];else delete merged[field];
  }
 }
 // A source record saved only as a draft can be published directly in one audited CAS.
 const published=record.published===null?fresh.content:validateContent(entry.kind,merged);
 if(!equal(record.published,published)){item.action='refresh';if(record.published===null)item.changedFields=Object.keys(fresh.content);}
 const follow=draftFollowsSource(record.draft,record.published,old?.content);
 const draft=follow?published:record.draft;
 item.preservedDraft=!follow;
 if(!equal(record.draft,draft)||!equal(old?.content,fresh.content))item.action='refresh';
 return {item,published,draft};
}
function checkStored(scope:Scope,target:Entry,record:ContentRecord|null){
 if(record&&(record.tenantId!==scope.tenantId||record.siteId!==scope.siteId||record.kind!==target.kind||record.id!==target.id))throw new CollectionError(403,'הרשומה אינה שייכת להקשר המורשה');
}
async function readTargets(store:CollectionStore,scope:Scope){
 const rows:(ContentRecord|null)[]=[];
 for(const target of targets){const row=await store.get(scope,target.kind,target.id);checkStored(scope,target,row);rows.push(row);}
 return rows;
}
export async function previewSourceCollectionRefresh(store:CollectionStore,scope:Scope,actor:RefreshActor):Promise<RefreshPlan>{
 authorized(scope,actor);const rows=await readTargets(store,scope),sourceHash=await sourceCollectionHash();
 return {sourceHash,snapshotId:SOURCE_COLLECTION_SNAPSHOT,expectedRevisions:targets.map((target,index)=>({kind:target.kind,id:target.id,expectedRevision:rows[index]?.revision??0})),items:targets.map((target,index)=>proposal(target,rows[index],sourceHash).item)};
}
/** Strict envelopes make IDs/revisions a preview acknowledgement, never caller-owned source authority. */
export function sourceRefreshRequest(input:unknown):RefreshRequest{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CollectionError(400,'בקשת עדכון אינה תקינה');
 const x=input as {[key:string]:unknown};
 if(x.operation==='preview'&&Object.keys(x).join(',')==='operation')return {operation:'preview'};
 if(x.operation!=='apply'||Object.keys(x).sort().join(',')!=='expectedRevisions,operation,sourceHash'||typeof x.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(x.sourceHash)||!Array.isArray(x.expectedRevisions)||x.expectedRevisions.length!==targets.length)throw new CollectionError(400,'בקשת עדכון אינה תקינה');
 const revisions=x.expectedRevisions as Revision[];
 for(let index=0;index<targets.length;index++){
  const row=revisions[index],target=targets[index];
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='expectedRevision,id,kind'||row.id!==target.id||row.kind!==target.kind||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<0)throw new CollectionError(400,'רשימת העדכון אינה תואמת לתצוגה המקדימה');
 }
 return {operation:'apply',sourceHash:x.sourceHash,expectedRevisions:revisions};
}
export async function applySourceCollectionRefresh(store:CollectionStore,scope:Scope,actor:RefreshActor,input:unknown){
 authorized(scope,actor);const request=sourceRefreshRequest(input);
 if(request.operation!=='apply')throw new CollectionError(400,'יש להציג את העדכון לפני החלתו');
 const sourceHash=await sourceCollectionHash();
 if(request.sourceHash!==sourceHash)throw new CollectionError(409,'מקור האתר השתנה, הצג את העדכון מחדש');
 const rows=await readTargets(store,scope);
 if(rows.some((record,index)=>(record?.revision??0)!==request.expectedRevisions[index].expectedRevision))throw new CollectionError(409,'התוכן השתנה, הצג את העדכון מחדש');
 // Reject unavailable related tours before the first mutation; each later CAS
 // still checks the actual scoped publication to catch concurrent withdrawal.
 for(let index=0;index<targets.length;index++){
  const target=targets[index],value=proposal(target,rows[index],sourceHash);
  if(target.kind!=='occurrence'||!value.published||!['insert','refresh'].includes(value.item.action))continue;
  const tourId=(value.published as {tourId:string}).tourId,tourIndex=targets.findIndex(entry=>entry.kind==='tour'&&entry.id===tourId);
  const tour=tourIndex<0?null:proposal(targets[tourIndex],rows[tourIndex],sourceHash);
  if(!tour?.published)throw new CollectionError(409,'הסיור המקושר הוסר מהתצוגה; יש להשיב אותו לפני עדכון המועדים');
 }
 const applied:RefreshItem[]=[],unchanged:RefreshItem[]=[];
 for(let index=0;index<targets.length;index++){
  const target=targets[index],previous=rows[index],nextValue=proposal(target,previous,sourceHash),item=nextValue.item;
  if(item.action==='unchanged'||item.action==='already_applied'){unchanged.push(item);continue;}
  // Related source tours are installed first. Never borrow a tour from another scope.
  if(target.kind==='occurrence'&&nextValue.published){
   const tourId=(nextValue.published as {tourId:string}).tourId,tour=await store.get(scope,'tour',tourId);
   if(!tour||tour.tenantId!==scope.tenantId||tour.siteId!==scope.siteId||!tour.published)return {complete:false,applied,unchanged,staleRecord:{kind:'tour',id:tourId},message:'הסיור המקושר השתנה. חלק מהעדכון עשוי להישמר; הצג את העדכון מחדש להמשך בטוח.'};
  }
  const now=new Date().toISOString();
  const next:ContentRecord={...scope,id:target.id,kind:target.kind,revision:(previous?.revision??0)+1,draft:structuredClone(nextValue.draft),published:structuredClone(nextValue.published),publishedVersion:(previous?.publishedVersion??0)+(equal(previous?.published??null,nextValue.published)?0:1),updatedAt:now,updatedBy:actor.id,sourceRefreshHash:sourceHash};
  const audit:Snapshot={version:next.revision,operation:'source_refresh',record:structuredClone(next),actorId:actor.id,at:now,sourceRefresh:{snapshotId:SOURCE_COLLECTION_SNAPSHOT,sourceHash,changedFields:item.changedFields,preservedDraft:item.preservedDraft,conflicts:item.conflicts}};
  if(!await store.commit(previous,next,audit))return {complete:false,applied,unchanged,staleRecord:{kind:target.kind,id:target.id},message:'חלק מהעדכון נשמר. תוכן נוסף השתנה; הצג את העדכון מחדש להמשך בטוח.'};
  applied.push(item);
 }
 return {complete:true,applied,unchanged,staleRecord:null,message:'תוכן המקור עודכן. טיוטות עצמאיות והיסטוריה נשמרו.'};
}
