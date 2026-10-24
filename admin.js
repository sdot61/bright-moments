const cfg=window.BRIGHT_MOMENTS_SUPABASE||{};
const $=id=>document.getElementById(id);
const show=(id,on)=>$(id).hidden=!on;
let client=null,photos=[],categories=[],selected=new Set(),viewSection="gallery",viewCategory="all",draggedId=null,savingReorder=false;
const say=(id,message)=>$(id).textContent=message;
// Keep editor sessions across refreshes; expire after 24 hours with no owner activity.
const IDLE_DURATION_MS=24*60*60*1000;
const LAST_ACTIVITY_KEY='bright-moments-owner-last-activity-v1';
let currentAdminId=null,lastActivityWrite=0,logoutInProgress=false,recoveryMode=false;
const signInButton=$('signin').querySelector('button');
const isRecoveryRedirect=()=>{
 const hash=new URLSearchParams(location.hash.slice(1));
 const query=new URLSearchParams(location.search);
 return hash.get('type')==='recovery'||query.get('type')==='recovery'||query.has('code');
};
function readLastActivity(){
 try{
  const record=JSON.parse(localStorage.getItem(LAST_ACTIVITY_KEY)||'null');
  return record&&typeof record.userId==='string'&&Number.isFinite(record.at)?record:null;
 }catch{return null;}
}
function saveLastActivity(userId){
 const now=Date.now();
 localStorage.setItem(LAST_ACTIVITY_KEY,JSON.stringify({userId,at:now}));
 lastActivityWrite=now;
}
function clearEditorAccess(){
 currentAdminId=null;
 selected.clear();
 show('editor',false);
 show('login',true);
}
async function stopEditing(expired=false){
 if(logoutInProgress)return;
 logoutInProgress=true;
 clearEditorAccess();
 localStorage.removeItem(LAST_ACTIVITY_KEY);
 try{
  if(client){
   const {error}=await client.auth.signOut({scope:'local'});
   if(error)console.warn('Supabase sign-out did not finish:',error);
  }
 }catch(error){console.warn('Supabase sign-out error:',error)}
 finally{
  logoutInProgress=false;
  if(expired)say('message','Your session expired after 24 hours without activity. Please sign in again.');
 }
}
function idleCheck(){
 if(!currentAdminId)return false;
 const record=readLastActivity(),now=Date.now();
 if(!record||record.userId!==currentAdminId||record.at>now||now-record.at>=IDLE_DURATION_MS){
  void stopEditing(true);
  return false;
 }
 return true;
}
function recordUserActivity(){
 if(!idleCheck())return;
 if(Date.now()-lastActivityWrite>=15000)saveLastActivity(currentAdminId);
}
for(const eventName of ['pointerdown','pointermove','keydown','wheel','touchstart','scroll']){
 document.addEventListener(eventName,recordUserActivity,{passive:true});
}
setInterval(()=>{if(currentAdminId)idleCheck()},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentAdminId)idleCheck()});
window.addEventListener('focus',()=>{if(currentAdminId)idleCheck()});
window.addEventListener('storage',event=>{
 if(event.key===LAST_ACTIVITY_KEY&&currentAdminId)idleCheck();
});
if(!cfg.url||!cfg.publishableKey){
 say('message','Setup pending: connect the Supabase project and add its public URL and publishable key to supabase-config.js.');
 signInButton.disabled=true;
}else{
 client=supabase.createClient(cfg.url,cfg.publishableKey,{
  auth:{detectSessionInUrl:true,autoRefreshToken:true,persistSession:true,storageKey:'bright-moments-owner-session-v1'}
 });
 client.auth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY'){recoveryMode=true;recoverForm();}
  else if(event==='SIGNED_OUT'){clearEditorAccess();}
 });
 if(!isRecoveryRedirect()){
  signInButton.disabled=true;
  restoreAdminSession().catch(error=>say('message','Could not restore your session: '+error.message))
  .finally(()=>{signInButton.disabled=false});
 }
}
async function restoreAdminSession(){
 const {data:{session},error}=await client.auth.getSession();
 if(error)throw error;
 if(!session){localStorage.removeItem(LAST_ACTIVITY_KEY);return;}
 const record=readLastActivity(),now=Date.now();
 if(!record||record.userId!==session.user.id||record.at>now||now-record.at>=IDLE_DURATION_MS){
  await stopEditing(true);
  return;
 }
 currentAdminId=session.user.id;
 lastActivityWrite=record.at;
 await checkAuth();
}
async function checkAuth(){
 if(!currentAdminId||!idleCheck())return;
 const {data:{user},error:userError}=await client.auth.getUser();
 if(userError||!user||user.id!==currentAdminId){await stopEditing();return;}
 const result=await client.from('site_admins').select('user_id').eq('user_id',user.id).maybeSingle();
 if(result.error||!result.data){
  await stopEditing();
  say('message','This account is not authorized to manage Bright Moments.');
  return;
 }
 if(!idleCheck())return;
 show('login',false);
 show('editor',true);
 await loadCategories();
 await loadPhotos();
 cleanPendingStorageFiles().then(result=>{if(result.pending)say('status','Some previously deleted Supabase image files are awaiting cleanup. They will be retried.');}).catch(error=>console.warn('Could not retry pending storage cleanup',error));
}
$('signin').addEventListener('submit',async event=>{
 event.preventDefault();
 if(!client)return;
 signInButton.disabled=true;
 say('message','Signing in…');
 try{
  const {data,error}=await client.auth.signInWithPassword({
   email:$('email').value.trim(),password:$('password').value
  });
  if(error)throw error;
  if(!data.user)throw Error('No user returned from the sign-in request.');
  currentAdminId=data.user.id;
  saveLastActivity(currentAdminId);
  say('message','');
  await checkAuth();
 }catch(error){say('message','Could not sign in. Please check your credentials.');}
 finally{signInButton.disabled=false;}
});
$('forgot').addEventListener('click',async()=>{
if(!client)return;
const email=$('email').value.trim();
if(!email){say('message','Enter your account email first.');return;}
const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
say('message',error?error.message:'If this account exists, a password-reset email will be sent.');
});
function recoverForm(){
show('login',true);show('editor',false);
$('signin').hidden=true;$('forgot').hidden=true;
let form=document.getElementById('recover');
if(!form){form=document.createElement('form');form.id='recover';form.innerHTML='<label>New password (at least 12 characters)<input type="password" minlength="12" required autocomplete="new-password"></label><button type="submit">Save new password</button>'; $('login').append(form);
form.addEventListener('submit',async e=>{e.preventDefault();const {error}=await client.auth.updateUser({password:form.querySelector('input').value});say('message',error?error.message:'Password updated. You can now sign in.');if(!error){form.remove();$('signin').hidden=false;$('forgot').hidden=false;await client.auth.signOut();}});
}
say('message','Enter your new password.');
}
$('logout').addEventListener('click',()=>{void stopEditing()});
const bucket='bright-moments-images';
function url(path){if(path.startsWith('github:'))return 'https://raw.githubusercontent.com/sdot61/bright-moments/main/'+path.slice(7).split('/').map(encodeURIComponent).join('/');return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;}
async function loadPhotos(keepSelection=false){
const {data,error}=await client.from('gallery_images').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:true});
if(error){say('status',error.message);return;}
photos=data||[];if(!keepSelection)selected.clear();render();
}
function render(){
const container=$('images');container.replaceChildren();
for(const p of visiblePhotos()){
const article=document.createElement('article');article.className='item';article.dataset.photoId=p.id;article.draggable=selected.has(p.id);article.tabIndex=0;if(selected.has(p.id))article.classList.add('selected');
const photo=document.createElement('div');photo.className='photo';
const img=document.createElement('img');img.src=url(p.file_path);img.alt=p.title;img.loading='lazy';
const button=document.createElement('button');button.className='check';button.type='button';button.textContent='✓';button.setAttribute('aria-label','Select '+p.title);button.setAttribute('aria-pressed',String(selected.has(p.id)));
button.onclick=()=>{if(selected.has(p.id))selected.delete(p.id);else selected.add(p.id);const on=selected.has(p.id);button.textContent='✓';button.setAttribute('aria-pressed',String(on));article.classList.toggle('selected',on);article.draggable=on;};
attachReorderEvents(article,p.id);
photo.append(img,button);
const title=document.createElement('h3');title.textContent=p.title;
const meta=document.createElement('p');meta.textContent=p.section+' · '+(categories.find(c=>c.slug===p.category)?.label||p.category);
article.append(photo,title,meta);container.append(article);
}
if(!container.children.length)container.textContent='No photographs in this selection yet.';
}
async function optimize(file){
const bitmap=await createImageBitmap(file);
const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Image conversion failed')),'image/jpeg',.83));
}
$('upload').addEventListener('submit',async e=>{
e.preventDefault();if(!client)return;
const files=Array.from($('files').files);say('status','Uploading '+files.length+' photograph(s)…');
for(const file of files){try{
const blob=await optimize(file);
const path=crypto.randomUUID()+'.jpg';
const {error:uploadError}=await client.storage.from(bucket).upload(path,blob,{contentType:'image/jpeg',upsert:false});
if(uploadError)throw uploadError;
const {error:dbError}=await client.from('gallery_images').insert({file_path:path,title:file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' '),section:$('section').value,category:$('category').value,sort_order:photos.length});
if(dbError){await client.storage.from(bucket).remove([path]);throw dbError;}signalGalleryChange();
}catch(error){say('status','Upload error: '+error.message);return;}}
say('status','Photographs uploaded.');$('files').value='';await loadPhotos();
});

