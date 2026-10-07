import type { CSSProperties } from "react";
import type { HomeView } from "@/core/home-view";
import { Band } from "./band";
import type { HomeComposition } from "./composition";
import { Countdown } from "./countdown";
import { Dial } from "./dial";
import type { GameClock } from "./game-clock";
import { PresenceLine } from "./presence-line";
import styles from "./title.module.css";

/**
 * The day's main title (§4.1): the weekday in the italic voice, the month fitted to the column, the
 * numeral fitted to what is left, the clock beside it; then the band and the presence line.
 * Sticky on a laptop: the credits roll on beside it.
 */
export function TitleColumn({
  view,
  comp,
  clock,
  initialGone,
  pending,
  onZero,
}: {
  view: HomeView;
  comp: HomeComposition;
  clock: GameClock;
  initialGone: number;
  pending: string | null;
  onZero: () => void;
}) {
  const { day } = view;
  const unavailable = view.buckets.reduce((n, b) => n + b.games.filter((g) => g.state === "unavailable").length, 0);
  const typeVars = {
    "--month-adv": comp.type.monthAdvance,
    "--day-ink": comp.type.dayInk,
    "--day-lsb": comp.type.dayLsb,
    "--day-rsb": comp.type.dayRsb,
  } as CSSProperties;

  return (
    <div className={styles.title} style={typeVars} data-op="title" data-comes-up="">
      <div className={styles.heroStrip} style={{ left: comp.strip.left, rotate: comp.strip.rotate, "--cut": comp.strip.clip } as CSSProperties} aria-hidden="true" data-op="hero-strip">
        <i />
        <i />
      </div>
      <h1 className={styles.h1}>
        <span className={styles.wk} data-op="weekday">
          {day.weekday}
        </span>{" "}
        <span className={styles.mo} data-op="month">
          {[...day.month].map((ch, i) => (
            <span key={i} data-op="month-letter">
              {ch}
            </span>
          ))}
        </span>{" "}
        <span className={styles.dayRow}>
          <span className={styles.num} data-op="numeral">
            <span className={styles.numPlate} aria-hidden="true" data-op="numeral-plate">
              {day.dayOfMonth}
            </span>
            {day.dayOfMonth}
          </span>
        </span>
      </h1>
      <div className={styles.clock}>
        <Dial clock={clock} initialGone={initialGone} rimSeed={comp.dialSeed} className={styles.dial} />
        <Countdown clock={clock} onZero={onZero} />
      </div>
      <Band
        progress={view.progress}
        primary={view.primary}
        streak={view.viewer.streak}
        clip={comp.band.clip}
        rotate={comp.band.rotate}
        pending={pending}
        unavailable={unavailable}
      />
      {view.presence && <PresenceLine presence={view.presence} />}
    </div>
  );
}
