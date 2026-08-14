import { notFound } from "next/navigation";
import ProductionCanvas from "@/components/ProductionCanvas";
import { getProject } from "@/lib/data";

export default async function ProductionProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  return <ProductionCanvas project={project} />;
}
