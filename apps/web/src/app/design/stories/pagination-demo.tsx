"use client";

import { useState } from "react";
import { Pagination } from "@/components/ui/pagination";

export function PaginationDemo({ totalPages }: { totalPages: number }) {
  const [page, setPage] = useState(1);
  return (
    <div className="mx-auto w-full max-w-md">
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
