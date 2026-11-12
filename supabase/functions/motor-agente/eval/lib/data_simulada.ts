// S-INST-QUAL-04 — data simulada para o gabarito.
// `DATA_ATUAL` e `deveReconhecerDisparoRecente` usam `new Date()`/`Date.now()` sem ponto de
// injeção. Durante cada caso o `Date` global é trocado por uma subclasse que devolve o "agora"
// simulado quando chamada sem argumento, e restaurado no `finally`. `new Date(valor)` continua
// funcionando normalmente (datas do histórico, `toISOString` etc.).

export async function comDataSimulada<T>(agoraMs: number, fn: () => Promise<T>): Promise<T> {
  const DateOriginal = globalThis.Date;
  class DataSimulada extends DateOriginal {
    // deno-lint-ignore no-explicit-any
    constructor(...args: any[]) {
      // deno-lint-ignore no-explicit-any
      super(...((args.length === 0 ? [agoraMs] : args) as [any]));
    }
    static override now(): number {
      return agoraMs;
    }
  }
  globalThis.Date = DataSimulada as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = DateOriginal;
  }
}
