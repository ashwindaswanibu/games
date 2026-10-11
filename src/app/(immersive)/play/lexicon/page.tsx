import { ImmersivePlayScreen, playMetadata } from "@/app/_play/play-screen";
import { LexiconEntry } from "@/games/lexicon/ui";

const GAME_ID = "lexicon";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <ImmersivePlayScreen gameId={GAME_ID}>
      <LexiconEntry />
    </ImmersivePlayScreen>
  );
}
