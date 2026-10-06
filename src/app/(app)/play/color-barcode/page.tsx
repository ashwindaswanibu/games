import { ColorBarcodeEntry } from "@/games/color-barcode/ui";
import { playMetadata, PlayScreen } from "../_shared/play-screen";

const GAME_ID = "color-barcode";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <PlayScreen gameId={GAME_ID}>
      <ColorBarcodeEntry />
    </PlayScreen>
  );
}
