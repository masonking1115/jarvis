// web/check_deep_phrase.ts — run: npx tsx check_deep_phrase.ts
import { wantsDeep } from "./lib/voice";

const cases: [string, boolean][] = [
  ["think hard about my finances", true],
  ["go deep on this", true],
  ["really think about the tradeoffs", true],
  ["what's the weather", false],
  ["open finance", false],
];
for (const [input, expected] of cases) {
  const got = wantsDeep(input);
  if (got !== expected) throw new Error(`wantsDeep(${input}) = ${got}, expected ${expected}`);
}
console.log("wantsDeep: all cases pass");
