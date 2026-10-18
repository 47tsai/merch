import './theme.css';
import './theme-refinement.css';

type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'merch-theme';

function getSystemTheme(): 'light' | 'dark' { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function getStoredTheme(): Theme { try { const value=localStorage.getItem(STORAGE_KEY); return value==='dark'||value==='light'?value:'system'; } catch { return 'system'; } }
function applyTheme(theme:Theme,persist=true):void{
  const effective=theme==='system'?getSystemTheme():theme;
  document.documentElement.dataset.theme=effective;
  document.documentElement.dataset.themePreference=theme;
  document.documentElement.style.colorScheme=effective;
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button=>{const active=button.dataset.themeChoice===theme;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
  const status=document.querySelector<HTMLElement>('[data-theme-status]');
  if(status)status.textContent=theme==='system'?`跟隨系統 · ${effective==='dark'?'深色':'淺色'}`:effective==='dark'?'深色模式':'淺色模式';
  if(persist){try{if(theme==='system')localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,theme);}catch{/* storage may be unavailable */}}
}
function init():void{
  applyTheme(getStoredTheme(),false);
  document.addEventListener('click',event=>{const button=(event.target as Element|null)?.closest<HTMLButtonElement>('[data-theme-choice]');const theme=button?.dataset.themeChoice;if(theme==='system'||theme==='dark'||theme==='light')applyTheme(theme);});
  const media=window.matchMedia?.('(prefers-color-scheme: dark)'); media?.addEventListener('change',()=>{if(getStoredTheme()==='system')applyTheme('system',false);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
