const KEY = "cielpos_auth_v1";
const LAST_KEY = "cielpos_auth_last_v1";

// 1 dakika inaktiflikte kilit
export const IDLE_MS = 60_000;

function now() {
  return Date.now();
}

function readLast(): number {
  const v = sessionStorage.getItem(LAST_KEY);
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

function writeLast(t: number) {
  sessionStorage.setItem(LAST_KEY, String(t));
}

export function isAuthed(): boolean {
  const flag = sessionStorage.getItem(KEY) === "1";
  if (!flag) return false;

  const last = readLast();
  if (!last) {
    logout();
    return false;
  }

  const idle = now() - last;
  if (idle > IDLE_MS) {
    logout();
    return false;
  }

  return true;
}

export function setAuthed(v: boolean) {
  if (v) {
    sessionStorage.setItem(KEY, "1");
    writeLast(now());
  } else {
    logout();
  }
}

//Kullanıcı hareket ettikçe süreyi uzat
export function touchAuth() {
  if (sessionStorage.getItem(KEY) === "1") {
    writeLast(now());
  }
}

export function logout() {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(LAST_KEY);
}


export function startIdleWatch(onExpired: () => void) {
  const onActivity = () => {
    if (sessionStorage.getItem(KEY) === "1") touchAuth();
  };

  const events: (keyof WindowEventMap)[] = [
    "mousemove",
    "mousedown",
    "keydown",
    "wheel",
    "touchstart",
  ];

  events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

  const timer = window.setInterval(() => {
    const ok = isAuthed();
    if (!ok) onExpired();
  }, 2000);

  // cleanup döndür
  return () => {
    events.forEach((ev) => window.removeEventListener(ev, onActivity as any));
    window.clearInterval(timer);
  };
}