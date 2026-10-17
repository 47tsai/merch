import { getStore, type MerchStore } from './store';
import type { Item, ShippingRecord } from './types';
import { escapeHtml, qs } from './utils/dom';
import { showToast } from './utils/toast';
import { ensureFormErrors, setFormErrors, clearFormErrors } from './utils/form-feedback';
import { openShippingDetail } from './shipping-detail-modal';
import './shipping.css';

let storeRef: MerchStore | null = null;
let editingId = '';
let saving = false;
let itemSearch = '';
let itemPage = 1;
let recordPage = 1;
let showSelectedItems = false;
let itemWorkFilter = '';
let itemCategoryFilter = '';
let draftRecordId: string | null = null;
let draftItemIds = new Set<string>();
const ITEM_PAGE_SIZE = 12;
const RECORD_PAGE_SIZE = 12;
const allItems=()=>storeRef?.snapshot.items??[];
const money=(n:number,c:string)=>`${c||'TWD'} ${new Intl.NumberFormat('zh-TW').format(n)}`;
function setValue(id:string,value:string):void{const el=qs<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`#${id}`);if(el)el.value=value;}
function renderItems(selected:ShippingRecord|undefined):void{
  const root=qs<HTMLElement>('[data-shipping-items]');
  if(!root)return;
  if(draftRecordId!==editingId){
    draftRecordId=editingId;
    draftItemIds=new Set(selected?.itemIds??[]);
    itemPage=1;
  }
  const items=allItems();
  const query=itemSearch.trim().toLocaleLowerCase('zh-Hant');
  const workOptions=[...new Set(items.map(item=>item.workId).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  const categoryOptions=[...new Set(items.map(item=>item.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  if(itemWorkFilter&&!workOptions.includes(itemWorkFilter))itemWorkFilter='';
  if(itemCategoryFilter&&!categoryOptions.includes(itemCategoryFilter))itemCategoryFilter='';
  const filtered=items.filter(item=>{
    if(showSelectedItems&&!draftItemIds.has(item.id))return false;
    if(itemWorkFilter&&item.workId!==itemWorkFilter)return false;
    if(itemCategoryFilter&&item.category!==itemCategoryFilter)return false;
    if(!query)return true;
    return [item.id,item.title,item.workId,item.workName??'',item.category].some(value=>String(value).toLocaleLowerCase('zh-Hant').includes(query));
  });
  const totalPages=Math.max(1,Math.ceil(filtered.length/ITEM_PAGE_SIZE));
  itemPage=Math.min(itemPage,totalPages);
  const start=(itemPage-1)*ITEM_PAGE_SIZE;
  const pageItems=filtered.slice(start,start+ITEM_PAGE_SIZE);
  const selectedItems=items.filter(item=>draftItemIds.has(item.id));
  root.replaceChildren();

  const selectedPanel=document.createElement('section');
  selectedPanel.className='shipping-selected-panel';
  selectedPanel.setAttribute('aria-label','已關聯周邊');
  const selectedHead=document.createElement('div');
  selectedHead.className='shipping-selected-heading';
  const selectedTitle=document.createElement('div');
  const eyebrow=document.createElement('span');eyebrow.className='shipping-mini-label';eyebrow.textContent='LINKED ITEMS';
  const count=document.createElement('strong');count.className='shipping-selected-count';count.textContent=`已選 ${draftItemIds.size} 件周邊`;
  const selectedHint=document.createElement('p');selectedHint.textContent=selectedItems.length?'這些周邊會被記入同一筆運費。':'先從下方清單選取這筆運費涵蓋的周邊。';
  selectedTitle.append(eyebrow,count,selectedHint);
  const clear=document.createElement('button');clear.type='button';clear.className='chi-button shipping-clear-selection';clear.textContent='清空選取';clear.disabled=saving||draftItemIds.size===0;clear.dataset.shippingClearSelection='true';
  selectedHead.append(selectedTitle,clear);selectedPanel.appendChild(selectedHead);
  const chips=document.createElement('div');chips.className='shipping-selected-chips';
  if(selectedItems.length){
    for(const item of selectedItems){
      const chip=document.createElement('div');chip.className='shipping-selected-chip';
      const text=document.createElement('span');text.textContent=item.title;
      const id=document.createElement('small');id.textContent=item.id;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title=`取消關聯：${item.title}`;remove.setAttribute('aria-label',`取消關聯 ${item.title}`);remove.disabled=saving;remove.dataset.shippingUnlink=item.id;
      chip.append(text,id,remove);chips.appendChild(chip);
    }
  }else{
    const empty=document.createElement('span');empty.className='shipping-selected-empty';empty.textContent='尚未選取周邊';chips.appendChild(empty);
  }
  selectedPanel.appendChild(chips);
  root.appendChild(selectedPanel);

  const toolbar=document.createElement('div');toolbar.className='shipping-items-toolbar';
  const searchLabel=document.createElement('label');searchLabel.className='shipping-item-search';
  const searchCaption=document.createElement('span');searchCaption.textContent='搜尋周邊';
  const search=document.createElement('input');search.type='search';search.value=itemSearch;search.placeholder='輸入名稱、Item ID 或作品';search.autocomplete='off';search.disabled=saving;search.setAttribute('data-shipping-item-search','true');search.className='chi-input';
  searchLabel.append(searchCaption,search);
  const filters=document.createElement('div');filters.className='shipping-item-filters';
  const workLabel=document.createElement('label');workLabel.className='shipping-filter-field';
  const workCaption=document.createElement('span');workCaption.textContent='作品';
  const workSelect=document.createElement('select');workSelect.className='chi-select';workSelect.disabled=saving;workSelect.dataset.shippingWorkFilter='true';
  const allWorks=document.createElement('option');allWorks.value='';allWorks.textContent='全部作品';workSelect.appendChild(allWorks);
  for(const workId of workOptions){const option=document.createElement('option');option.value=workId;option.textContent=items.find(item=>item.workId===workId)?.workName||workId;workSelect.appendChild(option);}
  workSelect.value=itemWorkFilter;workLabel.append(workCaption,workSelect);
  const categoryLabel=document.createElement('label');categoryLabel.className='shipping-filter-field';
  const categoryCaption=document.createElement('span');categoryCaption.textContent='類型';
  const categorySelect=document.createElement('select');categorySelect.className='chi-select';categorySelect.disabled=saving;categorySelect.dataset.shippingCategoryFilter='true';
  const allCategories=document.createElement('option');allCategories.value='';allCategories.textContent='全部類型';categorySelect.appendChild(allCategories);
  for(const category of categoryOptions){const option=document.createElement('option');option.value=category;option.textContent=category;categorySelect.appendChild(option);}
  categorySelect.value=itemCategoryFilter;categoryLabel.append(categoryCaption,categorySelect);
  const selectedLabel=document.createElement('label');selectedLabel.className='shipping-item-filter';
  const selectedCheckbox=document.createElement('input');selectedCheckbox.type='checkbox';selectedCheckbox.checked=showSelectedItems;selectedCheckbox.disabled=saving;selectedCheckbox.dataset.shippingShowSelected='true';
  const selectedText=document.createElement('span');selectedText.textContent='只看已選';selectedLabel.append(selectedCheckbox,selectedText);
  filters.append(workLabel,categoryLabel,selectedLabel);
  toolbar.append(searchLabel,filters);root.appendChild(toolbar);

  const listHeading=document.createElement('div');listHeading.className='shipping-results-heading';
  const resultsCount=document.createElement('span');resultsCount.textContent=`符合 ${filtered.length} 件`;
  const pageActions=document.createElement('div');pageActions.className='shipping-visible-actions';
  const selectVisible=document.createElement('button');selectVisible.type='button';selectVisible.className='chi-button';selectVisible.textContent=pageItems.length&&pageItems.every(item=>draftItemIds.has(item.id))?'取消本頁全選':'選取本頁';selectVisible.disabled=saving||pageItems.length===0;selectVisible.dataset.shippingSelectVisible='true';
  pageActions.appendChild(selectVisible);listHeading.append(resultsCount,pageActions);root.appendChild(listHeading);

  const list=document.createElement('div');list.className='shipping-items';
  if(pageItems.length){
    for(const item of pageItems){
      const label=document.createElement('label');label.className='shipping-item';if(draftItemIds.has(item.id))label.classList.add('is-selected');
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=item.id;checkbox.checked=draftItemIds.has(item.id);checkbox.disabled=saving;checkbox.dataset.shippingItemCheckbox='true';
      const copy=document.createElement('span');copy.className='shipping-item-copy';
      const title=document.createElement('strong');title.textContent=item.title;
      const meta=document.createElement('small');meta.textContent=`${item.id} · ${item.workName||item.workId} · ${item.category}`;
      copy.append(title,meta);const status=document.createElement('span');status.className='shipping-item-status';status.textContent=draftItemIds.has(item.id)?'已選取':'選取';
      label.append(checkbox,copy,status);list.appendChild(label);
    }
  }else{
    const empty=document.createElement('div');empty.className='shipping-items-empty';
    const emptyTitle=document.createElement('strong');emptyTitle.textContent=showSelectedItems?'沒有符合條件的已選周邊':'找不到符合條件的周邊';
    const emptyCopy=document.createElement('span');emptyCopy.textContent=showSelectedItems?'取消「只看已選」或調整篩選條件。':'試試其他關鍵字，或清除作品與類型篩選。';empty.append(emptyTitle,emptyCopy);list.appendChild(empty);
  }
  root.appendChild(list);
  const pager=document.createElement('div');pager.className='shipping-items-pagination';
  const summary=document.createElement('span');summary.textContent=`第 ${filtered.length?start+1:0}–${Math.min(start+ITEM_PAGE_SIZE,filtered.length)} 件，共 ${filtered.length} 件`;
  const controls=document.createElement('div');controls.className='shipping-pagination-controls';
  const prev=document.createElement('button');prev.className='chi-button';prev.type='button';prev.textContent='上一頁';prev.disabled=saving||itemPage<=1;prev.dataset.shippingItemPage=String(itemPage-1);
  const pageLabel=document.createElement('span');pageLabel.textContent=`${itemPage} / ${totalPages}`;
  const next=document.createElement('button');next.className='chi-button';next.type='button';next.textContent='下一頁';next.disabled=saving||itemPage>=totalPages;next.dataset.shippingItemPage=String(itemPage+1);
  controls.append(prev,pageLabel,next);pager.append(summary,controls);root.appendChild(pager);
}
function renderRecords():void{
  if(!storeRef)return;
  const listSection=qs<HTMLElement>('.shipping-list');
  if(!listSection)return;
  let root=qs<HTMLElement>('[data-shipping-records]');
  if(!root){
    root=document.createElement('div');
    root.setAttribute('data-shipping-records','true');
    root.className='shipping-records';
    listSection.appendChild(root);
  }
  const records=storeRef.snapshot.shipping??[];
  root.replaceChildren();
  if(!records.length){
    recordPage=1;
    const empty=document.createElement('div');
    empty.className='empty-state';
    empty.textContent='目前沒有運費紀錄。';
    root.appendChild(empty);
    return;
  }
  const totalPages=Math.max(1,Math.ceil(records.length/RECORD_PAGE_SIZE));
  recordPage=Math.min(recordPage,totalPages);
  const start=(recordPage-1)*RECORD_PAGE_SIZE;
  const pageRecords=records.slice(start,start+RECORD_PAGE_SIZE);
  const fragment=document.createDocumentFragment();
  for(const r of pageRecords){
    const card=document.createElement('article');card.className='shipping-card';card.dataset.shippingDetail=r.id;
    const head=document.createElement('div');const amount=document.createElement('strong');amount.textContent=money(r.amount,r.currency);const date=document.createElement('span');date.textContent=r.date||'未填日期';head.append(amount,date);
    const note=document.createElement('p');note.textContent=`${r.carrier||'未設定物流'}${r.note?` · ${r.note}`:''}`;
    const count=document.createElement('small');count.textContent=`關聯 ${r.itemIds.length} 件周邊`;
    const actions=document.createElement('div');actions.className='shipping-card-actions';
    const edit=document.createElement('button');edit.className='button secondary';edit.type='button';edit.dataset.shippingEdit=r.id;edit.disabled=saving;edit.textContent='編輯';
    const del=document.createElement('button');del.className='button danger';del.type='button';del.dataset.shippingDelete=r.id;del.disabled=saving;del.textContent='刪除';
    actions.append(edit,del);card.append(head,note,count,actions);fragment.appendChild(card);
  }
  root.appendChild(fragment);
  const pager=document.createElement('div');pager.className='shipping-records-pagination';
  const summary=document.createElement('span');summary.textContent=`顯示 ${start+1}–${Math.min(start+RECORD_PAGE_SIZE,records.length)} / ${records.length} 筆`;
  const prev=document.createElement('button');prev.className='button secondary compact';prev.type='button';prev.textContent='上一頁';prev.disabled=saving||recordPage<=1;prev.dataset.shippingRecordPage=String(recordPage-1);
  const pageLabel=document.createElement('span');pageLabel.textContent=`第 ${recordPage} / ${totalPages} 頁`;
  const next=document.createElement('button');next.className='button secondary compact';next.type='button';next.textContent='下一頁';next.disabled=saving||recordPage>=totalPages;next.dataset.shippingRecordPage=String(recordPage+1);
  pager.append(summary,prev,pageLabel,next);root.appendChild(pager);
}
function render():void{if(!storeRef)return;const records=storeRef.snapshot.shipping??[];const selected=records.find(x=>x.id===editingId);const title=qs<HTMLElement>('[data-shipping-editor-title]');if(title)title.textContent=selected?'編輯運費':'新增運費';setValue('shipping-amount',selected?String(selected.amount):'');setValue('shipping-currency',selected?.currency??'TWD');setValue('shipping-date',selected?.date??'');setValue('shipping-carrier',selected?.carrier??'');setValue('shipping-note',selected?.note??'');const form=qs<HTMLFormElement>('#shipping-form');if(form)form.setAttribute('aria-busy',String(saving));form?.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select').forEach(el=>{if(!el.matches('[data-shipping-item-checkbox],[data-shipping-item-search],[data-shipping-show-selected]'))el.disabled=saving;});const submit=qs<HTMLButtonElement>('#shipping-form button[type="submit"]');if(submit){submit.disabled=saving;submit.textContent=saving?'同步中…':selected?'儲存修改':'新增運費';}const cancel=qs<HTMLButtonElement>('#shipping-cancel');if(cancel){cancel.hidden=!selected;cancel.disabled=saving;}renderItems(selected);renderRecords();}
async function save(e:SubmitEvent){e.preventDefault();if(!storeRef||saving)return;const form=qs<HTMLFormElement>('#shipping-form');const feedback=ensureFormErrors(form);clearFormErrors(feedback);const amountText=qs<HTMLInputElement>('#shipping-amount')?.value.trim()??'';const amount=Number(amountText);const currency=qs<HTMLInputElement>('#shipping-currency')?.value.trim()||'TWD';const itemIds=[...draftItemIds];const availableItemIds=new Set(allItems().map(item=>item.id));const errors:string[]=[];if(!amountText||!Number.isFinite(amount)||amount<0)errors.push('運費金額必須是大於等於 0 的數字。');if(!itemIds.length)errors.push('請至少選擇一個關聯周邊。');else if(itemIds.some(id=>!availableItemIds.has(id)))errors.push('關聯周邊包含不存在的 Item，請重新選擇。');if(errors.length){setFormErrors(feedback,errors);showToast('請先修正表單中的錯誤。','error');return;}const record:ShippingRecord={id:editingId||`ship-${Date.now().toString(36)}`,amount,currency,date:qs<HTMLInputElement>('#shipping-date')?.value||undefined,carrier:qs<HTMLInputElement>('#shipping-carrier')?.value.trim()||undefined,note:qs<HTMLTextAreaElement>('#shipping-note')?.value.trim()||undefined,itemIds};saving=true;render();showToast(editingId?'運費修改同步中，請稍候。':'運費新增同步中，請稍候。','info');try{await storeRef.saveShipping(record);editingId='';draftRecordId=null;clearFormErrors(ensureFormErrors(form));showToast('運費紀錄已儲存。','success');}catch(e){const message=e instanceof Error?e.message:'儲存運費失敗。';setFormErrors(ensureFormErrors(form),[message]);showToast(message,'error');}finally{saving=false;render();}}
async function remove(id:string){if(!storeRef||saving)return;saving=true;render();showToast('運費刪除同步中，請稍候。','info');try{await storeRef.deleteShipping(id);if(editingId===id){editingId='';draftRecordId=null;}showToast('運費紀錄已刪除。','success');}catch(e){showToast(e instanceof Error?e.message:'刪除運費失敗。','error');}finally{saving=false;render();}}
function bind(){const root=qs<HTMLElement>('#shipping-root');if(!root)return;const form=qs<HTMLFormElement>('#shipping-form');if(form){form.noValidate=true;ensureFormErrors(form);}root.addEventListener('submit',e=>{void save(e as SubmitEvent)});root.addEventListener('input',e=>{const t=e.target as HTMLInputElement;if(t.matches('[data-shipping-item-search]')){const cursor=t.selectionStart??t.value.length;itemSearch=t.value;itemPage=1;renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));const next=qs<HTMLInputElement>('[data-shipping-item-search]');if(next){next.focus();const position=Math.min(cursor,next.value.length);next.setSelectionRange(position,position);}}else if(t.matches('#shipping-amount,#shipping-currency,#shipping-date,#shipping-carrier,#shipping-note')){clearFormErrors(ensureFormErrors(form));}});root.addEventListener('change',e=>{const t=e.target as HTMLInputElement|HTMLSelectElement;if(t.matches('[data-shipping-item-checkbox]')){const checkbox=t as HTMLInputElement;if(checkbox.checked)draftItemIds.add(checkbox.value);else draftItemIds.delete(checkbox.value);clearFormErrors(ensureFormErrors(form));renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));}else if(t.matches('[data-shipping-show-selected]')){showSelectedItems=(t as HTMLInputElement).checked;itemPage=1;renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));}else if(t.matches('[data-shipping-work-filter]')){itemWorkFilter=t.value;itemPage=1;renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));}else if(t.matches('[data-shipping-category-filter]')){itemCategoryFilter=t.value;itemPage=1;renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));}});root.addEventListener('click',async e=>{const t=e.target as Element;const unlink=t.closest<HTMLElement>('[data-shipping-unlink]');if(unlink&&!saving){draftItemIds.delete(unlink.dataset.shippingUnlink||'');renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));return}if(t.closest('[data-shipping-clear-selection]')&&!saving){draftItemIds.clear();renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));return}if(t.closest('[data-shipping-select-visible]')&&!saving){const visible=[...root.querySelectorAll<HTMLInputElement>('[data-shipping-item-checkbox]')].map(input=>input.value);const allSelected=visible.length>0&&visible.every(id=>draftItemIds.has(id));for(const id of visible){if(allSelected)draftItemIds.delete(id);else draftItemIds.add(id)}renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));return}const page=t.closest<HTMLElement>('[data-shipping-item-page]');if(page&&!saving){itemPage=Math.max(1,Number(page.dataset.shippingItemPage)||1);renderItems(storeRef?.snapshot.shipping.find(x=>x.id===editingId));return}const recordPager=t.closest<HTMLElement>('[data-shipping-record-page]');if(recordPager&&!saving){recordPage=Math.max(1,Number(recordPager.dataset.shippingRecordPage)||1);renderRecords();return}const edit=t.closest<HTMLElement>('[data-shipping-edit]');if(edit&&!saving){editingId=edit.dataset.shippingEdit||'';draftRecordId=null;itemSearch='';showSelectedItems=false;render();return}const del=t.closest<HTMLElement>('[data-shipping-delete]');if(del&&!saving){if(confirm('確定刪除此筆運費紀錄？'))await remove(del.dataset.shippingDelete||'');return}const card=t.closest<HTMLElement>('[data-shipping-detail]');if(card&&!t.closest('button')&&!saving){const record=recordsById(card.dataset.shippingDetail||'');if(record)openShippingDetail(record,allItems());return}if(t.closest('#shipping-cancel')&&!saving){editingId='';draftRecordId=null;itemSearch='';itemWorkFilter='';itemCategoryFilter='';showSelectedItems=false;render();}})}
const recordsById=(id:string)=>storeRef?.snapshot.shipping.find(record=>record.id===id);
async function init(){storeRef=await getStore();storeRef.subscribe(()=>{if(!saving)render()});render();bind()}
void init();
