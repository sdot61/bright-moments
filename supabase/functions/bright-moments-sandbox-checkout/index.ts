// Bright Moments test-only Stripe Checkout; never accept price values from the browser.
const HOME="https://sdot61.github.io/bright-moments/";
const CORS={
 "Access-Control-Allow-Origin":"https://sdot61.github.io",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Access-Control-Allow-Headers":"content-type, apikey",
 "Vary":"Origin"
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}
});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return response({error:"Use POST to create a test checkout."},405);
 const origin=req.headers.get("origin");
 if(origin&&origin!=="https://sdot61.github.io")return response({error:"Origin not allowed."},403);
 try{
  const body=await req.json();
  const ids=body?.ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>10||
     ids.some(id=>typeof id!=="string"||id.length!==36)||
     new Set(ids).size!==ids.length)return response({error:"Select 1–10 distinct store items."},400);
  const key=Deno.env.get("STRIPE_SANDBOX_SECRET_KEY")||"";
  if(!key.startsWith("sk_test_"))return response({error:"Stripe sandbox is not connected yet. Add the Stripe sandbox secret key in Supabase Edge Function secrets."},503);
  const base=Deno.env.get("SUPABASE_URL")||"";
  const namedKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
  const pub=typeof namedKeys.default==="string"?namedKeys.default:
   Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(!base||!pub)return response({error:"Gallery connection not configured."},503);
  const query=new URL(base+"/rest/v1/gallery_images");
  query.searchParams.set("select","id,title,price_cents,available,section");
  query.searchParams.set("id","in.("+ids.join(",")+")");
  const lookup=await fetch(query,{headers:{"apikey":pub,"Accept":"application/json"}});
  if(!lookup.ok)return response({error:"Could not verify current item prices."},503);
  const rows=await lookup.json();
  const byId=new Map(rows.map(row=>[row.id,row]));
  if(ids.some(id=>{
   const item=byId.get(id);
   return !item||item.section!=="store"||item.available!==true||
    !Number.isSafeInteger(item.price_cents)||item.price_cents<50;
  }))return response({error:"An item is no longer available or has no price. Refresh your cart."},409);
  const form=new URLSearchParams();
  form.set("mode","payment");
  form.set("payment_method_types[0]","card");
  form.set("success_url",HOME+"?section=store&checkout=returned&session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url",HOME+"?section=store&checkout=cancelled");
  form.set("customer_creation","always");
  form.set("shipping_address_collection[allowed_countries][0]","US");
  form.set("client_reference_id",crypto.randomUUID());
  form.set("metadata[bright_moments_image_ids]",ids.join(","));
  ids.forEach((id,index)=>{
   const item=byId.get(id);
   const prefix="line_items["+index+"]";
   form.set(prefix+"[price_data][currency]","usd");
   form.set(prefix+"[price_data][unit_amount]",String(item.price_cents));
   form.set(prefix+"[price_data][product_data][name]",item.title.slice(0,150));
   form.set(prefix+"[quantity]","1");
  });
  const checkout=await fetch("https://api.stripe.com/v1/checkout/sessions",{
   method:"POST",
   headers:{"Authorization":"Bearer "+key,"Content-Type":"application/x-www-form-urlencoded"},
   body:form.toString()
  });
  const result=await checkout.json();
  if(!checkout.ok)return response({error:result?.error?.message||"Stripe could not start the sandbox checkout."},502);
  if(!result.url||!result.url.startsWith("https://checkout.stripe.com/")||result.livemode!==false)
   return response({error:"Stripe did not return a safe test checkout URL."},502);
  return response({url:result.url,mode:"test"});
 }catch(error){
  console.error("Sandbox checkout error",error instanceof Error?error.message:"unknown");
  return response({error:"Could not start sandbox checkout."},500);
 }
});
