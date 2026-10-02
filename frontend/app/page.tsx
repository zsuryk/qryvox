import Intake from "./intake";

// Intake is the front of the flow: drop the pack, watch each document fan out, then open the case log.
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 900 }}>
      <h1>Qryvox</h1>
      <p style={{ color: "#5b6270", margin: "0 0 24px" }}>Drop a product pack to open a case on it.</p>
      <Intake />
    </main>
  );
}