const GALLERY_CHANGE_KEY='bright-moments-gallery-updated-v1';
const galleryChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('bright-moments-gallery'):null;
function signalGalleryChange(){
 try{
  galleryChannel?.postMessage({type:'gallery-changed'});
  localStorage.setItem(GALLERY_CHANGE_KEY,String(Date.now()));
 }catch(error){console.warn('Could not notify other open gallery tabs',error);}
}
// The DB trigger records storage files whenever their gallery entries are deleted.
// This keeps failed file cleanups recoverable on the next owner sign-in.
async function cleanPendingStorageFiles(){
 if(!client||!currentAdminId||!idleCheck())return {removed:0,pending:0};
 const {data,error}=await client.from('gallery_storage_cleanup')
  .select('file_path').order('queued_at',{ascending:true}).limit(500);
 if(error)throw error;
 const pending=(data||[]).map(p=>p.file_path);
 let removed=0,failed=0;
 for(let i=0;i<pending.length;i+=100){
  const batch=pending.slice(i,i+100);
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   const response=await client.storage.from(bucket).remove(batch);
   lastError=response.error;
   if(!lastError)break;
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
  }
  if(lastError){failed+=batch.length;console.warn('Storage cleanup queued for retry',lastError);continue;}
  const {error:queueError}=await client.from('gallery_storage_cleanup')
   .delete().in('file_path',batch);
  if(queueError){failed+=batch.length;console.warn('Could not mark storage cleanup complete',queueError);}
  else removed+=batch.length;
 }
 return {removed,pending:failed};
}
let deletingPhotos=false;
async function removeSelected(){
 if(!client||!currentAdminId||!idleCheck()||deletingPhotos)return;
 const chosen=photos.filter(p=>selected.has(p.id));
 if(!chosen.length){say('status','Select at least one photograph first.');return;}
 if(!confirm('Permanently remove '+chosen.length+' selected photograph(s) from Bright Moments?'))return;
 deletingPhotos=true;
 const deleteButton=$('delete');deleteButton.disabled=true;
 say('status','Deleting selected photographs…');
 try{
  const {data:deleted,error}=await client.from('gallery_images')
   .delete().in('id',chosen.map(p=>p.id)).select('id,file_path');
  if(error)throw error;
  const deletedRows=deleted||[];
  if(!deletedRows.length)throw Error('No photos were deleted. Please check your permissions.');
  // Change the editor immediately after the successful database deletion.
  const deletedIds=new Set(deletedRows.map(p=>p.id));
  photos=photos.filter(p=>!deletedIds.has(p.id));
  for(const id of deletedIds)selected.delete(id);
  render();
  signalGalleryChange();
  // GitHub-backed photos have no Supabase Storage object, only a metadata record.
  // Supabase-backed photos are queued by a database trigger for actual file deletion.
  let result;
  try{result=await cleanPendingStorageFiles();}
  catch(error){console.warn('Gallery file cleanup will be retried later',error);result={removed:0,pending:1};}
  if(result.pending){
   say('status',deletedRows.length+' photo(s) removed from the website. Supabase file cleanup is pending and will retry on the next editor sign-in.');
  }else{
   say('status',deletedRows.length+' photo(s) removed from the editor and public gallery.'+
    (result.removed?' '+result.removed+' Supabase file(s) permanently deleted.':''));
  }
 }catch(error){
  say('status','Deletion failed; photos have not been removed: '+error.message);
 }finally{
  deletingPhotos=false;
  deleteButton.disabled=false;
 }
}
$('delete').addEventListener('click',removeSelected);
$('rename').addEventListener('click',async()=>{
const chosen=photos.filter(p=>selected.has(p.id));
if(chosen.length!==1){say('status','Select exactly one photograph to rename.');return;}
const title=prompt('New photo title:',chosen[0].title);
if(title===null)return;
if(!title.trim()||title.trim().length>160){say('status','Please enter a title between 1 and 160 characters.');return;}
const {error}=await client.from('gallery_images').update({title:title.trim()}).eq('id',chosen[0].id);
if(error)say('status',error.message);else{signalGalleryChange();await loadPhotos();}
});

