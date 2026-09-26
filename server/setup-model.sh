#!/bin/sh
# One-time install of the Brazilian Portuguese embedding model the server uses for grouping.
# Downloads ~450 MB once, keeps ~110 MB in ./models. Needs curl and python3 (only to quantize).
# The Docker build runs this too. Without it the server falls back to word match.
set -eu
cd "$(dirname "$0")"

# ONNX export of PORTULAN/serafim-100m-portuguese-pt-sentence-encoder (BERTimbau-based), pinned to a commit.
MODEL=https://huggingface.co/tigopt/serafim-100m-portuguese-pt-sentence-encoder-onnx/resolve/4b9c8b1aafb06c03ffe1ee44d0c712e1fbd8175d
DIR=models/serafim-100m
PY=${PYTHON:-python3}

mkdir -p "$DIR/onnx"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  [ -s "$DIR/$f" ] || curl -fsL -o "$DIR/$f" "$MODEL/$f"
done

if [ ! -s "$DIR/onnx/model_quantized.onnx" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "Downloading Serafim 100m (434 MB)..."
  curl -fL --progress-bar -o "$TMP/model.onnx" "$MODEL/model.onnx"
  echo "Quantizing to 8-bit (~110 MB)..."
  "$PY" -m venv "$TMP/venv"
  "$TMP/venv/bin/pip" install -q onnxruntime onnx
  "$TMP/venv/bin/python" -c "from onnxruntime.quantization import quantize_dynamic, QuantType; \
quantize_dynamic('$TMP/model.onnx', '$DIR/onnx/model_quantized.onnx', weight_type=QuantType.QUInt8)"
fi

echo "Model ready in server/$DIR"
