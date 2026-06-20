"use client";

import { useState } from "react";
import { TagInput } from "@/components/ui/tag-input";

export function TagInputDemo() {
  const [tags, setTags] = useState<string[]>(["전자기기", "애플"]);
  return <TagInput value={tags} onChange={setTags} placeholder="태그 입력 후 Enter" max={8} />;
}
