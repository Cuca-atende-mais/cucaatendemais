"use client"

import { useParams } from "next/navigation"
import { ProjetoForm } from "@/components/planejamento/projeto-form"

// S-PLA-02: edição do projeto. Sem `pla_proj_editar`, o formulário leva à página do projeto com aviso.
export default function EditarProjetoPage() {
    const params = useParams()
    return <ProjetoForm key={params.id as string} projetoId={params.id as string} />
}
