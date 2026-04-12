"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { differenceInMonths, parse } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Atividade { descricao: string }
interface Experiencia {
    empresa: string
    cargo: string
    data_inicio: string
    data_fim: string
    atual: boolean
    atividades: Atividade[]
}
interface Formacao {
    escolaridade: string
    instituicao: string
    status: "concluido" | "cursando"
    ano: string
}
interface Curso {
    instituicao: string
    titulo: string
    ano: string
    descricao: string
}
interface Habilidade {
    titulo: string
    descricao: string
}
interface CvDados {
    nome: string
    endereco: string
    telefone: string
    email: string
    linkedin: string
    portfolio: string
    objetivo: string
    experiencias: Experiencia[]
    formacoes: Formacao[]
    cursos: Curso[]
    habilidades: Habilidade[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPeriodo(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    const fimStr = atual ? "Atual" : (fim || "")
    return fimStr ? `${inicio} – ${fimStr}` : inicio
}

function calcPermanencia(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    try {
        const start = parse(`01/${inicio}`, "dd/MM/yyyy", new Date())
        const end = atual ? new Date() : (fim ? parse(`01/${fim}`, "dd/MM/yyyy", new Date()) : new Date())
        const meses = differenceInMonths(end, start)
        if (meses <= 0) return ""
        const anos = Math.floor(meses / 12)
        const resto = meses % 12
        if (anos > 0 && resto > 0) return `${anos} ano${anos > 1 ? "s" : ""} e ${resto} mês${resto > 1 ? "es" : ""}`
        if (anos > 0) return `${anos} ano${anos > 1 ? "s" : ""}`
        return `${resto} mês${resto > 1 ? "es" : ""}`
    } catch { return "" }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PrintPage() {
    const params = useParams()
    const curriculoId = params.id as string
    const supabase = createClient()

    const [dados, setDados] = useState<CvDados | null>(null)
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState("")

    useEffect(() => {
        supabase
            .from("curriculos")
            .select("dados, talent_bank(nome)")
            .eq("id", curriculoId)
            .single()
            .then(({ data, error }) => {
                if (error || !data) { setErro("Currículo não encontrado."); setLoading(false); return }
                const d = data.dados || {}
                if (Object.keys(d).length === 0) { setErro("Este currículo ainda não tem dados. Preencha pelo CV Builder."); setLoading(false); return }
                // Garante o nome vindo do talent_bank se não preenchido
                const talentNome = (data.talent_bank as any)?.nome || ""
                setDados({ nome: talentNome, ...d } as CvDados)
                setLoading(false)
            })
    }, [curriculoId])

    if (loading) return (
        <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )

    if (erro || !dados) return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-6">
            <p className="text-muted-foreground max-w-md">{erro || "Currículo não disponível."}</p>
            <Button variant="outline" onClick={() => window.history.back()}>Voltar</Button>
        </div>
    )

    const contatos = [
        dados.endereco,
        dados.telefone,
        dados.email,
        dados.linkedin,
        dados.portfolio,
    ].filter(Boolean).join(" | ")

    return (
        <>
            {/* Barra de ação — oculta na impressão */}
            <div className="print:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b px-6 py-3 flex items-center justify-between shadow-sm">
                <div>
                    <p className="text-sm font-semibold">{dados.nome}</p>
                    <p className="text-xs text-muted-foreground">Prévia do Currículo</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => window.history.back()}>Voltar</Button>
                    <Button onClick={() => window.print()} className="bg-cuca-blue hover:bg-sky-800 text-white gap-2">
                        <Printer className="h-4 w-4" /> Imprimir / Salvar PDF
                    </Button>
                </div>
            </div>

            {/* ── Currículo ─────────────────────────────────────────────── */}
            <div className="print:mt-0 mt-16 min-h-screen bg-white text-black">
                <div
                    className="max-w-[800px] mx-auto px-10 py-10"
                    style={{ fontFamily: "'Inter', 'Roboto', Arial, sans-serif", fontSize: "13px", lineHeight: "1.6", color: "#111" }}
                >
                    {/* Header */}
                    <div style={{ textAlign: "center", marginBottom: "20px" }}>
                        <h1 style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 6px" }}>{dados.nome}</h1>
                        {contatos && (
                            <p style={{ fontSize: "11px", color: "#555", margin: 0 }}>{contatos}</p>
                        )}
                    </div>

                    <hr style={{ border: "none", borderTop: "1.5px solid #222", marginBottom: "18px" }} />

                    {/* Objetivo */}
                    {dados.objetivo && (
                        <section style={{ marginBottom: "20px" }}>
                            <SectionHeader>Objetivo Profissional</SectionHeader>
                            <p style={{ margin: "6px 0 0", color: "#333" }}>{dados.objetivo}</p>
                        </section>
                    )}

                    {/* Experiências */}
                    {dados.experiencias?.length > 0 && (
                        <section style={{ marginBottom: "20px" }}>
                            <SectionHeader>Experiência Profissional</SectionHeader>
                            {dados.experiencias.map((exp, i) => {
                                const periodo = formatPeriodo(exp.data_inicio, exp.data_fim, exp.atual)
                                const permanencia = calcPermanencia(exp.data_inicio, exp.data_fim, exp.atual)
                                return (
                                    <div key={i} style={{ marginTop: "12px", pageBreakInside: "avoid" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                            <strong style={{ fontSize: "14px" }}>{exp.cargo || "Cargo"}</strong>
                                            <span style={{ fontSize: "11px", color: "#555", whiteSpace: "nowrap", marginLeft: "8px" }}>
                                                {periodo}{permanencia ? ` (${permanencia})` : ""}
                                            </span>
                                        </div>
                                        <p style={{ margin: "2px 0 4px", color: "#444", fontStyle: "italic" }}>{exp.empresa}</p>
                                        {exp.atividades?.filter(a => a.descricao).length > 0 && (
                                            <ul style={{ margin: "4px 0 0 16px", paddingLeft: 0, color: "#333" }}>
                                                {exp.atividades.filter(a => a.descricao).map((at, j) => (
                                                    <li key={j} style={{ marginBottom: "2px" }}>{at.descricao}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )
                            })}
                        </section>
                    )}

                    {/* Formação */}
                    {dados.formacoes?.length > 0 && (
                        <section style={{ marginBottom: "20px" }}>
                            <SectionHeader>Formação Acadêmica</SectionHeader>
                            {dados.formacoes.map((f, i) => (
                                <div key={i} style={{ marginTop: "10px", pageBreakInside: "avoid" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                        <strong style={{ fontSize: "13.5px" }}>{f.escolaridade}</strong>
                                        <span style={{ fontSize: "11px", color: "#555" }}>
                                            {f.status === "cursando" ? `Cursando — Previsão ${f.ano}` : f.ano}
                                        </span>
                                    </div>
                                    {f.instituicao && <p style={{ margin: "2px 0 0", color: "#444", fontStyle: "italic" }}>{f.instituicao}</p>}
                                </div>
                            ))}
                        </section>
                    )}

                    {/* Cursos */}
                    {dados.cursos?.length > 0 && (
                        <section style={{ marginBottom: "20px" }}>
                            <SectionHeader>Cursos e Certificações</SectionHeader>
                            {dados.cursos.map((c, i) => (
                                <div key={i} style={{ marginTop: "10px", pageBreakInside: "avoid" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                        <strong style={{ fontSize: "13.5px" }}>{c.titulo}</strong>
                                        <span style={{ fontSize: "11px", color: "#555" }}>{c.ano}</span>
                                    </div>
                                    <p style={{ margin: "2px 0 2px", color: "#444", fontStyle: "italic" }}>{c.instituicao}</p>
                                    {c.descricao && <p style={{ margin: "2px 0 0", color: "#555", fontSize: "12px" }}>{c.descricao}</p>}
                                </div>
                            ))}
                        </section>
                    )}

                    {/* Habilidades */}
                    {dados.habilidades?.length > 0 && (
                        <section style={{ marginBottom: "20px" }}>
                            <SectionHeader>Habilidades Técnicas</SectionHeader>
                            <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px" }}>
                                {dados.habilidades.map((h, i) => (
                                    <div key={i}>
                                        <span style={{ fontWeight: 600 }}>{h.titulo}</span>
                                        {h.descricao && <span style={{ color: "#555" }}> — {h.descricao}</span>}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {/* CSS de impressão */}
            <style>{`
                @media print {
                    @page { margin: 12mm 15mm; size: A4 portrait; }
                    body { background: white !important; -webkit-print-color-adjust: exact; }
                    .print\\:hidden { display: none !important; }
                    .print\\:mt-0 { margin-top: 0 !important; }
                    nav, header, aside, footer { display: none !important; }
                    [data-sidebar], [data-radix-popper-content-wrapper],
                    div[class*="sidebar"], div[class*="Sidebar"],
                    div[id*="sidebar"], button[class*="trigger"] { display: none !important; }
                    #__next > div > div:first-child { display: none !important; }
                }
            `}</style>
        </>
    )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ borderBottom: "1px solid #ccc", paddingBottom: "4px", marginBottom: "4px" }}>
            <h2 style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#222", margin: 0 }}>
                {children}
            </h2>
        </div>
    )
}
