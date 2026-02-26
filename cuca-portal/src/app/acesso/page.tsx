import { Metadata } from "next"
import Image from "next/image"
import { AcessoForm } from "@/components/public/acesso-form"

export const metadata: Metadata = {
    title: "Solicitação de Acesso - Rede CUCA",
    description: "Formulário oficial para solicitação de uso de espaços e equipamentos da Rede CUCA.",
}

export default function AcessoPublicPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <header className="bg-cuca-blue text-white p-4 shadow-md">
                <div className="container mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Image
                            src="/logo-rede-cuca.png"
                            alt="Logo Rede CUCA"
                            width={50}
                            height={50}
                            className="bg-white rounded-full p-1"
                        />
                        <div>
                            <h1 className="font-bold text-lg leading-tight uppercase">Rede CUCA</h1>
                            <p className="text-xs text-cuca-yellow font-medium uppercase tracking-wider">Atende+</p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
                <div className="mb-8 text-center">
                    <h2 className="text-3xl font-bold text-cuca-dark mb-2">Solicitação de Acesso</h2>
                    <p className="text-slate-600">
                        Preencha os dados abaixo para solicitar o uso de espaços ou equipamentos em uma de nossas unidades.
                    </p>
                </div>

                <AcessoForm />
            </main>

            {/* Footer */}
            <footer className="bg-slate-100 border-t py-6 text-center text-slate-500 text-sm">
                <div className="container mx-auto px-4">
                    <p>© {new Date().getFullYear()} Prefeitura de Fortaleza</p>
                    <p className="mt-1">Secretaria Municipal da Juventude - Rede CUCA</p>
                </div>
            </footer>
        </div>
    )
}
