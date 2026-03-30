"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, UploadCloud, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface FileEntry {
  id: string;
  file: File;
  status: UploadStatus;
  result?: any;
  error?: string;
}

export default function BatchTriagePage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [model, setModel] = useState("gpt-4o-mini");
  const [temperature, setTemperature] = useState("0.1");
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files).map((f, i) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "idle" as UploadStatus
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter(f => f.id !== id));
  };

  const processSingleFile = async (id: string, file: File) => {
    setFiles((prev) => prev.map(f => f.id === id ? { ...f, status: "uploading" } : f));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", model);
    formData.append("temperature", temperature);

    try {
      const res = await fetch("/api/developer/batch-triage", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Erro desconhecido ao processar API");
      }

      setFiles((prev) => prev.map(f => 
        f.id === id ? { ...f, status: "success", result: json.data } : f
      ));
    } catch (err: any) {
      setFiles((prev) => prev.map(f => 
        f.id === id ? { ...f, status: "error", error: err.message } : f
      ));
    }
  };

  const processAllFiles = async () => {
    const pendingFiles = files.filter(f => f.status === "idle" || f.status === "error");
    if (pendingFiles.length === 0) {
      toast.error("Nenhum arquivo pendente para processar.");
      return;
    }

    setIsProcessingAll(true);
    for (const fileEntry of pendingFiles) {
      await processSingleFile(fileEntry.id, fileEntry.file);
    }
    setIsProcessingAll(false);
    toast.success("Processamento em lote concluído!");
  };

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Laboratório de Triagem (Batch Upload)</h1>
        <p className="text-muted-foreground mt-1">
          Selecione múltiplos currículos do seu dispositivo para extrair, classificar via IA e inserir diretamente na tabela <code className="bg-muted px-1 rounded">talent_bank</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Painel de Controles */}
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-lg">Configurações da IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Modelo LLM</Label>
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={model} 
                onChange={e => setModel(e.target.value)}
              >
                <option value="gpt-4o-mini">GPT-4o Mini (Recomendado/Rápido)</option>
                <option value="gpt-4o">GPT-4o (Maior Precisão)</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Temperatura (Criatividade): {temperature}</Label>
              <input 
                type="range" 
                min="0" max="1" step="0.1" 
                value={temperature} 
                onChange={e => setTemperature(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Recomendado 0.1 para classificação estrita. Valores altos fazem a IA "viajar" nas áreas de interesse.</p>
            </div>

            <hr className="my-4" />

            <div className="space-y-4">
              <Label>Subir Currículos</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/50 transition-colors cursor-pointer relative">
                <Input 
                  type="file" 
                  multiple 
                  accept=".pdf" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileChange}
                />
                <UploadCloud className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Clique ou arraste PDFs aqui</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fila de Processamento */}
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Fila de Processamento ({files.length})</CardTitle>
              <CardDescription>
                Arquivos aguardando extração e inserção no banco de talentos.
              </CardDescription>
            </div>
            <Button 
              onClick={processAllFiles} 
              disabled={isProcessingAll || files.length === 0}
            >
              {isProcessingAll && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Processar Todos
            </Button>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground border rounded-lg bg-muted/20">
                Nenhum currículo selecionado
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {files.map((entry) => (
                  <div key={entry.id} className="border rounded-lg p-3 flex flex-col justify-between items-start gap-4 shadow-sm bg-card hover:border-border transition-colors">
                    
                    <div className="flex items-center justify-between w-full">
                      <div className="font-medium truncate text-sm flex-1 mr-4" title={entry.file.name}>
                        {entry.file.name}
                      </div>

                      <div className="flex items-center gap-2">
                        {entry.status === "idle" && <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Aguardando</span>}
                        {entry.status === "uploading" && <span className="text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin"/> IA Pensando...</span>}
                        {entry.status === "success" && <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Inserido</span>}
                        {entry.status === "error" && <span className="text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Falhou</span>}
                        
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => removeFile(entry.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Resultado da IA Expandido */}
                    {entry.result && (
                      <div className="w-full bg-muted/30 p-3 flex flex-col gap-2 rounded text-sm mt-2 border border-border/50">
                         <div className="flex justify-between items-center">
                            <span className="font-semibold text-primary">{entry.result.nome.toUpperCase()}</span>
                            <span className="text-xs font-mono bg-background border px-2 rounded opacity-50">ID Inserido: {entry.result.talent_id?.split('-')[0]}...</span>
                         </div>
                         <div className="flex gap-2 flex-wrap">
                            {entry.result.areas.map((a: string, i: number) => (
                              <span key={i} className="bg-primary/10 text-primary border border-primary/20 text-xs px-2 py-0.5 rounded-full">{a}</span>
                            ))}
                         </div>
                         <p className="text-muted-foreground text-xs italic mt-1 pb-1">Justificativa IA: {entry.result.justificativa}</p>
                      </div>
                    )}

                    {/* Erro */}
                    {entry.error && (
                      <div className="w-full text-xs text-red-500 bg-red-500/10 p-2 rounded mt-2">
                        {entry.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
