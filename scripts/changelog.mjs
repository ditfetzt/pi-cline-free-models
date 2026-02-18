#!/usr/bin/env node
// PIPA changelog helper: extracts [Unreleased] notes, stamps with version/date,
// resets a fresh [Unreleased] section, and prints release body to stdout.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/changelog.mjs <version>");
  process.exit(1);
}

const file = "CHANGELOG.md";
const content = readFileSync(file, "utf-8");

const unreleasedHeader = "## [Unreleased]";
const idx = content.indexOf(unreleasedHeader);
if (idx === -1) {
  console.error("No [Unreleased] section found in CHANGELOG.md");
  process.exit(1);
}

// Find the next ## header after [Unreleased]
const afterHeader = idx + unreleasedHeader.length;
const nextSectionMatch = content.slice(afterHeader).search(/\n## \[/);
const endIdx = nextSectionMatch === -1 ? content.length : afterHeader + nextSectionMatch;

const releaseNotes = content.slice(afterHeader, endIdx).trim();
const today = new Date().toISOString().split("T")[0];
const newHeader = `## [v${version}] - ${today}`;

const updated =
  content.slice(0, idx) +
  `${unreleasedHeader}\n\n` +
  `${newHeader}\n${releaseNotes ? "\n" + releaseNotes : ""}\n` +
  content.slice(endIdx);

writeFileSync(file, updated);

// Print release body to stdout for gh release --notes
console.log(releaseNotes || "(no release notes)");
