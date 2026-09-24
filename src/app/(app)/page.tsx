"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { HOME_ORDER } from "@/components/nav";
import { useSession } from "@/components/session";
import { Loading } from "@/components/ui";

export default function Home() {
  const { can } = useSession();
  const router = useRouter();
  useEffect(() => {
    const target = HOME_ORDER.find((h) => can(h.perm))?.href ?? "/perfil";
    router.replace(target);
  }, [can, router]);
  return <Loading label="Ingresando…" />;
}
