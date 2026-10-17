import './settings-auth.css';
import { clearChiAuthToken, getAuthStatus, getChiAuthConfig, hasChiAuthToken } from './api';

let panel: HTMLElement | null = null;
function message(text: string, kind: 'info' | 'success' | 'error' = 'info'): void { const node=panel?.querySelector<HTMLElement>('[data-auth-message]'); if(!node)return; node.textContent=text; node.dataset.kind=kind; }
function updateStatus(authenticated:boolean):void { const status=panel?.querySelector<HTMLElement>('[data-auth-status]'); if(!status)return; status.textContent=authenticated?'已登入 Chi Auth':'尚未登入'; status.dataset.authenticated=String(authenticated); window.dispatchEvent(new Event('merch-auth-status-changed')); }
function randomToken(bytes=32):string { const value=crypto.getRandomValues(new Uint8Array(bytes)); let binary=''; for(const byte of value)binary+=String.fromCharCode(byte); return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
async function login():Promise<void>{
  const button=panel?.querySelector<HTMLButtonElement>('[data-auth-verify]');
  if(button)button.disabled=true;
  try{
    const config=await getChiAuthConfig();
    const state=randomToken(); const verifier=randomToken(48);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    let binary=''; for(const byte of new Uint8Array(digest))binary+=String.fromCharCode(byte);
    const challenge=btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    sessionStorage.setItem('chi-auth-oauth-state',state);
    sessionStorage.setItem('chi-auth-oauth-verifier',verifier);
    const redirectUri=`${location.origin}/oauth-callback.html`;
    const authorize=new URL('/api/authorize',config.authUrl);
    authorize.searchParams.set('response_type','code');
    authorize.searchParams.set('client_id',config.clientId);
    authorize.searchParams.set('redirect_uri',redirectUri);
    authorize.searchParams.set('code_challenge',challenge);
    authorize.searchParams.set('code_challenge_method','S256');
    authorize.searchParams.set('state',state);
    location.assign(authorize.toString());
  }catch(error){message(error instanceof Error?error.message:'無法啟動 Chi Auth 登入。','error');if(button)button.disabled=false;}
}
async function verifyStored():Promise<void>{try{const result=await getAuthStatus();if(result.authenticated){updateStatus(true);message('Chi Auth 身分已確認，可管理收藏。','success');return;}clearChiAuthToken();updateStatus(false);message('尚未登入，請使用 Chi Auth Passkey 登入。');}catch{updateStatus(false);}}
async function bind():Promise<void>{
  panel=document.querySelector<HTMLElement>('[data-page="settings"] section[aria-labelledby="settings-auth-title"]');
  if(!panel)return;
  panel.querySelector<HTMLButtonElement>('[data-auth-verify]')?.addEventListener('click',()=>{void login();});
  panel.querySelector<HTMLButtonElement>('[data-auth-clear]')?.addEventListener('click',()=>{clearChiAuthToken();updateStatus(false);message('已登出 Chi Auth。');});
  if(hasChiAuthToken())await verifyStored();else updateStatus(false);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void bind();},{once:true});else void bind();
