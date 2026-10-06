"use client";

import { createContext, useContext } from "react";

/**
 * `ochre`: the Movies world (ink and ochre with a cyan projector-beam accent).
 * `neutral`: a colorist's suite. Everything around the image is neutral gray (R = G = B) so the
 * surround doesn't bias how colors read. Use it for games that are about color.
 */
export type MoviesVariant = "ochre" | "neutral";

const VariantContext = createContext<MoviesVariant>("ochre");

export const MoviesVariantProvider = VariantContext.Provider;

/** The variant from the nearest `MoviesStage`, unless a component is given one explicitly. */
export function useMoviesVariant(explicit?: MoviesVariant): MoviesVariant {
  const inherited = useContext(VariantContext);
  return explicit ?? inherited;
}
