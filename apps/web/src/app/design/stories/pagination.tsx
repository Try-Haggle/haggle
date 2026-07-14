import { PaginationDemo } from "./pagination-demo";
import type { Story } from "./types";

export const paginationStory: Story = {
  slug: "pagination",
  name: "Pagination",
  componentName: "Pagination",
  controls: {
    totalPages: { type: "select", options: ["1", "3", "8"], default: "8" },
  },
  render: (a) => <PaginationDemo totalPages={Number(a.totalPages)} />,
};
