FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101

LABEL org.opencontainers.image.title="OpenClaw Amadeus agent" \
      org.opencontainers.image.source="agent-monorepo" \
      org.opencontainers.image.version="2026.9.4"

WORKDIR /app

# The plugin bundle is self-contained; the OpenClaw SDK remains provided by
# the pinned base image. No source, credentials, media directory, or Docker
# socket is copied into the image.
USER root
# The pinned WhatsApp channel converts OpenAI-compatible MP3 replies to native
# 48 kHz Ogg/Opus voice notes. Without ffmpeg, a healthy TTS response cannot be
# delivered as WhatsApp PTT. Keep this in the immutable OpenClaw image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus

# The official Longbridge arm64 binding is built against glibc 2.39 while the
# pinned OpenClaw image is Debian 12 (glibc 2.36). Keep the base image intact
# and run Node through a private glibc 2.39 loader so the native SDK binding
# can load without replacing the container's system libc.
# Node's private glibc path must remain in its process environment because
# OpenClaw spawns SQLite workers via process.execPath. Debian media binaries
# get a narrow clean-env wrapper below instead of changing Node's execPath.
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      arm64) \
        libc_url='https://ports.ubuntu.com/ubuntu-ports/pool/main/g/glibc/libc6_2.39-0ubuntu8.9_arm64.deb'; \
        libc_sha='ad109797c5f78a5eeb6d4c296bfbaae68b239111a0c9ac0eb97b8d430284ac45'; \
        libc_dir='aarch64-linux-gnu'; \
        ;; \
      amd64) \
        libc_url='https://archive.ubuntu.com/ubuntu/pool/main/g/glibc/libc6_2.39-0ubuntu8.9_amd64.deb'; \
        libc_sha='ff5557d99b51f761c4b7c92368b9cc45565eda17df9bf9eb4b134d09825008be'; \
        libc_dir='x86_64-linux-gnu'; \
        ;; \
      *) echo "unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/amadeus-glibc; \
    curl --fail --silent --show-error --location "$libc_url" --output /tmp/libc6.deb; \
    echo "$libc_sha  /tmp/libc6.deb" | sha256sum --check --status; \
    dpkg-deb --extract /tmp/libc6.deb /opt/amadeus-glibc; \
    loader_path=$(printf '%s\n' /opt/amadeus-glibc/usr/lib/$libc_dir/ld-linux-*.so.*); \
    cp "$loader_path" /lib/ld-amadeus.so; \
    cp /usr/local/bin/node /usr/local/bin/node.glibc; \
    node -e 'const fs=require("node:fs"); const path="/usr/local/bin/node.glibc"; const data=fs.readFileSync(path); const oldPath=Buffer.from("/lib/ld-linux-aarch64.so.1\0"); const oldX64Path=Buffer.from("/lib64/ld-linux-x86-64.so.2\0"); const newPath=Buffer.from("/lib/ld-amadeus.so\0"); const offset=data.indexOf(oldPath); const x64Offset=data.indexOf(oldX64Path); const start=offset>=0?offset:x64Offset; const old=offset>=0?oldPath:oldX64Path; if(start<0) throw new Error("could not locate Node ELF interpreter"); if(newPath.length>old.length) throw new Error("replacement ELF interpreter path is too long"); newPath.copy(data,start); data.fill(0,start+newPath.length,start+old.length); fs.writeFileSync(path,data);'; \
    printf '%s\n' '#!/bin/sh' 'set -eu' 'case "$(uname -m)" in' '  aarch64) libc_dir=aarch64-linux-gnu ;;' '  x86_64) libc_dir=x86_64-linux-gnu ;;' '  *) echo "unsupported runtime architecture" >&2; exit 1 ;;' 'esac' 'export LD_LIBRARY_PATH="/opt/amadeus-glibc/usr/lib/$libc_dir:/lib/$libc_dir:/usr/lib/$libc_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' 'exec /usr/local/bin/node.glibc "$@"' > /usr/local/bin/node; \
    chmod 755 /usr/local/bin/node /usr/local/bin/node.glibc; \
    rm -f /tmp/libc6.deb

