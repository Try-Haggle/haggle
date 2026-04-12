import { customType } from "drizzle-orm/pg-core";

export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; dpiData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value: number[]) => `[${value.join(",")}]`,
    fromDriver: (value: unknown) =>
      (value as string).slice(1, -1).split(",").map(Number),
  })(name);
