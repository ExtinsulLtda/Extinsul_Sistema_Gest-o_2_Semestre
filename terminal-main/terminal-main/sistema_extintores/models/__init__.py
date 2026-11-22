"""Pacote de modelos de domínio do sistema de controle de extintores."""

from models.extintor import Extintor
from models.ordem_servico import OrdemServico
from models.peca import Peca
from models.estoque import Estoque

__all__ = ["Extintor", "OrdemServico", "Peca", "Estoque"]