COPY infra/docker/casaos/openclaw/ffmpeg-clean-env.cjs /opt/amadeus/ffmpeg-clean-env.cjs
RUN set -eux; \
    mkdir -p /usr/libexec/amadeus; \
    mv /usr/bin/ffmpeg /usr/libexec/amadeus/ffmpeg.real; \
    mv /usr/bin/ffprobe /usr/libexec/amadeus/ffprobe.real; \
    cp /opt/amadeus/ffmpeg-clean-env.cjs /usr/bin/ffmpeg; \
    cp /opt/amadeus/ffmpeg-clean-env.cjs /usr/bin/ffprobe; \
    chmod 755 /usr/bin/ffmpeg /usr/bin/ffprobe; \
    node -e 'const {spawnSync}=require("node:child_process"); const p=spawnSync("/usr/bin/ffmpeg",["-hide_banner","-version"],{encoding:"utf8"}); if(p.status!==0) process.exit(1);'

# The official Longbridge SDK ships a platform-native quote transport. Keep it
# external to esbuild and install the linux/arm64 optional binary in the
# extension's dependency boundary.
COPY plugins/amadeus/package.json /app/dist/extensions/amadeus/package.json
RUN cd /app/dist/extensions/amadeus \
    && node -e 'const fs=require("fs"); const path="package.json"; const pkg=JSON.parse(fs.readFileSync(path,"utf8")); delete pkg.devDependencies; fs.writeFileSync(path, JSON.stringify(pkg)+"\n");' \
    && npm install --omit=dev --legacy-peer-deps --ignore-scripts=false

# Install our business plugins in OpenClaw's bundled-extension tree. This keeps
# the plugin runtime trusted for narrow host-owned capabilities such as the
# in-process WhatsApp owner notifier; load.paths would classify them as local
# external plugins and deny Gateway runtime requests.
COPY plugins/pubg/dist/index.js /app/dist/extensions/pubg/dist/index.js
COPY plugins/pubg/dist/index.js.map /app/dist/extensions/pubg/dist/index.js.map
COPY plugins/pubg/dist/migrate.js /app/dist/extensions/pubg/dist/migrate.js
COPY plugins/pubg/dist/migrate.js.map /app/dist/extensions/pubg/dist/migrate.js.map
COPY plugins/pubg/openclaw.plugin.json /app/dist/extensions/pubg/openclaw.plugin.json
COPY plugins/pubg/package.json /app/dist/extensions/pubg/package.json
COPY plugins/pubg/README.md /app/dist/extensions/pubg/README.md
COPY plugins/pubg/skills /app/dist/extensions/pubg/skills
COPY plugins/amadeus/dist/index.js /app/dist/extensions/amadeus/dist/index.js
COPY plugins/amadeus/dist/index.js.map /app/dist/extensions/amadeus/dist/index.js.map
COPY plugins/amadeus/openclaw.plugin.json /app/dist/extensions/amadeus/openclaw.plugin.json
COPY plugins/amadeus/README.md /app/dist/extensions/amadeus/README.md
COPY plugins/amadeus/skills /app/dist/extensions/amadeus/skills

# Patch only after stable OS/runtime, dependency install, and plugin payload.
# The volume-installed WhatsApp package is patched from the same Git modules
# during explicit CasaOS apply; no compiled patch source enters runtime image.
COPY scripts/patch-openclaw-channel-identity.mjs /tmp/patch-openclaw-channel-identity.mjs
COPY scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs /tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs
COPY scripts/openclaw-voice-*.mjs /tmp/
RUN node /tmp/patch-openclaw-channel-identity.mjs --core-root /app/dist \
    && node /tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs --core-root /app/dist \
    && rm /tmp/patch-openclaw-channel-identity.mjs /tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs /tmp/openclaw-voice-*.mjs

USER node
