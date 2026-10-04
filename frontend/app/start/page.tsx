import ClientStart from "../client-start";

// Where a client starts on their own, without a product (#71): one questionnaire, answered once, for every
// product the adviser has verified. They land on their list; an adviser confirms it before they see it.
// The link for one product, /start/<case>, still works.
export default function StartPage() {
  return <ClientStart caseId={null} product={null} ready />;
}
