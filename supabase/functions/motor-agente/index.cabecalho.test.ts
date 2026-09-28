// PLANO-026: cabeçalho repetido da programação sai dos trechos e aparece uma vez no topo.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { consolidarCabecalhoProgramacao } from "./index.ts";

const CAB = "PROGRAMAÇÃO MENSAL (9/2026) - Cuca Barra\nTítulo: Programação Mensal - 9/2026";

Deno.test("cabeçalho aparece uma vez e todas as atividades continuam", () => {
  const trechos = [
    CAB + "\n• Natação Infantil\n  Horário: 08:00",
    CAB + "\n• Judô\n  Local: Tatame",
    CAB + "\n• Vôlei\n  Horário: 18:00",
  ];
  const r = consolidarCabecalhoProgramacao(trechos);
  assertEquals(r, CAB + "\n• Natação Infantil\n  Horário: 08:00\n• Judô\n  Local: Tatame\n• Vôlei\n  Horário: 18:00");
  assertEquals(r.split("PROGRAMAÇÃO MENSAL").length - 1, 1);
});

Deno.test("turmas com o mesmo título no início: o título NUNCA vira cabeçalho", () => {
  const trechos = [
    CAB + "\n• Natação Infantil\n  Detalhes: Turma 1\n  Horário: 08:00",
    CAB + "\n• Natação Infantil\n  Detalhes: Turma 1\n  Horário: 09:00",
    CAB + "\n• Natação Infantil\n  Detalhes: Turma 2",
  ];
  const r = consolidarCabecalhoProgramacao(trechos);
  assertEquals(r.split("• Natação Infantil").length - 1, 3);
  assertEquals(r.startsWith(CAB + "\n• Natação Infantil"), true);
});

Deno.test("trecho com formato diferente fica intacto", () => {
  const estranho = "Programação antiga sem cabeçalho\n• Xadrez";
  const r = consolidarCabecalhoProgramacao([CAB + "\n• Judô", CAB + "\n• Vôlei", estranho]);
  assertEquals(r, CAB + "\n• Judô\n• Vôlei\n" + estranho);
});

Deno.test("sem cabeçalho comum, ou com um trecho só, sai igual a antes", () => {
  assertEquals(consolidarCabecalhoProgramacao(["• Judô", "• Vôlei"]), "• Judô\n• Vôlei");
  assertEquals(consolidarCabecalhoProgramacao([CAB + "\n• Judô"]), CAB + "\n• Judô");
  assertEquals(consolidarCabecalhoProgramacao([]), "");
});

Deno.test("trecho que é só o cabeçalho não perde conteúdo", () => {
  assertEquals(consolidarCabecalhoProgramacao(["A\nB", "A\nB"]), "A\nB\nB");
});
