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
function showReadyPage(){document.body.dataset.authState='ready';}
let authRedirectType=(()=>{
 const hash=new URLSearchParams(location.hash.slice(1));
 const query=new URLSearchParams(location.search);
 const type=hash.get('type')||query.get('type');
 if(type==='recovery')return 'recovery';
 if(type==='invite')return 'invite';
 // OAuth/PKCE verification may return an authorization code.
 if(query.has('code'))return 'invite';
 return null;
})();
const isRecoveryRedirect=()=>authRedirectType!==null;
function readLastActivity(){
 try{
  const record=JSON.parse(localStorage.getItem(LAST_ACTIVITY_KEY)||'null');
  return record&&typeof record.userId==='string'&&Number.isFinite(record.at)?record:null;
 }catch{return null;}
}
function saveLastActivity(userId,when=Date.now()){
 const at=Number(when);
 try{localStorage.setItem(LAST_ACTIVITY_KEY,JSON.stringify({userId,at}));}
 catch(error){console.warn('Cannot persist editor activity locally',error);}
 lastActivityWrite=at;
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
 showReadyPage();
}else{
 client=supabase.createClient(cfg.url,cfg.publishableKey,{
  auth:{detectSessionInUrl:true,autoRefreshToken:true,persistSession:true,storageKey:'bright-moments-owner-session-v1'}
 });
 client.auth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY'){recoveryMode=true;recoverForm('recovery');}
  else if(event==='SIGNED_IN'&&authRedirectType==='invite'){recoverForm('invite');}
  else if(event==='SIGNED_OUT'){clearEditorAccess();}
 });
 if(!isRecoveryRedirect()){
  signInButton.disabled=true;
  restoreAdminSession().catch(error=>{
   console.warn('Could not restore editor session',error);
   say('message','Could not restore your session. Please sign in again.');
   clearEditorAccess();
  }).finally(()=>{signInButton.disabled=false;showReadyPage()});
 }else{
  // Password-reset redirects are handled by Supabase's recovery callback.
  setTimeout(()=>{if(document.body.dataset.authState==='checking'){
   showReadyPage();say('message','The password-reset link could not be verified. You can request a new one.');
  }},6000);
 }
}
async function restoreAdminSession(){
 let {data:{session},error}=await client.auth.getSession();
 if(error)throw error;
 // Upgrade a session created by the earlier editor without forcing another login.
 if(!session){
  try{
   const legacyKey='sb-'+new URL(cfg.url).hostname.split('.')[0]+'-auth-token';
   const old=JSON.parse(localStorage.getItem(legacyKey)||'null');
   if(old?.access_token&&old?.refresh_token){
    const {data,migrationError,error:upgradeError}=await client.auth.setSession({
     access_token:old.access_token,refresh_token:old.refresh_token
    });
    if(!migrationError&&!upgradeError&&data?.session){
     session=data.session;
     localStorage.removeItem(legacyKey);
    }
   }
  }catch(error){console.warn('Legacy editor session could not be restored',error);}
 }
 if(!session){
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  clearEditorAccess();
  return;
 }
 const record=readLastActivity(),now=Date.now(),id=session.user.id;
 let lastUsed=record?.userId===id?record.at:null;
 if(lastUsed===null){
  // For existing users upgraded from the older login scheme, use the Auth
  // session's verified last sign-in time rather than discarding a live session.
  const signInAt=Date.parse(session.user.last_sign_in_at||'');
  const sessionStart=Number(session.created_at)*1000;
  const baseline=Number.isFinite(signInAt)?signInAt:sessionStart;
  if(Number.isFinite(baseline)&&baseline>0&&baseline<=now){
   lastUsed=baseline;
   saveLastActivity(id,baseline);
  }
 }
 if(lastUsed===null||lastUsed>now||now-lastUsed>=IDLE_DURATION_MS){
  await stopEditing(true);
  return;
 }
 currentAdminId=id;
 lastActivityWrite=lastUsed;
 await checkAuth();
}
async function checkAuth(){
 if(!currentAdminId||!idleCheck())return;
 const {data:{user},error:userError}=await client.auth.getUser();
 if(userError||!user||user.id!==currentAdminId){await stopEditing();return;}
 const result=await client.from('site_admins').select('user_id').eq('user_id',user.id).maybeSingle();
 if(result.error||!result.data){
  const {data:request}=await client.from('editor_access_requests').select('status').eq('user_id',user.id).maybeSingle();
  await stopEditing();
  if(request?.status==='pending')say('message','Your invitation was received, but editor access was not activated. Please contact the site owner.');
  else if(request?.status==='denied')say('message','Your editing access has been revoked.');
  else say('message','This account is not authorized to manage Bright Moments.');
  return;
 }
 if(!idleCheck())return;
 show('login',false);
 show('editor',true);
 await loadCategories();
 await loadPhotos();
 await loadAccessRequests();
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
function recoverForm(kind='recovery'){
 showReadyPage();
 show('login',true);
 show('editor',false);
 $('signin').hidden=true;
 $('forgot').hidden=true;
 const heading=$('login').querySelector('h2');
 if(heading)heading.textContent=kind==='invite'?'Create your Bright Moments password':'Reset your Bright Moments password';
 let form=$('recover');
 if(!form){
  form=document.createElement('form');
  form.id='recover';
  const label=document.createElement('label');
  label.textContent='New password (at least 12 characters)';
  const field=document.createElement('input');
  field.type='password';field.minLength=12;field.required=true;field.autocomplete='new-password';
  const button=document.createElement('button');
  button.type='submit';button.textContent='Set password';
  label.append(field);form.append(label,button);
  $('login').append(form);
  form.addEventListener('submit',async e=>{
   e.preventDefault();
   const button=form.querySelector('button');
   button.disabled=true;
   const password=form.querySelector('input').value;
   if(password.length<12){say('message','Please use a password of at least 12 characters.');button.disabled=false;return;}
   const {error}=await client.auth.updateUser({password});
   if(error){say('message',error.message);button.disabled=false;return;}
   form.remove();
   $('signin').hidden=false;
   $('forgot').hidden=false;
   if(heading)heading.textContent='Owner sign in';
   localStorage.removeItem(LAST_ACTIVITY_KEY);
   history.replaceState(null,'',location.pathname);
   authRedirectType=null;
   await client.auth.signOut({scope:'local'});
   clearEditorAccess();
   say('message','Password saved. Sign in with your email and new password.');
  });
 }
 say('message',kind==='invite'?'Invitation verified. Choose a password to activate your editor account.':'Choose a new password.');
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
const article=document.createElement('article');article.className='item';article.dataset.photoId=p.id;article.tabIndex=0;article.setAttribute('role','button');article.setAttribute('aria-label','Select or move '+p.title);article.setAttribute('aria-pressed',String(selected.has(p.id)));if(selected.has(p.id))article.classList.add('selected');
const photo=document.createElement('div');photo.className='photo';
const img=document.createElement('img');img.src=url(p.file_path);img.alt=p.title;img.loading='lazy';img.draggable=false;
const indicator=document.createElement('span');indicator.className='check';indicator.setAttribute('aria-hidden','true');indicator.textContent=selected.has(p.id)?'✓':'';
attachReorderEvents(article,p.id);
photo.append(img,indicator);
const title=document.createElement('h3');title.textContent=p.title;title.className='editable-photo-title';title.tabIndex=0;title.setAttribute('role','button');title.setAttribute('aria-label','Edit title: '+p.title);title.setAttribute('title','Edit title');title.addEventListener('click',event=>{event.stopPropagation();editPhotoTitle(title,p);});title.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();editPhotoTitle(title,p);}});
const meta=document.createElement('p');meta.textContent=p.section+' · '+(categories.find(c=>c.slug===p.category)?.label||p.category);
article.append(photo,title,meta);container.append(article);
}
if(!container.children.length)container.textContent='No photographs in this selection yet.';
}
function editPhotoTitle(heading,photo){
 if(heading.dataset.editing==='true')return;
 heading.dataset.editing='true';
 const original=photo.title;
 const input=document.createElement('input');
 input.type='text';input.className='photo-title-input';input.maxLength=160;
 input.required=true;input.value=original;input.setAttribute('aria-label','Photograph title');
 heading.replaceWith(input);
 input.focus();input.select();
 let finished=false;
 const restore=(name)=>{
  photo.title=name;
  heading.textContent=name;
  heading.setAttribute('aria-label','Edit title: '+name);
  delete heading.dataset.editing;
  input.replaceWith(heading);
 };
 const save=async()=>{
  if(finished)return;
  const name=input.value.trim();
  if(!name||name.length>160){say('status','Photo titles must be between 1 and 160 characters.');input.focus();return;}
  finished=true;input.disabled=true;
  if(name!==original){
   const {error}=await client.from('gallery_images').update({title:name}).eq('id',photo.id);
   if(error){finished=false;input.disabled=false;say('status','Could not save title: '+error.message);input.focus();return;}
   signalGalleryChange();
   say('status','Photograph title saved.');
  }
  restore(name);
 };
 input.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.key==='Enter'){event.preventDefault();void save();}
  if(event.key==='Escape'){event.preventDefault();finished=true;restore(original);}
 });
 input.addEventListener('pointerdown',event=>event.stopPropagation());
 input.addEventListener('blur',()=>{if(!finished)void save()});
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

