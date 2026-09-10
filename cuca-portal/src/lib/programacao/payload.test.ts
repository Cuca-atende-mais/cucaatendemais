import { describe, expect, it } from "vitest"
import { montarAtividadePayload } from "./payload"
import { AtividadeForm } from "./tipos"

// S-PROG-03 (item 1 — expand/contract): garante que `montarAtividadePayload` grava as chaves
// ANTIGAS que `formatarLinhaAtividadeDeterministica` (motor-agente/index.ts:443) lê direto do
// jsonb — turma, professor, sexo, dias_semana, horario, faixa_etaria — mesmo com o formulário
// usando só os campos novos da grade (S-PROG-01). Sem isso, o assistente do WhatsApp responderia
// "nao informado" pra toda atividade criada pela grade nova (AC1/AC2 da story).
//
// Também serve como o "teste de paridade" do AC5: como o wizard antigo (`criar-programacao-modal.tsx`)
// foi substituído pela grade (S-PROG-01) e não existe mais lado a lado pra comparar, este arquivo
// fixa por contrato o formato que `montarAtividadePayload` sempre produziu (a função em si não
// mudou de comportamento na extração — só saiu do componente React pra cá) — uma regressão futura
// no formato quebraria estes testes, não só a comparação manual contra um modal que não existe mais.

function esportesForm(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
    return {
        _tempId: "1",
        categoria: "ESPORTES",
        titulo: "Natação",
        descricao: null,
        local: null,
        data_atividade: null,
        hora_inicio: "08:00",
        hora_fim: "09:00",
        metadata: {
            professor: "Ricardo Alves",
            turma: "01",
            vagas: "25",
            sexo: "Misto",
            faixa_de: "7",
            faixa_ate: "10",
            dias_raw: ["Segunda", "Quarta"],
        },
        ...overrides,
    }
}

function cursoForm(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
    return {
        _tempId: "2",
        categoria: "CURSOS",
        titulo: "Violão para todos",
        descricao: null,
        local: null,
        data_atividade: null,
        hora_inicio: "09:00",
        hora_fim: "12:00",
        metadata: {
            educador: "Edmundo Vitoriano",
            vagas: "10",
            carga_horaria: "21",
            requisitos: "Nenhum",
            data_inicio_raw: "2026-08-08",
            data_fim_raw: "2026-08-29",
            ementa: "Estudo de violão popular.",
            dias_raw: ["Quarta", "Sexta"],
        },
        ...overrides,
    }
}

function diaADiaForm(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
    return {
        _tempId: "3",
        categoria: "DIA A DIA",
        titulo: "Comunidade em Pauta",
        descricao: null,
        local: "Anfiteatro",
        data_atividade: "2026-08-11",
        hora_inicio: "19:00",
        hora_fim: "21:00",
        metadata: { sessao: "DPDH", atividade: "Oficina de passinho", informacoes: "Texto aqui.", dia_semana: "Terça-feira", data_real: "11/08/2026" },
        ...overrides,
    }
}

describe("montarAtividadePayload — ESPORTES: chaves antigas recompostas (AC1/AC2)", () => {
    it("grava horario, faixa_etaria e dias_semana a partir dos campos novos", () => {
        const p = montarAtividadePayload(esportesForm(), "Cuca Mondubim")
        expect(p.metadata.horario).toBe("08:00 às 09:00")
        expect(p.metadata.faixa_etaria).toBe("7 a 10 anos")
        expect(p.metadata.dias_semana).toBe("Seg e Qua")
        expect(p.metadata.professor).toBe("Ricardo Alves")
        expect(p.metadata.sexo).toBe("Misto")
        expect(p.metadata.turma).toBe("Turma 01")
    })

    it("idade máxima em branco vira 'a partir de X anos' (item 2 da S-PROG-01, preservado)", () => {
        const p = montarAtividadePayload(esportesForm({ metadata: { ...esportesForm().metadata, faixa_ate: "" } }), "Cuca Mondubim")
        expect(p.metadata.faixa_etaria).toBe("a partir de 7 anos")
    })

    it("descricao (texto do RAG) não contém 'Vagas:' e termina com o aviso padrão (S-PROG-03 item 2, preservado)", () => {
        const p = montarAtividadePayload(esportesForm(), "Cuca Mondubim")
        expect(p.descricao).not.toContain("Vagas:")
        expect(p.descricao).toContain("procurar a unidade CUCA")
    })

    it("hora_inicio/hora_fim vazios viram null (nunca string vazia) — coluna `time` do Postgres", () => {
        const p = montarAtividadePayload(esportesForm({ hora_inicio: "", hora_fim: "" }), "Cuca Mondubim")
        expect(p.hora_inicio).toBeNull()
        expect(p.hora_fim).toBeNull()
        // mas o texto (descricao/metadata.horario) não vira "null às null"
        expect(p.metadata.horario).toBe(" às ")
        expect(p.descricao).not.toContain("null")
    })

    it("vagas continua gravado em metadata (AC4 — não desaparece, só sai do texto)", () => {
        const p = montarAtividadePayload(esportesForm(), "Cuca Mondubim")
        expect(p.metadata.vagas).toBe("25")
    })
})

