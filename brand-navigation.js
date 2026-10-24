// Shared brand-header navigation for public, editor, and registration pages.
// An authenticated, approved editor goes back to the editor; everyone else goes home.
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

 let navigating=false;
 brand.addEventListener('click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(navigating)return;
  navigating=true;
  let destination=homepage;
  try{
   if(await canReturnToEditor())destination=editorPage;
  }catch(error){
   console.warn('Brand navigation could not verify editor access',error);
  }
  if(new URL(destination).pathname===window.location.pathname){
   window.scrollTo({top:0,behavior:'auto'});
   navigating=false;
   return;
  }
  window.location.assign(destination);
 });
})();
