"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { cueAt } from "@/core/daylight";
import type { HomeCue, HomeGame, HomeView } from "@/core/home-view";
import { Billing } from "./billing";
import type { HomeComposition } from "./composition";
import { resultSentence, type CreditPhase } from "./credit";
import { clearCutLayers, cutToPicture } from "./cut-to-picture";
import { Fin } from "./fin";
import { watchFrames } from "./frames";
import { readClock, useGameClock } from "./game-clock";
import { clearPrePaint, decideMoments, markHomeSeen, markOpeningSeen, markSetInsPlayed, prePaintScript, type GateConfig } from "./gates";
import { InProduction } from "./in-production";
import { Opening } from "./opening";
import { NightSpill, Room } from "./room";
import { SetIn } from "./set-in";
import { Sheet } from "./sheet";
import { Strip } from "./strip";
import { TabBar } from "./tab-bar";
import { TitleColumn } from "./title-column";
import { UpNext } from "./up-next";
import { prefersReducedMotion, useReducedMotion } from "./use-reduced-motion";
import { WelcomeSlip } from "./welcome-slip";
import styles from "./home.module.css";
import sheetStyles from "./sheet.module.css";

/** Dev-only review hooks (spec §13.2), parsed by the page; always null in production. */
export interface HomeQa {
  /** Shift the whole clock (`?qa_t=HH:MM`): the cue, dial, countdown and opening follow. */
  offsetMs: number;
  /** Force a cue (`?qa_cue=`). */
  cue: HomeCue | null;
  /** `?qa_opening=play` plays the opening; a number freezes it at that millisecond. */
  opening: "play" | number | null;
  /** `?qa_setin=<id>` plays that game's set-in; `qa_st=<ms>` freezes it there. */
  setIn: string | null;
  setInAt: number | null;
  /** `?qa_fin=1`: the FIN card. */
  fin: boolean;
  /** `?qa_frames=1`: log frame deltas while a moment plays. */
  frames: boolean;
  /** `?qa_cue_change=1`: crossfade to the next cue 1.5 s after load. */
  cueChange: boolean;
}

export interface HomeProps {
  view: HomeView;
  comp: HomeComposition;
  /** The cue the server rendered (so the first paint has the right light). */
  initialCue: HomeCue;
  /** Epoch ms the server rendered at (QA time included): the first render's dial. */
  initialNow: number;
  /** The font variable classes (`HOME_FONT_VARS`). */
  className?: string;
  qa?: HomeQa | null;
}

type Moment = "opening" | "fin" | null;

const CUE_FADE_MS = 2400;
const SET_IN_DELAY_MS = 200;

/** True only while React hydrates the server's HTML: the pre-paint script is rendered then and never created on the client. */
const noop = () => () => {};
function useHydrating(): boolean {
  return useSyncExternalStore(
    noop,
    () => false,
    () => true,
  );
}

/** Every visible game, in bucket then registry order. */
function allGames(view: HomeView): HomeGame[] {
  return view.buckets.flatMap((b) => b.games);
}

/**
 * The home's client root: the light (cue), the moments (opening → set-in, comes up, FIN), the
 * per-device gates, and the page itself. Receives plain data only.
 */