describe("montarAtividadePayload — CURSOS: chaves antigas recompostas", () => {
    it("grava periodo no formato 'dd/mm/aaaa a dd/mm/aaaa' e horario", () => {
        const p = montarAtividadePayload(cursoForm(), "Cuca Mondubim")
        expect(p.metadata.periodo).toBe("08/08/2026 a 29/08/2026")
        expect(p.metadata.horario).toBe("09:00 às 12:00")
        expect(p.metadata.dias_semana).toBe("Qua e Sex")
    })

    it("periodo vazio quando as datas não estão preenchidas (nunca 'undefined a undefined')", () => {
        const p = montarAtividadePayload(cursoForm({ metadata: { ...cursoForm().metadata, data_inicio_raw: "", data_fim_raw: "" } }), "Cuca Mondubim")
        expect(p.metadata.periodo).toBe("")
    })

    it("dias da semana não se perdem da descricao mesmo com periodo só nas duas datas", () => {
        const p = montarAtividadePayload(cursoForm(), "Cuca Mondubim")
        expect(p.descricao).toContain("Qua e Sex")
    })

    it("data_atividade (coluna raiz) usa data_inicio_raw — AC4 mantém a coluna usada pela busca por data", () => {
        const p = montarAtividadePayload(cursoForm(), "Cuca Mondubim")
        expect(p.data_atividade).toBe("2026-08-08")
    })

    it("vagas continua gravado em metadata", () => {
        const p = montarAtividadePayload(cursoForm(), "Cuca Mondubim")
        expect(p.metadata.vagas).toBe("10")
    })
})

describe("montarAtividadePayload — DIA A DIA/ESPECIAIS", () => {
    it("mantém sessao, dia_semana e data_real no metadata (formato já usado por dado real de produção)", () => {
        const p = montarAtividadePayload(diaADiaForm(), "Cuca Mondubim")
        expect(p.metadata.sessao).toBe("DPDH")
        expect(p.metadata.dia_semana).toBe("Terça-feira")
        expect(p.metadata.data_real).toBe("11/08/2026")
        expect(p.data_atividade).toBe("2026-08-11")
    })
})

describe("montarAtividadePayload — chaves aditivas (S-PROG-01 item 4)", () => {
    it("meta/diretoria são copiadas em toda categoria quando presentes", () => {
        const p1 = montarAtividadePayload(esportesForm({ metadata: { ...esportesForm().metadata, meta: "45661", diretoria: "DEEC" } }), "Cuca Mondubim")
        expect(p1.metadata.meta).toBe("45661")
        expect(p1.metadata.diretoria).toBe("DEEC")

        const p2 = montarAtividadePayload(cursoForm({ metadata: { ...cursoForm().metadata, meta: "46031", diretoria: "ARTES E BIBLIOTECAS" } }), "Cuca Mondubim")
        expect(p2.metadata.meta).toBe("46031")
        expect(p2.metadata.diretoria).toBe("ARTES E BIBLIOTECAS")
    })

    it("meta/diretoria ausentes viram null, não undefined (jsonb não aceita undefined)", () => {
        const p = montarAtividadePayload(esportesForm(), "Cuca Mondubim")
        expect(p.metadata.meta).toBeNull()
        expect(p.metadata.diretoria).toBeNull()
    })
})
