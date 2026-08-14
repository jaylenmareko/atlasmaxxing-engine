"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getCharacter, getProject, projects } from "@/lib/data";

// Shared chrome across every route. Tabs are real links to real routes now
// (not local useState) — Production always points at whichever project is
// currently open, or the first project if none is, so switching to the
// Library tab and back doesn't lose your place.
export default function Header() {
  const pathname = usePathname();
  const isLibrary = pathname.startsWith("/library");

  const activeProjectId = pathname.startsWith("/production/") ? pathname.split("/")[2] : undefined;
  const activeProject = activeProjectId ? getProject(activeProjectId) : undefined;
  const activeCharacter = activeProject ? getCharacter(activeProject.characterId) : undefined;
  // fall back to the first project whenever there's no valid project on the
  // URL yet (on /library, or on a bad/expired project id) — otherwise a 404
  // would link the Production tab right back to itself
  const productionHref = `/production/${activeProject?.id ?? projects[0].id}`;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-5 border-b px-5 py-3" style={{ borderColor: "var(--node-line)", background: "var(--node)" }}>
      <div className="flex items-center gap-2 font-bold">
        <span className="h-5 w-5 rounded-md" style={{ background: "linear-gradient(135deg, var(--coral), var(--blue))" }} />
        Engine
      </div>
      <div className="flex gap-0.5 rounded-full p-1" style={{ background: "var(--canvas-2)" }}>
        <TabLink href={productionHref} active={!isLibrary}>Production</TabLink>
        <TabLink href="/library" active={isLibrary}>Library</TabLink>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {activeProject && (
          <>
            <span className="rounded-full border px-2 py-1 font-mono text-[10.5px] font-bold" style={{ borderColor: "var(--node-line)", color: "var(--coral-deep)" }}>
              {activeProject.version}
            </span>
            <span className="rounded-full border px-2 py-1 font-mono text-[10.5px] font-bold" style={{ borderColor: "var(--node-line)", color: "var(--muted)" }}>
              {activeCharacter?.name ?? activeProject.characterId} · {activeProject.tag}
            </span>
          </>
        )}
      </div>
    </header>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-colors"
      style={{
        background: active ? "var(--node)" : "transparent",
        color: active ? "var(--ink)" : "var(--muted)",
        boxShadow: active ? "0 1px 2px rgba(30,30,25,.07), 0 8px 20px -10px rgba(30,30,25,.16)" : "none",
      }}
    >
      {children}
    </Link>
  );
}
