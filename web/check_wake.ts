import { extractCommand } from "./lib/voice";

const cases: [string, string | null][] = [
  ["jarvis open finance", "open finance"],
  ["Travis, what's the weather", "what's the weather"],
  ["hey jarvis remember that I like tea", "remember that I like tea"],
  ["hey jarvis", ""],
  ["turn on the lights", null],
];
let failures = 0;
for (const [input, want] of cases) {
  const got = extractCommand(input);
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  "${input}" -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
}
if (failures > 0) throw new Error(`${failures} wake-word check(s) failed`);   // nonzero exit, no node types needed
