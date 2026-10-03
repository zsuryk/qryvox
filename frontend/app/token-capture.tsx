"use client";

import { useEffect } from "react";
import { captureJudgeToken } from "../lib/api";

// Takes the judge-link token off whichever page the demo link opens, once, into the tab's storage.
export default function TokenCapture() {
  useEffect(() => captureJudgeToken(), []);
  return null;
}