function visiblePhotos(){
 return photos.filter(p=>p.section===viewSection&&(viewCategory==='all'||p.category===viewCategory))
  .sort((a,b)=>a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at));
}

const palette=['#f2a277','#c9b4dc','#e9a4a9','#f2d36b','#b6d6a0'];
function changeCategory(next){
 viewCategory=next;
 selected.clear();
 document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.category===next)));
 render();
}
function changeSection(next){
 viewSection=next;
 selected.clear();
 document.querySelectorAll('[data-section]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.section===next)));
 render();
}
async function loadCategories(){
 const {data,error}=await client.from('gallery_categories').select('slug,label,color,sort_order').order('sort_order').order('label');
 if(error){say('tabMessage','Could not load tabs: '+error.message);return;}
 categories=data||[];
 const nav=document.querySelector('.secondary');
 nav.replaceChildren();
 const all=document.createElement('button');all.type='button';all.dataset.category='all';all.textContent='All';all.style.backgroundColor='#b6d6a0';
 all.addEventListener('mouseenter',()=>changeCategory('all'));
 all.addEventListener('click',()=>changeCategory('all'));nav.append(all);
 const dropdown=$('category');const previous=dropdown.value;
 dropdown.replaceChildren();
 for(const c of categories){
  const option=document.createElement('option');option.value=c.slug;option.textContent=c.label;dropdown.add(option);
  const button=document.createElement('button');button.type='button';button.dataset.category=c.slug;button.textContent=c.label;
  button.style.backgroundColor=/^#[0-9a-fA-F]{6}$/.test(c.color)?c.color:'#b6d6a0';
  button.addEventListener('mouseenter',()=>changeCategory(c.slug));
  button.addEventListener('click',()=>changeCategory(c.slug));
  nav.append(button);
 }
 if(categories.some(c=>c.slug===previous))dropdown.value=previous;
 if(viewCategory!=='all'&&!categories.some(c=>c.slug===viewCategory))viewCategory='all';
 nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.category===viewCategory)));
}
$('createTab').addEventListener('submit',async e=>{
 e.preventDefault();
 const input=$('newTabName'),label=input.value.trim().replace(/\s+/g,' ');
 if(!label||label.length>40){say('tabMessage','Please enter a tab name of 1–40 characters.');return;}
 const slug=label.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48).replace(/-$/,'');
 if(!slug){say('tabMessage','Please use a name containing letters or numbers.');return;}
 if(categories.some(c=>c.slug===slug||c.label.toLowerCase()===label.toLowerCase())){
  say('tabMessage','A tab with that name already exists.');return;
 }
 const button=$('createTab').querySelector('button');button.disabled=true;
 say('tabMessage','Creating the tab…');
 try{
  const order=categories.length?Math.max(...categories.map(c=>c.sort_order))+10:10;
  const color=palette[categories.length%palette.length];
  const {error}=await client.from('gallery_categories').insert({slug,label,sort_order:order,color});
  if(error)throw error;
  input.value='';
  signalGalleryChange();
  await loadCategories();
  $('category').value=slug;
  changeCategory(slug);
  say('tabMessage','Created '+label+'. The new tab is available in the public gallery and upload menu.');
 }catch(error){say('tabMessage','Could not create tab: '+error.message)}
 finally{button.disabled=false;}
});

