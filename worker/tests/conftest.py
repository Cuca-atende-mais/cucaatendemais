"""
Fixtures compartilhadas para os testes do worker.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock


@pytest.fixture(autouse=True)
def _debounce_instantaneo(monkeypatch):
    """VAL-05 (docs/migracao-meta/VALIDACAO-producao-institucional.md): por padrão, o debounce
    de dispatch em `worker/meta_adapter_inbound.py` é instantâneo em todos os testes — sem
    isso, qualquer teste que chegue no dispatch ficaria esperando o sleep real
    (`META_DEBOUNCE_SECONDS`, default 7s — S-WM-33), deixando a suíte inteira lenta por um motivo sem
    relação com o que cada teste individual quer provar. Testes que precisam controlar o
    timing de verdade (cancelamento/reagendamento) sobrescrevem `_dormir_debounce`
    explicitamente por cima deste autouse (ver TestDebounceDispatch).
    """
    import meta_adapter_inbound
    monkeypatch.setattr(meta_adapter_inbound, "_dormir_debounce", AsyncMock(return_value=None))
    meta_adapter_inbound._DEBOUNCE_TASKS.clear()
    yield
    meta_adapter_inbound._DEBOUNCE_TASKS.clear()
