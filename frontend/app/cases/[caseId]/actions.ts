"use server";

import { revalidatePath } from "next/cache";

// Re-reads a case on the server, every section of it. A run or a decision appends to the log, so the
// header's event count and chain verdict, and the server's copy of each section, are out of date the
// moment it lands.
export async function refetchCase() {
  revalidatePath("/cases/[caseId]", "layout");
}
