/**
 * S-PROG-01 (item 2): máscaras de hora e data — puras, sem dependência de DOM, testáveis
 * isoladamente. Existem para tornar impossível o que a planilha real permitia: horário em 4
 * formatos (`8h às 9h`, `14 às 17h`, `09:00 às 12:00h`, `10h às 12h30`), data com três
 * informações e quebra de linha numa célula só.
 */

/**
 * Aplica a máscara de hora enquanto o usuário digita (`oninput`): só dígitos, ":" entra
 * sozinho a partir do 3º dígito. "8" continua "8" até o campo perder o foco — a normalização
 * final (padStart, 08:00) acontece em `normalizarHora`, chamada no blur, não aqui, porque
 * completar cedo demais atrapalha quem ainda está digitando o segundo dígito da hora.
 */
export function aplicarMascaraHoraDigitando(valorAtual: string): string {
  const digitos = valorAtual.replace(/\D/g, "").slice(0, 4)
  return digitos.length >= 3 ? digitos.slice(0, 2) + ":" + digitos.slice(2) : digitos
}

export type ResultadoHora = { ok: true; valor: string } | { ok: false; motivo: string }

/**
 * Normaliza e valida uma hora no blur do campo. "8" -> "08:00"; "830" -> "08:30"; hora > 23 ou
 * minuto > 59 é rejeitado (rede de segurança contra digitação com o dedo escorregado). String
 * vazia é válida (campo opcional / ainda zerado pela duplicação) — quem exige o preenchimento é
 * o painel de revisão, não esta função.
 */
export function normalizarHora(valorDigitado: string): ResultadoHora {
  const digitos = valorDigitado.replace(/\D/g, "")
  if (!digitos) return { ok: true, valor: "" }

  let d = digitos
  if (d.length === 1) d = "0" + d + "00"
  else if (d.length === 2) d = d + "00"
  else if (d.length === 3) d = "0" + d
  else d = d.slice(0, 4)

  const hora = Number(d.slice(0, 2))
  const minuto = Number(d.slice(2, 4))
  if (hora > 23 || minuto > 59) return { ok: false, motivo: "Horário inválido" }

  return { ok: true, valor: String(hora).padStart(2, "0") + ":" + String(minuto).padStart(2, "0") }
}

/** "08:30" -> true se hFim for depois de hInicio. Strings vazias nunca comparam como inválidas
 * (a obrigatoriedade é responsabilidade do painel de revisão, não desta função). */
export function horaFimDepoisDoInicio(horaInicio: string, horaFim: string): boolean {
  if (!horaInicio || !horaFim) return true
  return horaFim > horaInicio
}

/** Máscara de data enquanto digita: só dígitos, "/" entra sozinho nas posições 2 e 4. */
export function aplicarMascaraDataDigitando(valorAtual: string): string {
  const digitos = valorAtual.replace(/\D/g, "").slice(0, 8)
  if (digitos.length > 4) return digitos.slice(0, 2) + "/" + digitos.slice(2, 4) + "/" + digitos.slice(4)
  if (digitos.length > 2) return digitos.slice(0, 2) + "/" + digitos.slice(2)
  return digitos
}

export type ResultadoData = { ok: true; valor: string } | { ok: false; motivo: string }

/** Normaliza e valida uma data "dd/mm/aaaa" no blur — dia 1-31, mês 1-12. Não valida dias por
 * mês (ex.: 31/02) de propósito: essa checagem fina não vale o custo de manutenção aqui: o
 * `Date` do JS já rejeitaria silenciosamente, e o ganho de UX de apontar "fevereiro não tem 31
 * dias" é pequeno perto do resto da story. String vazia é válida. */
export function normalizarData(valorDigitado: string): ResultadoData {
  const digitos = valorDigitado.replace(/\D/g, "")
  if (!digitos) return { ok: true, valor: "" }
  if (digitos.length !== 8) return { ok: false, motivo: "Data incompleta" }

  const dia = Number(digitos.slice(0, 2))
  const mes = Number(digitos.slice(2, 4))
  const ano = Number(digitos.slice(4, 8))
  if (dia < 1 || dia > 31) return { ok: false, motivo: "Dia inválido" }
  if (mes < 1 || mes > 12) return { ok: false, motivo: "Mês inválido" }

  return { ok: true, valor: String(dia).padStart(2, "0") + "/" + String(mes).padStart(2, "0") + "/" + String(ano) }
}

/**
 * "07/08/2026" -> "2026-08-07". `data_atividade` é coluna `date` no Postgres — precisa de ISO
 * mesmo com o campo de edição sendo texto mascarado dd/mm/aaaa. `null` quando a string não é
 * uma data válida e completa (nunca lança, quem chama decide o que fazer com `null`).
 */
export function dataBrParaISO(dataBr: string): string | null {
  const m = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, dia, mes, ano] = m
  return `${ano}-${mes}-${dia}`
}

/** "2026-08-07" -> "07/08/2026" — inverso de `dataBrParaISO`, usado ao carregar uma atividade
 * já gravada (ex.: duplicação de mês, S-PROG-02) de volta para o campo mascarado. */
export function dataISOParaBr(dataISO: string): string | null {
  const m = dataISO.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, ano, mes, dia] = m
  return `${dia}/${mes}/${ano}`
}

/**
 * Valor a exibir num campo de data controlado, cujo estado pode guardar dois formatos
 * conforme a fase de edição: ISO (`aaaa-mm-dd`), já commitado quando a data ficou completa e
 * válida, ou o texto mascarado bruto (`dd/mm/aa...`) ainda sendo digitado, quando a conversão
 * pra ISO falhou por estar incompleto. Sem isto, converter só o formato ISO faz o campo exibir
 * "" a cada tecla enquanto a data está incompleta — era exatamente o bug reportado pelo @qa.
 */
export function exibirData(valorArmazenado: string | null | undefined): string {
  if (!valorArmazenado) return ""
  if (/^\d{4}-\d{2}-\d{2}/.test(valorArmazenado)) return dataISOParaBr(valorArmazenado) || ""
  return valorArmazenado
}
