/**
 * The shared Movies-world UI kit. See `src/games/_movies/README.md` for how the pieces fit a game.
 */
export { MoviesStage, FilmLeader, IrisReveal, MoviesButton, type MoviesStageProps, type MoviesButtonProps } from "./stage";
export { PuzzleImage, type PuzzleImageProps } from "./puzzle-image";
export { FilmSearch, type FilmSearchProps } from "./film-search";
export { PersonSearch, type PersonSearchProps } from "./person-search";
export type { CatalogSearchProps } from "./catalog-combobox";
export { RevealStrip, type RevealStep, type RevealStepStatus, type RevealStripProps } from "./reveal-strip";
export {
  ClueChips,
  GuessLog,
  LastGuess,
  LiveStatus,
  guessAnnouncement,
  type ClueChipsProps,
  type GuessLogEntry,
  type GuessLogProps,
  type LastGuessProps,
} from "./clue-chips";
export { useMoviesVariant, type MoviesVariant } from "./variant";
