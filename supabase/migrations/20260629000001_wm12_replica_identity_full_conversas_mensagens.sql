-- Migration: S-WM-12 — Formaliza REPLICA IDENTITY FULL em conversas e mensagens
-- Necessário para Supabase Realtime retransmitir valores antigos (DELETE/UPDATE) e
-- garantir que ChatSidebar receba eventos completos sem polling.
-- Idempotente: ALTER TABLE REPLICA IDENTITY é safe to run múltiplas vezes.

ALTER TABLE public.conversas REPLICA IDENTITY FULL;
ALTER TABLE public.mensagens REPLICA IDENTITY FULL;
