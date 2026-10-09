import { ImmersivePlayScreen, playMetadata } from "@/app/_play/play-screen";
import { DegreesEntry } from "@/games/degrees/ui";

const GAME_ID = "degrees";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <ImmersivePlayScreen gameId={GAME_ID}>
      <DegreesEntry />
    </ImmersivePlayScreen>
  );
}
