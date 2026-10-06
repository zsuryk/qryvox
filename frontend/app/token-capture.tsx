"use client";

import { useEffect } from "react";
import { captureApiToken } from "../lib/api";

// Takes the API token off whichever page the demo link opens, once, into the tab's storage.
export default function TokenCapture() {
  useEffect(() => captureApiToken(), []);
  return null;
}
