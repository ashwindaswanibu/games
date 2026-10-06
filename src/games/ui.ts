import type { AnyGameUi } from "@/core/view";
import { ColorBarcodeUi } from "./color-barcode/ui";
import { ColorGradeUi } from "./color-grade/ui";
import { DegreesUi } from "./degrees/ui";
import { FrameByFrameUi } from "./frame-by-frame/ui";
import { NumberHuntUi } from "./number-hunt/ui";

/** Game id → client UI component. Keys must match `GAMES` in `./registry.ts`. */
export const GAME_UIS: Readonly<Record<string, AnyGameUi>> = {
  "number-hunt": NumberHuntUi,
  "degrees": DegreesUi,
  "frame-by-frame": FrameByFrameUi,
  "color-grade": ColorGradeUi,
  "color-barcode": ColorBarcodeUi,
};
