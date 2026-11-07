/**
 * Texto do balão da conversa (resposta do bot, da atendente ou mensagem do lead).
 *
 * `[overflow-wrap:anywhere]` (S-RESP-01): quebra também link e qualquer sequência longa sem
 * espaço dentro do limite do balão. O `break-words` usado antes não quebrava esses casos, e a
 * coluna da conversa esticava até cortar as respostas do lado direito.
 */
export function TextoMensagem({ conteudo }: { conteudo: string | null }) {
    return (
        <p data-slot="texto-mensagem" className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {conteudo}
        </p>
    )
}
