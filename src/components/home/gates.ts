/**
 * When the home's two moments play, decided per device from localStorage:
 *
 *  - `home.opening.v1:<date>` = "1" once today's opening titles finished or were skipped.
 *  - `home.seen.v1` = `{ date, at, setIn }`: when this device last saw the home (epoch ms) and which
 *    set-ins already played today.
 *
 * Every access is guarded: storage can be missing or throw (private windows, blocked site data).
 * A failure counts as "seen" for the opening and "nothing new" for the set-in, so a broken storage
 * never replays a moment on every visit.
 *
 * The decision runs twice: in the pre-paint script (a hard load of "/" decides before the first
 * paint, so nothing flashes; `PREPAINT_DECIDE_SRC`), and in the client root on client navigations
 * (`decideMoments`).
 */

export const OPENING_KEY_PREFIX = "home.opening.v1:";
export const SEEN_KEY = "home.seen.v1";

export interface GateConfig {
  /** Today's puzzle date. */
  date: string;
  /** Epoch ms when today began in New York. */
  dayStart: number;
  /** The viewer's finished games today: [gameId, finishedAt (epoch ms)]. */
  finished: readonly (readonly [string, number])[];
  /** QA overrides (dev only): force the opening / a set-in regardless of storage. */
  forceOpening?: boolean;
  forceSetIn?: string | null;
}

export interface Moments {
  opening: boolean;
  /** The game whose result sets in, or null. */
  setIn: string | null;
  /** Every finished game newer than the last visit (all are marked seen when the set-in plays). */
  candidates: string[];
}

export interface SeenRecord {
  date: string;
  at: number;
  setIn: string[];
}

export function decideMoments(cfg: GateConfig, storage: Pick<Storage, "getItem"> | null, reducedMotion: boolean): Moments {
  let opening = false;
  let setIn: string | null = null;
  let candidates: string[] = [];
  try {
    if (!storage) throw new Error("no storage");
    opening = storage.getItem("home.opening.v1:" + cfg.date) === null;
    const raw = storage.getItem("home.seen.v1");
    const seen = raw ? JSON.parse(raw) : null;
    if (seen && typeof seen.at === "number" && typeof seen.date === "string") {
      const today = seen.date === cfg.date;
      const last = today ? seen.at : cfg.dayStart;
      const played: string[] = today && Array.isArray(seen.setIn) ? seen.setIn : [];
      let best = -1;
      for (let i = 0; i < cfg.finished.length; i++) {
        const id = cfg.finished[i][0];
        const at = cfg.finished[i][1];
        if (at > last && played.indexOf(id) < 0) {
          candidates.push(id);
          if (at > best) {
            best = at;
            setIn = id;
          }
        }
      }
    }
  } catch {
    opening = false;
    setIn = null;
    candidates = [];
  }
  if (reducedMotion) opening = false;
  if (cfg.forceOpening) opening = true;
  if (cfg.forceSetIn) {
    setIn = cfg.forceSetIn;
    if (candidates.indexOf(setIn) < 0) candidates.push(setIn);
  }
  return { opening: opening, setIn: setIn, candidates: candidates };
}

/** The CSS that holds a credit in its pre-state (keylines, no result) before the set-in starts. */
export function preSetInCss(gameId: string): string {
  const id = gameId.replace(/[^a-z0-9-]/g, "");
  return (
    `[data-credit="${id}"] [data-result]{visibility:hidden}` +
    `[data-credit="${id}"] [data-keyline]{visibility:visible}` +
    `[data-chip="${id}"] b{visibility:hidden}` +
    `[data-band-n][data-pre-for~="${id}"] [data-n-now]{visibility:hidden}` +
    `[data-band-n][data-pre-for~="${id}"] [data-n-before]{visibility:visible}`
  );
}

/**
 * `decideMoments` and `preSetInCss` again, as plain ES5 for the inline script. Hand-written rather
 * than `Function.prototype.toString()`, so the server's and the browser's HTML are byte-identical
 * whatever the bundlers do; `gates.test.ts` holds the two versions to the same decisions.
 */
export const PREPAINT_DECIDE_SRC =
  "function(cfg,storage,rm){var opening=false,setIn=null,candidates=[];try{if(!storage)throw 0;" +
  'opening=storage.getItem("home.opening.v1:"+cfg.date)===null;var raw=storage.getItem("home.seen.v1");var seen=raw?JSON.parse(raw):null;' +
  'if(seen&&typeof seen.at==="number"&&typeof seen.date==="string"){var today=seen.date===cfg.date;var last=today?seen.at:cfg.dayStart;' +
  "var played=today&&Array.isArray(seen.setIn)?seen.setIn:[];var best=-1;for(var i=0;i<cfg.finished.length;i++){var id=cfg.finished[i][0],at=cfg.finished[i][1];" +
  "if(at>last&&played.indexOf(id)<0){candidates.push(id);if(at>best){best=at;setIn=id}}}}}catch(e){opening=false;setIn=null;candidates=[]}" +
  "if(rm)opening=false;if(cfg.forceOpening)opening=true;if(cfg.forceSetIn){setIn=cfg.forceSetIn;if(candidates.indexOf(setIn)<0)candidates.push(setIn)}" +
  "return{opening:opening,setIn:setIn,candidates:candidates}}";

