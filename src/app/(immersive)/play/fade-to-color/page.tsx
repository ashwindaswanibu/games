import { ImmersivePlayScreen, playMetadata } from "@/app/_play/play-screen";
import { FadeToColorEntry } from "@/games/fade-to-color/ui";

const GAME_ID = "fade-to-color";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <ImmersivePlayScreen gameId={GAME_ID}>
      <FadeToColorEntry />
    </ImmersivePlayScreen>
  );
}
