# Modèles du mot d'activation « Jean-Claude »

- `melspectrogram.onnx`, `embedding_model.onnx` : extraction de caractéristiques, openWakeWord v0.5.1
  (Apache 2.0) — https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1
- `jean_claude.onnx` : modèle maison, entraîné par `scripts/train-wakeword.py` sur les prises
  enregistrées sur /wakeword, des voix Piper et les features négatives publiées par openWakeWord.
- `hey_jarvis_v0.1.onnx` : ancien modèle pré-entraîné (CC BY-NC-SA 4.0), plus chargé par défaut.

Utilisés par `src/voice/wakeWord.ts`, exécutés dans le navigateur via onnxruntime-web.
