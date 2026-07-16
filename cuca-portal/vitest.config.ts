import { defineConfig } from "vitest/config"
import path from "node:path"

// Config mínima: só testa as funções puras extraídas dos parsers (ex.:
// src/lib/programacao/planilha-parser.ts). Não testa componentes React — evitar depender de
// jsdom/testing-library enquanto isso não for necessário (ver S-WM-35 / tarefa B2).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
