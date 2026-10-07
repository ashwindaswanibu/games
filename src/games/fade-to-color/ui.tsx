"use client";

import { connectImmersiveGameUi } from "../game-ui-context";
import { FadeToColorTheater } from "./theater/theater";

/** What the play page renders for this game; the immersive game host supplies the props. */
export const FadeToColorEntry = connectImmersiveGameUi(FadeToColorTheater);
