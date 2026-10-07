"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./theater.module.css";

/**
 * The win, on the screen: the title matte. You name the film and the film says its name back. Over
 * the picture sit a black card (`dip`) and, above it, the title cut out of the picture itself
 * (`matte`: the same picture, registered pixel for pixel to the screen, seen through the letters),
 * so as the black comes down the name emerges out of the film. Then the letters fade to colour,
 * left to right (`lit`: the film's barcode as light, one slice per letter), with one swell of
 * light (`bloom`) that settles into a close halo (`halo`). Then the film rolls on: its last reel
 * unreels over the card (`wipe`), with the reel's own sweep of light.
 *
 * Nothing here moves by itself: the win's timeline (`win-timeline.ts`) plays every part, found by
 * `data-win`. The card is for looking at only; the end card names the film for everyone.
 */
export function TitleCard(props: {
  title: string;
  /** The picture on screen (its URL), which the letters are cut from. */
  picture: string;
  /** The film's barcode as light, graded (a data URL): what the letters fill with. */
  fill: string | null;
  /** The last reel's picture, when the card leaves by unreeling onto it. */
  next: string | null;
  reduced: boolean;
  /** The last reel's picture is decoded (true) or failed to load (false). */
  onNextReady(ok: boolean): void;
}) {
  const { title, picture, fill, next, reduced, onNextReady } = props;
  // Letter by letter, or word by word on WebKit and for long titles (fewer layers to composite).
  const [byWord] = useState(() => title.length > 20 || isWebKit());
  const nextImg = useRef<HTMLImageElement>(null);
  const readyRef = useRef(onNextReady);
  useLayoutEffect(() => {
    readyRef.current = onNextReady;
  });

  useEffect(() => {
    const img = nextImg.current;
    if (!img || !next) return;
    let live = true;
    img.decode().then(
      () => live && readyRef.current(true),
      () => live && readyRef.current(false),
    );
    return () => {
      live = false;
    };
  }, [next]);

  const units = titleUnits(title, byWord);
  return (
    <div className={styles.titleCard} data-reduced={reduced || undefined} aria-hidden>
      {!reduced && <div className={styles.dip} data-win="dip" />}
      {!reduced && (
        <div className={styles.card} data-win="card">
          <canvas className={styles.cardLight} data-win="bloom" />
          <canvas className={styles.cardLight} data-win="halo" />
          <div className={styles.matte} style={{ "--pic": `url(${picture})` } as CSSProperties} data-win="matte">
            <TitleText units={units} className={styles.cardTitle} />
          </div>
          <TitleText
            units={units}
            className={`${styles.cardTitle} ${styles.cardLit}`}
            style={fill ? ({ "--fill": `url(${fill})` } as CSSProperties) : undefined}
            lit
          />
        </div>
      )}
      {next && (
        <div className={styles.cardWipe} data-win="wipe">
          {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin asset, decoded and animated by hand */}
          <img ref={nextImg} className={styles.frame} src={next} alt="" decoding="async" data-win="next" />
        </div>
      )}
      {next && !reduced && (
        <>
          <div className={styles.flare} data-win="flare" />
          <div className={styles.cardBarTrack} data-win="bar">
            <div className={styles.cardBar} />
          </div>
        </>
      )}
    </div>
  );
}

/** The title's own light, thrown into the room behind the reel as it takes its colour: a narrow spill of its bands, a faint glow on the floor. */
export function TitleAura({ fill }: { fill: string | null }) {
  return (
    <>
      <div className={`${styles.spill} ${styles.auraSpill}`} style={fill ? { backgroundImage: `url(${fill})` } : undefined} data-win="aura-spill" aria-hidden />
      <div className={styles.auraGlow} data-win="aura-glow" aria-hidden />
    </>
  );
}

/** One piece of the title that takes its colour on its own: a letter, or a whole word. `at` is its first letter's place among the letters. */
interface TitleUnit {
  text: string;
  at: number;
}

/** The title as words (kept whole on a line), each a list of units; whitespace between them as is. */
function titleUnits(title: string, byWord: boolean): (string | TitleUnit[])[] {
  let at = 0;
  return title.split(/(\s+)/).map((part) => {
    if (/^\s*$/.test(part)) return part;
    const chars = [...part];
    const units = byWord ? [{ text: part, at }] : chars.map((ch, i) => ({ text: ch, at: at + i }));
    at += chars.length;
    return units;
  });
}

/** The title in units. The matte and the lit title share it exactly, so they break and kern alike and stay in register. */
function TitleText(props: { units: (string | TitleUnit[])[]; className: string; style?: CSSProperties; lit?: boolean }) {
  const { units, className, style, lit } = props;
  return (
    <span className={className} style={style} data-win={lit ? "lit" : undefined} data-fill={lit && style ? "" : undefined}>
      {units.map((part, p) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={p} className={styles.word}>
            {part.map((unit) => (
              <span key={unit.at} className={styles.cardUnit} data-at={lit ? unit.at : undefined}>
                {unit.text}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}

/** Safari, and every browser on iOS: per-letter clipped layers are costly there. */
function isWebKit(): boolean {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}
