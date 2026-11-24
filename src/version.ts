import './theme';
import './app-loading';
import './page-auth-status';
import { getStore, type MerchStore } from './store';

export type AppVersion = `${number}.${number}.${number}`;

type VersionResponse = { version?: unknown };

const DEPLOY_HINT_TEXT = '新資料部署中，約數分鐘後所有人可見';
const DEPLOY_POLL_MS = 60_000;

export async function loadVersion(): Promise<AppVersion> {
  const response = await fetch('/data/version.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Version request failed: ${response.status}`);
  const data = (await response.json()) as VersionResponse;
  if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
    throw new Error('Invalid version metadata');
  }
  return data.version as AppVersion;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function setDeployHint(show: boolean): void {
  document.querySelectorAll<HTMLElement>('.version').forEach((element) => {
    const next = element.nextElementSibling;
    const hint = next?.classList.contains('version-deploy-hint') ? (next as HTMLElement) : null;
    if (show) {
      if (hint) return;
      const span = document.createElement('span');
      span.className = 'version-deploy-hint';
      span.textContent = DEPLOY_HINT_TEXT;
      element.after(span);
    } else if (hint) {
      hint.remove();
    }
  });
}

function stopDeployPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function renderVersion(): Promise<void> {
  let staticVersion: AppVersion | null = null;
  try {
    staticVersion = await loadVersion();
    document.querySelectorAll<HTMLElement>('.version').forEach((element) => {
      element.textContent = `v${staticVersion}`;
    });
  } catch (error) {
    console.error('Failed to load version metadata:', error);
  }
  // The store reads the authoritative /api/data version; the static
  // version.json only catches up once the deployment lands. When the store
  // is ahead, a deployment is still rolling out: show the hint next to
  // every version label and re-check the static version every 60s until
  // it catches up, then hide the hint and stop polling. A store load
  // failure must not affect the static version display.
  try {
    const store: MerchStore = await getStore();
    const update = async (): Promise<void> => {
      const storeVersion = store.snapshot.version;
      if (!staticVersion || storeVersion === staticVersion) return;
      setDeployHint(true);
      if (pollTimer !== null) return;
      pollTimer = setInterval(() => {
        void (async () => {
          try {
            const current = await loadVersion();
            if (current === store.snapshot.version) {
              setDeployHint(false);
              stopDeployPolling();
            }
          } catch {
            // A failed re-check keeps the hint; the next tick retries.
          }
        })();
      }, DEPLOY_POLL_MS);
    };
    await update();
    store.subscribe(() => void update());
  } catch {
    // Store load failed: keep the static version display as-is.
  }
}

void renderVersion();
