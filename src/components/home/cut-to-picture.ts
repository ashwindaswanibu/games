import type { HomeGame } from "@/core/home-view";

/** Cut to the picture (built in the motion pass). */
export function cutToPicture(_from: HTMLElement, _game: HomeGame, go: () => void): void {
  go();
}
