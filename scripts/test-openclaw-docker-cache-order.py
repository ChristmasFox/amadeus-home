from pathlib import Path

source = Path('infra/docker/casaos/openclaw/Dockerfile').read_text()
markers = [
    'RUN apt-get update',
    'ARG TARGETARCH',
    'COPY infra/docker/casaos/openclaw/ffmpeg-clean-env.cjs',
    'COPY plugins/amadeus/package.json',
    'npm install --omit=dev',
    'COPY plugins/amadeus/dist/index.js',
    'COPY scripts/openclaw-voice-*.mjs',
    'RUN node /tmp/patch-openclaw-channel-identity.mjs',
]
positions = [source.index(marker) for marker in markers]
assert positions == sorted(positions), 'stable OS/glibc/npm layers must precede plugin and Voice patch inputs'
assert source.count('COPY plugins/amadeus/package.json') == 1
assert source.count('RUN apt-get update') == 1
print('OPENCLAW_CACHE_ORDER=passed')
