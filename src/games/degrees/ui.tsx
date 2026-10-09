"use client";

import { connectImmersiveGameUi } from "../game-ui-context";
import { DegreesScreen } from "./screen/screen";

/** What the play page renders for this game; the immersive game host supplies the props. */
export const DegreesEntry = connectImmersiveGameUi(DegreesScreen);
