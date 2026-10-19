(()=>{
 const $=id=>document.getElementById(id),kind=$('collection-kind'),form=$('record-form'),fields=$('record-fields'),status=$('record-status');
 const definitions={tour:[['title','שם הסיור'],['slug','כתובת קצרה לסיור'],['description','תיאור','textarea'],['image','תמונת הסיור','image'],['imageAlt','תיאור התמונה']],occurrence:[['tourId','הסיור','tour'],['startsAt','תחילת הסיור'],['endsAt','סיום הסיור'],['meetingPoint','נקודת מפגש'],['priceMinor','מחיר בש״ח','price'],['capacity','מספר משתתפים מרבי','number']]};
 let current=null,working=false,tours=[];
 const message=text=>{status.textContent=text;};
 const call=async(query='',body)=>{const response=await fetch(`/api/collections/${kind.value}${query}`,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'הפעולה נכשלה');return data;};
 async function loadTours(){if(kind.value!=='occurrence')return;const response=await fetch('/api/collections/tour',{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'טעינת הסיורים נכשלה');tours=data.records.filter(x=>x.draft);}
 function tourName(id){const row=tours.find(x=>x.id===id);return row?.draft?.title||row?.published?.title||'הסיור';}
 function dateLabel(iso){try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'}).format(new Date(iso));}catch{return 'מועד שהוסר';}}
 function label(row){const content=row.draft||row.published;if(kind.value==='tour')return content?.title||'טיוטה שהוסרה';return content?`${tourName(content.tourId)} · ${dateLabel(content.startsAt)}`:'מועד שהוסר';}
 function render(record){current=record;fields.replaceChildren();$('record-versions').replaceChildren();$('record-id').value=record?.id||crypto.randomUUID();
  const data=record?.draft||{};for(const [key,label,type]of definitions[kind.value]){
   const holder=document.createElement('label');holder.className='admin-field';holder.textContent=label;
   let input;
   if(type==='tour'){
    input=document.createElement('select');const choose=document.createElement('option');choose.value='';choose.textContent='בחר סיור';input.append(choose);
    for(const row of tours){const option=document.createElement('option');option.value=row.id;option.textContent=row.draft.title||row.published?.title||'סיור ללא שם';input.append(option);}
   }else input=document.createElement(type==='textarea'?'textarea':'input');
   input.name=key;
   if(type==='number'||type==='price'){input.type='number';input.min=type==='price'?'0':'1';input.step=type==='price'?'0.01':'1';}
   input.value=type==='price'?(data[key]===undefined?'':String(data[key]/100)):(data[key]??'');
   if(type==='image'){
    input.type='hidden';const preview=document.createElement('img');preview.alt=data.imageAlt||'תצוגת תמונת הסיור';preview.style.maxWidth='160px';preview.hidden=!input.value;if(input.value)preview.src=input.value;
    const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;if(file.size>5*1024*1024){message('יש לבחור תמונה עד 5MB');return;}upload.disabled=true;try{const response=await fetch('/api/cms/upload',{method:'POST',credentials:'same-origin',headers:{'content-type':file.type},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'העלאת התמונה נכשלה');input.value=result.url;preview.src=result.url;preview.hidden=false;message('התמונה עלתה. שמור את הטיוטה כדי לצרף אותה לסיור.');}catch(e){message(e.message);}finally{upload.disabled=false;}};
    holder.append(preview,upload,input);
   }else{holder.append(input);if(key==='startsAt'||key==='endsAt'){input.dir='ltr';input.placeholder='2027-01-01T10:00:00+02:00';const hint=document.createElement('small');hint.textContent='תאריך ושעה בישראל עם הפרש UTC: לדוגמה ‎2027-01-01T10:00:00+02:00. בקיץ ההפרש הוא ‎+03:00. אין המרת שעון אוטומטית בשלב זה.';holder.append(hint);}}
   fields.append(holder);
  }
  message(record?`גרסה ${record.revision} · פרסום ${record.publishedVersion}${record.draft===null?' · טיוטה שהוסרה':''}`:'רשומה חדשה');
 }
 async function refresh(){const {records}=await call();const list=$('record-list');list.replaceChildren();for(const row of records){const button=document.createElement('button');button.type='button';button.textContent=label(row);button.onclick=()=>render(row);list.append(button);}}
 async function act(operation,extra={}){if(working)return;working=true;form.querySelectorAll('button').forEach(x=>x.disabled=true);try{const result=await call('',{id:$('record-id').value,operation,expectedRevision:current?.revision??0,...extra});render(result.record);await refresh();message(operation==='publish'?'פורסם ונשמר':'הטיוטה נשמרה');}catch(e){message(e.message);}finally{working=false;form.querySelectorAll('button').forEach(x=>x.disabled=false);}}
 form.onsubmit=e=>{e.preventDefault();const content={};for(const [key,,type]of definitions[kind.value]){const value=form.elements.namedItem(key).value;if(type==='price'){if(!/^\d+(?:\.\d{1,2})?$/.test(value)){message('יש להזין מחיר בשקלים, עם עד שתי ספרות אחרי הנקודה');return;}content[key]=Math.round(Number(value)*100);}else content[key]=type==='number'?Number(value):value;}if(kind.value==='occurrence'){content.timezone='Asia/Jerusalem';content.currency='ILS';}act('save',{content});};
 $('record-new').onclick=()=>render(null);$('record-publish').onclick=()=>act('publish');$('record-delete').onclick=()=>act('delete');
 $('record-history').onclick=async()=>{try{if(!current)return;const {history}=await call(`?id=${encodeURIComponent(current.id)}&history=1`);const list=$('record-versions');list.replaceChildren();for(const item of history){const button=document.createElement('button');button.type='button';button.textContent=`שחזור גרסה ${item.version} לטיוטה (${dateLabel(item.at)})`;button.onclick=()=>act('restore',{version:item.version});list.append(button);}}catch(e){message(e.message);}};
 kind.onchange=async()=>{try{await loadTours();render(null);await refresh();}catch(e){message(e.message);}};render(null);refresh().catch(e=>message(e.message));
})();
