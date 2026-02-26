"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Sparkles, ThumbsUp, ThumbsDown, Target, GraduationCap, Briefcase } from "lucide-react"

interface MatchModalProps {
    isOpen: boolean
    onClose: () => void
    candidato: any
    vaga: any
}

export function MatchModal({ isOpen, onClose, candidato, vaga }: MatchModalProps) {
    if (!candidato) return null

    const ocr = candidato.dados_ocr_json || {}
    const analise = ocr.analise_aderencia || {}
    const score = candidato.match_score || 0

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto">
                <DialogHeader>
                    <div className="flex items-center justify-between mb-2">
                        <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                            <Sparkles className="text-cuca-yellow w-6 h-6" />
                            Análise de Aderência (IA)
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Match</span>
                            <div className={`
                text-2xl font-bold px-3 py-1 rounded-lg border-2
                ${score >= 80 ? "text-green-600 border-green-200 bg-green-50" :
                                    score >= 50 ? "text-amber-600 border-amber-200 bg-amber-50" :
                                        "text-red-600 border-red-200 bg-red-50"}
              `}>
                                {score}%
                            </div>
                        </div>
                    </div>
                    <DialogDescription>
                        Comparação detalhada do perfil de <b>{candidato.nome}</b> com a vaga <b>{vaga?.titulo}</b>.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                    {/* Resumo OCR */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-2 font-semibold text-slate-700 mb-2">
                                <GraduationCap className="w-4 h-4 text-cuca-blue" />
                                Escolaridade
                            </div>
                            <p className="text-sm text-slate-600">{ocr.escolaridade || "Não identificada"}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-2 font-semibold text-slate-700 mb-2">
                                <Briefcase className="w-4 h-4 text-cuca-blue" />
                                Experiência
                            </div>
                            <p className="text-sm text-slate-600">
                                {ocr.experiencia_meses ? `${ocr.experiencia_meses} meses` : "Nenhuma experiência profissional detectada"}
                            </p>
                        </div>
                    </div>

                    {/* Análise de Aderência */}
                    <div className="space-y-4">
                        <div className="bg-green-50/50 p-5 rounded-xl border border-green-100">
                            <h4 className="font-bold flex items-center gap-2 text-green-800 mb-3">
                                <ThumbsUp className="w-5 h-5" />
                                Pontos Fortes
                            </h4>
                            <ul className="space-y-2">
                                {analise.pontos_fortes?.map((item: string, i: number) => (
                                    <li key={i} className="text-sm text-green-700 flex items-start gap-2">
                                        <span className="mt-1.5 w-1.5 h-1.5 bg-green-400 rounded-full shrink-0" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="bg-amber-50/50 p-5 rounded-xl border border-amber-100">
                            <h4 className="font-bold flex items-center gap-2 text-amber-800 mb-3">
                                <Target className="w-5 h-5" />
                                Pontos de Atenção
                            </h4>
                            <ul className="space-y-2">
                                {analise.pontos_atencao?.map((item: string, i: number) => (
                                    <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                                        <span className="mt-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Habilidades */}
                    <div className="space-y-2">
                        <h4 className="font-semibold text-slate-700 text-sm uppercase tracking-wider">Habilidades Extraídas</h4>
                        <div className="flex flex-wrap gap-2">
                            {ocr.habilidades?.map((h: string, i: number) => (
                                <Badge key={i} variant="secondary" className="bg-white border-slate-200">
                                    {h}
                                </Badge>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <Badge className={`text-lg px-4 py-1 flex items-center gap-2 ${analise.veredito === '✅' ? 'bg-green-600' :
                            analise.veredito === '⚠️' ? 'bg-amber-500' : 'bg-red-600'
                        }`}>
                        Veredito: {analise.veredito}
                    </Badge>
                </div>
            </DialogContent>
        </Dialog>
    )
}
