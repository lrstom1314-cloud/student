import { redirect } from "next/navigation";

import { getSessionUser, landingFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? landingFor(user) : "/login");
}
