import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Check, Copy, ExternalLink, Globe2, Link2, Plus, Save, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { PageHeader } from '@/components/admin-console-primitives';
import { MetricTile } from '@/components/admin-console-primitives';
import {
  getGetPublicStorefrontQueryKey, getGetResellerStorefrontQueryKey, getGetResellerStorefrontLeadQueryKey,
  getListResellerStorefrontLeadsQueryKey, useCreatePublicStorefrontLead, useGetPublicStorefront,
  useGetResellerStorefront, useListResellerStorefrontLeads, useRecordPublicStorefrontView,
  useUpdateResellerStorefront, useUpdateResellerStorefrontLead,
  type PublicStorefrontInquiryInput, type ResellerStorefront, type ResellerStorefrontInput,
  type StorefrontLead, type StorefrontLeadUpdateInput, type StorefrontOfferInput,
} from '@workspace/api-client-react';
import './storefront.css';

const faNumber = (value: number) => new Intl.NumberFormat('fa-IR').format(value);
const rial = (value: number) => `${new Intl.NumberFormat('fa-IR').format(value)} تومان`;
const statusNames: Record<string, string> = { new: 'جدید', contacted: 'پیگیری شده', converted: 'تبدیل به فروش', closed: 'بسته شده' };
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function StoreLoading() {
  return <main className="pulse-store store-public" dir="rtl"><div className="store-wrap"><div className="store-skeleton" style={{height:38,width:160}}/><div className="store-skeleton" style={{height:270,marginTop:26}}/><div className="store-skeleton" style={{height:210,marginTop:22}}/><div className="store-skeleton" style={{height:230,marginTop:18}}/></div></main>;
}