export const PREPAINT_CSS_SRC =
  'function(gameId){var id=gameId.replace(/[^a-z0-9-]/g,"");' +
  "return'[data-credit=\"'+id+'\"] [data-result]{visibility:hidden}'+'[data-credit=\"'+id+'\"] [data-keyline]{visibility:visible}'+" +
  "'[data-chip=\"'+id+'\"] b{visibility:hidden}'+'[data-band-n][data-pre-for~=\"'+id+'\"] [data-n-now]{visibility:hidden}'+" +
  "'[data-band-n][data-pre-for~=\"'+id+'\"] [data-n-before]{visibility:visible}'}";

/**
 * The inline script, the first child of the home root (`document.currentScript.parentElement`).
 * Marks the root before the first paint: `data-pre="opening"` paints the opening's cover;
 * `data-pre="comes-up"` starts the return visit's come-up; `data-pre-setin="<id>"` plus a style
 * element holds that credit in its pre-state.
 */
export function prePaintScript(cfg: GateConfig): string {
  return (
    "(function(){try{var root=document.currentScript.parentElement;" +
    `var decide=${PREPAINT_DECIDE_SRC};var css=${PREPAINT_CSS_SRC};` +
    'var s=null;try{s=window.localStorage}catch(e){}var rm=false;try{rm=window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}' +
    `var m=decide(${JSON.stringify(cfg).replace(/</g, "\\u003c")},s,rm);` +
    'if(m.opening)root.setAttribute("data-pre","opening");else if(!m.setIn&&!rm)root.setAttribute("data-pre","comes-up");' +
    'if(m.setIn&&!rm){root.setAttribute("data-pre-setin",m.setIn);var st=document.createElement("style");st.setAttribute("data-home-pre","");st.textContent=css(m.setIn);document.head.appendChild(st)}' +
    "}catch(e){}})();"
  );
}

/**
 * Removes what the pre-paint script added, once the client root has taken over. The come-up is
 * left to finish (it is CSS only, and removing it mid-way would restart nothing but end it early).
 */
export function clearPrePaint(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (root.getAttribute("data-pre") === "comes-up") {
    // Done by then (700 ms, staggered): drop the mark so nothing stays animated at rest.
    timer = setTimeout(() => root.removeAttribute("data-pre"), 1600);
  } else root.removeAttribute("data-pre");
  root.removeAttribute("data-pre-setin");
  document.querySelectorAll("style[data-home-pre]").forEach((el) => el.remove());
  return () => clearTimeout(timer);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Records that today's opening played (or was skipped), and forgets every other day's key. */
export function markOpeningSeen(date: string): void {
  try {
    const s = window.localStorage;
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && key.startsWith(OPENING_KEY_PREFIX) && key !== OPENING_KEY_PREFIX + date) stale.push(key);
    }
    for (const key of stale) s.removeItem(key);
    s.setItem(OPENING_KEY_PREFIX + date, "1");
  } catch {
    // Storage unavailable: the root's in-memory state still stops a repeat in this page view.
  }
}

export function readSeen(): SeenRecord | null {
  try {
    const raw = storage()?.getItem(SEEN_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.date === "string" && typeof v.at === "number" ? { date: v.date, at: v.at, setIn: Array.isArray(v.setIn) ? v.setIn : [] } : null;
  } catch {
    return null;
  }
}

function writeSeen(record: SeenRecord): void {
  try {
    storage()?.setItem(SEEN_KEY, JSON.stringify(record));
  } catch {
    // Unavailable: nothing to remember on this device.
  }
}

/** This device saw the home at `at` (written when the page is hidden or left). */
export function markHomeSeen(date: string, at: number): void {
  const prev = readSeen();
  writeSeen({ date, at, setIn: prev && prev.date === date ? prev.setIn : [] });
}

/** These games' set-ins are done for today on this device. */
export function markSetInsPlayed(date: string, ids: readonly string[]): void {
  const prev = readSeen();
  const setIn = prev && prev.date === date ? [...new Set([...prev.setIn, ...ids])] : [...ids];
  writeSeen({ date, at: prev && prev.date === date ? prev.at : 0, setIn });
}
