import { ColorGradeEntry } from "@/games/color-grade/ui";
import { playMetadata, PlayScreen } from "../_shared/play-screen";

const GAME_ID = "color-grade";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <PlayScreen gameId={GAME_ID}>
      <ColorGradeEntry />
    </PlayScreen>
  );
}
