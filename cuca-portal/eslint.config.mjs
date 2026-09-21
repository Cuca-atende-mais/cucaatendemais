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
    // Saída de build do OpenNext: 12 MB de código já compilado. Sem isto o ESLint
    // estoura o teto de heap do Node (~2 GB) quando a pasta existe em disco.
    ".open-next/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
