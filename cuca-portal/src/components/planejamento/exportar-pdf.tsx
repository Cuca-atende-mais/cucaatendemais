"use client"

import { MENSAGEM_FICHA_PARCIAL, montarSlides, nomeArquivoFicha, nomeArquivoSlides, type DadosSlides } from "@/lib/planejamento/slides"

// S-PLA-05 (AC7, AC8): exportações em PDF, geradas no navegador. O @react-pdf/renderer e os
// documentos só são carregados no clique (import sob demanda), para não pesar nas páginas.

const logoAbsoluto = () => `${window.location.origin}/logo-rede-cuca.png`

function baixar(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = nome
    a.click()
    // Dá tempo ao navegador de começar o download antes de liberar o arquivo.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Slides em PDF: mesmas regras da tela, com o texto longo indo para slides de continuação.
// Ficha parcial (D7): recusa com a mesma mensagem da página.
export async function exportarSlidesPdf(dados: DadosSlides): Promise<string> {
    const resultado = montarSlides(dados, "pdf")
    if (resultado.tipo !== "ok") throw new Error(MENSAGEM_FICHA_PARCIAL)
    const [{ pdf }, { SlidesPdfDocument }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/planejamento/slides-pdf")])
    const nome = nomeArquivoSlides(dados.setor?.nome ?? "", dados.projeto.nome)
    const blob = await pdf(<SlidesPdfDocument apresentacao={resultado} logo={logoAbsoluto()} titulo={dados.projeto.nome} />).toBlob()
    baixar(blob, nome)
    return nome
}

// Ficha em PDF (A4): sai com a ficha parcial ou final.
export async function exportarFichaPdf(dados: DadosSlides): Promise<string> {
    const [{ pdf }, { FichaPdfDocument }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/planejamento/ficha-pdf")])
    const nome = nomeArquivoFicha(dados.setor?.nome ?? "", dados.projeto.nome)
    const blob = await pdf(
        <FichaPdfDocument projeto={dados.projeto} filhas={dados.filhas} setor={dados.setor} unidades={dados.unidades} logo={logoAbsoluto()} />,
    ).toBlob()
    baixar(blob, nome)
    return nome
}
