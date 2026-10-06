import { Archivo, Six_Caps } from "next/font/google";

/**
 * Movies-world type: Six Caps for film-title display lines (the condensed poster face), Archivo
 * with its width axis for everything else. Self-hosted by next/font; applied by setting
 * `MOVIES_FONT_VARS` on a kit component's root, which defines `--mv-font-film` / `--mv-font-sans`.
 */
const film = Six_Caps({ weight: "400", subsets: ["latin", "latin-ext"], variable: "--mv-font-film", display: "swap" });
const sans = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--mv-font-sans", display: "swap" });

export const MOVIES_FONT_VARS = `${film.variable} ${sans.variable}`;
