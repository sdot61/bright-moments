const cfg=window.BRIGHT_MOMENTS_SUPABASE||{};
const form=document.getElementById('registrationForm');
const message=document.getElementById('registerMessage');
const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
function tell(text){message.textContent=text;}
if(!/^[a-zA-Z0-9_-]{43}$/.test(token)){
 form.hidden=true;
 tell('This registration link is invalid. Ask the site owner for a new link.');
}
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!/^[a-zA-Z0-9_-]{43}$/.test(token)||!cfg.url)return;
 const button=form.querySelector('button');
 button.disabled=true;
 tell('Creating your account…');
 try{
  const email=document.getElementById('registrationEmail').value.trim();
  const response=await fetch(cfg.url+'/functions/v1/register-bright-moments-editor',{
   method:'POST',
   headers:{'Content-Type':'application/json','apikey':cfg.publishableKey},
   body:JSON.stringify({email,token})
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.message||'Could not create the account.');
  form.hidden=true;
  history.replaceState(null,'',location.pathname);
  tell(result.message);
 }catch(error){
  tell(error.message||'Unable to create account. Please try again.');
  button.disabled=false;
 }
});
