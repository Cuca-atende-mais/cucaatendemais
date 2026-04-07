"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { CheckCircle2 } from "lucide-react"

export default function FeedbackSucessoPage() {
    return (
        <div className="min-h-screen bg-muted/30 p-4 md:p-8 flex flex-col items-center justify-center">
            <Card className="w-full max-w-md shadow-xl border-none text-center">
                <CardHeader className="bg-green-600 text-white rounded-t-lg py-12">
                   <div className="flex justify-center mb-4">
                     <div className="bg-white/20 p-4 rounded-full">
                       <CheckCircle2 className="h-16 w-16 text-white" />
                     </div>
                   </div>
                   <CardTitle className="text-3xl font-bold">Feedback Enviado!</CardTitle>
                </CardHeader>
                <CardContent className="pt-8 pb-12">
                   <p className="text-xl font-medium text-muted-foreground">
                       Muito obrigado pela sua avaliação.
                   </p>
                   <p className="mt-4 text-sm text-muted-foreground/60">
                       As informações foram processadas e nossa equipe entrará em contato se necessário.
                   </p>
                </CardContent>
            </Card>
        </div>
    )
}
