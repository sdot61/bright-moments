const cfg=window.BRIGHT_MOMENTS_SUPABASE||{};
const $=id=>document.getElementById(id);
const show=(id,on)=>$(id).hidden=!on;
let client=null,photos=[],selected=new Set(),viewSection="gallery",viewCategory="all";
const say=(id,message)=>$(id).textContent=message;
if(!cfg.url||!cfg.publishableKey){say('message','Setup pending: connect the Supabase project and add its public URL and publishable key to supabase-config.js.');$('signin').querySelector('button').disabled=true;}
else{
client=supabase.createClient(cfg.url,cfg.publishableKey,{auth:{detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}});
client.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY')recoverForm();else setTimeout(checkAuth,0)});
checkAuth();
}
async function checkAuth(){
const {data:{user}}=await client.auth.getUser();
if(!user){show('login',true);show('editor',false);return;}
const result=await client.from('site_admins').select('user_id').eq('user_id',user.id).maybeSingle();
if(result.error||!result.data){say('message','This account is not authorized to manage Bright Moments.');show('editor',false);show('login',true);return;}
show('login',false);show('editor',true);await loadPhotos();
}
$('signin').addEventListener('submit',async e=>{
e.preventDefault();if(!client)return;
say('message','Signing in…');
const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
say('message',error?'Could not sign in. Please check your credentials.':'');
if(!error)await checkAuth();
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
$('logout').addEventListener('click',async()=>{await client.auth.signOut();selected.clear();show('login',true);show('editor',false)});
const bucket='bright-moments-images';
function url(path){return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;}
async function loadPhotos(){
const {data,error}=await client.from('gallery_images').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:true});
if(error){say('status',error.message);return;}
photos=data||[];selected.clear();render();
}
function render(){
const container=$('images');container.replaceChildren();
for(const p of photos.filter(p=>p.section===viewSection&&(viewCategory==="all"||p.category===viewCategory))){
const article=document.createElement('article');article.className='item';
const photo=document.createElement('div');photo.className='photo';
const img=document.createElement('img');img.src=url(p.file_path);img.alt=p.title;img.loading='lazy';
const button=document.createElement('button');button.className='check';button.type='button';button.textContent=selected.has(p.id)?'✓':'○';button.setAttribute('aria-label','Select '+p.title);button.setAttribute('aria-pressed',String(selected.has(p.id)));
button.onclick=()=>{if(selected.has(p.id))selected.delete(p.id);else selected.add(p.id);render()};
photo.append(img,button);
const title=document.createElement('h3');title.textContent=p.title;
const meta=document.createElement('p');meta.textContent=p.section+' · '+p.category;
article.append(photo,title,meta);container.append(article);
}
if(!container.children.length)container.textContent='No managed photographs in this selection yet.';
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
if(dbError){await client.storage.from(bucket).remove([path]);throw dbError;}
}catch(error){say('status','Upload error: '+error.message);return;}}
say('status','Photographs uploaded.');$('files').value='';await loadPhotos();
});

async function removeSelected(){
const chosen=photos.filter(p=>selected.has(p.id));if(!chosen.length){say('status','Select a photograph first.');return;}
if(!confirm('Permanently delete '+chosen.length+' selected photograph(s)?'))return;
const {error}=await client.from('gallery_images').delete().in('id',chosen.map(p=>p.id));
if(error){say('status',error.message);return;}
const {error:storageError}=await client.storage.from(bucket).remove(chosen.map(p=>p.file_path));
say('status',storageError?'Gallery entries deleted; storage cleanup failed: '+storageError.message:'Photographs deleted.');
await loadPhotos();
}
$('delete').addEventListener('click',removeSelected);
$('rename').addEventListener('click',async()=>{
const chosen=photos.filter(p=>selected.has(p.id));
if(chosen.length!==1){say('status','Select exactly one photograph to rename.');return;}
const title=prompt('New photo title:',chosen[0].title);
if(title===null)return;
if(!title.trim()||title.trim().length>160){say('status','Please enter a title between 1 and 160 characters.');return;}
const {error}=await client.from('gallery_images').update({title:title.trim()}).eq('id',chosen[0].id);
if(error)say('status',error.message);else await loadPhotos();
});
async function moveSelected(direction){
const chosen=photos.filter(p=>selected.has(p.id));
if(chosen.length!==1){say('status','Select exactly one photograph to rearrange.');return;}
const same=photos.filter(p=>p.section===chosen[0].section&&p.category===chosen[0].category);
const index=same.findIndex(p=>p.id===chosen[0].id),neighbor=index+direction;
if(neighbor<0||neighbor>=same.length)return;
[same[index],same[neighbor]]=[same[neighbor],same[index]];
for(let i=0;i<same.length;i++){const {error}=await client.from('gallery_images').update({sort_order:i}).eq('id',same[i].id);if(error){say('status',error.message);return;}}
await loadPhotos();selected.add(chosen[0].id);render();
}
$('earlier').addEventListener('click',()=>moveSelected(-1));
$('later').addEventListener('click',()=>moveSelected(1));

document.querySelectorAll('[data-section]').forEach(button=>{const change=()=>{viewSection=button.dataset.section;selected.clear();render()};button.addEventListener('mouseenter',change);button.addEventListener('click',change)});
document.querySelectorAll('[data-category]').forEach(button=>{const change=()=>{viewCategory=button.dataset.category;selected.clear();render()};button.addEventListener('mouseenter',change);button.addEventListener('click',change)});