let touchDrag=null;
function highlightDrop(id){
 document.querySelectorAll('.item.drag-target').forEach(el=>el.classList.remove('drag-target'));
 if(!id)return;
 const item=Array.from(document.querySelectorAll('.item')).find(el=>el.dataset.photoId===id);
 if(item)item.classList.add('drag-target');
}
function dragCleanup(){
 draggedId=null;touchDrag=null;highlightDrop(null);
 document.body.classList.remove('reordering');
}
function attachReorderEvents(article,id){
 article.addEventListener('dragstart',event=>{
  if(!selected.has(id)){event.preventDefault();return;}
  draggedId=id;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',id);
  document.body.classList.add('reordering');
 });
 article.addEventListener('dragover',event=>{
  if(!draggedId)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';highlightDrop(id);
 });
 article.addEventListener('drop',event=>{
  if(!draggedId)return;
  event.preventDefault();const source=draggedId;dragCleanup();
  if(source!==id)reorderSelected(source,id);
 });
 article.addEventListener('dragend',dragCleanup);
 article.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'||!selected.has(id)||event.target.closest('button'))return;
  touchDrag={id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,target:null,active:false};
  article.setPointerCapture(event.pointerId);
 });
 article.addEventListener('pointermove',event=>{
  if(!touchDrag||touchDrag.pointerId!==event.pointerId||touchDrag.id!==id)return;
  if(!touchDrag.active&&Math.hypot(event.clientX-touchDrag.startX,event.clientY-touchDrag.startY)<8)return;
  touchDrag.active=true;event.preventDefault();
  document.body.classList.add('reordering');
  const under=document.elementFromPoint(event.clientX,event.clientY)?.closest('.item');
  touchDrag.target=under?.dataset.photoId||null;
  highlightDrop(touchDrag.target);
 });
 article.addEventListener('pointerup',event=>{
  if(!touchDrag||touchDrag.pointerId!==event.pointerId||touchDrag.id!==id)return;
  const target=touchDrag.target,active=touchDrag.active;dragCleanup();
  if(active&&target&&target!==id)reorderSelected(id,target);
 });
 article.addEventListener('pointercancel',dragCleanup);
 article.addEventListener('keydown',event=>{
  if(!selected.has(id)||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();
  const ordered=visiblePhotos();const n=ordered.findIndex(p=>p.id===id);
  const next=ordered[n+(event.key==='ArrowLeft'?-1:1)];
  if(next)reorderSelected(id,next.id);
 });
}

