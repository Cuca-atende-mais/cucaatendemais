# Dados extraídos do banco cuca (produção) em 2026-09-23, dias em UTC
DIAS=[f"2026-09-{d:02d}" for d in range(1,24)]
# rag_retrieval_logs (Institucional) por camada — só existe a partir de 12/09
RAG={
"2026-09-12":{"programacao_completa":2,"resposta_canned":3,"vetorial":4},
"2026-09-13":{"programacao_completa":1,"resposta_canned":1,"vetorial":4},
"2026-09-14":{"programacao_completa":1,"resposta_canned":3,"sem_match_rag":5,"vetorial":6},
"2026-09-15":{"handover":1,"programacao_completa":3,"resposta_canned":4,"sem_match_rag":2,"vetorial":8},
"2026-09-16":{"deterministica_metadata":3,"encerramento":1,"handover":2,"programacao_completa":6,"resposta_canned":18,"sem_match_rag":3,"vetorial":26},
"2026-09-17":{"deterministica_metadata":6,"encerramento":36,"nao_aplicavel":183,"programacao_completa":26,"resposta_canned":329,"sem_match_rag":30,"vetorial":126},
"2026-09-18":{"deterministica_metadata":2,"encerramento":8,"handover":1,"nao_aplicavel":11,"programacao_completa":13,"resposta_canned":64,"sem_match_rag":12,"vetorial":40},
"2026-09-19":{"deterministica_metadata":9,"encerramento":3,"programacao_completa":6,"resposta_canned":28,"sem_match_rag":17,"vetorial":25},
"2026-09-20":{"encerramento":8,"programacao_completa":1,"resposta_canned":21,"sem_match_rag":2,"vetorial":9},
"2026-09-21":{"ambiguidade_unidade":1,"deterministica_metadata":21,"encerramento":5,"handover":1,"programacao_completa":37,"resposta_canned":85,"sem_match_rag":51,"vetorial":109},
"2026-09-22":{"deterministica_metadata":25,"deterministica_texto":1,"encerramento":4,"handover":4,"programacao_completa":26,"resposta_canned":83,"sem_match_rag":33,"vetorial":78},
"2026-09-23":{"deterministica_metadata":11,"encerramento":7,"programacao_completa":13,"resposta_canned":78,"sem_match_rag":18,"vetorial":47},
}
# mensagens por agente (UTC): (resp agente, msgs lead)
MSG_EMP={"01":(389,360),"02":(338,333),"03":(311,296),"04":(221,212),"05":(65,63),"06":(399,402),"07":(337,336),"08":(449,424),"09":(294,272),"10":(309,313),"11":(487,503),"12":(159,160),"13":(229,233),"14":(451,471),"15":(470,510),"16":(558,555),"17":(705,663),"18":(950,899),"19":(284,290),"20":(55,51),"21":(383,374),"22":(733,732),"23":(669,654)}
MSG_INST={"01":(17,7),"02":(41,35),"03":(0,0),"04":(27,26),"05":(24,21),"06":(16,13),"07":(2,2),"08":(61,50),"09":(191,188),"10":(211,162),"11":(77,59),"12":(17,17),"13":(6,6),"14":(15,19),"15":(46,24),"16":(92,98),"17":(829,809),"18":(224,223),"19":(101,97),"20":(42,46),"21":(484,416),"22":(415,331),"23":(271,206)}
CONV_INST_NOVAS={"08":3,"09":21,"10":17,"11":8,"12":4,"13":1,"14":2,"15":4,"16":14,"17":456,"18":45,"19":15,"20":8,"21":70,"22":54,"23":42}
CONV_INST_DISPARO={"17":198,"18":16,"19":9,"20":8,"21":1,"22":1}
# CV / banco de talentos
CAND_OCR={"01":15,"02":61,"03":6,"04":2,"05":1,"06":9,"07":4,"08":4,"09":1,"10":6,"11":9,"12":5,"13":4,"14":10,"15":9,"16":56,"17":110,"18":41,"19":11,"20":2,"21":11,"22":14,"23":86}
TB_UPD={"01":2,"02":59,"03":2,"04":5,"05":0,"06":5,"07":8,"08":14,"09":5,"10":2,"11":13,"12":6,"13":8,"14":9,"15":13,"16":48,"17":86,"18":15,"19":4,"20":2,"21":3,"22":17,"23":100}
CAND_NEW={"01":26,"02":72,"03":24,"04":9,"05":3,"06":31,"07":30,"08":31,"09":14,"10":15,"11":35,"12":12,"13":16,"14":27,"15":35,"16":78,"17":137,"18":76,"19":23,"20":4,"21":22,"22":59,"23":128}
CHUNKS_NEW={"01":1,"02":23,"03":1,"08":3,"10":3,"11":1,"12":513,"14":3,"15":2,"16":3,"17":17,"18":1,"22":3,"23":32}
ATIV_NEW={"22":42,"23":409}
LOGS_DISPARO={"17":633}
CONF_AE={"17":401,"18":23,"19":12,"20":5}
