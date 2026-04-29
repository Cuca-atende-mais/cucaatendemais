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
    apresentacao: string
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

function normalizarData(s: string): string {
    const digits = s.replace(/\D/g, "")
    if (digits.length === 6) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return s
}

function calcPermanencia(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    try {
        const start = parse(`01/${normalizarData(inicio)}`, "dd/MM/yyyy", new Date())
        const end = atual ? new Date() : (fim ? parse(`01/${normalizarData(fim)}`, "dd/MM/yyyy", new Date()) : new Date())
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return ""
        const meses = differenceInMonths(end, start)
        if (meses <= 0) return ""
        const anos = Math.floor(meses / 12)
        const resto = meses % 12
        if (anos > 0 && resto > 0) return `${anos} ano${anos > 1 ? "s" : ""} e ${resto} mês${resto > 1 ? "es" : ""}`
        if (anos > 0) return `${anos} ano${anos > 1 ? "s" : ""}`
        return `${resto} mês${resto > 1 ? "es" : ""}`
    } catch { return "" }
}

// Monta linhas de contato como pares rótulo + valor
function ContatoLinha({ itens }: { itens: { label: string; value: string }[] }) {
    const filtrados = itens.filter(i => i.value)
    if (filtrados.length === 0) return null
    return (
        <p style={{ fontSize: "10px", color: "#333", margin: "2px 0" }}>
            {filtrados.map((item, idx) => (
                <span key={item.label}>
                    {idx > 0 && <span style={{ margin: "0 6px", color: "#aaa" }}>|</span>}
                    <strong>{item.label}:</strong>{" "}{item.value}
                </span>
            ))}
        </p>
    )
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ borderBottom: "2px solid #1a4a7a", paddingBottom: "4px", marginBottom: "10px", marginTop: "18px" }}>
            <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1a2e5a", margin: 0, textTransform: "none", letterSpacing: 0 }}>
                {children}
            </h2>
        </div>
    )
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
                if (Object.keys(d).length === 0) {
                    setErro("Este currículo ainda não tem dados. Preencha pelo editor antes de imprimir.")
                    setLoading(false)
                    return
                }
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

    return (
        <>
            {/* ── Barra de ação (oculta na impressão) ───────────────────── */}
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
                    className="cv-print-wrapper max-w-[800px] mx-auto px-10 py-10"
                    style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", fontSize: "11px", lineHeight: "1.5", color: "#111" }}
                >

                    {/* ── Header: Nome + Contatos ────────────────────────── */}
                    <div style={{ marginBottom: "12px" }}>
                        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#1a2e5a", margin: "0 0 4px", lineHeight: 1.1 }}>
                            {dados.nome}
                        </h1>
                        <ContatoLinha itens={[
                            { label: "Endereço", value: dados.endereco || "" },
                            { label: "Telefone", value: dados.telefone || "" },
                        ]} />
                        <ContatoLinha itens={[
                            { label: "E-mail", value: dados.email || "" },
                            { label: "LinkedIn", value: dados.linkedin || "" },
                            { label: dados.portfolio?.includes("github") ? "GitHub" : "Portfólio", value: dados.portfolio || "" },
                        ]} />
                    </div>

                    <hr style={{ border: "none", borderTop: "1.5px solid #ccc", margin: "8px 0 12px" }} />

                    {/* ── Apresentação Profissional ──────────────────────── */}
                    {dados.apresentacao && (
                        <p style={{ fontSize: "10.5px", textAlign: "justify", color: "#222", marginBottom: "10px", lineHeight: "1.6" }}>
                            {dados.apresentacao}
                        </p>
                    )}

                    {/* ── Objetivo Profissional ──────────────────────────── */}
                    {dados.objetivo && (
                        <p style={{ fontSize: "11px", fontWeight: 700, color: "#1a4a7a", textAlign: "center", marginBottom: "10px" }}>
                            Objetivo Profissional: {dados.objetivo}
                        </p>
                    )}

                    {(dados.apresentacao || dados.objetivo) && (
                        <hr style={{ border: "none", borderTop: "1.5px solid #ccc", margin: "0 0 4px" }} />
                    )}

                    {/* ── Experiência Profissional ───────────────────────── */}
                    {dados.experiencias?.length > 0 && (
                        <section style={{ pageBreakInside: "avoid" }}>
                            <SectionHeader>Experiência Profissional</SectionHeader>
                            {dados.experiencias.map((exp, i) => {
                                const periodo = formatPeriodo(exp.data_inicio, exp.data_fim, exp.atual)
                                const permanencia = calcPermanencia(exp.data_inicio, exp.data_fim, exp.atual)
                                return (
                                    <div key={i} style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                                        <h3 style={{ color: "#1a4a7a", fontWeight: 700, fontSize: "12px", margin: "0 0 2px" }}>
                                            {exp.cargo || "Cargo"}
                                        </h3>
                                        <p style={{ color: "#555", fontSize: "10px", margin: "0 0 4px" }}>
                                            {[exp.empresa, periodo, permanencia ? `(${permanencia})` : ""].filter(Boolean).join(" | ")}
                                        </p>
                                        {exp.atividades?.filter(a => a.descricao).length > 0 && (
                                            <div>
                                                {exp.atividades.filter(a => a.descricao).map((at, j) => (
                                                    <p key={j} style={{ fontSize: "10px", paddingLeft: "14px", margin: "2px 0", color: "#333" }}>
                                                        • {at.descricao}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </section>
                    )}

                    {/* ── Formação Acadêmica ─────────────────────────────── */}
                    {dados.formacoes?.length > 0 && (
                        <section style={{ pageBreakInside: "avoid" }}>
                            <SectionHeader>Formação Acadêmica</SectionHeader>
                            {dados.formacoes.map((f, i) => (
                                <p key={i} style={{ fontSize: "11px", margin: "6px 0" }}>
                                    <strong>{f.escolaridade}</strong>
                                    {f.instituicao && <span> — {f.instituicao}</span>}
                                    {f.ano && (
                                        <span> — {f.status === "cursando" ? `Cursando, previsão ${f.ano}` : f.ano}</span>
                                    )}
                                </p>
                            ))}
                        </section>
                    )}

                    {/* ── Cursos e Certificações ─────────────────────────── */}
                    {dados.cursos?.length > 0 && (
                        <section style={{ pageBreakInside: "avoid" }}>
                            <SectionHeader>Cursos e Certificações</SectionHeader>
                            {dados.cursos.map((c, i) => (
                                <p key={i} style={{ fontSize: "11px", margin: "6px 0" }}>
                                    <strong>{c.titulo}</strong>
                                    {c.instituicao && <span> — {c.instituicao}</span>}
                                    {c.ano && <span> — {c.ano}</span>}
                                    {c.descricao && <span style={{ color: "#555" }}> ({c.descricao})</span>}
                                </p>
                            ))}
                        </section>
                    )}

                    {/* ── Habilidades Técnicas ───────────────────────────── */}
                    {dados.habilidades?.length > 0 && (
                        <section style={{ pageBreakInside: "avoid" }}>
                            <SectionHeader>Habilidades Técnicas</SectionHeader>
                            <div style={{ marginTop: "4px" }}>
                                {dados.habilidades.map((h, i) => (
                                    <p key={i} style={{ fontSize: "10.5px", margin: "4px 0" }}>
                                        • <strong>{h.titulo}{h.titulo && h.descricao ? ":" : ""}</strong>
                                        {h.descricao && <span style={{ color: "#333" }}> {h.descricao}</span>}
                                    </p>
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </div>

            {/* CSS de impressão */}
            <style>{`
                @media print {
                    /* margin:0 elimina o espaço onde o browser imprime URL/data/título */
                    @page { margin: 0; size: A4 portrait; }
                    body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    /* compensa a margem zerada adicionando padding no conteúdo */
                    .cv-print-wrapper { padding: 12mm 15mm !important; }
                    .print\\:hidden { display: none !important; }
                    .print\\:mt-0 { margin-top: 0 !important; }
                    nav, header, aside, footer { display: none !important; }
                    [data-sidebar], [data-radix-popper-content-wrapper],
                    div[class*="sidebar"], div[class*="Sidebar"],
                    div[id*="sidebar"], button[class*="trigger"] { display: none !important; }
                }
            `}</style>
        </>
    )
}
