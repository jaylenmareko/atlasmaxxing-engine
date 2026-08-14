import Link from "next/link";
import { characters, projects, type ProjectTone } from "@/lib/data";

const toneColor: Record<ProjectTone, string> = {
  blue: "var(--blue)",
  green: "var(--green)",
  violet: "var(--violet)",
  muted: "var(--muted)",
};

export default function LibraryPage() {
  return (
    <div className="flex-1 overflow-auto p-8">
      <section className="mx-auto mb-10 max-w-4xl">
        <h2 className="text-[15px] font-bold">Characters</h2>
        <p className="mb-4 text-[12px]" style={{ color: "var(--muted)" }}>
          Locked identity, wardrobe, environments — one card per character, reused across every project.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {characters.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 rounded-xl border bg-node p-3 shadow" style={{ borderColor: "var(--node-line)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.photo} alt={c.name} className="aspect-square w-full rounded-lg border object-cover" style={{ borderColor: "var(--node-line)" }} />
              <div className="text-[13px] font-bold">{c.name}</div>
              <div className="flex flex-wrap gap-2 font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                <span>{c.wardrobe} wardrobe</span>
                <span>{c.environments} environments</span>
                <span>{c.page}</span>
              </div>
            </div>
          ))}
          <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed text-[13px] font-semibold" style={{ borderColor: "var(--node-line)", color: "var(--muted)" }}>
            + Add character
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl">
        <h2 className="text-[15px] font-bold">Projects</h2>
        <p className="mb-4 text-[12px]" style={{ color: "var(--muted)" }}>
          Every video, current stage, version history — newest first. Click one to open it in Production.
        </p>
        <div className="flex flex-col gap-2">
          {projects.map((p) => {
            const character = characters.find((c) => c.id === p.characterId);
            return (
              <Link
                key={p.id}
                href={`/production/${p.id}`}
                className="grid grid-cols-[44px_1fr_auto_auto_auto] items-center gap-3 rounded-xl border bg-node p-3 shadow transition-transform hover:scale-[1.01]"
                style={{ borderColor: "var(--node-line)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" className="h-[58px] w-11 rounded-md border object-cover" style={{ borderColor: "var(--node-line)" }} />
                <div>
                  <div className="text-[13px] font-semibold">{p.title}</div>
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>{character?.name ?? p.characterId} · {p.version} · {p.source}</div>
                </div>
                <span className="rounded-full border px-2 py-1 font-mono text-[10px] font-bold" style={{ borderColor: "var(--node-line)", color: "var(--coral-deep)" }}>
                  {p.version}
                </span>
                <span
                  className="whitespace-nowrap rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase"
                  style={{ background: `color-mix(in srgb, ${toneColor[p.tone]} 16%, transparent)`, color: toneColor[p.tone] }}
                >
                  {p.status}
                </span>
                <span className="whitespace-nowrap text-right font-mono text-[11px]" style={{ color: "var(--faint)" }}>{p.updated}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
