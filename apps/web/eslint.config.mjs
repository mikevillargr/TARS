import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Service worker is plain JS, not part of the TS project
    "public/sw.js",
  ]),
  {
    rules: {
      // react-hooks/set-state-in-effect fires on async setState calls inside
      // useEffect callbacks (e.g. load() and initialisation patterns). These are
      // intentional and valid — downgraded to warn so the real bugs stay visible.
      "react-hooks/set-state-in-effect": "warn",
      // next/image is a nice optimisation but not required for v1
      "@next/next/no-img-element": "warn",
    },
  },
]);

export default eslintConfig;
