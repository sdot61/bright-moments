// Shared brand-header navigation for public, editor, and registration pages.
// The heading always returns home; approved signed-in editors get a separate shortcut.
(()=>{
 const brand=document.getElementById('brandNavigation');
 if(!brand)return;
 const homepage=new URL('./',window.location.href).href;
 const editorPage=new URL('admin.html',window.location.href).href;
 const SESSION_KEY='bright-moments-owner-session-v1';
 const ACTIVITY_KEY='bright-moments-owner-last-activity-v1';
 const MAX_IDLE=24*60*60*1000;
 brand.href=homepage; // Safe and usable even if JavaScript or Supabase is unavailable.

 function activityIsRecent(session){
  const now=Date.now();
  let lastUsed=null;
  try{
   const record=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'null');
   if(record?.userId===session.user?.id&&Number.isFinite(record.at)){
    lastUsed=record.at;
   }
  }catch{}
  if(lastUsed===null){
   const signedIn=Date.parse(session.user?.last_sign_in_at||'');
   const created=Number(session.created_at)*1000;
   lastUsed=Number.isFinite(signedIn)?signedIn:created;
  }
  return Number.isFinite(lastUsed)&&lastUsed>0&&lastUsed<=now&&now-lastUsed<MAX_IDLE;
 }

 async function canReturnToEditor(){
  const cfg=window.BRIGHT_MOMENTS_SUPABASE;
  if(!cfg?.url||!cfg?.publishableKey||!window.supabase)return false;
  // Read the editor's existing session rather than creating a separate login.
  // The public gallery uses a different storage key and must not sign owners out.
  let knownSession;
  try{knownSession=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}
  catch{return false;}
  if(!knownSession?.user?.id||!knownSession?.refresh_token)return false;
  if(!activityIsRecent(knownSession))return false;
  const client=window.supabase.createClient(cfg.url,cfg.publishableKey,{
   auth:{
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:false,
    storageKey:SESSION_KEY
   }
  });
  const {data:{session},error:sessionError}=await client.auth.getSession();
  if(sessionError||!session||!activityIsRecent(session))return false;
  const {data:{user},error:userError}=await client.auth.getUser();
  if(userError||!user||user.id!==session.user.id)return false;
  // Do not assume having a login means authorization to edit the gallery.
  const {data:approval,error:approvalError}=await client.from('site_admins')
   .select('user_id').eq('user_id',user.id).maybeSingle();
  return !approvalError&&!!approval;
 }

 // The heading always leads to the public homepage, even for signed-in editors.
 // The separate Editing mode link is visible only after verifying editor access.
 if(window.location.pathname===new URL(homepage).pathname){
  const container=document.createElement('div');
  container.className='brand-heading-wrap';
  brand.parentNode.insertBefore(container,brand);
  container.append(brand);
  const editorLink=document.createElement('a');
  editorLink.className='brand-edit-link';
  editorLink.href=editorPage;
  editorLink.textContent='Editing mode';
  editorLink.setAttribute('aria-label','Return to editing mode');
  editorLink.hidden=true;
  container.append(editorLink);

  let checkGeneration=0;
  async function updateEditorShortcut(){
   const thisCheck=++checkGeneration;
   editorLink.hidden=true;
   try{
    const approved=await canReturnToEditor();
    if(thisCheck===checkGeneration)editorLink.hidden=!approved;
   }catch(error){
    if(thisCheck===checkGeneration)editorLink.hidden=true;
    console.warn('Unable to verify editor shortcut',error);
   }
  }
  void updateEditorShortcut();
  window.addEventListener('focus',()=>{void updateEditorShortcut();});
  document.addEventListener('visibilitychange',()=>{
   if(!document.hidden)void updateEditorShortcut();
  });
  window.addEventListener('storage',event=>{
   if(event.key===SESSION_KEY||event.key===ACTIVITY_KEY)void updateEditorShortcut();
  });
 }
})();
