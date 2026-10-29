(()=>{
 const app=document.querySelector('#task-app');if(!app)return;
 const $=id=>document.getElementById(id),statuses={open:'פתוחה',in_progress:'בטיפול',waiting_info:'ממתינה למידע',blocked:'חסומה',done:'הושלמה',cancelled:'בוטלה'},categories={content_review:'שאלת תוכן',contradiction:'סתירה בתוכן',access_request:'בקשת גישה'};
 let records=[],selected='',busy=false,requestKey=null;
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const message=text=>{$('task-message').textContent=text;};
 async function api(path,body){const response=await fetch('/api/tasks'+path,{credentials:'same-origin',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'הפעולה נכשלה');return data;}
 function list(){const target=$('task-list');target.replaceChildren();const category=$('task-category').value,status=$('task-filter-status').value;const shown=records.filter(({snapshot:x})=>(!category||x.category===category)&&(!status||(status==='active'?!['done','cancelled'].includes(x.status):x.status===status)));if(!shown.length)target.append(el('p','אין משימות בתצוגה הזו. משימות יופיעו לאחר סנכרון ממערכת העבודה.'));for(const record of shown){const x=record.snapshot,button=el('button');button.type='button';button.setAttribute('aria-pressed',String(selected===x.externalId));button.append(el('strong',x.title),el('small',`${categories[x.category]} · ${statuses[x.status]} · ${x.assigneeLabel}`));button.onclick=()=>open(x.externalId);target.append(button);}}
 async function refresh(){try{records=(await api('')).records;list();message('הרשימה עודכנה.');if(selected)await open(selected);}catch(error){message(error.message);}}
 async function open(id){try{const data=await api('?id='+encodeURIComponent(id));selected=id;requestKey=null;list();detail(data);}catch(error){message(error.message);}}
 function detail({record,commands,history}){
  const target=$('task-detail'),x=record.snapshot,pending=commands.find(c=>c.state==='pending');target.replaceChildren(el('h2',x.title),el('p',`${categories[x.category]} · מצב המקור: ${statuses[x.status]} · אחראי: ${x.assigneeLabel}`));
  if(x.sourceUrl){const source=el('a','פתיחת עמוד המקור');source.href=x.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';target.append(source);}
  if(x.linkedTarget)target.append(el('p','מקום בתוכן: '+x.linkedTarget));
  if(x.quotedContent)target.append(el('h3','התוכן הקיים במקור'),el('blockquote',x.quotedContent));
  const question=el('p',x.question);question.className='task-question';target.append(el('h3','השאלה לבירור'),question);
  if(x.answer){const answer=el('p',x.answer);answer.className='task-answer';target.append(el('h3','תשובה שאושרה במערכת העבודה'),answer);}
  target.append(el('p','סנכרון אחרון: '+new Date(record.syncedAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})));
  if(pending){target.append(el('h3','תשובה הממתינה לסנכרון'),el('blockquote',pending.answer||'בקשת שינוי מצב'),el('p','מצב מבוקש: '+statuses[pending.requestedStatus]),el('p','התשובה נשמרה בממשק. טרם התקבל אישור ממערכת העבודה.'));}
  else {const form=el('form'),label=el('label','התשובה שלך'),answer=el('textarea');answer.name='answer';answer.maxLength=10000;label.append(answer);const stateLabel=el('label','מצב מבוקש'),select=el('select');select.name='status';for(const [value,text]of Object.entries(statuses)){const option=el('option',text);option.value=value;select.append(option);}select.value=x.status;stateLabel.append(select);const submit=el('button','שמירת תשובה ובקשת עדכון');submit.type='submit';form.append(label,stateLabel,submit);form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;requestKey??=crypto.randomUUID();try{await api('',{operation:'request',id:x.externalId,key:requestKey,expectedRevision:record.revision,answer:answer.value,requestedStatus:select.value});message('התשובה נשמרה וממתינה לסנכרון.');await open(x.externalId);}catch(error){message(error.message);}finally{busy=false;submit.disabled=false;}};answer.oninput=select.onchange=()=>{requestKey=null;};target.append(form);}
  const previous=commands.filter(c=>c.state!=='pending');if(previous.length){target.append(el('h3','תוצאות סנכרון'));const items=el('ul');for(const command of previous){const li=el('li',`${command.state==='accepted'?'אושרה במערכת העבודה':'נדרש בירור נוסף'}${command.resultNote?': '+command.resultNote:''}`);items.append(li);}target.append(items);}
  if(history.length){const audit=el('details'),summary=el('summary','יומן שינויים');audit.append(summary);const entries=el('ul');for(const entry of history)entries.append(el('li',`${new Date(entry.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})} · ${entry.operation==='import'?'עדכון ממערכת העבודה':'תשובה נשמרה לסנכרון'}`));audit.append(entries);target.append(audit);}
 }
 const importer=$('task-import');if(importer)importer.onchange=async()=>{
  const file=importer.files?.[0];if(!file||busy)return;
  if(file.size>2000000){message('קובץ העדכון גדול מדי');return;}
  busy=true;importer.disabled=true;
  try{
   const entries=JSON.parse(await file.text());if(!Array.isArray(entries)||entries.length>200)throw new Error('קובץ העדכון אינו תקין');
   for(const entry of entries){if(!entry.snapshot||!Number.isSafeInteger(entry.expectedRevision)||entry.expectedRevision<0)throw new Error('חסרים פרטי גרסה בקובץ');}
   let count=0;for(const entry of entries){await api('',{operation:'import',...entry});message(`עודכנו ${++count} מתוך ${entries.length} משימות`);}
   await refresh();message(`עודכנו ${entries.length} משימות ממערכת העבודה.`);
  }catch(error){message('העדכון נעצר: '+error.message);}finally{busy=false;importer.disabled=false;importer.value='';}
 };
 $('task-category').onchange=list;$('task-filter-status').onchange=list;$('tasks-refresh').onclick=refresh;refresh();
})();
