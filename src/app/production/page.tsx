import { redirect } from "next/navigation";
import { projects } from "@/lib/data";

// /production with no project id — land on the most recent one.
export default function ProductionIndex() {
  redirect(`/production/${projects[0].id}`);
}
