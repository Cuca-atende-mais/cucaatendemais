import { describe, expect, it } from "vitest"
import { montarAbasExportacao, nomeArquivoExportacao, AtividadeParaExportacao, CampanhaParaExportacao } from "./exportacao"

// S-PROG-05 (item 3): "teste de snapshot — condição de PASS do @qa". `handleExportarXLSX`
// (programacao/mensal/[id]/page.tsx) era a ÚNICA especificação viva do formato que a gráfica
// aceita — os .xlsx originais não existem em nenhum storage (S-WM-35). Este arquivo foi extraído
// SEM mudança de comportamento (mesmos headers, mesma ordem, mesmo "—", mesmo nome de aba) — as
// asserções abaixo travam exatamente o que o código já produzia antes desta story, célula a
// célula, com asserções explícitas em vez de snapshot opaco (`.snap`), pelo mesmo motivo de todo
// teste desta sessão: uma regressão de formato fica visível no diff da PR, não escondida num
// arquivo gerado.

const campanha: CampanhaParaExportacao = { mes: 8, ano: 2026, unidade_cuca: "Cuca Mondubim" }

describe("montarAbasExportacao — contrato congelado (AC2/AC3)", () => {
    it("CURSOS: headers, título de aba/visual e recomposição das chaves antigas", () => {
        const atividades: AtividadeParaExportacao[] = [{
            titulo: "Violão para todos", categoria: "CURSOS",
            metadata: { carga_horaria: "21", vagas: "10", ementa: "Estudo de violão popular.", requisitos: "Nenhum", periodo: "08/08/2026 a 29/08/2026", horario: "09:00 às 12:00", educador: "Edmundo Vitoriano" },
        }]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.chave).toBe("CURSOS")
        expect(aba.tituloAba).toBe("CURSOS - AGOSTO")
        expect(aba.tituloVisual).toBe("CURSOS CUCA MONDUBIM — AGOSTO 2026")
        expect(aba.headers).toEqual(["#", "Curso", "Carga Horária", "Vagas", "Ementa", "Requisitos", "Período", "Horário", "Educador"])
        expect(aba.linhas).toEqual([
            [1, "Violão para todos", "21h", "10", "Estudo de violão popular.", "Nenhum", "08/08/2026 a 29/08/2026", "09:00 às 12:00", "Edmundo Vitoriano"],
        ])
    })

    it("CURSOS: metadata ausente vira '—' em toda coluna, nunca undefined/célula vazia (AC6)", () => {
        const atividades: AtividadeParaExportacao[] = [{ titulo: "Curso sem dados", categoria: "CURSOS", metadata: {} }]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.linhas[0]).toEqual([1, "Curso sem dados", "—", "—", "—", "—", "—", "—", "—"])
        expect(aba.linhas[0]).not.toContain(undefined)
        expect(aba.linhas[0]).not.toContain(null)
    })

    it("ESPORTES: headers e recomposição de faixa etária/dias/horário", () => {
        const atividades: AtividadeParaExportacao[] = [{
            titulo: "Natação", categoria: "ESPORTES",
            metadata: { professor: "Ricardo Alves", turma: "Turma 01", faixa_etaria: "7 a 10 anos", sexo: "Misto", vagas: "25", dias_semana: "Seg e Qua", horario: "08:00 às 09:00" },
        }]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.headers).toEqual(["#", "Modalidade", "Professor", "Turma", "Faixa Etária", "Sexo", "Vagas", "Dias", "Horário"])
        expect(aba.linhas).toEqual([
            [1, "Natação", "Ricardo Alves", "Turma 01", "7 a 10 anos", "Misto", "25", "Seg e Qua", "08:00 às 09:00"],
        ])
    })

    it("DIA A DIA: headers, extrai hora_inicio/hora_fim das colunas raiz (não do metadata)", () => {
        const atividades: AtividadeParaExportacao[] = [{
            titulo: "Comunidade em Pauta", categoria: "DIA A DIA", local: "Anfiteatro",
            hora_inicio: "19:00:00", hora_fim: "21:00:00",
            metadata: { sessao: "DPDH", data_real: "11/08/2026", dia_semana: "Terça-feira", atividade: "Oficina de passinho" },
        }]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.headers).toEqual(["#", "Sessão", "Data", "Dia da Semana", "Atividade", "Horário Início", "Horário Fim", "Local", "Informações"])
        expect(aba.linhas).toEqual([
            [1, "DPDH", "11/08/2026", "Terça-feira", "Oficina de passinho", "19:00", "21:00", "Anfiteatro", "—"],
        ])
    })

    it("DIA A DIA: sem 'atividade' no metadata usa o título da linha", () => {
        const atividades: AtividadeParaExportacao[] = [{ titulo: "Programa X", categoria: "DIA A DIA", metadata: {} }]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.linhas[0][4]).toBe("Programa X")
    })

    it("categoria sem nenhuma atividade não gera aba (só categorias com dado aparecem)", () => {
        const atividades: AtividadeParaExportacao[] = [{ titulo: "Natação", categoria: "ESPORTES", metadata: {} }]
        const abas = montarAbasExportacao(campanha, atividades)
        expect(abas).toHaveLength(1)
        expect(abas[0].chave).toBe("ESPORTES")
    })

    it("numeração '#' reinicia em 1 por categoria, na ordem de chegada", () => {
        const atividades: AtividadeParaExportacao[] = [
            { titulo: "Natação", categoria: "ESPORTES", metadata: {} },
            { titulo: "Jiu-Jitsu", categoria: "ESPORTES", metadata: {} },
            { titulo: "Vôlei", categoria: "ESPORTES", metadata: {} },
        ]
        const [aba] = montarAbasExportacao(campanha, atividades)
        expect(aba.linhas.map(l => l[0])).toEqual([1, 2, 3])
    })
})

describe("nomeArquivoExportacao", () => {
    it("monta o nome com espaço da unidade virando underscore, extensão parametrizada", () => {
        expect(nomeArquivoExportacao(campanha, "xlsx")).toBe("Programacao_Cuca_Mondubim_Agosto_2026.xlsx")
        expect(nomeArquivoExportacao(campanha, "pdf")).toBe("Programacao_Cuca_Mondubim_Agosto_2026.pdf")
    })
})
