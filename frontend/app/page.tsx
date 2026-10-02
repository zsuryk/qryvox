import Link from "next/link";
import Intake from "./intake";

// Intake is the front of the flow: drop the pack, watch each document fan out, then open the case log.
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 900 }}>
      <h1>Qryvox</h1>
      <p style={{ color: "#5b6270", margin: "0 0 4px" }}>Drop a product pack to open a case on it.</p>
      <p style={{ color: "#5b6270", fontSize: "0.75rem", letterSpacing: "0.04em", margin: "0 0 24px", textTransform: "uppercase" }}>
        Or read a case already reviewed
        <br />
        <Link href="/board" style={{ color: "#1f4f8f", fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
          Open the recorded claim board →
        </Link>
      </p>
      <Intake />
    </main>
  );
}