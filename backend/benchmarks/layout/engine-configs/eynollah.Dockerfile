FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONHASHSEED=0 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Eynollah 0.9.0 declares GPU-only ONNX Runtime and TensorRT dependencies even
# though its inference code supports CPUExecutionProvider. This portable CPU
# image makes that substitution explicit and records the actual provider and
# built image architecture in every run.
RUN python -m pip install --no-cache-dir \
        "ocrd==3.13.2" \
        "onnxruntime==1.28.0" \
        "scikit-learn==1.9.0" \
        "scikit-image==0.26.0" \
        "tabulate==0.10.0" \
    && python -m pip download --no-deps --dest /tmp "eynollah==0.9.0" \
    && echo "c3680a1c9047ff344500e8f585927876d01d4234b73abd1b1e64fd5f4735e97c  /tmp/eynollah-0.9.0-py3-none-any.whl" | sha256sum --check \
    && python -m pip install --no-cache-dir --no-deps /tmp/eynollah-0.9.0-py3-none-any.whl \
    && rm /tmp/eynollah-0.9.0-py3-none-any.whl \
    && python -c "from importlib.metadata import version; import onnxruntime; assert version('eynollah') == '0.9.0'; assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()" \
    && eynollah --help >/dev/null

WORKDIR /work
