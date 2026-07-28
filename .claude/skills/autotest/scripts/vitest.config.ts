import { defineConfig } from 'vitest/config';

// Az autotest-szkriptek tiszta helpereinek unit-tesztjei (lib/*.spec.ts). A vitest.workspace.ts
// `**`-globja a dot-mappát (.claude) kihagyja, ezért a workspace EXPLICIT hivatkozik erre a configra.
export default defineConfig({
  // A tesztek ehhez a mappához relatívak, akkor is, ha a workspace a repo-gyökérből hívja.
  root: import.meta.dirname,
  test: {
    name: 'autotest-scripts',
    include: ['lib/**/*.spec.ts'],
    environment: 'node',
  },
});
