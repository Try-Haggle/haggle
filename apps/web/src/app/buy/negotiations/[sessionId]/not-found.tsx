export default function BuyerNegotiationNotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Negotiation not found</h1>
      <p className="text-sm text-neutral-500">
        This chat is missing, finished elsewhere, or you do not have access to it.
      </p>
    </main>
  );
}
