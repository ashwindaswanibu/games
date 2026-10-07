import { NumberHuntEntry } from "@/games/number-hunt/ui";
import { playMetadata, PlayScreen } from "@/app/_play/play-screen";

const GAME_ID = "number-hunt";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <PlayScreen gameId={GAME_ID}>
      <NumberHuntEntry />
    </PlayScreen>
  );
}