export function PublicStorefrontPage() {
  const client = useQueryClient();
  const { slug = '' } = useParams<{slug:string}>();
  const params = useMemo(() => new URLSearchParams(window.location.search), [slug]);
  const sourceValue = params.get('source') || 'direct';
  const campaign = params.get('campaign');
  const source = [sourceValue, campaign ? `campaign:${campaign}` : ''].filter(Boolean).join('|').slice(0,80);
  const storefrontQuery = useGetPublicStorefront(slug,{query:{queryKey:getGetPublicStorefrontQueryKey(slug),enabled:Boolean(slug)}});
  const recordView = useRecordPublicStorefrontView();
  const submitLead = useCreatePublicStorefrontLead();
  const storefront = storefrontQuery.data;
  const [selected,setSelected] = useState<number|null>(null);
  const [form,setForm] = useState({customer_name:'',phone:'',message:'',website:''});
  const [leadResult,setLeadResult] = useState<{lead_id:number;whatsapp_url:string|null}|null>(null);
  const [validation,setValidation] = useState('');
  const [submitError,setSubmitError] = useState('');

  useEffect(() => {
    if (!storefront || !slug) return;
    const key = `pulse-store-view:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key,'recorded');
      recordView.mutate({slug,data:{source}},{onSuccess:()=>void client.invalidateQueries({queryKey:getGetPublicStorefrontQueryKey(slug)})});
    } catch { /* Storage can be unavailable in private browsing. */ }
  },[storefront,slug]);

  const offers = storefront?.offers?.filter((offer)=>offer.enabled) ?? [];
  const submit = (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidation(''); setSubmitError('');
    if (!selected || !offers.some((offer)=>offer.id===selected)) return setValidation('برای ادامه، یکی از بسته‌های فعال را انتخاب کنید.');
    if (form.customer_name.trim().length<2) return setValidation('نام خود را کامل وارد کنید.');
    const phone = form.phone.replace(/[^\d+]/g,'');
    if (phone.replace(/\D/g,'').length<7) return setValidation('شماره تماس واردشده معتبر نیست.');
    const data:PublicStorefrontInquiryInput = {customer_name:form.customer_name.trim(),phone,offer_id:selected,message:form.message.trim(),source,website:form.website};
    submitLead.mutate({slug,data},{onSuccess:(result)=>{
      const rawPhone=storefront?.whatsapp_phone?.replace(/\D/g,'')||'';
      const waPhone=rawPhone.startsWith('0')?`98${rawPhone.slice(1)}`:rawPhone;
      const waMessage=`سلام، درخواست شماره ${result.lead_id} را دربارهٔ ویترین ${storefront?.store_name||''} ثبت کردم.`;
      const whatsappUrl=result.whatsapp_url||(waPhone?`https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`:null);
      setLeadResult({lead_id:result.lead_id,whatsapp_url:whatsappUrl});
      void client.invalidateQueries({queryKey:getGetPublicStorefrontQueryKey(slug)});
    },onError:(error)=>setSubmitError(error instanceof Error?error.message:'ارسال درخواست انجام نشد. دوباره تلاش کنید.')});
  };
  if (storefrontQuery.isLoading) return <StoreLoading/>;
  if (storefrontQuery.isError || !storefront) return <main className="pulse-store store-public" dir="rtl"><div className="store-state"><section className="store-state-card"><Globe2 size={30}/><h1>این ویترین در دسترس نیست</h1><p>ممکن است نشانی اشتباه باشد یا ویترین موقتاً غیرفعال شده باشد.</p><button className="store-button secondary" onClick={()=>storefrontQuery.refetch()}>تلاش دوباره</button></section></div></main>;
  if (leadResult) return <main className="pulse-store store-public" dir="rtl"><div className="store-state"><section className="store-state-card store-success"><span className="store-success-mark"><Check size={24}/></span><small className="store-kicker">درخواست شما ثبت شد</small><h1>فروشنده به‌زودی با شما هماهنگ می‌کند</h1><p>شماره پیگیری {faNumber(leadResult.lead_id)} است. برای ادامهٔ گفتگو می‌توانید از واتساپ استفاده کنید.</p>{leadResult.whatsapp_url&&<a className="store-button" href={leadResult.whatsapp_url} target="_blank" rel="noreferrer"><ExternalLink size={17}/> ادامه در واتساپ</a>}<a className="store-button secondary" href={window.location.pathname+window.location.search}>بازگشت به ویترین</a></section></div></main>;
  return <main className="pulse-store store-public" dir="rtl"><div className="store-wrap">
    <header className="store-bar"><div className="store-brand"><span className="store-mark">پ</span><span>پالس<small style={{display:'block',fontSize:9,color:'var(--sf-muted)',letterSpacing:'.1em'}}>ویترین فروش</small></span></div><span className="store-trust"><ShieldCheck size={14} style={{verticalAlign:'middle',marginLeft:5}}/> ثبت درخواست امن و مستقیم</span></header>
    <section className="store-hero"><div><span className="store-kicker">دسترسی مطمئن، با انتخاب خودتان</span><h1>{storefront.store_name}</h1><p>{storefront.description||'بستهٔ مناسب خود را انتخاب کنید؛ برای هماهنگی و دریافت جزئیات، درخواستتان را ثبت کنید.'}</p></div><aside className="store-hero-side"><span className="store-hero-orbit"><Wifi size={30}/></span><small>ارتباط مستقیم با فروشنده</small><strong>انتخاب ساده، پیگیری روشن</strong></aside></section>
     <div className="store-public-workspace">
       <section className="store-offer-stage" aria-label="انتخاب بسته">
         <div className="store-section-head"><div><span className="store-kicker">پیشنهادهای فعال</span><h2>یک بسته انتخاب کنید</h2></div><p>{faNumber(offers.length)} بسته برای انتخاب</p></div>
         {offers.length?<section className="store-offers" aria-label="بسته‌های فعال">{offers.map((offer)=><button type="button" key={offer.id} className={`store-offer ${selected===offer.id?'selected':''}`} onClick={()=>{setSelected(offer.id);setValidation('')}} aria-pressed={selected===offer.id} data-testid={`card-store-offer-${offer.id}`}><span className="store-offer-top"><h3>{offer.title}</h3><span className="store-radio">{selected===offer.id&&<Check size={14}/>}</span></span><p>{offer.description||'بسته‌ای مناسب برای استفادهٔ روزمره و ارتباط پایدار.'}</p><span className="store-specs"><span>{faNumber(offer.gb)} گیگابایت</span><span>{faNumber(offer.days)} روز</span></span><span className="store-price"><strong>{rial(offer.price)}</strong><small>قیمت فروش به مشتری</small></span></button>)}</section>:<div className="store-empty">در حال حاضر بستهٔ فعالی برای نمایش وجود ندارد. لطفاً بعداً دوباره سر بزنید.</div>}
       </section>
       <section className="store-inquiry" id="inquiry"><div className="store-inquiry-copy"><span className="store-kicker">شروع گفت‌وگو</span><h2>برای ثبت درخواست آماده‌اید؟</h2><p>اطلاعات تماس خود را بگذارید تا فروشنده دربارهٔ بستهٔ انتخابی با شما هماهنگ کند. ثبت درخواست به‌تنهایی خرید یا فعال‌سازی سرویس نیست.</p><div className="store-mini-note"><ShieldCheck size={17}/> اطلاعات فقط برای پیگیری همین درخواست استفاده می‌شود.</div></div>
       <form className="store-form" onSubmit={submit} noValidate><div className="store-field"><label htmlFor="store-customer">نام شما</label><input id="store-customer" data-testid="input-store-customer-name" value={form.customer_name} onChange={(e)=>setForm({...form,customer_name:e.target.value})} placeholder="نام و نام خانوادگی" autoComplete="name"/></div><div className="store-field"><label htmlFor="store-phone">شماره تماس</label><input id="store-phone" data-testid="input-store-phone" type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})} placeholder="۰۹۱۲۱۲۳۴۵۶۷" autoComplete="tel"/></div><div className="store-field full"><label htmlFor="store-message">یادداشت برای فروشنده <small style={{fontWeight:400,color:'var(--sf-muted)'}}>ـ اختیاری</small></label><textarea id="store-message" maxLength={500} value={form.message} onChange={(e)=>setForm({...form,message:e.target.value})} placeholder="اگر توضیحی دارید، اینجا بنویسید."/></div><input name="website" aria-hidden="true" tabIndex={-1} autoComplete="off" style={{position:'absolute',left:'-10000px',opacity:0}} value={form.website} onChange={(e)=>setForm({...form,website:e.target.value})}/><button className="store-button" type="submit" disabled={submitLead.isPending||!offers.length} data-testid="button-store-submit">{submitLead.isPending?'در حال ثبت درخواست…':<>ثبت درخواست <ArrowLeft size={17}/></>}</button>{validation&&<div className="store-notice" role="alert">{validation}</div>}{submitError&&<div className="store-notice" role="alert">{submitError} <button type="button" onClick={()=>setSubmitError('')}>بستن</button></div>}</form></section>
     </div>
     <footer className="store-footer"><span>ویترین فروش با پالس</span><span>برای ثبت درخواست، بستهٔ فعال را انتخاب کنید.</span></footer>
  </div></main>;
}

const blankOffer=(sort_order:number):StorefrontOfferInput=>({id:null,title:'',description:'',gb:30,days:30,price:0,enabled:true,sort_order});
const formFromStore=(store:ResellerStorefront):ResellerStorefrontInput=>({slug:store.slug,store_name:store.store_name,description:store.description,whatsapp_phone:store.whatsapp_phone,enabled:store.enabled,offers:store.offers.map(({id,title,description,gb,days,price,enabled,sort_order})=>({id,title,description,gb,days,price,enabled,sort_order}))});

export function StorefrontManagerPage() {
  const client=useQueryClient();
  const storefrontQuery=useGetResellerStorefront({query:{queryKey:getGetResellerStorefrontQueryKey()}});
  const leadsQuery=useListResellerStorefrontLeads({limit:100},{query:{queryKey:getListResellerStorefrontLeadsQueryKey({limit:100})}});
  const saveStore=useUpdateResellerStorefront();
  const updateLead=useUpdateResellerStorefrontLead();
  const initializedSlug=useRef<string|null>(null);
  const store=storefrontQuery.data;
  const [draft,setDraft]=useState<ResellerStorefrontInput|null>(null);
  const [notice,setNotice]=useState('');
  const [campaignValue,setCampaignValue]=useState('social');
  useEffect(()=>{if(store&&initializedSlug.current!==store.slug){initializedSlug.current=store.slug;setDraft(formFromStore(store))}},[store]);
  const leads:StorefrontLead[]=Array.isArray(leadsQuery.data)?leadsQuery.data:[];
  const publicUrl=store?.slug?`${window.location.origin}${appBasePath}/store/${encodeURIComponent(store.slug)}`:'';
    if(storefrontQuery.isLoading) return <main className="admin-console hope-admin-page hope-page-form hope-pattern-form store-manager-console"><div className="hope-storefront-builder store-wrap store-manage"><div className="store-skeleton" style={{height:45,width:300}}/><div className="store-skeleton" style={{height:140,marginTop:24}}/><div className="store-skeleton" style={{height:500,marginTop:20}}/></div></main>;
    if(storefrontQuery.isError||!store||!draft) return <main className="admin-console hope-admin-page hope-page-form hope-pattern-form store-manager-console"><div className="hope-storefront-builder store-wrap store-manage"><section className="console-surface store-state-card" role="alert"><h1>دریافت اطلاعات ویترین انجام نشد</h1><p>اتصال را بررسی کنید و دوباره تلاش کنید.</p><button className="console-action console-action-secondary" onClick={()=>storefrontQuery.refetch()}>تلاش دوباره</button></section></div></main>;
  const patchDraft=(patch:Partial<ResellerStorefrontInput>)=>setDraft((current)=>current?{...current,...patch}:current);
  const save=async()=>{
    setNotice('');
    try{const updated=await saveStore.mutateAsync({data:draft});client.setQueryData(getGetResellerStorefrontQueryKey(),updated);setDraft(formFromStore(updated));setNotice('تغییرات ویترین ذخیره شد.')}
    catch(error){setNotice(error instanceof Error?error.message:'ذخیره انجام نشد. دوباره تلاش کنید.')}
  };
  const copyLink=async(url:string,success:string)=>{try{await navigator.clipboard.writeText(url);setNotice(success)}catch{setNotice('کپی خودکار ممکن نشد؛ نشانی را از نوار مرورگر کپی کنید.')}};
  const campaignUrl=`${publicUrl}?source=campaign&campaign=${encodeURIComponent(campaignValue.trim()||'campaign')}`;
  const conversionRate=store.stats.views>0?Math.round((store.stats.conversions/store.stats.views)*1000)/10:null;
  const validDraft=/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(draft.slug)&&Boolean(draft.store_name.trim())&&draft.offers.every((o)=>o.title.trim().length>0&&o.gb>0&&o.days>=1&&o.price>=0)&&(!draft.enabled||draft.offers.some((offer)=>offer.enabled));
  const updateLeadLocal=(lead:StorefrontLead,data:StorefrontLeadUpdateInput)=>updateLead.mutate({id:lead.id,data},{onSuccess:(updated)=>{
    const key=getListResellerStorefrontLeadsQueryKey({limit:100});
    client.setQueryData<StorefrontLead[]>(key,(old)=>old?.map((item)=>item.id===updated.id?updated:item));
    client.setQueryData(getGetResellerStorefrontLeadQueryKey(updated.id),updated);
    void client.invalidateQueries({queryKey:getGetResellerStorefrontQueryKey()});
  },onError:(error)=>setNotice(error instanceof Error?error.message:'به‌روزرسانی درخواست انجام نشد.')});
  const changeOffer=(index:number,patch:Partial<StorefrontOfferInput>)=>patchDraft({offers:draft.offers.map((offer,i)=>i===index?{...offer,...patch}:offer)});
     return <main className="admin-console hope-admin-page hope-page-form hope-pattern-form store-manager-console" data-surface="storefront"><div className="hope-storefront-builder store-wrap store-manage">
      <PageHeader eyebrow="ابزار فروش آنلاین" title="ویترین شما" description="یک نشانی برای معرفی بسته‌ها و دریافت درخواست‌های مشتری." action={<div className="console-page-actions"><button className="console-action console-action-secondary" onClick={()=>void copyLink(publicUrl,'نشانی ویترین کپی شد.')}><Copy size={15}/> کپی نشانی</button><a className="console-action console-action-primary" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> مشاهده ویترین</a></div>} />
      <section className="store-manager-overview" aria-label="هویت و دسترسی ویترین">
        <span className="store-manager-overview-mark"><Globe2 size={19}/></span>
        <div className="store-manager-overview-copy"><small>نشانی عمومی شما</small><strong>{store.store_name}</strong><code dir="ltr">{publicUrl}</code></div>
        <span className={`store-manager-state ${store.enabled?'enabled':'disabled'}`}><i/>{store.enabled?'ویترین فعال':'ویترین غیرفعال'}</span>
      </section>
      <section className="store-performance-deck console-metrics-grid" aria-label="عملکرد واقعی ویترین">
        <MetricTile label="بازدید" value={faNumber(store.stats.views)} detail="ورود به ویترین" icon={Globe2} />
        <MetricTile label="درخواست مشتری" value={faNumber(store.stats.inquiries)} detail="ثبت‌شده از همین ویترین" icon={Link2} tone="amber" />
        <MetricTile label="تبدیل به فروش" value={faNumber(store.stats.conversions)} detail={conversionRate===null?'نرخ تبدیل نامشخص':`${faNumber(conversionRate)}٪ از بازدید`} icon={Check} tone="sage" />
        <MetricTile label="درآمد منتسب" value={rial(store.stats.attributed_revenue)} detail="از تبدیل‌های ثبت‌شده" icon={Wifi} tone="coral" />
      </section>
    {notice&&<div className="store-notice" role="status" style={{marginBottom:14}}>{notice}</div>}
     <div className="store-manager-grid"><section className="console-surface store-panel"><h2>مشخصات و بسته‌ها</h2><div className="store-edit-grid">
      <div className="store-field"><label>نشانی کوتاه ویترین</label><input dir="ltr" value={draft.slug} onChange={(e)=>patchDraft({slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')})} placeholder="my-store"/></div>
      <div className="store-field"><label>نام ویترین</label><input value={draft.store_name} onChange={(e)=>patchDraft({store_name:e.target.value})} maxLength={100}/></div>
      <div className="store-field full"><label>معرفی کوتاه</label><textarea value={draft.description} onChange={(e)=>patchDraft({description:e.target.value})} maxLength={500}/></div>
      <div className="store-field full"><label>شماره واتساپ برای پیگیری</label><input dir="ltr" type="tel" value={draft.whatsapp_phone||''} onChange={(e)=>patchDraft({whatsapp_phone:e.target.value||null})} placeholder="+989121234567" maxLength={30}/></div>
      <label className="store-toggle full"><span>ویترین برای مشتریان فعال باشد</span><input type="checkbox" checked={draft.enabled} onChange={(e)=>patchDraft({enabled:e.target.checked})}/></label>
    </div>
    <div className="store-offer-editor">{draft.offers.map((offer,index)=><article className="store-offer-row" key={offer.id??`new-${index}`}><div className="store-offer-row-head"><strong>بستهٔ {faNumber(index+1)}</strong><button className="store-remove" type="button" onClick={()=>patchDraft({offers:draft.offers.filter((_,i)=>i!==index)})}><Trash2 size={14} style={{verticalAlign:'middle',marginLeft:4}}/>حذف بسته</button></div><div className="store-offer-fields">
      <div className="store-field"><label>عنوان</label><input value={offer.title} maxLength={80} onChange={(e)=>changeOffer(index,{title:e.target.value})}/></div><div className="store-field"><label>توضیح</label><input value={offer.description} maxLength={280} onChange={(e)=>changeOffer(index,{description:e.target.value})}/></div>
      <div className="store-field"><label>حجم، گیگ</label><input type="number" min=".1" value={offer.gb} onChange={(e)=>changeOffer(index,{gb:Number(e.target.value)})}/></div><div className="store-field"><label>مدت، روز</label><input type="number" min="1" value={offer.days} onChange={(e)=>changeOffer(index,{days:Number(e.target.value)})}/></div>
      <div className="store-field"><label>قیمت فروش، تومان</label><input type="number" min="0" value={offer.price} onChange={(e)=>changeOffer(index,{price:Number(e.target.value)})}/></div><label className="store-toggle"><span>نمایش به مشتری</span><input type="checkbox" checked={offer.enabled} onChange={(e)=>changeOffer(index,{enabled:e.target.checked})}/></label>
    </div></article>)}</div>
    <button type="button" className="store-button secondary store-add-offer" disabled={draft.offers.length>=20} onClick={()=>patchDraft({offers:[...draft.offers,blankOffer(draft.offers.length)]})}><Plus size={16}/> افزودن بسته</button><div className="store-save-row"><button className="store-button" disabled={saveStore.isPending||!validDraft} onClick={()=>void save()}><Save size={16}/>{saveStore.isPending?'در حال ذخیره…':'ذخیره تغییرات'}</button></div>
      </section><aside className="console-surface store-panel"><h2>درخواست‌های مشتریان</h2>{leadsQuery.isError&&<div className="console-state is-error" role="alert">دریافت درخواست‌ها ناموفق بود. <button className="console-action console-action-secondary" onClick={()=>leadsQuery.refetch()}>تلاش دوباره</button></div>}{leadsQuery.isLoading?<div className="store-skeleton store-skeleton-line"/>:leads.length?<div className="hope-table-scroll"><table className="hope-data-table storefront-leads-table" aria-label="درخواست‌های ویترین"><thead><tr><th>مشتری</th><th>بسته / منبع</th><th>وضعیت</th><th>یادداشت و اقدام</th></tr></thead><tbody>{leads.map((lead)=><LeadCard key={lead.id} lead={lead} onSave={updateLeadLocal} pending={updateLead.isPending&&updateLead.variables?.id===lead.id}/>)}</tbody></table></div>:<div className="console-empty">هنوز درخواستی ثبت نشده است.<br/>با اشتراک‌گذاری نشانی ویترین، اولین مشتری‌ها را به اینجا بیاورید.</div>}
      <div style={{borderTop:'1px solid var(--sf-line)',marginTop:22,paddingTop:18}}><h2 style={{fontSize:15,marginBottom:8}}>نشانی اختصاصی کمپین</h2><p style={{fontSize:12,color:'var(--sf-muted)',lineHeight:1.8}}>برای شناختن کانال‌های ورودی، برای هر کمپین یک نشانی جدا بسازید.</p><div className="store-field"><label>نام کمپین</label><input dir="ltr" value={campaignValue} onChange={(e)=>setCampaignValue(e.target.value)} placeholder="instagram"/></div><div dir="ltr" style={{overflowWrap:'anywhere',marginTop:10,borderRadius:10,background:'#eef3eb',padding:10,fontSize:10,color:'#537169'}}>{campaignUrl}</div><button className="store-button secondary" style={{marginTop:10,width:'100%'}} onClick={()=>void copyLink(campaignUrl,'نشانی کمپین کپی شد.')}><Link2 size={15}/> کپی نشانی کمپین</button>
       </div></aside></div></div></main>;
}

function LeadCard({lead,onSave,pending}:{lead:StorefrontLead;onSave:(lead:StorefrontLead,data:StorefrontLeadUpdateInput)=>void;pending:boolean}) {
  const [status,setStatus]=useState<StorefrontLeadUpdateInput['status']>(lead.status==='converted'?'contacted':lead.status);
  const [note,setNote]=useState(lead.seller_note||'');
  useEffect(()=>{setStatus(lead.status==='converted'?'contacted':lead.status);setNote(lead.seller_note||'')},[lead.id,lead.status,lead.seller_note]);
    return <tr className="store-lead" data-testid={`row-store-lead-${lead.id}`}><td><strong>{lead.customer_name}</strong><small className="hope-table-subline" dir="ltr"><a href={`tel:${lead.phone}`}>{lead.phone}</a></small><small className="hope-table-subline">{new Date(lead.created_at).toLocaleDateString('fa-IR')}</small></td><td><strong>{lead.offer_name}</strong><small className="hope-table-subline">{faNumber(lead.gb)} گیگ · {faNumber(lead.days)} روز · {rial(lead.offer_price)}</small><small className="hope-table-subline">منبع: {lead.source||'مستقیم'}{lead.converted_sale_id?` · فروش ${faNumber(lead.converted_sale_id)}`:''}</small>{lead.message&&<small className="hope-table-subline">{lead.message}</small>}</td><td><span className={`store-status ${lead.status}`}>{statusNames[lead.status]||'جدید'}</span></td><td>{lead.status!=='converted'&&lead.status!=='closed'&&<Link className="store-button secondary" href={`/pos?storefront_lead=${lead.id}`}>ثبت فروش</Link>}<div className="store-lead-controls"><select value={status} onChange={(e)=>setStatus(e.target.value as StorefrontLeadUpdateInput['status'])} aria-label="وضعیت درخواست" disabled={lead.status==='converted'}><option value="new">جدید</option><option value="contacted">پیگیری شده</option><option value="closed">بسته شده</option></select><input value={note} maxLength={500} onChange={(e)=>setNote(e.target.value)} placeholder="یادداشت پیگیری" aria-label="یادداشت فروشنده" disabled={lead.status==='converted'}/><button type="button" disabled={pending||lead.status==='converted'} onClick={()=>onSave(lead,{status,seller_note:note.trim()||null})}>{pending?'در حال ذخیره…':'ذخیره'}</button></div></td></tr>;
}