export function Home({ view, comp, initialCue, initialNow, className, qa = null }: HomeProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrating = useHydrating();
  const reduced = useReducedMotion();
  const date = view.day.date;
  const clock = useGameClock(view.clock, view.generatedAt, qa?.offsetMs ?? 0);

  // ---- Light --------------------------------------------------------------------------------
  // The room follows New York's daylight on the skew-corrected clock: the first reading puts it in
  // place (a page restored from the back/forward cache may be hours old), a later change of cue
  // crossfades the room over 2.4 s and swaps the inks at the midpoint.
  const [cue, setCue] = useState<HomeCue>(qa?.cue ?? initialCue);
  const [lit, setLit] = useState<HomeCue>(qa?.cue ?? initialCue);
  const [fadeMs, setFadeMs] = useState(0);
  const forced = qa?.cue ?? null;

  useEffect(() => {
    if (forced) return;
    let current: HomeCue | null = null;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = clock.subscribe((reading) => {
      const next = cueAt(reading.now, view.clock);
      if (next === current) return;
      const animate = current !== null && !prefersReducedMotion();
      current = next;
      clearTimeout(swap);
      setFadeMs(animate ? CUE_FADE_MS : 0);
      setLit(next);
      if (animate) swap = setTimeout(() => setCue(next), CUE_FADE_MS / 2);
      else setCue(next);
    });
    return () => {
      unsubscribe();
      clearTimeout(swap);
    };
  }, [clock, view.clock, forced]);

  // QA: crossfade to the next cue 1.5 s after load (`?qa_cue_change=1`).
  useEffect(() => {
    if (!qa?.cueChange) return;
    const order: readonly HomeCue[] = ["morning", "afternoon", "night", "morning"];
    let swap: ReturnType<typeof setTimeout> | undefined;
    let end: ReturnType<typeof setTimeout> | undefined;
    let stop: ((keep?: boolean) => unknown) | null = null;
    const go = setTimeout(() => {
      const next = order[order.indexOf(lit) + 1];
      if (qa.frames) stop = watchFrames("cue crossfade");
      setFadeMs(CUE_FADE_MS);
      setLit(next);
      swap = setTimeout(() => setCue(next), CUE_FADE_MS / 2);
      end = setTimeout(() => stop?.(), CUE_FADE_MS + 100);
    }, 1500);
    return () => {
      clearTimeout(go);
      clearTimeout(swap);
      clearTimeout(end);
      stop?.(false);
    };
    // Once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qa?.cueChange]);

  // ---- Moments ------------------------------------------------------------------------------
  const games = useMemo(() => allGames(view), [view]);
  const finished = useMemo(
    () =>
      games
        .filter((g) => g.state === "finished" && g.result)
        .map((g) => [g.id, Date.parse(g.result!.finishedAt)] as const),
    [games],
  );
  const gate: GateConfig = useMemo(
    () => ({
      date,
      dayStart: Date.parse(view.clock.dayStartsAt),
      finished,
      forceOpening: qa?.opening != null,
      forceSetIn: qa?.setIn ?? null,
    }),
    [date, view.clock.dayStartsAt, finished, qa?.opening, qa?.setIn],
  );

  const [moment, setMoment] = useState<Moment>(null);
  const [openingRun, setOpeningRun] = useState(0);
  const [setIn, setSetIn] = useState<string | null>(null);
  /** A finished game whose set-in has not landed: its credit and chip wait in their pre-state. */
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const decided = useRef<string | null>(null);

  // Decide once per day per mount, before the first paint (client navigations included). The
  // decision reads per-device storage, which exists only after hydration, and must land before the
  // browser paints (or the home would flash before its opening): state set in a layout effect is
  // exactly that, one synchronous re-render before paint.
  useLayoutEffect(() => {
    if (decided.current === date) return;
    decided.current = date;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const still = prefersReducedMotion();
    const m = decideMoments(gate, storage, still);
    if (m.setIn) markSetInsPlayed(date, m.candidates);
    // Reduced motion: no opening, but today's is still counted as seen.
    if (still) markOpeningSeen(date);
    const next: Moment = qa?.fin ? "fin" : m.opening ? "opening" : null;
    const landed = m.setIn ? games.find((g) => g.id === m.setIn) : undefined;
    /* eslint-disable react-hooks/set-state-in-effect -- see above: before the first paint, once */
    if (m.setIn && !still) {
      setPending(m.setIn);
      setSetIn(m.setIn);
    } else if (landed) {
      // Reduced motion: no card; the credit is simply finished, and the result is still announced.
      setAnnounce(resultSentence(landed));
    }
    if (next === "opening") setOpeningRun((n) => n + 1);
    setMoment(next);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Neither moment: a full load comes up (CSS, started by the pre-paint script); a client navigation just shows the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // The pre-paint marks are React's from here on. A page restored from the back/forward cache drops
  // any layer left by a cut to the picture.
  useLayoutEffect(() => {
    clearPrePaint(rootRef.current);
    const restore = () => clearCutLayers(rootRef.current);
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  // A set-in waits for the opening to end (or for none), then 200 ms.
  const [setInLive, setSetInLive] = useState(false);
  useEffect(() => {
    if (!setIn || moment === "opening" || moment === "fin" || setInLive) return;
    const t = setTimeout(() => setSetInLive(true), SET_IN_DELAY_MS);
    return () => clearTimeout(t);
  }, [setIn, moment, setInLive]);

  const onOpeningEnd = useCallback(() => {
    markOpeningSeen(date);
    setMoment(null);
  }, [date]);

  const onSetInEnd = useCallback(
    (sentence: string) => {
      setAnnounce(sentence);
      setPending(null);
      setSetIn(null);
      setSetInLive(false);
    },
    [],
  );

  const replay = useCallback(() => {
    if (prefersReducedMotion()) return;
    setOpeningRun((n) => n + 1);
    setMoment("opening");
  }, []);

  const onZero = useCallback(() => {
    setMoment("fin");
  }, []);

  // The new day's view arrives with a new date, which decides its opening; if it does not come
  // (a device clock ahead of New York), FIN gives way after a while rather than hang.
  const onFinEnd = useCallback(() => {
    router.refresh();
    setTimeout(() => setMoment((m) => (m === "fin" ? null : m)), 8000);
  }, [router]);

  // Remember when this device last saw the home (for the next visit's set-in).
  useEffect(() => {
    const save = () => markHomeSeen(date, clock.now());
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [date, clock]);

  // ---- Cut to the picture ---------------------------------------------------------------------
  const onOpen = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, game: HomeGame) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (prefersReducedMotion()) return;
      e.preventDefault();
      cutToPicture(e.currentTarget, game, () => router.push(game.href));
    },
    [router],
  );

  // ---- Page -------------------------------------------------------------------------------------
  const openBuckets = view.buckets.filter((b) => b.status === "open");
  const quietBuckets = view.buckets.filter((b) => b.status === "in_production");
  const density = games.length === 1 ? "solo" : games.length >= 9 ? "dense" : "standard";
  const primaryId = view.primary?.gameId ?? null;
  const firstOpen = openBuckets[0];
  // Phone only (CSS): the primary's game is below the first sheet. "Today's standings" needs no
  // slip: the band holds it, above the fold, and a second filled pill would break the one-primary rule.
  const upNext = view.primary !== null && view.primary.kind !== "standings" && (!firstOpen || !firstOpen.games.some((g) => g.id === primaryId));
  const primaryGame = primaryId ? games.find((g) => g.id === primaryId) ?? null : null;
  const initialGone = readClock(view.clock, initialNow).gone;
  const phaseOf = useCallback((id: string): CreditPhase => (id === pending ? "pre" : "rest"), [pending]);
  const setInGame = setIn ? games.find((g) => g.id === setIn) ?? null : null;
  const setInBucket = setIn ? view.buckets.find((b) => b.games.some((g) => g.id === setIn))?.id ?? null : null;

  return (
    <div
      ref={rootRef}
      className={`${styles.home} ${className ?? ""}`}
      data-cue={cue}
      data-moment={moment ?? undefined}
      data-upnext={upNext ? "" : undefined}
      data-home=""
      suppressHydrationWarning
    >
      {hydrating && <script dangerouslySetInnerHTML={{ __html: prePaintScript(gate) }} />}
      <Room lit={lit} light={cue} fadeMs={reduced ? 0 : fadeMs} />
      <div className={styles.cover} aria-hidden="true" />
      <div className={styles.chrome} data-op="strip" data-comes-up="" style={{ "--i": 0 } as CSSProperties}>
        <Strip viewer={view.viewer} onReplay={replay} />
      </div>
      <main className={styles.stage} inert={moment === "opening"} data-stage="">
        <NightSpill night={cue === "night"} className={styles.spill} />
        <TitleColumn view={view} comp={comp} clock={clock} initialGone={initialGone} pending={pending} onZero={onZero} />
        <div className={sheetStyles.creditsCol} data-density={density} data-op="credits">
          {view.welcome && <WelcomeSlip welcome={view.welcome} cut={comp.slips.welcome} />}
          {upNext && view.primary && <UpNext primary={view.primary} game={primaryGame} cut={comp.slips.upNext} onOpen={onOpen} />}
          {openBuckets.map((b, i) => (
            <Sheet
              key={b.id}
              bucket={b}
              date={date}
              cut={comp.sheets[b.id]}
              words={comp.words}
              vanishX={comp.vanishX}
              primaryId={primaryId}
              phaseOf={phaseOf}
              onOpen={onOpen}
              index={i}
            />
          ))}
          <InProduction buckets={quietBuckets} cuts={comp.wings} words={comp.words} vanishX={comp.vanishX} />
          {setInLive && setInGame && setInBucket && (
            <SetIn
              key={setInGame.id}
              game={setInGame}
              bucket={setInBucket}
              date={date}
              cut={comp.cards[setInGame.id]}
              freezeAt={qa?.setInAt ?? null}
              frames={qa?.frames ?? false}
              onEnd={onSetInEnd}
            />
          )}
        </div>
      </main>
      <Billing billing={view.billing} />
      <TabBar viewer={view.viewer} tear={comp.tabTear} />
      <p className={styles.srOnly} aria-live="polite">
        {announce}
      </p>
      {moment === "opening" && (
        <Opening
          key={openingRun}
          view={view}
          comp={comp}
          now={clock.now()}
          freezeAt={typeof qa?.opening === "number" ? qa.opening : null}
          frames={qa?.frames ?? false}
          onEnd={onOpeningEnd}
        />
      )}
      {moment === "fin" && <Fin day={view.day} fin={comp.fin} plate={comp.slips.fin} reduced={reduced} hold={qa?.fin ?? false} onEnd={onFinEnd} />}
    </div>
  );
}
