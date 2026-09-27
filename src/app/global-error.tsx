"use client";
// Last-resort screen if the whole app fails to render (styles may not be loaded, so it's self-contained).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "-apple-system, system-ui, sans-serif", background: "#f5f5f7", color: "#1d1d1f", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Ledgr couldn&apos;t load</h1>
          <p style={{ color: "#56565b", lineHeight: 1.5 }}>Please check your connection and try again. Your records are safe.</p>
          <button onClick={reset} style={{ marginTop: 16, height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#0071e3", color: "#fff", fontSize: 15, fontWeight: 500 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
