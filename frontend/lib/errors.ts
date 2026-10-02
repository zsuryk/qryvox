// What a tile, a card or a notice shows when something goes wrong: whatever the browser, pdf.js, the fold
// or the server last said. Its own module because every layer needs it, and the modules that need it
// should not have to import each other's machinery to get it.
export const errorMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));