function visiblePhotos(){
 return photos.filter(p=>p.section===viewSection&&(viewCategory==='all'||p.category===viewCategory))
  .sort((a,b)=>a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at));
}


let movingImages=false;
let moveNoticeTimer=null;
function endMoveMode(){
 movingImages=false;
 document.body.classList.remove('moving-images');
 $('moveImage').setAttribute('aria-pressed','false');
}
function showMoveRibbon(message){
 let banner=$('moveConfirmation');
 if(!banner){
  banner=document.createElement('div');
  banner.id='moveConfirmation';
  banner.setAttribute('role','status');
  banner.setAttribute('aria-live','polite');
  banner.hidden=true;
  document.body.append(banner);
 }
 banner.textContent=message;
 if(moveNoticeTimer)clearTimeout(moveNoticeTimer);
 banner.hidden=false;
 moveNoticeTimer=setTimeout(()=>{banner.hidden=true;moveNoticeTimer=null;},3000);
}
$('moveImage').addEventListener('click',()=>{
 if($('moveImage').disabled)return;
 if(movingImages){endMoveMode();return;}
 if(!selected.size){say('status','Select one or more photos to move.');return;}
 movingImages=true;
 document.body.classList.add('moving-images');
 $('moveImage').setAttribute('aria-pressed','true');
 say('status','Choose the destination tab for the selected photo'+(selected.size===1?'':'s')+'.');
});
async function moveToCategory(slug){
 if(!movingImages||slug==='all')return;
 const destination=categories.find(c=>c.slug===slug);
 if(!destination)return;
 const button=$('moveImage');
 if(button.disabled)return; // Prevent simultaneous moves to different tabs.
 const original=new Map(photos.map(p=>[p.id,p.category]));
 const moveIds=[...selected].filter(id=>original.has(id)&&original.get(id)!==slug);
 if(!moveIds.length){
  say('status','The selected photo'+(selected.size===1?' is':'s are')+' already in '+destination.label+'. Choose a different tab.');
  return;
 }
 const fromCategories=[...new Set(moveIds.map(id=>original.get(id)))];
 const fromLabel=fromCategories.length===1
  ? (categories.find(c=>c.slug===fromCategories[0])?.label||fromCategories[0])
  : 'multiple categories';
 const message=(moveIds.length===1?'Photo':moveIds.length+' photos')+' moved from '+fromLabel+' to '+destination.label+'.';
 button.disabled=true;
 let saved=false;
 try{
  // First check what the database reports was actually updated.
  const {data:updated,error:updateError}=await client.from('gallery_images')
   .update({category:slug}).in('id',moveIds).select('id,category');
  if(updateError)throw updateError;
  if(!updated||updated.length!==moveIds.length||
     updated.some(p=>p.category!==slug)||
     moveIds.some(id=>!updated.some(p=>p.id===id))){
   throw Error('Supabase did not confirm all category changes.');
  }
  saved=true;
  // Independently reread the saved records. A success ribbon appears ONLY
  // if their authoritative database categories match the clicked destination.
  const {data:verified,error:verifyError}=await client.from('gallery_images')
   .select('id,category').in('id',moveIds);
  if(verifyError)throw verifyError;
  if(!verified||verified.length!==moveIds.length||
     verified.some(p=>p.category!==slug)||
     moveIds.some(id=>!verified.some(p=>p.id===id))){
   throw Error('The saved photo categories could not be verified.');
  }
  for(const photo of photos){
   if(moveIds.includes(photo.id))photo.category=slug;
  }
  selected.clear();
  endMoveMode();
  render(); // Remain in original category; moved photos vanish immediately.
  signalGalleryChange();
  showMoveRibbon(message);
  say('status',message+(viewCategory==='all'?' The All tab still includes all categories.':''));
 }catch(error){
  say('status',(saved?'The move may have saved, but verification failed: ':'Could not move photos: ')+error.message);
  await loadPhotos(true);
 }finally{
  button.disabled=false;
 }
}
function selectCategoryTab(slug){
 if(movingImages){void moveToCategory(slug);return;}
 changeCategory(slug);
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
 
 all.addEventListener('click',()=>selectCategoryTab('all'));nav.append(all);
 const dropdown=$('category');const previous=dropdown.value;
 dropdown.replaceChildren();
 for(const c of categories){
  const option=document.createElement('option');option.value=c.slug;option.textContent=c.label;dropdown.add(option);
  const button=document.createElement('button');button.type='button';button.dataset.category=c.slug;button.textContent=c.label;
  button.style.backgroundColor=/^#[0-9a-fA-F]{6}$/.test(c.color)?c.color:'#b6d6a0';
  
  button.addEventListener('click',()=>selectCategoryTab(c.slug));
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


// Photo interactions: normal click selects; hold-and-drag rearranges.
// Global pointer tracking avoids losing the drag when the pointer leaves a photo.
let activeDrag=null;
function highlightDrop(id){
 document.querySelectorAll('.item.drag-target').forEach(el=>el.classList.remove('drag-target'));
 if(!id)return;
 const item=Array.from(document.querySelectorAll('.item')).find(el=>el.dataset.photoId===id);
 if(item)item.classList.add('drag-target');
}
function updateCellSelection(article,id,on){
 if(on)selected.add(id);else selected.delete(id);
 article.classList.toggle('selected',on);
 article.setAttribute('aria-pressed',String(on));
 const check=article.querySelector('.check');
 if(check)check.textContent=on?'✓':'';
}
function toggleCellSelection(article,id){
 updateCellSelection(article,id,!selected.has(id));
}
function syncVisibleSelections(){
 document.querySelectorAll('.item').forEach(article=>{
  updateCellSelection(article,article.dataset.photoId,selected.has(article.dataset.photoId));
 });
}
function findDropTarget(x,y){
 const element=document.elementFromPoint(x,y);
 return element?.closest('.item')?.dataset.photoId||null;
}
function finishPhotoDrag(event,cancel=false){
 const drag=activeDrag;
 if(!drag||event.pointerId!==drag.pointerId)return;
 activeDrag=null;
 document.removeEventListener('pointermove',trackPhotoDrag);
 document.removeEventListener('pointerup',finishPhotoDrag);
 document.removeEventListener('pointercancel',cancelPhotoDrag);
 drag.article.classList.remove('drag-source');
 highlightDrop(null);
 document.body.classList.remove('reordering');
 if(cancel||!drag.moved)return;
 // A drop should never also toggle the selection through a synthetic click.
 drag.article.dataset.justDragged='true';
 setTimeout(()=>{delete drag.article.dataset.justDragged;},0);
 if(!selected.has(drag.id)){
  selected.clear();
  selected.add(drag.id);
  syncVisibleSelections();
 }
 const target=findDropTarget(event.clientX,event.clientY)||drag.target;
 if(target&&target!==drag.id)void reorderSelected(drag.id,target);
}
function cancelPhotoDrag(event){finishPhotoDrag(event,true);}
function trackPhotoDrag(event){
 const drag=activeDrag;
 if(!drag||drag.pointerId!==event.pointerId)return;
 if(!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<7)return;
 if(!drag.moved){
  drag.moved=true;
  drag.article.classList.add('drag-source');
  document.body.classList.add('reordering');
 }
 if(event.cancelable)event.preventDefault();
 const target=findDropTarget(event.clientX,event.clientY);
 drag.target=target&&target!==drag.id?target:null;
 highlightDrop(drag.target);
}
function attachReorderEvents(article,id){
 article.addEventListener('click',event=>{
  if(event.target.closest('.editable-photo-title,.photo-title-input,input,button'))return;
  if(article.dataset.justDragged==='true')return;
  if(savingReorder)return;
  toggleCellSelection(article,id);
 });
 article.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||activeDrag||savingReorder)return;
  if(event.target.closest('.editable-photo-title,.photo-title-input,input,button'))return;
  activeDrag={id,article,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false,target:null};
  document.addEventListener('pointermove',trackPhotoDrag,{passive:false});
  document.addEventListener('pointerup',finishPhotoDrag);
  document.addEventListener('pointercancel',cancelPhotoDrag);
 });
 article.addEventListener('keydown',event=>{
  if(event.target!==article)return; // Editing the title must not select the cell.
  if(event.key===' '||event.key==='Enter'){
   event.preventDefault();
   toggleCellSelection(article,id);
   return;
  }
  if(!selected.has(id)||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();
  const ordered=visiblePhotos(),n=ordered.findIndex(p=>p.id===id);
  const neighbor=ordered[n+(event.key==='ArrowLeft'?-1:1)];
  if(neighbor)void reorderSelected(id,neighbor.id);
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
 button.addEventListener('click',change);
});



// Create a registration link on the server, after verifying the current editor
// account and its authorization. The link is only ever returned to this session.
$('makeSignupLink').addEventListener('click',async()=>{
 const button=$('makeSignupLink');
 if(!currentAdminId||!idleCheck()){
  say('accessMessage','Sign in as an approved editor to create a registration link.');
  return;
 }
 button.disabled=true;
 say('accessMessage','Creating a registration link…');
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();
  if(sessionError||!session?.access_token)throw Error('Your login expired. Please sign in again.');
  const response=await fetch(cfg.url+'/functions/v1/create-bright-moments-signup-link',{
   method:'POST',
   headers:{
    'Authorization':'Bearer '+session.access_token,
    'apikey':cfg.publishableKey,
    'Content-Type':'application/json'
   },
   body:'{}'
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Could not create the registration link.');
  if(typeof result.url!=='string'||!result.url.includes('/register.html#token='))throw Error('The server did not return a valid registration link.');
  const field=$('signupLink');
  field.value=result.url;
  $('signupLinkArea').hidden=false;
  const preview=$('registrationPreview');
  if(preview)preview.href=result.url;
  say('accessMessage','Link created. Copy it and send it to your client. It can be used once within seven days.');
  $('signupLinkArea').scrollIntoView({block:'nearest'});
  field.focus({preventScroll:true});
  field.select();
 }catch(error){
  console.error('Registration link creation failed',error);
  say('accessMessage','Unable to generate link: '+(error.message||'Please try again.'));
 }finally{
  button.disabled=false;
 }
});
$('copySignupLink').addEventListener('click',async()=>{
 const value=$('signupLink').value;
 if(!value)return;
 try{await navigator.clipboard.writeText(value);say('accessMessage','Registration link copied.');}
 catch(error){$('signupLink').focus();$('signupLink').select();say('accessMessage','Link selected; copy it from the field.');}
});
async function loadAccessRequests(){
 if(!currentAdminId||!idleCheck())return;
 const list=$('accountList');
 const {data,error}=await client.from('editor_access_requests')
  .select('user_id,email,status,registered_at').order('registered_at',{ascending:false});
 if(error){say('accessMessage','Unable to load registered accounts: '+error.message);return;}
 list.replaceChildren();
 const accounts=data||[];
 const head=$('registeredCount');
 if(head)head.textContent=accounts.length+' account'+(accounts.length===1?'':'s');
 for(const entry of accounts){
  const item=document.createElement('div');item.className='account-row';
  const detail=document.createElement('div');
  const email=document.createElement('div');email.className='account-row-email';email.textContent=entry.email;
  const status=document.createElement('div');status.className='account-status';status.textContent=entry.status==='approved'?'Editor access active':entry.status==='denied'?'Access revoked':'Account setup incomplete';
  detail.append(email,status);item.append(detail);
  const actions=document.createElement('div');actions.className='access-actions';
  if(entry.user_id!==currentAdminId){
   if(entry.status!=='approved'){
    const approve=document.createElement('button');approve.type='button';approve.textContent=entry.status==='denied'?'Restore access':'Enable access';
    approve.onclick=()=>reviewAccess(entry.user_id,true,approve);
    actions.append(approve);
   }
   if(entry.status!=='denied'){
    const deny=document.createElement('button');deny.type='button';deny.textContent=entry.status==='approved'?'Revoke access':'Deny';
    deny.onclick=()=>reviewAccess(entry.user_id,false,deny);
    actions.append(deny);
   }
  }
  item.append(actions);list.append(item);
 }
}
async function reviewAccess(id,allow,button){
 if(!currentAdminId||!idleCheck())return;
 button.disabled=true;
 say('accessMessage',allow?'Enabling editor access…':'Updating access…');
 try{
  const {error}=await client.rpc('review_bright_moments_editor',{target_user:id,approve:allow});
  if(error)throw error;
  say('accessMessage',allow?'Editor access enabled.':'Editor access revoked.');
  await loadAccessRequests();
 }catch(error){say('accessMessage','Could not update account: '+error.message);button.disabled=false;}
}
$('refreshAccounts').addEventListener('click',()=>{void loadAccessRequests()});
