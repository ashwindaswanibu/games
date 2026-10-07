import { requireProfile } from "@/server/auth";

/**
 * The home draws its own chrome (spec §2.1): signed-in like the rest of the app, but without its
 * header, nav or 512px column.
 */
export default async function HomeLayout({ children }: LayoutProps<"/">) {
  await requireProfile();
  return children;
}
