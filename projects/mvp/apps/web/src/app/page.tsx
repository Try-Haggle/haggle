export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>Haggle</h1>
      <p style={{ fontSize: "1.25rem", color: "#666" }}>
        AI-Powered Negotiation Marketplace
      </p>
      <p style={{ marginTop: "2rem", color: "#999", fontSize: "0.875rem" }}>
        Slice 0 deployed — skeleton ready
      </p>
    </main>
  );
}
