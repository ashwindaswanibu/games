import { FrameByFrameEntry } from "@/games/frame-by-frame/ui";
import { playMetadata, PlayScreen } from "../_shared/play-screen";

const GAME_ID = "frame-by-frame";

export const generateMetadata = () => playMetadata(GAME_ID);

export default function Page() {
  return (
    <PlayScreen gameId={GAME_ID}>
      <FrameByFrameEntry />
    </PlayScreen>
  );
}
