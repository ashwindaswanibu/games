import { DegreesEntry } from "@/games/degrees/ui";
import { playMetadata, PlayScreen } from "../_shared/play-screen";

const GAME_ID = "degrees";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <PlayScreen gameId={GAME_ID}>
      <DegreesEntry />
    </PlayScreen>
  );
}
