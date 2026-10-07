import type { HomeGame } from "@/core/home-view";
import { EASE_IO } from "./timeline";
import styles from "./moments.module.css";

const DURATION = 320;

/**
 * Cut to the picture (spec §8.6): the credit's sheet of paper, or for a full-screen game (Fade to
 * Color) an ink layer, scales from where it sits to fill the window, then the game's route is
 * pushed; the home unmounting is the hard cut. If the route is slow, the full-screen sheet holds
 * with the game's name on it (never a spinner). The layer lives inside the home's root, so it goes
 * when the home does.
 */
export function cutToPicture(link: HTMLElement, game: HomeGame, go: () => void): void {
  const home = link.closest<HTMLElement>("[data-home]");
  const sheet = link.closest<HTMLElement>("[data-sheet]");
  if (!home || !sheet) {
    go();
    return;
  }
  const from = (game.fullScreen ? link : sheet).getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const paper = getComputedStyle(sheet).getPropertyValue("--sheet").trim();
  const ink = getComputedStyle(sheet).getPropertyValue("--fink").trim();

  const layer = document.createElement("div");
  layer.className = styles.cutLayer;
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.cutLayer = "";
  if (game.fullScreen) {
    layer.style.background = "#050506";
    layer.style.color = "oklch(0.935 0.015 81)";
  } else {
    layer.style.background = `${paper || "var(--verm)"} url("/home/fibre-light-240.png")`;
    layer.style.color = ink || "var(--sheet-ink)";
  }
  const name = document.createElement("span");
  name.className = styles.cutName;
  name.textContent = game.name;
  layer.append(name);
  home.append(layer);

  const sx = from.width / vw;
  const sy = from.height / vh;
  const animation = layer.animate(
    [{ transform: `translate(${from.left}px, ${from.top}px) scale(${sx}, ${sy})` }, { transform: "translate(0px, 0px) scale(1, 1)" }],
    { duration: DURATION, easing: EASE_IO, fill: "both" },
  );
  animation.onfinish = go;
}

/** Leftover layers (a page restored from the back/forward cache) are cleared when the home mounts. */
export function clearCutLayers(home: HTMLElement | null): void {
  home?.querySelectorAll("[data-cut-layer]").forEach((el) => el.remove());
}
