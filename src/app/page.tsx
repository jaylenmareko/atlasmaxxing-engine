import { redirect } from "next/navigation";
import { projects } from "@/lib/data";

// "/" has no meaning on its own — send people to the most recent project.
export default function Home() {
  redirect(`/production/${projects[0].id}`);
}
