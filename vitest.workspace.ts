export default [
  '**/vite.config.{mjs,js,ts,mts}',
  '**/vitest.config.{mjs,js,ts,mts}',
  // A `**` glob a dot-mappát kihagyja, ezért az autotest-szkriptek tesztjeit explicit vesszük fel.
  '.claude/skills/autotest/scripts/vitest.config.ts',
];
