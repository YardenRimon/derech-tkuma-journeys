document.addEventListener('click',async event=>{
 const button=event.target.closest('button[data-effect-key]');if(!button)return;
 if(!confirm('לשחזר את הטיוטה למצב שלפני העדכון? ההיסטוריה תישמר והתוכן הציבורי לא ישתנה.'))return;
 const status=document.getElementById('execution-status');button.disabled=true;
 try{const response=await fetch('/api/execution',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'rollback',effectKey:button.dataset.effectKey,expectedRevision:Number(button.dataset.revision)})});const result=await response.json();if(!response.ok)throw Error(result.error||'השחזור לא הושלם');location.reload();}
 catch(error){status.textContent=error.message;button.disabled=false;}
});