async function reorderSelected(draggedPhotoId,targetId){
 const visible=visiblePhotos();
 const from=visible.findIndex(p=>p.id===draggedPhotoId);
 const to=visible.findIndex(p=>p.id===targetId);
 if(from<0||to<0||from===to||!selected.has(draggedPhotoId))return;
 const rearranged=visible.slice();
 const moving=rearranged.filter(p=>selected.has(p.id));
 const target=rearranged[to];
 if(selected.has(target.id))return;
 if(moving.length===1&&Math.abs(to-from)===1){
  [rearranged[from],rearranged[to]]=[rearranged[to],rearranged[from]];
 }else{
  const remaining=rearranged.filter(p=>!selected.has(p.id));
  const targetIndex=remaining.findIndex(p=>p.id===target.id);
  const insertAt=targetIndex+(to>from?1:0);
  remaining.splice(insertAt,0,...moving);
  rearranged.splice(0,rearranged.length,...remaining);
 }
 const full=photos.filter(p=>p.section===viewSection).slice().sort((a,b)=>a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at));
 const visibleIds=new Set(visible.map(p=>p.id));
 let j=0;
 const reorderedFull=full.map(p=>visibleIds.has(p.id)?rearranged[j++]:p);
 if(savingReorder)return;
 savingReorder=true;
 say('status','Saving the new photo order…');
 try{
  const {error}=await client.rpc('reorder_bright_moments_images',{image_ids:reorderedFull.map(p=>p.id)});
  if(error)throw error;
  signalGalleryChange();
  await loadPhotos(true);
  say('status','Photo order saved. The public gallery will use the new order when refreshed.');
 }catch(error){say('status','Could not save the new order: '+error.message);await loadPhotos(true);}
 finally{savingReorder=false;}
}

document.querySelectorAll('[data-section]').forEach(button=>{
 const change=()=>changeSection(button.dataset.section);
 button.addEventListener('mouseenter',change);button.addEventListener('click',change);
});
