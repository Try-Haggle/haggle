import { notFound } from "next/navigation";
import { Playground } from "../playground";
import { getStory, stories } from "../stories/registry";

export function generateStaticParams() {
  return stories.map((s) => ({ slug: s.slug }));
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStory(slug)) {
    notFound();
  }
  return <Playground slug={slug} />;
}
