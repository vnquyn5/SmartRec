# AI - Pham vi chua co testcase inference

## D. Gioi han test theo implementation hien tai

| Module source | Trang thai | Ket luan test |
|---|---|---|
| `app/pipelines/audio_pipeline.py` | Chua co xu ly | Chua the tao expected ket qua transcription/audio analysis |
| `app/pipelines/nlp_pipeline.py` | Chua co xu ly | Chua the tao expected ket qua NLP/recommendation |
| `app/pipelines/vision_pipeline.py` | Chua co xu ly | Chua the tao expected ket qua vision |
| `app/api/routes.py` | Chi co `/` va `/health` | Khong co API inference de kiem thu qua HTTP |
