import { requireProfile } from "@/server/auth";

/**
 * Full-screen games: signed-in like the rest of the app, but without its header, nav or column,
 * so the game can use the whole window. Each game draws its own way back.
 */
export default async function ImmersiveLayout({ children }: LayoutProps<"/">) {
  await requireProfile();
  return children;
}
