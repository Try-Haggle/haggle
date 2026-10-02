import { type ComponentType, lazy, Suspense } from "react";

// Next's client-only dynamic boundary under Vite; the imported checkout components are real.
export default function dynamic<P extends object>(
  load: () => Promise<ComponentType<P>>,
  options: { loading: ComponentType },
) {
  const Client = lazy(async () => ({ default: await load() }));
  return function DynamicClient(props: P) {
    return (
      <Suspense fallback={<options.loading />}>
        <Client {...props} />
      </Suspense>
    );
  };
}
