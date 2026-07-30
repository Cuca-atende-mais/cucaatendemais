export function serializarLinkParams(searchParams: URLSearchParams): string {
    return searchParams.toString()
}

export async function validarLinkAssinadoNoServidor(searchParams: URLSearchParams): Promise<boolean> {
    const res = await fetch("/api/empregabilidade/link-assinado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link_params: serializarLinkParams(searchParams) }),
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    return data?.valido === true
}
