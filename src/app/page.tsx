import { redirect } from "next/navigation";
import { getUserId } from "@/lib/server/session";

export default async function Home() {
  redirect((await getUserId()) ? "/dashboard" : "/login");
}
