import { fold } from "@qryvox/shared";

export default function Home() {
  const state = fold([]);

  return (
    <main>
      <h1>Qryvox</h1>
      <p>{state.caseId === null ? "No case open." : `Case ${state.caseId}`}</p>
    </main>
  );
}
