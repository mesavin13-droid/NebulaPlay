import type { VideoSource } from "./data"

// CINEMA starts with no unverified third-party video catalogues.
// Add only sources whose content rights, API terms, and permitted territories
// have been reviewed and documented.
export const BUILTIN_LINES: { name: string; url: string }[] = []

export const BUILTIN_TVBOX_SOURCES: VideoSource[] = []
